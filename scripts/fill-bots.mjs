// 혼자 해 볼 때 가짜 아이를 채운다. 공을 쫓아다니며 가끔 패스·슛
// 사용: node scripts/fill-bots.mjs 방코드 [아이 수] [주소]
const code = process.argv[2];
const N = Number(process.argv[3] || 7);
const base = (process.argv[4] || 'http://localhost:8787').replace(/^http/, 'ws');
if (!/^\d{4}$/.test(code || '')) {
  console.log('사용: node scripts/fill-bots.mjs 방코드 [아이 수]');
  process.exit(1);
}
const NAMES = ['민준', '서연', '도윤', '하은', '지호', '수아', '예준', '지우', '건우', '유나', '시우', '하린', '주원', '채원', '은우'];
const bots = [];
for (let i = 0; i < N; i++) {
  const ws = new WebSocket(`${base}/ws/play?code=${code}&name=${encodeURIComponent('봇' + NAMES[i % NAMES.length])}`);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'match') ws.you = m.you, ws.team = (m.roster.find((r) => r.id === m.you) || {}).team;
    else if (m.t === 's') ws.s = m;
    else if (m.t === 'result' || m.t === 'lobbyView') ws.s = null;
    else if (m.t === 'error') console.log('봇', i, m.msg);
  };
  bots.push(ws);
}
setInterval(() => {
  for (const ws of bots) {
    if (ws.readyState !== 1 || ws.you == null || !ws.s) continue;
    const me = ws.s.p.find((p) => p[0] === ws.you);
    if (!me) continue;
    const [bx, by] = ws.s.b;
    const goalX = ws.team === 'red' ? 320 : 0;
    // 공 뒤쪽(상대 골 반대편)으로 돌아 들어간다
    const tx = bx + (ws.team === 'red' ? -6 : 6) + (Math.random() - 0.5) * 16;
    const ty = by + (Math.random() - 0.5) * 16;
    ws.send(JSON.stringify({ t: 'i', dx: Math.abs(tx - me[1]) > 3 ? Math.sign(tx - me[1]) : 0, dy: Math.abs(ty - me[2]) > 3 ? Math.sign(ty - me[2]) : 0 }));
    const near = Math.hypot(bx - me[1], by - me[2]) < 12;
    if (near && Math.random() < 0.3) ws.send(JSON.stringify({ t: 'k', a: Math.abs(goalX - me[1]) < 140 ? 'shoot' : 'pass' }));
  }
}, 120);
console.log(`가짜 아이 ${N}명 들어감 (방 ${code}). 끝내려면 Ctrl+C`);
