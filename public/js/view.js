// 경기 화면 — 서버에서 받은 상태를 부드럽게 이어 그린다 (아이·선생님 공용)
import { W, H, FIELD, TEAM, drawField, drawPlayer, drawBall, hairOf } from './pixel.js';
import { play, startBgm, stopBgm } from './sound.js';
import { TICK } from './game.js';

// 받은 상태 두 개 사이를 그린다. 서버 경기는 틱 번호(n)로 시간을 맞춰
// 와이파이에서 몇 개가 늦게·한꺼번에 와도 끊기지 않게 조금 넉넉히 늦춰 그린다
const DELAY_NET = 140; // ms (서버 경기, 15번/초)
const DELAY_LOCAL = 70; // ms (혼자 연습)
const TICK_MS = TICK * 1000;

export function createView(root) {
  root.innerHTML = `
    <div class="stage">
      <canvas class="px"></canvas>
      <canvas class="tags"></canvas>
      <div class="hud">
        <div class="score red"><span class="tname">빨강</span><b data-r>0</b></div>
        <div class="clock"><b data-t>3:00</b><span data-dbl class="dbl hidden">⚡ 한 골 2점</span></div>
        <div class="score blue"><b data-b>0</b><span class="tname">파랑</span></div>
      </div>
      <div class="keyhint" data-keys>← ↑ → ↓ 움직이기 · Z 꾹 패스 (공 없으면 태클) · X 꾹 슛</div>
      <div class="banner hidden" data-banner></div>
      <div class="ribbon hidden" data-ribbon></div>
    </div>`;
  const px = root.querySelector('canvas.px');
  const tags = root.querySelector('canvas.tags');
  const stage = root.querySelector('.stage');
  const g = px.getContext('2d');
  const tg = tags.getContext('2d');
  px.width = W;
  px.height = H;
  const el = (s) => root.querySelector(s);
  const hud = { r: el('[data-r]'), b: el('[data-b]'), t: el('[data-t]'), dbl: el('[data-dbl]') };
  const banner = el('[data-banner]');
  const ribbon = el('[data-ribbon]');

  let roster = new Map(); // id → { name, team, hair }
  let you = null;
  let snaps = [];
  let running = false;
  let scale = 4;
  let bannerTimer = null;
  let ballSpin = 0;
  let lastBall = null;
  let paused = false;
  let charge = null; // { a: 'pass'|'shoot', t0 }

  function fit() {
    const availW = root.clientWidth || window.innerWidth;
    const availH = root.clientHeight || window.innerHeight;
    scale = Math.max(1, Math.floor(Math.min(availW / W, availH / H)));
    // 정수배가 너무 작으면(작은 창) 소수배라도 꽉 채운다
    const fill = Math.min(availW / W, availH / H);
    if (fill - scale > 0.6 && scale < 3) scale = fill;
    const cw = Math.floor(W * scale);
    const ch = Math.floor(H * scale);
    stage.style.width = cw + 'px';
    stage.style.height = ch + 'px';
    // 점수판은 위쪽 나무 벽, 키 안내는 아래쪽 벽 위에 얹는다
    stage.style.setProperty('--wall-top', Math.floor(FIELD.top * scale) + 'px');
    stage.style.setProperty('--wall-bottom', Math.floor((H - FIELD.bottom) * scale) + 'px');
    stage.style.setProperty('--u', scale + 'px');
    px.style.width = cw + 'px';
    px.style.height = ch + 'px';
    const dpr = window.devicePixelRatio || 1;
    tags.width = Math.floor(cw * dpr);
    tags.height = Math.floor(ch * dpr);
    tags.style.width = cw + 'px';
    tags.style.height = ch + 'px';
    tg.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', fit);

  function showBanner(text, ms = 1600, cls = '') {
    banner.textContent = text;
    banner.className = 'banner ' + cls;
    clearTimeout(bannerTimer);
    if (ms > 0) bannerTimer = setTimeout(() => banner.classList.add('hidden'), ms);
  }

  function setRibbon(text) {
    if (text) {
      ribbon.textContent = text;
      ribbon.classList.remove('hidden');
    } else ribbon.classList.add('hidden');
  }

  function start(rosterList, youId) {
    roster = new Map(rosterList.map((r) => [r.id, { ...r, hair: hairOf(r.name) }]));
    you = youId;
    snaps = [];
    lastBall = null;
    paused = false;
    banner.classList.add('hidden');
    setRibbon(youId == null ? '관전 중' : '');
    root.querySelector('[data-keys]').classList.toggle('hidden', youId == null);
    fit();
    if (you != null) {
      const me = roster.get(you);
      showBanner(`나는 ${TEAM[me.team].name} 팀!`, 1800, me.team);
    }
    startBgm();
    if (!running) {
      running = true;
      requestAnimationFrame(frame);
    }
  }

  function stop() {
    running = false;
    stopBgm();
  }

  function setPaused(on) {
    paused = on;
    if (on) showBanner('⏸ 잠깐 멈춤', 0);
    else banner.classList.add('hidden');
  }

  function myHasBall() {
    const s = snaps[snaps.length - 1];
    if (!s || you == null) return false;
    const q = s.p.find((x) => x[0] === you);
    return !!(q && q[8]);
  }

  function setCharge(c) {
    charge = c;
  }

  function push(s) {
    s.at = performance.now();
    s.st = s.n != null ? s.n * TICK_MS : s.at; // 서버 시각(틱 번호) 기준
    snaps.push(s);
    if (snaps.length > 30) snaps.shift();
    // 소리·알림
    for (const ev of s.ev || []) {
      if (ev.e === 'goal') {
        play('goal', ev.points);
        showBanner(ev.points === 2 ? `골!! +2점 (${TEAM[ev.team].name})` : `골!! (${TEAM[ev.team].name})`, 2000, ev.team);
      } else if (ev.e === 'double') {
        play('double');
        showBanner('⚡ 이제부터 한 골 2점!', 2600, 'gold');
      } else if (ev.e === 'whistle') play('whistle');
      else if (ev.e === 'end') play('end');
      else play(ev.e);
    }
    hud.r.textContent = s.sc[0];
    hud.b.textContent = s.sc[1];
    const m = Math.floor(s.tl / 60);
    const sec = String(s.tl % 60).padStart(2, '0');
    hud.t.textContent = `${m}:${sec}`;
    hud.dbl.classList.toggle('hidden', !s.dbl);
    hud.t.classList.toggle('hurry', s.dbl);
  }

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (!snaps.length) return;
    // 가장 빨리 도착한 것 기준으로 서버 시각 ↔ 내 시각 차이를 잡는다
    const net = snaps[snaps.length - 1].n != null;
    let off = Infinity;
    for (const x of snaps) off = Math.min(off, x.at - x.st);
    const target = now - off - (net ? DELAY_NET : DELAY_LOCAL);
    let a = snaps[0];
    let b = snaps[0];
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].st <= target) {
        a = snaps[i];
        b = snaps[i + 1] || snaps[i];
        break;
      }
    }
    const span = b.st - a.st;
    const k = span > 0 ? Math.min(1, Math.max(0, (target - a.st) / span)) : 1;
    const lerp = (x, y) => x + (y - x) * k;
    const t = now / 1000;

    drawField(g);
    const bmap = new Map(b.p.map((q) => [q[0], q]));
    const players = a.p.map((q) => {
      const q2 = bmap.get(q[0]) || q;
      const info = roster.get(q[0]) || { name: '?', team: 'red', hair: 0 };
      return {
        id: q[0],
        x: lerp(q[1], q2[1]),
        y: lerp(q[2], q2[2]),
        face: q2[3] || (info.team === 'red' ? 1 : -1),
        moving: q2[4] && !paused,
        kicking: q2[5],
        tackling: q2[6],
        stunned: q2[7],
        hasBall: q2[8],
        team: info.team,
        hair: info.hair,
        name: info.name,
      };
    });
    const bx = lerp(a.b[0], b.b[0]);
    const by = lerp(a.b[1], b.b[1]);
    if (lastBall) ballSpin += Math.hypot(bx - lastBall[0], by - lastBall[1]) * 0.3;
    lastBall = [bx, by];

    // 위에서부터 차례로 (아래 있는 선수가 앞에)
    const items = players.map((p) => ({ y: p.y, draw: () => drawPlayer(g, p, t) }));
    items.push({ y: by, draw: () => drawBall(g, bx, by, ballSpin) });
    items.sort((p, q) => p.y - q.y);
    for (const it of items) it.draw();

    // 이름표는 선명한 글자로 따로
    const cw = W * scale;
    const ch = H * scale;
    tg.clearRect(0, 0, cw, ch);
    const fs = Math.max(10, Math.round(scale * 3));
    tg.font = `${fs}px Galmuri11, Galmuri9, sans-serif`;
    tg.textAlign = 'center';
    tg.textBaseline = 'bottom';
    for (const p of players) {
      const mine = p.id === you;
      const x = p.x * scale;
      const y = (p.y - 9) * scale;
      const w = tg.measureText(p.name).width + fs * 0.6;
      tg.fillStyle = mine ? '#ffe14d' : p.team === 'red' ? 'rgba(162,38,51,0.85)' : 'rgba(27,77,155,0.85)';
      tg.fillRect(x - w / 2, y - fs - 2, w, fs + 4);
      tg.fillStyle = mine ? '#1a1c2c' : '#fff';
      tg.fillText(p.name, x, y + 1);
      if (p.stunned) {
        // 어지러움: 머리 위에서 도는 별
        tg.font = `${fs}px sans-serif`;
        for (let k = 0; k < 3; k++) {
          const a = t * 8 + (k * Math.PI * 2) / 3;
          tg.fillText('⭐', x + Math.cos(a) * fs * 0.9, y - fs - 2 + Math.sin(a) * fs * 0.35);
        }
        tg.font = `${fs}px Galmuri11, Galmuri9, sans-serif`;
      }
      if (mine && charge) {
        // 게이지: 이름표 위
        const v = Math.min(1, (performance.now() - charge.t0) / 1000);
        const gw = fs * 4.8;
        const gh = Math.max(7, fs * 0.7);
        const gy = y - fs - 6 - gh - fs * 0.9;
        tg.fillStyle = '#1a1c2c';
        tg.fillRect(x - gw / 2 - 2, gy - 2, gw + 4, gh + 4);
        tg.fillStyle = '#3a4466';
        tg.fillRect(x - gw / 2, gy, gw, gh);
        tg.fillStyle = charge.a === 'shoot' ? (v > 0.85 ? '#ff4d4d' : v > 0.5 ? '#ffb000' : '#ffe14d') : '#5fd3ff';
        tg.fillRect(x - gw / 2, gy, gw * v, gh);
        tg.fillStyle = '#fff';
        tg.font = `${Math.round(fs * 0.8)}px Galmuri11, sans-serif`;
        tg.fillText(charge.a === 'shoot' ? '슛' : '패스', x - gw / 2 - fs * 1.1, gy + gh + 2);
        tg.font = `${fs}px Galmuri11, Galmuri9, sans-serif`;
      }
      if (mine && !charge) {
        const bob = Math.sin(t * 6) * scale * 0.6;
        const ty = y - fs - 6 + bob;
        tg.fillStyle = '#ffe14d';
        tg.strokeStyle = '#1a1c2c';
        tg.lineWidth = 2;
        tg.beginPath();
        tg.moveTo(x - fs * 0.5, ty - fs * 0.6);
        tg.lineTo(x + fs * 0.5, ty - fs * 0.6);
        tg.lineTo(x, ty);
        tg.closePath();
        tg.fill();
        tg.stroke();
      }
    }
  }

  return { start, stop, push, setPaused, showBanner, fit, myHasBall, setCharge };
}
