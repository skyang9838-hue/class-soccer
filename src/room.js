// 방 안의 아이들·팀 짜기 — 서버와 떨어진 순수 코드

export const MAX_ON_FIELD = 12;
export const NAME_MAX = 8;

export function cleanName(raw) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, NAME_MAX);
}

export function createRoster() {
  // name → { name, connected, team: 'red'|'blue'|null, lastPlayed: 판 번호 (-1 = 아직 안 뜀) }
  return { kids: new Map(), round: 0 };
}

// 들어오기. 돌려주는 값: { ok, kid } 또는 { ok:false, reason }
export function join(roster, rawName) {
  const name = cleanName(rawName);
  if (!name) return { ok: false, reason: 'empty' };
  const kid = roster.kids.get(name);
  if (kid) {
    if (kid.connected) return { ok: false, reason: 'taken' };
    kid.connected = true; // 다시 들어옴 → 원래 자리
    return { ok: true, kid, rejoined: true };
  }
  const fresh = { name, connected: true, team: null, lastPlayed: -1 };
  roster.kids.set(name, fresh);
  return { ok: true, kid: fresh, rejoined: false };
}

export function leave(roster, name) {
  const kid = roster.kids.get(name);
  if (kid) kid.connected = false;
}

export function kick(roster, name) {
  roster.kids.delete(name);
}

// 랜덤 팀 짜기: 지난 판에 안 뛴 아이 먼저. 같은 순위끼리는 섞는다.
export function randomTeams(roster, max = MAX_ON_FIELD, rnd = Math.random) {
  const present = [...roster.kids.values()].filter((k) => k.connected);
  for (const k of roster.kids.values()) k.team = null;
  const shuffled = present
    .map((k) => ({ k, r: rnd() }))
    .sort((a, b) => a.k.lastPlayed - b.k.lastPlayed || a.r - b.r)
    .map((x) => x.k);
  const chosen = shuffled.slice(0, max);
  // 고른 아이들을 다시 섞어 빨강·파랑 번갈아
  const mixed = chosen
    .map((k) => ({ k, r: rnd() }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.k);
  mixed.forEach((k, i) => (k.team = i % 2 === 0 ? 'red' : 'blue'));
  return teamsOf(roster);
}

// 이름 누르면 빨강 → 파랑 → 관전 → 빨강
export function cycleTeam(roster, name, max = MAX_ON_FIELD) {
  const kid = roster.kids.get(name);
  if (!kid) return;
  const onField = [...roster.kids.values()].filter((k) => k.team).length;
  if (kid.team === 'red') kid.team = 'blue';
  else if (kid.team === 'blue') kid.team = null;
  else if (onField < max) kid.team = 'red';
}

export function teamsOf(roster) {
  const red = [];
  const blue = [];
  const bench = [];
  for (const k of roster.kids.values()) {
    if (k.team === 'red') red.push(k.name);
    else if (k.team === 'blue') blue.push(k.name);
    else bench.push(k.name);
  }
  return { red, blue, bench };
}

export function canStart(roster) {
  const t = teamsOf(roster);
  return t.red.length > 0 && t.blue.length > 0;
}

// 경기 시작 때 부른다: 뛴 아이 표시
export function markPlayed(roster) {
  roster.round += 1;
  for (const k of roster.kids.values()) if (k.team) k.lastPlayed = roster.round;
}
