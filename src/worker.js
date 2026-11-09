// 교실 축구 서버 — Cloudflare Worker + Durable Objects
// ClassRoom: 반 하나 = DO 하나 (아이들·경기·기록)
// Registry: 4자리 방 코드 → 반

import { DurableObject } from 'cloudflare:workers';
import { createMatch, step, setInput, snapshot, result, TICK } from '../public/js/game.js';
import {
  createRoster,
  join,
  leave,
  kick,
  randomTeams,
  cycleTeam,
  teamsOf,
  markPlayed,
  canStart,
  cleanName,
} from './room.js';

const CLASS_NAME_MAX = 12;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === '/api/class' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const name = String(body.name ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, CLASS_NAME_MAX);
      if (!name) return json({ error: '반 이름을 적어 주세요' }, 400);
      const classId = crypto.randomUUID();
      const key = randomHex(16);
      const stub = env.ROOM.get(env.ROOM.idFromName(classId));
      await stub.init(classId, name, key);
      return json({ classId, key, name });
    }

    if (url.pathname === '/ws/teacher') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
      const classId = url.searchParams.get('class') || '';
      if (!/^[0-9a-f-]{36}$/.test(classId)) return wsError('반을 찾을 수 없어요');
      const stub = env.ROOM.get(env.ROOM.idFromName(classId));
      return stub.fetch(req);
    }

    if (url.pathname === '/ws/play') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
      const code = url.searchParams.get('code') || '';
      if (!/^\d{4}$/.test(code)) return wsError('방 코드는 숫자 4자리예요');
      const reg = env.REGISTRY.get(env.REGISTRY.idFromName('registry'));
      const classId = await reg.lookup(code);
      if (!classId) return wsError('그런 방 코드가 없어요. 다시 확인해 주세요');
      const stub = env.ROOM.get(env.ROOM.idFromName(classId));
      return stub.fetch(req);
    }

    return new Response('Not found', { status: 404 });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 연결을 받자마자 이유를 보내고 닫는다 (브라우저는 실패한 업그레이드의 이유를 못 읽어서)
function wsError(msg) {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  server.send(JSON.stringify({ t: 'error', msg }));
  server.close(4000, 'error');
  return new Response(null, { status: 101, webSocket: client });
}

// ───────────────────────── 방 코드
export class Registry extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS codes (code TEXT PRIMARY KEY, class_id TEXT NOT NULL, created INTEGER NOT NULL)'
    );
  }

  async alloc(classId) {
    const now = Date.now();
    this.sql.exec('DELETE FROM codes WHERE created < ?', now - 24 * 3600 * 1000);
    this.sql.exec('DELETE FROM codes WHERE class_id = ?', classId);
    for (let i = 0; i < 200; i++) {
      const code = String(1000 + Math.floor(Math.random() * 9000));
      const used = this.sql.exec('SELECT 1 FROM codes WHERE code = ?', code).toArray().length;
      if (used) continue;
      this.sql.exec('INSERT INTO codes VALUES (?, ?, ?)', code, classId, now);
      return code;
    }
    throw new Error('no code');
  }

  async lookup(code) {
    const row = this.sql
      .exec('SELECT class_id FROM codes WHERE code = ? AND created > ?', code, Date.now() - 24 * 3600 * 1000)
      .toArray()[0];
    return row ? row.class_id : null;
  }
}

// ───────────────────────── 반
export class ClassRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS stats (name TEXT PRIMARY KEY, games INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0, goals INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS matches (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL,
        red INTEGER NOT NULL, blue INTEGER NOT NULL, detail TEXT NOT NULL);
    `);
    this.roster = createRoster();
    this.sockets = new Map(); // ws → { role: 'teacher'|'kid', name }
    this.code = null;
    this.view = 'lobby'; // lobby | match | result
    this.match = null;
    this.matchIds = new Map(); // 이름 → 선수 id
    this.paused = false;
    this.timer = null;
    this.lastResult = null;
  }

  meta(k) {
    const row = this.sql.exec('SELECT v FROM meta WHERE k = ?', k).toArray()[0];
    return row ? row.v : null;
  }

  async init(classId, name, key) {
    this.sql.exec('INSERT OR REPLACE INTO meta VALUES (?, ?)', 'classId', classId);
    this.sql.exec('INSERT OR REPLACE INTO meta VALUES (?, ?)', 'name', name);
    this.sql.exec('INSERT OR REPLACE INTO meta VALUES (?, ?)', 'key', key);
  }

  async fetch(req) {
    const url = new URL(req.url);
    const pair = new WebSocketPair();
    const [client, ws] = Object.values(pair);
    ws.accept();

    const fail = (msg) => {
      ws.send(JSON.stringify({ t: 'error', msg }));
      ws.close(4000, 'error');
      return new Response(null, { status: 101, webSocket: client });
    };

    if (url.pathname === '/ws/teacher') {
      const key = url.searchParams.get('key') || '';
      const saved = this.meta('key');
      if (!saved || !timingSafeEqual(saved, key)) return fail('선생님 열쇠가 맞지 않아요');
      if (!this.code) {
        const reg = this.env.REGISTRY.get(this.env.REGISTRY.idFromName('registry'));
        this.code = await reg.alloc(this.meta('classId'));
      }
      this.sockets.set(ws, { role: 'teacher' });
      this.wire(ws);
      this.send(ws, { t: 'welcome', role: 'teacher', code: this.code, className: this.meta('name') });
      this.sendLobby(ws);
      this.sendCurrent(ws);
      return new Response(null, { status: 101, webSocket: client });
    }

    // 아이
    const name = cleanName(url.searchParams.get('name'));
    const res = join(this.roster, name);
    if (!res.ok) {
      return fail(res.reason === 'taken' ? '같은 이름이 벌써 있어요. 다른 이름으로 들어와 주세요' : '이름을 적어 주세요');
    }
    this.sockets.set(ws, { role: 'kid', name: res.kid.name });
    this.wire(ws);
    this.send(ws, { t: 'welcome', role: 'kid', name: res.kid.name, className: this.meta('name') });
    this.broadcastLobby();
    this.sendCurrent(ws);
    return new Response(null, { status: 101, webSocket: client });
  }

  wire(ws) {
    // 모두 나가서 멈췄던 경기를 다시 돌린다
    if (this.view === 'match' && this.match && !this.timer) this.startTimer();
    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      } catch {
        return;
      }
      const who = this.sockets.get(ws);
      if (!who) return;
      if (who.role === 'kid') this.onKid(who, msg);
      else this.onTeacher(ws, msg);
    });
    const gone = () => {
      const who = this.sockets.get(ws);
      this.sockets.delete(ws);
      if (who && who.role === 'kid') {
        // 같은 이름으로 다른 창이 남아 있지 않을 때만 나감 처리
        const still = [...this.sockets.values()].some((w) => w.role === 'kid' && w.name === who.name);
        if (!still) {
          leave(this.roster, who.name);
          if (this.match) {
            const id = this.matchIds.get(who.name);
            if (id != null) setInput(this.match, id, { dx: 0, dy: 0 });
          }
          this.broadcastLobby();
        }
      }
      if (this.sockets.size === 0) this.stopTimer();
    };
    ws.addEventListener('close', gone);
    ws.addEventListener('error', gone);
  }

  onKid(who, msg) {
    if (!this.match || this.view !== 'match' || this.paused) return;
    const id = this.matchIds.get(who.name);
    if (id == null) return;
    if (msg.t === 'i') setInput(this.match, id, { dx: msg.dx, dy: msg.dy });
    else if (msg.t === 'k') setInput(this.match, id, { pass: msg.a === 'pass', shoot: msg.a === 'shoot' });
  }

  onTeacher(ws, msg) {
    switch (msg.t) {
      case 'random':
        if (this.view === 'match') return;
        randomTeams(this.roster, clampInt(msg.max, 2, 30, 12));
        this.broadcastLobby();
        break;
      case 'cycle':
        if (this.view === 'match') return;
        cycleTeam(this.roster, String(msg.name), clampInt(msg.max, 2, 30, 12));
        this.broadcastLobby();
        break;
      case 'kick': {
        const name = String(msg.name);
        for (const [w, who] of this.sockets) {
          if (who.role === 'kid' && who.name === name) {
            this.send(w, { t: 'error', msg: '선생님이 방에서 내보냈어요' });
            this.sockets.delete(w);
            try {
              w.close(4001, 'kicked');
            } catch {}
          }
        }
        kick(this.roster, name);
        this.broadcastLobby();
        break;
      }
      case 'start':
        this.startMatch(ws);
        break;
      case 'pause':
        if (this.view !== 'match') return;
        this.paused = !this.paused;
        this.broadcast({ t: 'paused', on: this.paused });
        break;
      case 'stop':
        if (this.view !== 'match') return;
        this.endMatch(false);
        break;
      case 'next':
        this.view = 'lobby';
        this.lastResult = null;
        this.broadcast({ t: 'lobbyView' });
        this.broadcastLobby();
        break;
      case 'records':
        this.send(ws, { t: 'records', rows: this.records(), matches: this.recentMatches() });
        break;
    }
  }

  startMatch(ws) {
    if (this.view === 'match') return;
    if (!canStart(this.roster)) {
      this.send(ws, { t: 'notice', msg: '빨강·파랑에 한 명씩은 있어야 시작할 수 있어요' });
      return;
    }
    markPlayed(this.roster);
    const t = teamsOf(this.roster);
    const roster = [];
    this.matchIds = new Map();
    let id = 1;
    for (const name of t.red) {
      roster.push({ id, name, team: 'red' });
      this.matchIds.set(name, id++);
    }
    for (const name of t.blue) {
      roster.push({ id, name, team: 'blue' });
      this.matchIds.set(name, id++);
    }
    this.match = createMatch(roster, { kickoffTeam: Math.random() < 0.5 ? 'red' : 'blue' });
    this.matchRoster = roster;
    this.view = 'match';
    this.paused = false;
    this.broadcastMatchStart();
    this.startTimer();
  }

  broadcastMatchStart() {
    for (const [w] of this.sockets) this.sendMatchStart(w);
  }

  sendMatchStart(w) {
    const who = this.sockets.get(w);
    const you = who && who.role === 'kid' ? this.matchIds.get(who.name) ?? null : null;
    this.send(w, { t: 'match', roster: this.matchRoster, you, paused: this.paused });
  }

  startTimer() {
    this.stopTimer();
    this.timer = setInterval(() => this.tick(), TICK * 1000);
  }

  stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    if (!this.match) return this.stopTimer();
    if (this.paused) return;
    step(this.match);
    const snap = JSON.stringify({ t: 's', ...snapshot(this.match) });
    for (const [w] of this.sockets) {
      try {
        w.send(snap);
      } catch {}
    }
    if (this.match.phase === 'end') this.endMatch(true);
  }

  endMatch(record) {
    this.stopTimer();
    const m = this.match;
    if (!m) return;
    const r = result(m);
    if (record) this.saveResult(r);
    this.lastResult = { ...r, recorded: record, roster: this.matchRoster };
    this.match = null;
    this.view = 'result';
    this.paused = false;
    this.broadcast({ t: 'result', ...this.lastResult });
  }

  saveResult(r) {
    for (const p of this.matchRoster) {
      const goals = r.goals.filter((g) => !g.own && g.name === p.name).length;
      const win = r.winner === p.team ? 1 : 0;
      this.sql.exec(
        `INSERT INTO stats (name, games, wins, goals) VALUES (?, 1, ?, ?)
         ON CONFLICT(name) DO UPDATE SET games = games + 1, wins = wins + excluded.wins, goals = goals + excluded.goals`,
        p.name,
        win,
        goals
      );
    }
    this.sql.exec(
      'INSERT INTO matches (at, red, blue, detail) VALUES (?, ?, ?, ?)',
      Date.now(),
      r.score.red,
      r.score.blue,
      JSON.stringify({ roster: this.matchRoster.map(({ name, team }) => ({ name, team })), goals: r.goals })
    );
  }

  records() {
    return this.sql
      .exec('SELECT name, games, wins, goals FROM stats ORDER BY goals DESC, wins DESC, games DESC, name')
      .toArray();
  }

  recentMatches() {
    return this.sql
      .exec('SELECT at, red, blue, detail FROM matches ORDER BY id DESC LIMIT 20')
      .toArray()
      .map((r) => ({ at: r.at, red: r.red, blue: r.blue, ...JSON.parse(r.detail) }));
  }

  // 지금 화면(경기 중·결과)을 새로 들어온 창에 맞춰 준다
  sendCurrent(w) {
    if (this.view === 'match' && this.match) {
      this.sendMatchStart(w);
      this.send(w, { t: 's', ...snapshot(this.match), ev: [] });
    } else if (this.view === 'result' && this.lastResult) {
      this.send(w, { t: 'result', ...this.lastResult });
    }
  }

  lobbyMsg() {
    const kids = [...this.roster.kids.values()].map((k) => ({
      name: k.name,
      on: k.connected,
      team: k.team,
    }));
    return { t: 'lobby', kids, view: this.view };
  }

  sendLobby(w) {
    this.send(w, this.lobbyMsg());
  }

  broadcastLobby() {
    this.broadcast(this.lobbyMsg());
  }

  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const [w] of this.sockets) {
      try {
        w.send(s);
      } catch {}
    }
  }

  send(w, obj) {
    try {
      w.send(JSON.stringify(obj));
    } catch {}
  }
}

function clampInt(v, a, b, d) {
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) return d;
  return Math.max(a, Math.min(b, v));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
