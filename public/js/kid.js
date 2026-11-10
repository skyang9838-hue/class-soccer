import { createView } from './view.js';
import { unlock, toggleMute, isMuted, play, stopBgm } from './sound.js';
import { renderResult, renderLists } from './common.js';
import { startSolo } from './solo.js';

const $ = (id) => document.getElementById(id);
const screens = ['join', 'wait', 'game', 'result'];
function show(id) {
  for (const s of screens) $(s).classList.toggle('hidden', s !== id);
}

const view = createView($('view'));
let ws = null;
let me = null;
let inMatch = false;
let myId = null;
let wantConnect = false;
let retryTimer = null;
let solo = null; // 혼자 연습 중이면 경기 조종기

// 저장해 둔 코드·이름 (창을 닫았다 와도 바로)
let saved = {};
try {
  saved = JSON.parse(localStorage.getItem('cs-kid') || '{}');
} catch {}
// 이 노트북 표시 (끊겼다 다시 들어올 때 내 자리를 넘겨받는 데 씀)
let cid = '';
try {
  cid = localStorage.getItem('cs-cid') || '';
  if (!cid) {
    cid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('cs-cid', cid);
  }
} catch {
  cid = Math.random().toString(36).slice(2);
}
const params = new URLSearchParams(location.search);
$('code').value = params.get('code') || saved.code || '';
$('name').value = saved.name || '';
let gender = saved.g || null;
function paintGender() {
  document.querySelectorAll('#gender [data-g]').forEach((b) => b.classList.toggle('on', b.dataset.g === gender));
}
document.querySelectorAll('#gender [data-g]').forEach((b) => {
  b.onclick = () => {
    gender = b.dataset.g;
    paintGender();
  };
});
paintGender();

$('mute').textContent = isMuted() ? '🔇' : '🔊';
$('mute').onclick = () => {
  unlock();
  $('mute').textContent = toggleMute() ? '🔇' : '🔊';
};

$('joinForm').onsubmit = (e) => {
  e.preventDefault();
  unlock();
  play('click');
  const code = $('code').value.trim();
  const name = $('name').value.trim();
  if (!/^\d{4}$/.test(code)) return ($('joinErr').textContent = '방 코드는 숫자 4자리예요');
  if (!name) return ($('joinErr').textContent = '이름을 적어 주세요');
  if (!gender) return ($('joinErr').textContent = '남·여를 골라 주세요');
  saved = { code, name, g: gender };
  try {
    localStorage.setItem('cs-kid', JSON.stringify(saved));
  } catch {}
  wantConnect = true;
  if (solo) solo.stop();
  solo = null;
  $('soloAgain').classList.add('hidden');
  connect();
};

let lastMsgAt = 0;
let pingAt = 0;
function connect() {
  clearTimeout(retryTimer);
  // 앞의 창이 남아 있으면 먼저 닫는다 (두 번 눌러 연결이 두 개 생기지 않게)
  if (ws) {
    const old = ws;
    ws = null;
    try {
      old.close();
    } catch {}
  }
  lastMsgAt = Date.now();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/ws/play?code=${encodeURIComponent(saved.code)}&name=${encodeURIComponent(saved.name)}&g=${saved.g || ''}&cid=${encodeURIComponent(cid)}`;
  const sock = new WebSocket(url);
  ws = sock;
  let fatal = false;
  sock.onmessage = (ev) => {
    if (ws !== sock) return;
    lastMsgAt = Date.now();
    const msg = JSON.parse(ev.data);
    if (msg.t === 'p') {
      if (pingAt) view.setRtt(performance.now() - pingAt);
      pingAt = 0;
      return;
    }
    if (msg.t === 'error') {
      fatal = true;
      wantConnect = false;
      leaveMatch();
      show('join');
      $('joinErr').textContent = msg.msg;
      return;
    }
    onMessage(msg);
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    if (!fatal && wantConnect) {
      toast('연결이 끊겼어요. 다시 잇는 중…');
      retryTimer = setTimeout(connect, 1500);
    }
  };
}

function onMessage(msg) {
  switch (msg.t) {
    case 'welcome':
      me = msg.name;
      $('waitClass').textContent = msg.className + ' 반';
      $('waitName').textContent = me;
      $('joinErr').textContent = '';
      hideToast();
      if (!inMatch) show('wait');
      break;
    case 'lobby': {
      renderLists(msg.kids, $('lRed'), $('lBlue'), $('lBench'), me);
      const mine = msg.kids.find((k) => k.name === me);
      const b = $('waitTeam');
      if (mine && mine.team) {
        b.className = 'team-badge ' + mine.team;
        b.textContent = mine.team === 'red' ? '나는 빨강 팀' : '나는 파랑 팀';
      } else {
        b.className = 'team-badge none';
        b.textContent = '이번 판은 관전 (선생님이 팀을 짜는 중일 수도)';
      }
      break;
    }
    case 'match':
      inMatch = true;
      myId = msg.you;
      show('game');
      view.start(msg.roster, msg.you);
      view.setPaused(!!msg.paused);
      break;
    case 's':
      if (inMatch) view.push(msg);
      break;
    case 'paused':
      view.setPaused(msg.on);
      break;
    case 'result':
      leaveMatch();
      $('resultBox').innerHTML = renderResult(msg, me);
      show('result');
      break;
    case 'lobbyView':
      leaveMatch();
      show('wait');
      break;
  }
}

function leaveMatch() {
  if (inMatch) view.stop();
  inMatch = false;
  myId = null;
  stopBgm();
  sendInput(true);
}

function sendKick(a, power = 0.5) {
  if (solo) solo.kick(a, power);
  else if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'k', a, p: Math.round(power * 100) / 100 }));
}

let charge = null;
function startCharge(a) {
  charge = { a, t0: performance.now() };
  view.setCharge(charge);
}

// ───── 혼자 연습
function soloStart() {
  unlock();
  play('click');
  const name = $('name').value.trim() || '나';
  wantConnect = false;
  if (ws) ws.close();
  if (solo) solo.stop();
  $('soloAgain').classList.remove('hidden');
  solo = startSolo({
    name,
    perTeam: Number($('soloN').value),
    level: $('soloL').value,
    matchTime: Number($('soloT').value),
    onMatch(roster, you) {
      inMatch = true;
      myId = you;
      show('game');
      view.start(roster, you);
    },
    onSnap(s) {
      view.push(s);
    },
    onEnd(r) {
      leaveMatch();
      $('resultBox').innerHTML = renderResult(r, name).replace('선생님이 다음 판을 준비하고 있어요', '혼자 연습 끝!');
      show('result');
    },
  });
}
$('soloGo').onclick = soloStart;
$('soloRetry').onclick = soloStart;
$('soloHome').onclick = () => {
  solo && solo.stop();
  solo = null;
  $('soloAgain').classList.add('hidden');
  show('join');
};
window.addEventListener('keydown', (e) => {
  // 연습 중 Esc = 그만하고 처음으로
  if (solo && inMatch && e.code === 'Escape') {
    solo.stop();
    solo = null;
    leaveMatch();
    $('soloAgain').classList.add('hidden');
    show('join');
  }
});

// ───── 키보드
const held = new Set();
const KEYS = {
  ArrowLeft: 'l', KeyA: 'l',
  ArrowRight: 'r', KeyD: 'r',
  ArrowUp: 'u', KeyW: 'u',
  ArrowDown: 'd', KeyS: 'd',
};
let lastSent = '';

function sendInput(force) {
  const dx = (held.has('r') ? 1 : 0) - (held.has('l') ? 1 : 0);
  const dy = (held.has('d') ? 1 : 0) - (held.has('u') ? 1 : 0);
  const key = dx + ',' + dy;
  if (!force && key === lastSent) return;
  lastSent = key;
  view.setInput(dx, dy);
  if (solo) solo.input(dx, dy);
  else if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'i', dx, dy }));
}

window.addEventListener('keydown', (e) => {
  if (!inMatch || myId == null) return;
  if (KEYS[e.code]) {
    e.preventDefault();
    held.add(KEYS[e.code]);
    sendInput();
  } else if (e.code === 'KeyZ' || e.code === 'KeyJ') {
    e.preventDefault();
    if (e.repeat || charge) return;
    // 공이 없으면 바로 태클, 있으면 게이지 모으기
    if (!view.myHasBall()) sendKick('pass', 0.5);
    else startCharge('pass');
  } else if (e.code === 'KeyX' || e.code === 'KeyK') {
    e.preventDefault();
    if (e.repeat || charge) return;
    startCharge('shoot');
  }
});
window.addEventListener('keyup', (e) => {
  const a = e.code === 'KeyZ' || e.code === 'KeyJ' ? 'pass' : e.code === 'KeyX' || e.code === 'KeyK' ? 'shoot' : null;
  if (a && charge && charge.a === a) {
    const power = Math.min(1, (performance.now() - charge.t0) / 1000);
    charge = null;
    view.setCharge(null);
    // 모으는 사이 공을 뺏겼으면 패스는 버린다 (태클로 바뀌지 않게)
    if (a === 'shoot' || view.myHasBall()) sendKick(a, power);
    return;
  }
  if (KEYS[e.code]) {
    held.delete(KEYS[e.code]);
    sendInput();
  }
});
window.addEventListener('blur', () => {
  held.clear();
  charge = null;
  view.setCharge(null);
  sendInput();
});
// 살아 있음 신호: 2초마다 보내고, 7초 넘게 아무것도 못 받으면 끊긴 걸로 보고 다시 잇는다
setInterval(() => {
  if (!wantConnect || solo) return;
  if (ws && ws.readyState === 1) {
    pingAt = performance.now();
    ws.send('{"t":"p"}');
  }
  if (ws && Date.now() - lastMsgAt > 7000) {
    toast('연결이 끊겼어요. 다시 잇는 중…');
    connect();
  }
}, 2000);
// 키 입력이 사라져도 서버가 맞춰지게 가끔 다시 보낸다
setInterval(() => inMatch && sendInput(true), 500);

let toastEl = null;
function toast(text) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = text;
  toastEl.classList.remove('hidden');
}
function hideToast() {
  toastEl && toastEl.classList.add('hidden');
}

// 주소에 코드가 있고 이름도 저장돼 있으면 이름 칸으로
if ($('code').value) $('name').focus();
else $('code').focus();
