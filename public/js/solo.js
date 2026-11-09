// 혼자 연습 — 서버 없이 브라우저에서 경기를 돌린다. 나 + AI 동료 vs AI 상대
import { createMatch, step, setInput, snapshot, result, TICK } from './game.js';
import { createAI } from './ai.js';

const NAMES = ['민준', '서연', '도윤', '하은', '지호', '수아', '예준', '지우', '건우', '유나', '시우'];

export function startSolo({ name, perTeam, level, matchTime, onMatch, onSnap, onEnd }) {
  const roster = [{ id: 1, name, team: 'red' }];
  const pool = [...NAMES].sort(() => Math.random() - 0.5);
  let id = 2;
  for (let i = 1; i < perTeam; i++) roster.push({ id: id++, name: 'AI ' + pool.pop(), team: 'red' });
  for (let i = 0; i < perTeam; i++) roster.push({ id: id++, name: 'AI ' + pool.pop(), team: 'blue' });
  const m = createMatch(roster, { kickoffTeam: Math.random() < 0.5 ? 'red' : 'blue', matchTime });
  const ai = createAI(m, new Set(roster.filter((r) => r.id !== 1).map((r) => r.id)), level);
  let paused = false;
  onMatch(roster, 1);
  const timer = setInterval(() => {
    if (paused) return;
    ai.tick();
    step(m, TICK);
    onSnap(snapshot(m));
    if (m.phase === 'end') {
      clearInterval(timer);
      onEnd({ ...result(m), recorded: true, roster });
    }
  }, TICK * 1000);

  return {
    input(dx, dy) {
      setInput(m, 1, { dx, dy });
    },
    kick(a, power = 0.5) {
      setInput(m, 1, { pass: a === 'pass', shoot: a === 'shoot', power });
    },
    pause(on) {
      paused = on;
    },
    stop() {
      clearInterval(timer);
    },
  };
}
