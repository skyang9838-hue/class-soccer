// 도트 그림 — 320×150 도트에 그리고 화면에서 정수배로 키운다.
// 서버 game.js 의 경기장 숫자와 같아야 한다.
export const W = 320;
export const H = 150;
export const FIELD = { left: 10, right: 310, top: 12, bottom: 142 };
export const GOAL_HALF = 18;
export const GOAL_DEPTH = 8;
export const CX = 160;
export const CY = 77;

export const TEAM = {
  red: { j: '#e43b44', J: '#a22633', w: '#ffffff', name: '빨강' },
  blue: { j: '#2f7de1', J: '#1b4d9b', w: '#ffffff', name: '파랑' },
};

const SKIN = '#f7c9a0';
const HAIRS = ['#2a1e17', '#5a3825', '#3b2a20', '#1a1a2e', '#7a4a26'];
const OUTLINE = '#1a1c2c';

// 오른쪽을 보는 선수. 글자: h 머리 s 피부 q 눈 j 유니폼 J 그림자 w 바지 k 신발
const BODY = [
  '..hhhhhh..',
  '.hhhhhhhh.',
  '.hhhsssss.',
  '.hsssssqs.',
  '.hsssssss.',
  '..ssssss..',
  '...jjjj...',
  '..jjjjjjJ.',
  '.sjjjjjjs.',
  '..wwwwww..',
];
const LEGS = {
  idle: ['..k...k...', '..k...k...'],
  walkA: ['.k.....k..', 'kk.....kk.'],
  walkB: ['...k.k....', '...kkkk...'],
  kick: ['..k....kk.', '..k.....kk'],
  slide: ['.......kkk', '..........'],
};

const cache = new Map();

function makeSprite(team, hair, legs, flip) {
  const key = team + hair + legs + flip;
  if (cache.has(key)) return cache.get(key);
  const rows = [...BODY, ...LEGS[legs]];
  const w = rows[0].length + 2;
  const h = rows.length + 2;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const col = TEAM[team];
  const pal = { h: HAIRS[hair], s: SKIN, q: OUTLINE, j: col.j, J: col.J, w: col.w, k: '#3a3a3a' };
  const filled = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x0) => {
      const x = flip ? row.length - 1 - x0 : x0;
      if (ch === '.') return;
      g.fillStyle = pal[ch];
      g.fillRect(x + 1, y + 1, 1, 1);
      filled.push((y + 1) * w + (x + 1));
    });
  });
  // 바깥 테두리를 자동으로
  const set = new Set(filled);
  g.fillStyle = OUTLINE;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (set.has(y * w + x)) continue;
      const n = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => set.has((y + dy) * w + (x + dx)) && x + dx >= 0 && x + dx < w);
      if (n) g.fillRect(x, y, 1, 1);
    }
  }
  cache.set(key, c);
  return c;
}

let fieldCanvas = null;

export function drawField(g) {
  if (!fieldCanvas) fieldCanvas = buildField();
  g.drawImage(fieldCanvas, 0, 0);
}

function buildField() {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  // 바깥 (관중석 쪽 나무 벽)
  g.fillStyle = '#3b2b22';
  g.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 6) {
    g.fillStyle = (x / 6) % 2 ? '#4a372b' : '#533e30';
    g.fillRect(x, 0, 6, FIELD.top - 2);
    g.fillRect(x, FIELD.bottom + 2, 6, H - FIELD.bottom - 2);
  }
  // 잔디 줄무늬
  const fw = FIELD.right - FIELD.left;
  for (let i = 0; i < 15; i++) {
    g.fillStyle = i % 2 ? '#3e9a3a' : '#48a843';
    g.fillRect(FIELD.left + Math.floor((i * fw) / 15), FIELD.top, Math.ceil(fw / 15) + 1, FIELD.bottom - FIELD.top);
  }
  // 벽 안쪽 테두리
  g.fillStyle = '#e8e3c9';
  g.fillRect(FIELD.left - 2, FIELD.top - 2, fw + 4, 2);
  g.fillRect(FIELD.left - 2, FIELD.bottom, fw + 4, 2);
  g.fillRect(FIELD.left - 2, FIELD.top - 2, 2, FIELD.bottom - FIELD.top + 4);
  g.fillRect(FIELD.right, FIELD.top - 2, 2, FIELD.bottom - FIELD.top + 4);
  // 선
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillRect(CX, FIELD.top, 1, FIELD.bottom - FIELD.top);
  pixelCircle(g, CX, CY, 18);
  g.fillRect(CX - 1, CY - 1, 3, 3);
  // 골 앞 상자
  box(g, FIELD.left, CY - 32, 30, 64);
  box(g, FIELD.right - 30, CY - 32, 30, 64);
  // 골대 (벽 뒤로 파인 그물)
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? FIELD.left - GOAL_DEPTH - 2 : FIELD.right;
    g.fillStyle = '#d9d9d9';
    g.fillRect(x0, CY - GOAL_HALF - 2, GOAL_DEPTH + 2, GOAL_HALF * 2 + 4);
    g.fillStyle = '#2d6b2a';
    g.fillRect(x0 + (side < 0 ? 1 : 0), CY - GOAL_HALF, GOAL_DEPTH + 1, GOAL_HALF * 2);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let y = CY - GOAL_HALF; y < CY + GOAL_HALF; y++) {
      for (let x = x0; x < x0 + GOAL_DEPTH + 2; x++) {
        if ((x + y) % 3 === 0) g.fillRect(x, y, 1, 1);
      }
    }
    // 골문 자리의 벽은 지운다
    const wx = side < 0 ? FIELD.left - 2 : FIELD.right;
    g.fillStyle = '#48a843';
    g.fillRect(wx, CY - GOAL_HALF, 2, GOAL_HALF * 2);
    // 골대 기둥
    g.fillStyle = '#ffffff';
    g.fillRect(wx, CY - GOAL_HALF - 2, 2, 2);
    g.fillRect(wx, CY + GOAL_HALF, 2, 2);
  }
  return c;
}

function box(g, x, y, w, h) {
  g.fillRect(x, y, w, 1);
  g.fillRect(x, y + h - 1, w, 1);
  g.fillRect(x === FIELD.left ? x + w - 1 : x, y, 1, h);
}

function pixelCircle(g, cx, cy, r) {
  let x = r;
  let y = 0;
  let err = 1 - r;
  while (x >= y) {
    for (const [a, b] of [
      [x, y],
      [y, x],
      [-y, x],
      [-x, y],
      [-x, -y],
      [-y, -x],
      [y, -x],
      [x, -y],
    ])
      g.fillRect(cx + a, cy + b, 1, 1);
    y++;
    if (err < 0) err += 2 * y + 1;
    else {
      x--;
      err += 2 * (y - x) + 1;
    }
  }
}

export function drawPlayer(g, p, t) {
  // p: { x, y, team, face, moving, kicking, hair }
  const legs = p.tackling ? 'slide' : p.kicking ? 'kick' : p.moving ? (Math.floor(t * 8 + p.id) % 2 ? 'walkA' : 'walkB') : 'idle';
  const spr = makeSprite(p.team, p.hair, legs, p.face < 0);
  const x = Math.round(p.x - spr.width / 2);
  const y = Math.round(p.y + 5 - spr.height) + (p.tackling ? 2 : 0);
  // 그림자
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(Math.round(p.x) - 4, Math.round(p.y) + 4, 8, 2);
  g.fillRect(Math.round(p.x) - 3, Math.round(p.y) + 3, 6, 1);
  g.drawImage(spr, x, y);
}

const BALL = ['.ooo.', 'owwko', 'owkwo', 'okwwo', '.ooo.'];
export function drawBall(g, x, y, spin) {
  x = Math.round(x) - 2;
  y = Math.round(y) - 2;
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(x + 1, y + 5, 4, 1);
  const flip = Math.floor(spin) % 2;
  BALL.forEach((row, ry) => {
    [...row].forEach((ch, rx) => {
      if (ch === '.') return;
      const c = ch === 'o' ? OUTLINE : ch === 'k' ? '#333' : '#fff';
      g.fillStyle = c;
      g.fillRect(x + (flip ? 4 - rx : rx), y + ry, 1, 1);
    });
  });
}

export function hairOf(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % HAIRS.length;
}
