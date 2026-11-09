import { createView } from './view.js';
import { unlock, toggleMute, isMuted, play, stopBgm } from './sound.js';
import { renderResult, renderLists } from './common.js';

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

// 저장해 둔 코드·이름 (창을 닫았다 와도 바로)
let saved = {};
try {
  saved = JSON.parse(localStorage.getItem('cs-kid') || '{}');
} catch {}
const params = new URLSearchParams(location.search);
$('code').value = params.get('code') || saved.code || '';
$('name').value = saved.name || '';

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
  saved = { code, name };
  try {
    localStorage.setItem('cs-kid', JSON.stringify(saved));
  } catch {}
  wantConnect = true;
  connect();
};

function connect() {
  clearTimeout(retryTimer);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/ws/play?code=${encodeURIComponent(saved.code)}&name=${encodeURIComponent(saved.name)}`;
  const sock = new WebSocket(url);
  ws = sock;
  let fatal = false;
  sock.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
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
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'i', dx, dy }));
}

window.addEventListener('keydown', (e) => {
  if (!inMatch || myId == null) return;
  if (KEYS[e.code]) {
    e.preventDefault();
    held.add(KEYS[e.code]);
    sendInput();
  } else if (!e.repeat && (e.code === 'KeyZ' || e.code === 'KeyJ')) {
    e.preventDefault();
    ws && ws.readyState === 1 && ws.send(JSON.stringify({ t: 'k', a: 'pass' }));
  } else if (!e.repeat && (e.code === 'KeyX' || e.code === 'KeyK')) {
    e.preventDefault();
    ws && ws.readyState === 1 && ws.send(JSON.stringify({ t: 'k', a: 'shoot' }));
  }
});
window.addEventListener('keyup', (e) => {
  if (KEYS[e.code]) {
    held.delete(KEYS[e.code]);
    sendInput();
  }
});
window.addEventListener('blur', () => {
  held.clear();
  sendInput();
});
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
