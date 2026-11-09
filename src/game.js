// 경기 계산 — 서버·화면과 떨어진 순수 코드. 단위는 도트 1칸(px).
// 화면은 320×150 도트를 정수배로 키워 그린다.

export const W = 320;
export const H = 150;
export const FIELD = { left: 10, right: 310, top: 12, bottom: 142 };
export const GOAL_HALF = 18; // 골문 높이의 절반
export const GOAL_DEPTH = 8;
export const CY = (FIELD.top + FIELD.bottom) / 2;
export const CX = (FIELD.left + FIELD.right) / 2;

export const TICK = 1 / 30;
export const MATCH_TIME = 180; // 3분
export const DOUBLE_TIME = 60; // 마지막 1분은 한 골 2점
export const KICKOFF_FREEZE = 1.5;
export const GOAL_PAUSE = 2.2;

const PLAYER_R = 4;
const BALL_R = 2.5;
const PLAYER_SPEED = 62;
const BALL_DECAY = 1.1; // 초당 감속 (지수)
const BALL_MAX = 240;
const SHOOT_SPEED = 220;
const PASS_MIN = 70;
const PASS_MAX = 150;
const KICK_RANGE = PLAYER_R + BALL_R + 4;
const KICK_COOLDOWN = 0.3;
const WALL_BOUNCE = 0.8;

// team: 'red'은 왼쪽 골을 지키고 오른쪽으로 공격, 'blue'는 반대.

export function createMatch(roster, opts = {}) {
  // roster: [{ id, name, team }]
  const m = {
    time: opts.matchTime ?? MATCH_TIME,
    phase: 'kickoff', // kickoff | play | goal | end
    phaseTime: KICKOFF_FREEZE,
    score: { red: 0, blue: 0 },
    goals: [], // { id, name, team, points, own }
    ball: { x: CX, y: CY, vx: 0, vy: 0, lastTouch: null, prevTouch: null },
    players: roster.map((r) => ({
      id: r.id,
      name: r.name,
      team: r.team,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      fx: r.team === 'red' ? 1 : -1,
      fy: 0,
      cool: 0,
      kickAnim: 0,
      input: { dx: 0, dy: 0, pass: false, shoot: false },
    })),
    events: [],
    doubleAnnounced: false,
    kickoffTeam: opts.kickoffTeam ?? 'red',
  };
  placeKickoff(m, m.kickoffTeam);
  m.events.push({ e: 'whistle' });
  return m;
}

export function isDouble(m) {
  return m.time <= DOUBLE_TIME;
}

function placeKickoff(m, team) {
  m.ball.x = CX;
  m.ball.y = CY;
  m.ball.vx = 0;
  m.ball.vy = 0;
  m.ball.lastTouch = null;
  m.ball.prevTouch = null;
  for (const side of ['red', 'blue']) {
    const list = m.players.filter((p) => p.team === side);
    const dir = side === 'red' ? -1 : 1; // 자기 진영 쪽
    const slots = formation(list.length);
    list.forEach((p, i) => {
      const s = slots[i];
      p.x = CX + dir * s.x;
      p.y = CY + s.y;
      p.vx = p.vy = 0;
      p.fx = -dir;
      p.fy = 0;
      p.cool = 0;
      p.kickAnim = 0;
    });
    // 공을 잡는 팀은 한 명이 공 바로 옆에 선다
    if (side === team && list.length) {
      list[0].x = CX + dir * (PLAYER_R + BALL_R + 2);
      list[0].y = CY;
    }
  }
}

// 자기 진영 안에서 고르게 퍼지는 자리 (중앙선에서의 거리 x, 위아래 y)
export function formation(n) {
  const out = [];
  if (n === 0) return out;
  const halfW = CX - FIELD.left;
  const usableH = FIELD.bottom - FIELD.top - 24;
  const cols = Math.ceil(Math.sqrt(n));
  let idx = 0;
  for (let c = 0; c < cols && idx < n; c++) {
    const remainingCols = cols - c;
    const inCol = Math.ceil((n - idx) / remainingCols);
    const x = 18 + ((c + 0.5) / cols) * (halfW - 36);
    for (let r = 0; r < inCol; r++) {
      const y = inCol === 1 ? 0 : -usableH / 2 + (r / (inCol - 1)) * usableH;
      out.push({ x, y });
      idx++;
    }
  }
  return out;
}

export function setInput(m, id, input) {
  const p = m.players.find((q) => q.id === id);
  if (!p) return;
  p.input.dx = clampUnit(input.dx);
  p.input.dy = clampUnit(input.dy);
  if (input.pass) p.input.pass = true;
  if (input.shoot) p.input.shoot = true;
}

function clampUnit(v) {
  v = Number(v) || 0;
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

export function step(m, dt = TICK) {
  m.events = [];
  if (m.phase === 'end') return m;

  if (m.phase === 'kickoff') {
    m.phaseTime -= dt;
    // 얼어 있는 동안 키는 버린다
    for (const p of m.players) p.input.pass = p.input.shoot = false;
    if (m.phaseTime <= 0) {
      m.phase = 'play';
      m.events.push({ e: 'whistle' });
    }
    return m;
  }

  if (m.phase === 'goal') {
    m.phaseTime -= dt;
    moveBall(m, dt, true);
    if (m.phaseTime <= 0) {
      if (m.time <= 0) return finish(m);
      const conceded = m.goals[m.goals.length - 1].team === 'red' ? 'blue' : 'red';
      placeKickoff(m, conceded);
      m.phase = 'kickoff';
      m.phaseTime = KICKOFF_FREEZE;
    }
    return m;
  }

  // play
  const before = m.time;
  m.time = Math.max(0, m.time - dt);
  if (!m.doubleAnnounced && before > DOUBLE_TIME && m.time <= DOUBLE_TIME) {
    m.doubleAnnounced = true;
    m.events.push({ e: 'double' });
  }

  movePlayers(m, dt);
  kicks(m);
  dribble(m);
  separatePlayers(m);
  const goalTeam = moveBall(m, dt, false);
  if (goalTeam) {
    scoreGoal(m, goalTeam);
    return m;
  }
  if (m.time <= 0) return finish(m);
  return m;
}

function finish(m) {
  m.phase = 'end';
  m.events.push({ e: 'end' });
  return m;
}

function movePlayers(m, dt) {
  for (const p of m.players) {
    let { dx, dy } = p.input;
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      dx /= len;
      dy /= len;
      p.fx = dx;
      p.fy = dy;
    }
    p.vx = dx * PLAYER_SPEED;
    p.vy = dy * PLAYER_SPEED;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.x = clamp(p.x, FIELD.left + PLAYER_R, FIELD.right - PLAYER_R);
    p.y = clamp(p.y, FIELD.top + PLAYER_R, FIELD.bottom - PLAYER_R);
    if (p.cool > 0) p.cool -= dt;
    if (p.kickAnim > 0) p.kickAnim -= dt;
  }
}

function kicks(m) {
  const b = m.ball;
  for (const p of m.players) {
    const wantShoot = p.input.shoot;
    const wantPass = p.input.pass;
    p.input.shoot = p.input.pass = false;
    if (!wantShoot && !wantPass) continue;
    if (p.cool > 0) continue;
    p.kickAnim = 0.2;
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    if (d > KICK_RANGE) continue;
    p.cool = KICK_COOLDOWN;
    if (wantShoot) {
      b.vx = p.fx * SHOOT_SPEED;
      b.vy = p.fy * SHOOT_SPEED;
      m.events.push({ e: 'shoot' });
    } else {
      const mate = nearestMate(m, p);
      if (mate) {
        const tx = mate.x - b.x;
        const ty = mate.y - b.y;
        const td = Math.hypot(tx, ty) || 1;
        const sp = clamp(PASS_MIN + td * 0.9, PASS_MIN, PASS_MAX);
        b.vx = (tx / td) * sp;
        b.vy = (ty / td) * sp;
      } else {
        b.vx = p.fx * PASS_MIN * 1.4;
        b.vy = p.fy * PASS_MIN * 1.4;
      }
      m.events.push({ e: 'pass' });
    }
    touch(b, p);
  }
}

function nearestMate(m, p) {
  let best = null;
  let bestD = Infinity;
  for (const q of m.players) {
    if (q === p || q.team !== p.team) continue;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

function touch(b, p) {
  if (b.lastTouch !== p.id) b.prevTouch = b.lastTouch;
  b.lastTouch = p.id;
}

// 공에 닿으면 몸으로 민다 (드리블)
function dribble(m) {
  const b = m.ball;
  for (const p of m.players) {
    const dx = b.x - p.x;
    const dy = b.y - p.y;
    const d = Math.hypot(dx, dy);
    const min = PLAYER_R + BALL_R;
    if (d >= min) continue;
    const nx = d > 0.001 ? dx / d : p.fx;
    const ny = d > 0.001 ? dy / d : p.fy;
    b.x = p.x + nx * min;
    b.y = p.y + ny * min;
    // 선수 속도만큼 공이 앞으로 굴러간다
    const pushed = Math.max(0, p.vx * nx + p.vy * ny) * 1.15 + 12;
    const along = b.vx * nx + b.vy * ny;
    if (along < pushed) {
      b.vx += (pushed - along) * nx;
      b.vy += (pushed - along) * ny;
    }
    touch(b, p);
  }
}

function separatePlayers(m) {
  const ps = m.players;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i];
      const c = ps[j];
      let dx = c.x - a.x;
      let dy = c.y - a.y;
      let d = Math.hypot(dx, dy);
      const min = PLAYER_R * 2 - 1;
      if (d >= min) continue;
      if (d < 0.001) {
        dx = 1;
        dy = 0;
        d = 1;
      }
      const push = (min - d) / 2;
      a.x -= (dx / d) * push;
      a.y -= (dy / d) * push;
      c.x += (dx / d) * push;
      c.y += (dy / d) * push;
    }
  }
}

// 공 움직임. 골이면 골 먹은 쪽이 아니라 '넣은 팀'을 돌려준다.
function moveBall(m, dt, frozen) {
  const b = m.ball;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > BALL_MAX) {
    b.vx *= BALL_MAX / sp;
    b.vy *= BALL_MAX / sp;
  }
  const decay = Math.exp(-BALL_DECAY * dt);
  b.vx *= decay;
  b.vy *= decay;
  if (Math.abs(b.vx) < 1 && Math.abs(b.vy) < 1) b.vx = b.vy = 0;
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  const inMouth = Math.abs(b.y - CY) < GOAL_HALF - BALL_R;

  // 위아래 벽
  if (b.y < FIELD.top + BALL_R) {
    b.y = FIELD.top + BALL_R;
    b.vy = Math.abs(b.vy) * WALL_BOUNCE;
    if (!frozen) m.events.push({ e: 'wall' });
  } else if (b.y > FIELD.bottom - BALL_R) {
    b.y = FIELD.bottom - BALL_R;
    b.vy = -Math.abs(b.vy) * WALL_BOUNCE;
    if (!frozen) m.events.push({ e: 'wall' });
  }

  // 왼쪽
  if (b.x < FIELD.left + BALL_R) {
    if (inMouth || frozen) {
      if (b.x < FIELD.left - GOAL_DEPTH + BALL_R) {
        b.x = FIELD.left - GOAL_DEPTH + BALL_R;
        b.vx = Math.abs(b.vx) * 0.3;
      }
      if (!frozen && b.x < FIELD.left - BALL_R) return 'blue';
    } else {
      b.x = FIELD.left + BALL_R;
      b.vx = Math.abs(b.vx) * WALL_BOUNCE;
      m.events.push({ e: 'wall' });
    }
  }
  // 오른쪽
  if (b.x > FIELD.right - BALL_R) {
    if (inMouth || frozen) {
      if (b.x > FIELD.right + GOAL_DEPTH - BALL_R) {
        b.x = FIELD.right + GOAL_DEPTH - BALL_R;
        b.vx = -Math.abs(b.vx) * 0.3;
      }
      if (!frozen && b.x > FIELD.right + BALL_R) return 'red';
    } else {
      b.x = FIELD.right - BALL_R;
      b.vx = -Math.abs(b.vx) * WALL_BOUNCE;
      m.events.push({ e: 'wall' });
    }
  }
  // 골망 안에서 위아래로 못 나가게
  if (b.x < FIELD.left || b.x > FIELD.right) {
    b.y = clamp(b.y, CY - GOAL_HALF + BALL_R, CY + GOAL_HALF - BALL_R);
  }
  return null;
}

function scoreGoal(m, team) {
  const points = isDouble(m) ? 2 : 1;
  m.score[team] += points;
  const b = m.ball;
  const byId = (id) => m.players.find((p) => p.id === id);
  let scorer = byId(b.lastTouch);
  let own = false;
  if (scorer && scorer.team !== team) {
    // 자책골이면 그 전에 찬 같은 팀 아이에게, 없으면 자책골로
    const prev = byId(b.prevTouch);
    if (prev && prev.team === team) scorer = prev;
    else own = true;
  }
  m.goals.push({
    id: scorer ? scorer.id : null,
    name: scorer ? scorer.name : null,
    team,
    points,
    own,
  });
  m.phase = 'goal';
  m.phaseTime = GOAL_PAUSE;
  m.events.push({ e: 'goal', team, points });
}

export function result(m) {
  const winner =
    m.score.red > m.score.blue ? 'red' : m.score.blue > m.score.red ? 'blue' : null;
  return { score: { ...m.score }, winner, goals: m.goals.map((g) => ({ ...g })) };
}

// 화면으로 보낼 작은 상태
export function snapshot(m) {
  return {
    ph: m.phase,
    tl: Math.ceil(m.time),
    sc: [m.score.red, m.score.blue],
    dbl: isDouble(m),
    b: [round1(m.ball.x), round1(m.ball.y)],
    p: m.players.map((p) => [
      p.id,
      round1(p.x),
      round1(p.y),
      Math.sign(Math.round(p.fx * 10)) || 0,
      p.vx !== 0 || p.vy !== 0 ? 1 : 0,
      p.kickAnim > 0 ? 1 : 0,
    ]),
    ev: m.events,
  };
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
