// 가짜 아이 여러 명으로 한 판 돌려 보기
// 사용: node scripts/bots.mjs [주소] [아이 수] [초]
// 예: node scripts/bots.mjs http://localhost:8787 16 20
const base = process.argv[2] || 'http://localhost:8787';
const N = Number(process.argv[3] || 16);
const SECONDS = Number(process.argv[4] || 20);
const wsBase = base.replace(/^http/, 'ws');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function open(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    ws.inbox = [];
    ws.onmessage = (e) => ws.inbox.push(JSON.parse(e.data));
    ws.onopen = () => res(ws);
    ws.onerror = rej;
  });
}
const last = (ws, t) => [...ws.inbox].reverse().find((m) => m.t === t);

const cls = await (await fetch(base + '/api/class', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: '시험반' }),
})).json();
const teacher = await open(`${wsBase}/ws/teacher?class=${cls.classId}&key=${cls.key}`);
await wait(300);
const code = last(teacher, 'welcome').code;
console.log('방 코드', code);

// 잘못된 경우들
const bad = await open(`${wsBase}/ws/play?code=0000&name=x`);
await wait(300);
console.log('없는 코드 →', last(bad, 'error')?.msg);

const kids = [];
for (let i = 0; i < N; i++) kids.push(await open(`${wsBase}/ws/play?code=${code}&name=아이${i + 1}`));
const dup = await open(`${wsBase}/ws/play?code=${code}&name=아이1`);
await wait(400);
console.log('같은 이름 →', last(dup, 'error')?.msg);
console.log('대기실 인원', last(teacher, 'lobby').kids.length);

teacher.send(JSON.stringify({ t: 'random', max: 12 }));
await wait(300);
const lob = last(teacher, 'lobby').kids;
console.log('빨강', lob.filter((k) => k.team === 'red').length, '파랑', lob.filter((k) => k.team === 'blue').length, '관전', lob.filter((k) => !k.team).length);
teacher.send(JSON.stringify({ t: 'start' }));
await wait(300);

// 아이들은 공 쪽으로 달리며 가끔 찬다
const t0 = Date.now();
const counts = new Map();
kids.forEach((k) => (k.inbox.length = 0));
const timer = setInterval(() => {
  for (const k of kids) {
    const m = last(k, 'match');
    const s = last(k, 's');
    if (!m || m.you == null || !s) continue;
    const me = s.p.find((p) => p[0] === m.you);
    if (!me) continue;
    const dx = Math.sign(s.b[0] - me[1] + (Math.random() - 0.5) * 20);
    const dy = Math.sign(s.b[1] - me[2] + (Math.random() - 0.5) * 20);
    k.send(JSON.stringify({ t: 'i', dx, dy }));
    if (Math.random() < 0.15) k.send(JSON.stringify({ t: 'k', a: Math.random() < 0.5 ? 'pass' : 'shoot' }));
  }
}, 100);

// 중간에 한 아이 나갔다 들어오기
await wait(3000);
kids[0].close();
await wait(800);
kids[0] = await open(`${wsBase}/ws/play?code=${code}&name=아이1`);
await wait(500);
console.log('다시 들어온 아이1 경기 화면 받음:', !!last(kids[0], 'match'));

teacher.send(JSON.stringify({ t: 'pause' }));
await wait(1000);
const a = last(teacher, 's').tl;
await wait(1000);
console.log('일시정지 중 시간 그대로:', a === last(teacher, 's').tl);
teacher.send(JSON.stringify({ t: 'pause' }));

await wait(Math.max(0, SECONDS * 1000 - (Date.now() - t0)));
clearInterval(timer);
const snaps = kids[3].inbox.filter((m) => m.t === 's');
const secs = (Date.now() - t0) / 1000;
const s = last(teacher, 's');
console.log(`받은 상태 ${snaps.length}개 / 약 ${secs.toFixed(0)}초 (초당 ${(snaps.length / (secs - 2)).toFixed(1)})`);
console.log('점수', s.sc, '남은 시간', s.tl, '골 이벤트', kids[3].inbox.filter((m) => m.t === 's' && m.ev.some((e) => e.e === 'goal')).length);

teacher.send(JSON.stringify({ t: 'stop' }));
await wait(400);
const r = last(teacher, 'result');
console.log('강제 종료 →', r && r.recorded === false ? '결과 화면, 기록 안 함' : r);
teacher.send(JSON.stringify({ t: 'records' }));
await wait(300);
console.log('기록 줄 수', last(teacher, 'records').rows.length);
teacher.send(JSON.stringify({ t: 'next' }));
await wait(300);
console.log('다음 판 → 대기실:', !!last(kids[5], 'lobbyView'));
const afterNext = last(teacher, 'lobby').kids;
console.log('다음 판 → 모두 관전:', afterNext.every((k) => !k.team), '· 방금 뛴 표시', afterNext.filter((k) => k.last).length, '명');
const benchedBefore = lob.filter((k) => !k.team).map((k) => k.name);
teacher.send(JSON.stringify({ t: 'random', max: 12 }));
await wait(300);
const nowPlaying = last(teacher, 'lobby').kids.filter((k) => k.team).map((k) => k.name);
console.log('지난 판 관전했던 아이가 이번 판에 들어감:', benchedBefore.every((n) => nowPlaying.includes(n)));
teacher.send(JSON.stringify({ t: 'kick', name: '아이2' }));
await wait(300);
console.log('내보낸 아이 메시지:', last(kids[1], 'error')?.msg);
for (const k of kids) k.close();
teacher.close();
process.exit(0);
