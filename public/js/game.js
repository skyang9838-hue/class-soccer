// 경기 계산 — 서버·화면과 떨어진 순수 코드. 단위는 도트 1칸(px).
// 화면은 426×200 도트를 정수배로 키워 그린다. 서버(src/worker.js)와 혼자 연습(solo.js)이 같이 쓴다.

export const W = 426;
export const H = 200;
export const FIELD = { left: 12, right: 414, top: 16, bottom: 190 };
export const GOAL_HALF = 22; // 골문 높이의 절반
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
const PLAYER_SPEED = 46;
const DRIBBLE_SPEED = 40; // 공을 가지면 조금 느리다
const BALL_DECAY = 1.35; // 초당 감속 (지수)
const BALL_MAX = 240;
const SHOOT_SPEED = 165;
const PASS_MIN = 55;
const PASS_MAX = 105;
const KICK_RANGE = PLAYER_R + BALL_R + 4;
const KICK_COOLDOWN = 0.3;
const WALL_BOUNCE = 0.8;
const CATCH_SPEED = 115; // 이보다 빠른 공은 몸에 맞고 튕긴다
const CARRY_GAP = PLAYER_R + BALL_R + 1; // 드리블할 때 공이 발 앞 이만큼
const NO_CATCH_AFTER_KICK = 0.25;
// 태클
// 스탠딩 태클: 공 가진 상대에게 붙어서 누르면 그 자리에서 뺏는다 (앞·옆·뒤 모두)
const TACKLE_BODY_REACH = PLAYER_R * 2 + 6; // 상대 몸까지
const TACKLE_BALL_REACH = PLAYER_R + BALL_R + 5; // 또는 공까지
const TACKLE_COOL = 0.6;
const WHIFF_TIME = 0.3; // 헛발이면 잠깐 느려진다
const WHIFF_SPEED = 0.4;
const STUN_TIME = 0.6;
const STEAL_SAFE = 0.6; // 막 빼앗은 아이는 잠깐 안 빼앗긴다 (핑퐁 막기)

// team: 'red'은 왼쪽 골을 지키고 오른쪽으로 공격, 'blue'는 반대.

export function createMatch(roster, opts = {}) {
  // roster: [{ id, name, team }]
  const m = {
    time: opts.matchTime ?? MATCH_TIME,
    phase: 'kickoff', // kickoff | play | goal | end
    phaseTime: KICKOFF_FREEZE,
    score: { red: 0, blue: 0 },
    goals: [], // { id, name, team, points, own }
    ball: { x: CX, y: CY, vx: 0, vy: 0, owner: null, safe: 0, lastTouch: null, prevTouch: null },
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
      noCatch: 0,
      tackleT: 0, // 화면용: 태클 동작 남은 시간
      whiff: 0,
      tackleCool: 0,
      stun: 0,
      input: { dx: 0, dy: 0, pass: false, shoot: false, power: 0.5 },
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
  const b = m.ball;
  b.x = CX;
  b.y = CY;
  b.vx = b.vy = 0;
  b.owner = null;
  b.safe = 0;
  b.lastTouch = null;
  b.prevTouch = null;
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
      p.cool = p.kickAnim = p.noCatch = p.tackleT = p.tackleCool = p.stun = p.whiff = 0;
    });
    // 공을 잡는 팀은 맨 앞 한 명이 공 바로 옆에 선다 (맨 뒤 가운데 자리는 비우지 않는다)
    if (side === team && list.length) {
      const k = list[list.length - 1];
      k.x = CX + dir * (PLAYER_R + BALL_R + 2);
      k.y = CY;
    }
  }
}

// 자기 진영 안에서 고르게 퍼지는 자리 (중앙선에서의 거리 x, 위아래 y)
export function formation(n) {
  const out = [];
  if (n === 0) return out;
  const halfW = CX - FIELD.left;
  const usableH = FIELD.bottom - FIELD.top - 24;
  // 맨 뒤 가운데에 한 명 (골키퍼는 없지만 가운데가 비지 않게), 나머지는 앞쪽에 고르게
  out.push({ x: halfW - 26, y: 0 });
  const rest = n - 1;
  if (rest === 0) return out;
  const cols = Math.ceil(Math.sqrt(rest));
  let idx = 0;
  for (let c = 0; c < cols && idx < rest; c++) {
    const remainingCols = cols - c;
    const inCol = Math.ceil((rest - idx) / remainingCols);
    const x = 18 + ((c + 0.5) / cols) * (halfW - 64);
    for (let r = 0; r < inCol; r++) {
      const y = inCol === 1 ? 0 : -usableH / 2 + (r / (inCol - 1)) * usableH;
      out.push({ x, y });
      idx++;
    }
  }
  return out;
}

// 방향(dx·dy)은 들어왔을 때만 바꾼다. 패스·슛만 눌러도 움직임은 그대로.
export function setInput(m, id, input) {
  const p = m.players.find((q) => q.id === id);
  if (!p) return;
  if ('dx' in input) p.input.dx = clampUnit(input.dx);
  if ('dy' in input) p.input.dy = clampUnit(input.dy);
  if (input.pass) p.input.pass = true;
  if (input.shoot) p.input.shoot = true;
  // 게이지 0~1 (안 주면 중간)
  if (input.pass || input.shoot) p.input.power = 'power' in input ? clamp(Number(input.power) || 0, 0, 1) : 0.5;
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
  if (m.ball.safe > 0) m.ball.safe -= dt;

  movePlayers(m, dt);
  separatePlayers(m);
  actions(m);
  let goalTeam;
  if (m.ball.owner != null) {
    carry(m);
    goalTeam = checkBounds(m, false);
  } else {
    goalTeam = moveBall(m, dt, false);
    if (!goalTeam) catchBall(m);
  }
  if (goalTeam) {
    scoreGoal(m, goalTeam);
    return m;
  }
  if (m.time <= 0) return finish(m);
  return m;
}

function finish(m) {
  m.phase = 'end';
  m.ball.owner = null;
  m.events.push({ e: 'end' });
  return m;
}

function byId(m, id) {
  return m.players.find((p) => p.id === id);
}

function movePlayers(m, dt) {
  for (const p of m.players) {
    if (p.cool > 0) p.cool -= dt;
    if (p.kickAnim > 0) p.kickAnim -= dt;
    if (p.noCatch > 0) p.noCatch -= dt;
    if (p.tackleCool > 0) p.tackleCool -= dt;
    if (p.stun > 0) {
      p.stun -= dt;
      p.vx = p.vy = 0;
      continue;
    }
    if (p.tackleT > 0) p.tackleT -= dt;
    if (p.whiff > 0) p.whiff -= dt;
    {
      let { dx, dy } = p.input;
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        dx /= len;
        dy /= len;
        p.fx = dx;
        p.fy = dy;
      }
      let sp = m.ball.owner === p.id ? DRIBBLE_SPEED : PLAYER_SPEED;
      if (p.whiff > 0) sp *= WHIFF_SPEED;
      p.vx = dx * sp;
      p.vy = dy * sp;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.x = clamp(p.x, FIELD.left + PLAYER_R, FIELD.right - PLAYER_R);
    p.y = clamp(p.y, FIELD.top + PLAYER_R, FIELD.bottom - PLAYER_R);
  }
}

// 패스·슛·태클 키
function actions(m) {
  const b = m.ball;
  for (const p of m.players) {
    const wantShoot = p.input.shoot;
    const wantPass = p.input.pass;
    p.input.shoot = p.input.pass = false;
    if (!wantShoot && !wantPass) continue;
    if (p.stun > 0) continue;
    const mine = b.owner === p.id;
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    const canKick = p.cool <= 0 && (mine || (b.owner == null && d <= KICK_RANGE));
    if (canKick) {
      kick(m, p, wantShoot, p.input.power);
      continue;
    }
    // 공이 없을 때 패스 키 = 태클
    if (wantPass && !mine && p.tackleCool <= 0) standTackle(m, p);
  }
}

function kick(m, p, shoot, power = 0.5) {
  const b = m.ball;
  p.cool = KICK_COOLDOWN;
  p.kickAnim = 0.2;
  p.noCatch = NO_CATCH_AFTER_KICK;
  b.owner = null;
  // 공을 발 앞에 두고 찬다
  b.x = p.x + p.fx * CARRY_GAP;
  b.y = p.y + p.fy * CARRY_GAP;
  if (shoot) {
    // 자동 슛: 보는 방향과 상관없이 상대 골문 안쪽으로 (조금 흔들림)
    const gx = p.team === 'red' ? FIELD.right + GOAL_DEPTH / 2 : FIELD.left - GOAL_DEPTH / 2;
    // 세게 찰수록 조금 더 흔들린다
    const gy = CY + (Math.random() * 2 - 1) * GOAL_HALF * (0.45 + power * 0.45);
    const tx = gx - b.x;
    const ty = gy - b.y;
    const td = Math.hypot(tx, ty) || 1;
    const ss = SHOOT_SPEED * (0.6 + power * 0.55);
    b.vx = (tx / td) * ss;
    b.vy = (ty / td) * ss;
    m.events.push({ e: 'shoot' });
  } else {
    // 자동 패스: 받기 좋은 우리 편에게, 달려가는 앞쪽으로, 발에 붙을 세기로
    const mate = passTarget(m, p, power);
    if (mate) {
      let tx = mate.x - b.x;
      let ty = mate.y - b.y;
      let td = Math.hypot(tx, ty) || 1;
      let sp = clamp(PASS_MIN + td * 0.55, PASS_MIN, PASS_MAX);
      const lead = Math.min(0.9, td / sp);
      tx = clamp(mate.x + mate.vx * lead, FIELD.left + 6, FIELD.right - 6) - b.x;
      ty = clamp(mate.y + mate.vy * lead, FIELD.top + 6, FIELD.bottom - 6) - b.y;
      td = Math.hypot(tx, ty) || 1;
      sp = clamp(PASS_MIN + td * 0.55, PASS_MIN, PASS_MAX) * (0.8 + power * 0.45);
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

// 받기 좋은 우리 편: 가깝고, 상대 골 쪽에 있고, 가는 길에 상대가 덜 막는 아이
function passTarget(m, p, power = 0.5) {
  const fwd = p.team === 'red' ? 1 : -1;
  let best = null;
  let bestScore = -Infinity;
  for (const q of m.players) {
    if (q === p || q.team !== p.team || q.stun > 0) continue;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > 190) continue;
    // 게이지가 길수록 먼 아이를 고른다 (짧게 = 30, 가득 = 150 근처)
    const want = 30 + power * 120;
    let score = -Math.abs(d - want) * 0.6 + dx * fwd * 0.35;
    for (const o of m.players) {
      if (o.team === p.team) continue;
      const ox = o.x - p.x;
      const oy = o.y - p.y;
      const along = (ox * dx + oy * dy) / d;
      if (along < 0 || along > d) continue;
      const off = Math.abs(ox * dy - oy * dx) / d;
      if (off < 12) score -= (12 - off) * 4; // 길목에 상대
    }
    if (score > bestScore) {
      bestScore = score;
      best = q;
    }
  }
  return best;
}

function standTackle(m, p) {
  const b = m.ball;
  p.tackleCool = TACKLE_COOL;
  p.tackleT = 0.2;
  const owner = b.owner != null ? byId(m, b.owner) : null;
  if (owner && owner.team !== p.team && b.safe <= 0) {
    const body = Math.hypot(owner.x - p.x, owner.y - p.y);
    const ball = Math.hypot(b.x - p.x, b.y - p.y);
    if (body <= TACKLE_BODY_REACH || ball <= TACKLE_BALL_REACH) {
      owner.stun = STUN_TIME;
      owner.noCatch = STUN_TIME;
      take(m, p);
      // 뺏은 아이는 공 쪽을 본다
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.5) {
        p.fx = dx / d;
        p.fy = dy / d;
      }
      m.events.push({ e: 'steal' });
      return;
    }
  }
  // 헛발
  p.whiff = WHIFF_TIME;
  m.events.push({ e: 'tackle' });
}

function take(m, p) {
  const b = m.ball;
  b.owner = p.id;
  b.safe = STEAL_SAFE;
  b.vx = b.vy = 0;
  touch(b, p);
}

// 굴러가는 공에 닿으면 발 앞에 붙는다 (빠른 공은 몸에 맞고 튕긴다)
function catchBall(m) {
  const b = m.ball;
  const speed = Math.hypot(b.vx, b.vy);
  let best = null;
  let bestD = Infinity;
  for (const p of m.players) {
    if (p.stun > 0 || p.noCatch > 0) continue;
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    if (d < PLAYER_R + BALL_R + 1 && d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (!best) return;
  if (speed <= CATCH_SPEED) {
    take(m, best);
    return;
  }
  // 튕김
  const dx = b.x - best.x;
  const dy = b.y - best.y;
  const d = Math.hypot(dx, dy) || 1;
  const nx = dx / d;
  const ny = dy / d;
  const along = b.vx * nx + b.vy * ny;
  if (along < 0) {
    b.vx -= 1.6 * along * nx;
    b.vy -= 1.6 * along * ny;
  }
  b.x = best.x + nx * (PLAYER_R + BALL_R + 0.5);
  b.y = best.y + ny * (PLAYER_R + BALL_R + 0.5);
  touch(b, best);
}

// 드리블: 공이 가진 아이의 발 앞을 따라다닌다
function carry(m) {
  const b = m.ball;
  const p = byId(m, b.owner);
  if (!p || p.stun > 0) {
    b.owner = null;
    return;
  }
  b.x = p.x + p.fx * CARRY_GAP;
  b.y = p.y + p.fy * CARRY_GAP;
  b.vx = p.vx;
  b.vy = p.vy;
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

// 굴러가는 공. 골이면 '넣은 팀'을 돌려준다.
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
  return checkBounds(m, frozen);
}

// 벽에 튕기기·골 판정 (드리블 중인 공도 여기서 골이 된다)
function checkBounds(m, frozen) {
  const b = m.ball;
  const carried = b.owner != null;
  const inMouth = Math.abs(b.y - CY) < GOAL_HALF - BALL_R;

  if (b.y < FIELD.top + BALL_R) {
    b.y = FIELD.top + BALL_R;
    b.vy = Math.abs(b.vy) * WALL_BOUNCE;
    if (!frozen && !carried) m.events.push({ e: 'wall' });
  } else if (b.y > FIELD.bottom - BALL_R) {
    b.y = FIELD.bottom - BALL_R;
    b.vy = -Math.abs(b.vy) * WALL_BOUNCE;
    if (!frozen && !carried) m.events.push({ e: 'wall' });
  }

  if (b.x < FIELD.left + BALL_R) {
    if (inMouth || frozen) {
      if (b.x < FIELD.left - GOAL_DEPTH + BALL_R) {
        b.x = FIELD.left - GOAL_DEPTH + BALL_R;
        b.vx = Math.abs(b.vx) * 0.3;
      }
      if (!frozen && b.x < FIELD.left - BALL_R + (carried ? 3 : 0)) return 'blue';
    } else {
      b.x = FIELD.left + BALL_R;
      b.vx = Math.abs(b.vx) * WALL_BOUNCE;
      if (!carried) m.events.push({ e: 'wall' });
    }
  }
  if (b.x > FIELD.right - BALL_R) {
    if (inMouth || frozen) {
      if (b.x > FIELD.right + GOAL_DEPTH - BALL_R) {
        b.x = FIELD.right + GOAL_DEPTH - BALL_R;
        b.vx = -Math.abs(b.vx) * 0.3;
      }
      if (!frozen && b.x > FIELD.right + BALL_R - (carried ? 3 : 0)) return 'red';
    } else {
      b.x = FIELD.right - BALL_R;
      b.vx = -Math.abs(b.vx) * WALL_BOUNCE;
      if (!carried) m.events.push({ e: 'wall' });
    }
  }
  if (b.x < FIELD.left || b.x > FIELD.right) {
    b.y = clamp(b.y, CY - GOAL_HALF + BALL_R, CY + GOAL_HALF - BALL_R);
  }
  return null;
}

function touch(b, p) {
  if (b.lastTouch !== p.id) b.prevTouch = b.lastTouch;
  b.lastTouch = p.id;
}

function scoreGoal(m, team) {
  const points = isDouble(m) ? 2 : 1;
  m.score[team] += points;
  const b = m.ball;
  b.owner = null;
  // 골망 안으로 살짝 굴러 들어가게
  b.vx = team === 'red' ? 60 : -60;
  b.vy = 0;
  let scorer = byId(m, b.lastTouch);
  let own = false;
  if (scorer && scorer.team !== team) {
    // 자책골이면 그 전에 찬 같은 팀 아이에게, 없으면 자책골로
    const prev = byId(m, b.prevTouch);
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
// p: [id, x, y, 보는 방향(±1), 움직임, 차기, 태클, 어지러움, 공 가짐]
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
      p.tackleT > 0 ? 1 : 0,
      p.stun > 0 ? 1 : 0,
      m.ball.owner === p.id ? 1 : 0,
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
