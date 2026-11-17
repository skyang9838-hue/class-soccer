// 11/17 수업 피드백: 자리 돌리기 · 관전 아이 랜덤 응원단 · 뛴 판 수
import { describe, it, expect } from 'vitest';
import { createMatch, step, FIELD, CX, CY, KICKOFF_FREEZE, GOAL_PAUSE, TICK } from '../public/js/game.js';
import { createRoster, join, randomTeams, markPlayed, assignCheer, cheerFor, CHEERS } from '../src/room.js';

function seeded(seed = 1) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

const roster = [
  { id: 1, name: '가', team: 'red' },
  { id: 2, name: '나', team: 'red' },
  { id: 3, name: '다', team: 'red' },
  { id: 4, name: '라', team: 'blue' },
  { id: 5, name: '마', team: 'blue' },
];

// 지금 킥오프 자리: 팀마다 [맨 뒤 사람, 공 옆(킥오프) 사람]
function seats(m, team) {
  const list = m.players.filter((p) => p.team === team);
  const ownX = team === 'red' ? FIELD.left : FIELD.right;
  const back = list.reduce((a, b) => (Math.abs(b.x - ownX) < Math.abs(a.x - ownX) ? b : a));
  const kick = list.reduce((a, b) => (Math.hypot(b.x - CX, b.y - CY) < Math.hypot(a.x - CX, a.y - CY) ? b : a));
  return { back: back.name, kick: kick.name, xy: list.map((p) => `${p.name}:${p.x.toFixed(1)},${p.y.toFixed(1)}`) };
}

function run(m, s) {
  for (let t = 0; t < s; t += TICK) step(m);
}

// 빨강이 파랑 골에 넣게 공을 골문으로 보낸다 → 다음 킥오프까지
function redScores(m) {
  for (const p of m.players) p.x = p.team === 'red' ? CX - 60 : CX - 80; // 길 비키기
  const b = m.ball;
  b.owner = null;
  b.x = FIELD.right - 3;
  b.y = CY;
  b.vx = 300;
  b.vy = 0;
  b.lastTouch = 1;
  let n = 0;
  while (m.phase !== 'goal' && n++ < 200) step(m);
  expect(m.phase).toBe('goal');
  run(m, GOAL_PAUSE + 0.1);
  expect(m.phase).toBe('kickoff');
}

describe('자리 돌리기', () => {
  it('골이 날 때마다 맨 뒤·킥오프 자리를 팀 안에서 한 칸씩 돌아가며 맡는다', () => {
    const m = createMatch(roster, { kickoffTeam: 'red', matchTime: 600 });
    const red = [seats(m, 'red')];
    const blue = [seats(m, 'blue')];
    run(m, KICKOFF_FREEZE + 0.1);
    for (let i = 0; i < 6; i++) {
      redScores(m);
      red.push(seats(m, 'red'));
      blue.push(seats(m, 'blue'));
      run(m, KICKOFF_FREEZE + 0.1);
    }
    // 빨강 3명: 맨 뒤 자리가 3골마다 한 바퀴, 연속 두 번 같은 사람이 아님
    const backs = red.map((s) => s.back);
    expect(new Set(backs.slice(0, 3)).size).toBe(3);
    expect(backs.slice(3, 6)).toEqual(backs.slice(0, 3));
    // 파랑(골 먹고 킥오프하는 쪽) 2명: 킥오프하는 사람이 번갈아
    const blueKicks = blue.slice(1).map((s) => s.kick);
    for (let i = 1; i < blueKicks.length; i++) expect(blueKicks[i]).not.toBe(blueKicks[i - 1]);
    // 자리(좌표 모양)는 그대로, 사람만 바뀐다
    const shape = (s) => s.xy.map((v) => v.split(':')[1]).sort().join('|');
    // 같은 팀이 킥오프할 때끼리 비교 (파랑은 골 먹은 뒤라 늘 킥오프)
    expect(shape(blue[1])).toBe(shape(blue[2]));
  });

  it('혼자 1명인 팀도 문제없다', () => {
    const m = createMatch(
      [
        { id: 1, name: '가', team: 'red' },
        { id: 2, name: '나', team: 'blue' },
      ],
      { matchTime: 600 }
    );
    run(m, KICKOFF_FREEZE + 0.1);
    redScores(m);
    redScores(m);
    for (const p of m.players) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});

describe('관전 아이 랜덤 응원단', () => {
  it('반씩 나누고 (홀수면 한 명 차이), 모두 빨강·파랑 중 하나', () => {
    for (let n = 0; n <= 13; n++) {
      const names = Array.from({ length: n }, (_, i) => '아이' + i);
      const c = assignCheer(names, seeded(n + 3));
      expect(c.size).toBe(n);
      const red = [...c.values()].filter((t) => t === 'red').length;
      const blue = [...c.values()].filter((t) => t === 'blue').length;
      expect(red + blue).toBe(n);
      expect(Math.abs(red - blue)).toBeLessThanOrEqual(1);
    }
  });

  it('누가 어느 쪽인지는 판마다 섞인다', () => {
    const names = Array.from({ length: 10 }, (_, i) => '아이' + i);
    const rnd = seeded(7);
    const a = [...assignCheer(names, rnd)].join();
    let differs = false;
    for (let i = 0; i < 5; i++) if ([...assignCheer(names, rnd)].join() !== a) differs = true;
    expect(differs).toBe(true);
  });

  it('경기 중에 들어온 아이는 사람이 적은 쪽으로', () => {
    const c = new Map([
      ['a', 'red'],
      ['b', 'red'],
      ['c', 'blue'],
    ]);
    expect(cheerFor(c)).toBe('blue');
    c.set('d', 'blue');
    expect(['red', 'blue']).toContain(cheerFor(c));
    expect(['red', 'blue']).toContain(cheerFor(new Map()));
  });

  it('응원 문구가 있다', () => {
    expect(CHEERS.length).toBeGreaterThan(3);
  });
});

describe('뛴 판 수', () => {
  it('방을 연 뒤 판마다 뛴 아이만 1씩 는다', () => {
    const r = createRoster();
    for (const n of ['가', '나', '다', '라', '마']) join(r, n, 'm');
    expect([...r.kids.values()].every((k) => k.played === 0)).toBe(true);
    const rnd = seeded(5);
    const counts = {};
    for (let g = 0; g < 5; g++) {
      randomTeams(r, 4, rnd);
      for (const k of r.kids.values()) if (k.team) counts[k.name] = (counts[k.name] || 0) + 1;
      markPlayed(r);
    }
    for (const k of r.kids.values()) expect(k.played).toBe(counts[k.name] || 0);
    // 4명씩 5판 = 20
    const all = [...r.kids.values()].map((k) => k.played);
    expect(all.reduce((a, b) => a + b, 0)).toBe(20);
  });
});
