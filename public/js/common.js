export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function renderLists(kids, red, blue, bench, me) {
  const li = (k) =>
    `<li style="${k.on ? '' : 'opacity:.45'}">${k.name === me ? '▶ ' : ''}${k.g === 'm' ? '♂ ' : k.g === 'f' ? '♀ ' : ''}${esc(k.name)}${k.on ? '' : ' (나감)'}</li>`;
  red.innerHTML = kids.filter((k) => k.team === 'red').map(li).join('') || '<li>-</li>';
  blue.innerHTML = kids.filter((k) => k.team === 'blue').map(li).join('') || '<li>-</li>';
  bench.innerHTML = kids.filter((k) => !k.team).map(li).join('') || '<li>-</li>';
}

export function renderResult(r, me) {
  const [rs, bs] = [r.score.red, r.score.blue];
  let head = r.winner === 'red' ? '빨강 승리!' : r.winner === 'blue' ? '파랑 승리!' : '무승부!';
  if (r.recorded === false) head = '경기를 멈췄어요';
  const myTeam = me && r.roster ? (r.roster.find((p) => p.name === me) || {}).team : null;
  let mine = '';
  if (r.recorded !== false && myTeam) mine = r.winner === myTeam ? '🏆 우리 팀이 이겼어요!' : r.winner ? '다음 판엔 이길 거예요!' : '';
  const goals = r.goals
    .map((g) => {
      const who = g.own ? '자책골' : esc(g.name || '?');
      const color = g.team === 'red' ? '#ff8a8a' : '#8ab8ff';
      return `<li><span style="color:${color}">⚽ ${who}</span>${g.points === 2 ? ' <b style="color:#ffe14d">+2</b>' : ''}</li>`;
    })
    .join('');
  return `
    <h2>${head}</h2>
    <div class="big"><span class="r">${rs}</span><span>:</span><span class="b">${bs}</span></div>
    ${mine ? `<p class="sub" style="margin-top:10px">${mine}</p>` : ''}
    <ul>${goals || '<li style="color:#94b0c2">골 없음</li>'}</ul>
    <p class="sub" style="margin-top:16px">선생님이 다음 판을 준비하고 있어요</p>`;
}
