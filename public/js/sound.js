// 8비트 소리 — 파일 없이 브라우저에서 만든다.
let ctx = null;
let master = null;
let muted = false;
let bgmTimer = null;
let bgmOn = false;
let bgmGain = null;

try {
  muted = localStorage.getItem('cs-muted') === '1';
} catch {}

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function isMuted() {
  return muted;
}

export function toggleMute() {
  muted = !muted;
  try {
    localStorage.setItem('cs-muted', muted ? '1' : '0');
  } catch {}
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

function tone(freq, start, dur, type = 'square', vol = 0.15, slideTo = null, dest = null) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
  g.gain.setValueAtTime(vol, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(dest || master);
  o.start(start);
  o.stop(start + dur + 0.02);
}

function noise(start, dur, vol = 0.2) {
  if (!ctx) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource();
  s.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = vol;
  s.connect(g).connect(master);
  s.start(start);
}

export function play(name, arg) {
  if (!ctx) return;
  const t = ctx.currentTime;
  switch (name) {
    case 'whistle':
      for (let i = 0; i < 6; i++) tone(2200 + (i % 2) * 180, t + i * 0.05, 0.06, 'square', 0.06);
      break;
    case 'shoot':
      noise(t, 0.08, 0.35);
      tone(180, t, 0.08, 'triangle', 0.25, 60);
      break;
    case 'pass':
      noise(t, 0.05, 0.18);
      tone(320, t, 0.05, 'triangle', 0.15, 160);
      break;
    case 'wall':
      tone(140, t, 0.05, 'square', 0.05);
      break;
    case 'goal': {
      const notes = arg === 2 ? [523, 659, 784, 1047, 1319] : [523, 659, 784, 1047];
      notes.forEach((f, i) => tone(f, t + i * 0.09, 0.18, 'square', 0.12));
      noise(t, 0.6, 0.08);
      break;
    }
    case 'double':
      for (let i = 0; i < 4; i++) {
        tone(880, t + i * 0.22, 0.1, 'square', 0.12);
        tone(1175, t + i * 0.22 + 0.1, 0.1, 'square', 0.12);
      }
      break;
    case 'end':
      [784, 659, 523].forEach((f, i) => tone(f, t + i * 0.25, 0.3, 'square', 0.1));
      for (let i = 0; i < 3; i++) tone(2200, t + 0.9 + i * 0.3, 0.2, 'square', 0.06);
      break;
    case 'click':
      tone(660, t, 0.04, 'square', 0.06);
      break;
  }
}

// 배경음악 — 짧은 8비트 반복
const MELODY = [
  [659, 1], [784, 1], [880, 2], [784, 1], [659, 1], [587, 2],
  [523, 1], [587, 1], [659, 2], [587, 1], [523, 1], [440, 2],
  [659, 1], [784, 1], [880, 2], [1047, 1], [880, 1], [784, 2],
  [659, 1], [587, 1], [523, 2], [587, 2], [523, 4],
];
const BASS = [131, 131, 175, 175, 147, 147, 196, 196];
const BEAT = 0.16;

export function startBgm() {
  if (!ctx || bgmOn) return;
  bgmOn = true;
  bgmGain = ctx.createGain();
  bgmGain.connect(master);
  const out = bgmGain;
  let next = ctx.currentTime + 0.1;
  const loopLen = MELODY.reduce((a, [, d]) => a + d, 0) * BEAT;
  const schedule = () => {
    if (!bgmOn) return;
    while (next < ctx.currentTime + 1.5) {
      let at = next;
      for (const [f, d] of MELODY) {
        tone(f, at, d * BEAT * 0.9, 'square', 0.035, null, out);
        at += d * BEAT;
      }
      const bl = loopLen / BASS.length;
      BASS.forEach((f, i) => tone(f, next + i * bl, bl * 0.8, 'triangle', 0.08, null, out));
      next += loopLen;
    }
  };
  schedule();
  bgmTimer = setInterval(schedule, 500);
}

export function stopBgm() {
  bgmOn = false;
  if (bgmGain) bgmGain.disconnect();
  bgmGain = null;
  if (bgmTimer) clearInterval(bgmTimer);
  bgmTimer = null;
}
