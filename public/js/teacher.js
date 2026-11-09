import { createView } from './view.js';
import { unlock, toggleMute, isMuted, play, stopBgm } from './sound.js';
import { renderResult, esc } from './common.js';

const $ = (id) => document.getElementById(id);
const screens = ['pick', 'lobby', 'game', 'result'];
function show(id) {
  for (const s of screens) $(s).classList.toggle('hidden', s !== id);
  $('records').classList.toggle('hidden', id === 'pick');
}

const view = createView($('view'));
let ws = null;
let current = null; // { classId, key, name }
let inMatch = false;
let paused = false;
let wantConnect = false;
let retryTimer = null;
let kids = [];

// 이 브라우저에 기억해 둔 반들
function loadClasses() {
  try {
    return JSON.parse(localStorage.getItem('cs-classes') || '[]');
  } catch {
    return [];
  }
}
function saveClasses(list) {
  try {
    localStorage.setItem('cs-classes', JSON.stringify(list));
  } catch {}
}

function renderClasses() {
  const list = loadClasses();
  $('classList').innerHTML = list.length
    ? list.map((c, i) => `<button class="btn blue" data-i="${i}">${esc(c.name)} 반 열기 ▶</button>`).join('')
    : '<p class="sub" style="margin:0">아직 만든 반이 없어요</p>';
  $('classList').querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      unlock();
      open(list[Number(b.dataset.i)]);
    };
  });
}

$('newClass').onsubmit = async (e) => {
  e.preventDefault();
  unlock();
  const name = $('cname').value.trim();
  if (!name) return ($('pickErr').textContent = '반 이름을 적어 주세요');
  $('pickErr').textContent = '';
  try {
    const res = await fetch('/api/class', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '만들지 못했어요');
    const list = loadClasses();
    list.unshift(data);
    saveClasses(list);
    $('cname').value = '';
    open(data);
  } catch (err) {
    $('pickErr').textContent = err.message;
  }
};

function open(c) {
  current = c;
  wantConnect = true;
  $('lobbyClass').textContent = c.name + ' 반';
  $('addr').textContent = location.host;
  connect();
}

function connect() {
  clearTimeout(retryTimer);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(
    `${proto}://${location.host}/ws/teacher?class=${encodeURIComponent(current.classId)}&key=${encodeURIComponent(current.key)}`
  );
  ws = sock;
  let fatal = false;
  sock.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.t === 'error') {
      fatal = true;
      wantConnect = false;
      show('pick');
      $('pickErr').textContent = msg.msg;
      return;
    }
    onMessage(msg);
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    if (!fatal && wantConnect) retryTimer = setTimeout(connect, 1500);
  };
}

function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function onMessage(msg) {
  switch (msg.t) {
    case 'welcome':
      $('code').textContent = msg.code;
      if (!inMatch) show('lobby');
      break;
    case 'lobby':
      kids = msg.kids;
      renderLobby();
      break;
    case 'match':
      inMatch = true;
      paused = !!msg.paused;
      $('pause').textContent = paused ? '▶ 이어 하기' : '⏸ 일시정지';
      show('game');
      view.start(msg.roster, null);
      view.setPaused(paused);
      break;
    case 's':
      if (inMatch) view.push(msg);
      break;
    case 'paused':
      paused = msg.on;
      $('pause').textContent = paused ? '▶ 이어 하기' : '⏸ 일시정지';
      view.setPaused(msg.on);
      break;
    case 'result':
      leaveMatch();
      $('resultBox').innerHTML = renderResult(msg, null).replace(/<p class="sub" style="margin-top:16px">.*?<\/p>/, '');
      show('result');
      break;
    case 'lobbyView':
      leaveMatch();
      show('lobby');
      break;
    case 'records':
      renderRecords(msg);
      break;
    case 'notice':
      alertBox(msg.msg);
      break;
  }
}

function leaveMatch() {
  if (inMatch) view.stop();
  inMatch = false;
  stopBgm();
}

function renderLobby() {
  const chip = (k) => `
    <span class="chip ${k.team || ''} ${k.on ? '' : 'off'}">
      <button class="g ${k.g || 'none'}" data-gender="${esc(k.name)}" title="성별 고치기">${k.g === 'm' ? '♂' : k.g === 'f' ? '♀' : '?'}</button>
      <button data-cycle="${esc(k.name)}" title="팀 바꾸기">${esc(k.name)}${k.on ? '' : ' (나감)'}</button>
      <button class="x" data-kick="${esc(k.name)}" title="내보내기">✕</button>
    </span>`;
  const red = kids.filter((k) => k.team === 'red');
  const blue = kids.filter((k) => k.team === 'blue');
  const bench = kids.filter((k) => !k.team);
  $('cRed').innerHTML = red.map(chip).join('');
  $('cBlue').innerHTML = blue.map(chip).join('');
  $('cBench').innerHTML = bench.map(chip).join('');
  $('nRed').textContent = red.length;
  $('nBlue').textContent = blue.length;
  $('nBench').textContent = bench.length;
  $('count').textContent = kids.filter((k) => k.on).length;
  $('start').disabled = !(red.length && blue.length);
  document.querySelectorAll('[data-cycle]').forEach((b) => {
    b.onclick = () => {
      play('click');
      send({ t: 'cycle', name: b.dataset.cycle, max: Number($('max').value) });
    };
  });
  document.querySelectorAll('[data-gender]').forEach((b) => {
    b.onclick = () => send({ t: 'gender', name: b.dataset.gender });
  });
  const nm = kids.filter((k) => k.on && k.g === 'm').length;
  const nf = kids.filter((k) => k.on && k.g === 'f').length;
  $('kind').options[1].textContent = `남자판 (${nm})`;
  $('kind').options[2].textContent = `여자판 (${nf})`;
  document.querySelectorAll('[data-kick]').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.armed) {
        send({ t: 'kick', name: b.dataset.kick });
      } else {
        // 실수로 누르지 않게 한 번 더 눌러야 내보낸다
        b.dataset.armed = '1';
        b.textContent = '내보내기?';
        setTimeout(() => {
          delete b.dataset.armed;
          b.textContent = '✕';
        }, 2000);
      }
    };
  });
}

$('random').onclick = () => {
  unlock();
  play('click');
  send({ t: 'random', max: Number($('max').value), kind: $('kind').value });
};
$('start').onclick = () => {
  unlock();
  send({ t: 'start' });
};
$('pause').onclick = () => send({ t: 'pause' });
$('stop').onclick = () => {
  const b = $('stop');
  if (b.dataset.armed) send({ t: 'stop' });
  else {
    b.dataset.armed = '1';
    b.textContent = '정말 끝낼까요? (기록 안 됨)';
    setTimeout(() => {
      delete b.dataset.armed;
      b.textContent = '■ 강제 종료';
    }, 2500);
  }
};
$('next').onclick = () => {
  play('click');
  send({ t: 'next' });
};
$('back').onclick = () => {
  wantConnect = false;
  ws && ws.close();
  renderClasses();
  show('pick');
};
$('records').onclick = () => send({ t: 'records' });
$('recClose').onclick = () => $('recModal').classList.add('hidden');
$('mute').textContent = isMuted() ? '🔇' : '🔊';
$('mute').onclick = () => {
  unlock();
  $('mute').textContent = toggleMute() ? '🔇' : '🔊';
};

function renderRecords(msg) {
  $('recTitle').textContent = `${current.name} 반 기록`;
  const rows = msg.rows
    .map(
      (r, i) =>
        `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.goals}</td><td>${r.wins}</td><td>${r.games}</td></tr>`
    )
    .join('');
  const matches = msg.matches
    .map((m) => {
      const d = new Date(m.at);
      const when = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
      const scorers = m.goals.filter((g) => !g.own).map((g) => esc(g.name)).join(', ');
      return `<tr><td>${when}</td><td><span style="color:#ff8a8a">${m.red}</span> : <span style="color:#8ab8ff">${m.blue}</span></td><td style="text-align:left">${scorers || '-'}</td></tr>`;
    })
    .join('');
  $('recBody').innerHTML = `
    <h3>골 순위</h3>
    <table><tr><th>순위</th><th>이름</th><th>골</th><th>이긴 판</th><th>뛴 판</th></tr>${rows || '<tr><td colspan="5">아직 기록이 없어요</td></tr>'}</table>
    <h3 style="margin-top:18px">최근 경기</h3>
    <table><tr><th>언제</th><th>점수</th><th>골 넣은 아이</th></tr>${matches || '<tr><td colspan="3">-</td></tr>'}</table>`;
  $('recModal').classList.remove('hidden');
}

let alertTimer = null;
function alertBox(text) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(alertTimer);
  alertTimer = setTimeout(() => el.classList.add('hidden'), 2500);
}

renderClasses();
show('pick');
