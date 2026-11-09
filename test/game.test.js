import { describe, it, expect } from 'vitest';
import {
  createMatch,
  step,
  setInput,
  result,
  FIELD,
  CX,
  CY,
  KICKOFF_FREEZE,
  GOAL_PAUSE,
  TICK,
  formation,
} from '../public/js/game.js';

const roster = [
  { id: 1, name: '가', team: 'red' },
  { id: 2, name: '나', team: 'blue' },
];

function playing(opts) {
  const m = createMatch(roster, opts);
  // 킥오프 얼음 풀기
  for (let t = 0; t < KICKOFF_FREEZE + 0.1; t += TICK) step(m);
  expect(m.phase).toBe('play');
  return m;
}

function run(m, seconds) {
  for (let t = 0; t < seconds; t += TICK) step(m);
}

describe('경기 계산', () => {
  it('킥오프 동안은 얼어 있다가 풀린다', () => {
    const m = createMatch(roster);
    const p = m.players[0];
    const x0 = p.x;
    setInput(m, 1, { dx: 1, dy: 0 });
    step(m);
    expect(m.phase).toBe('kickoff');
    expect(p.x).toBe(x0);
    run(m, KICKOFF_FREEZE);
    expect(m.phase).toBe('play');
  });

  it('공은 위 벽에 튕긴다', () => {
    const m = playing();
    m.ball.x = 100;
    m.ball.y = FIELD.top + 10;
    m.ball.vx = 0;
    m.ball.vy = -150;
    m.players.forEach((p) => ((p.x = 250), (p.y = 120)));
    run(m, 0.3);
    expect(m.ball.vy).toBeGreaterThan(0);
    expect(m.ball.y).toBeGreaterThan(FIELD.top);
  });

  it('골문 밖 옆 벽에도 튕긴다', () => {
    const m = playing();
    m.ball.x = FIELD.left + 10;
    m.ball.y = FIELD.top + 8;
    m.ball.vx = -150;
    m.ball.vy = 0;
    m.players.forEach((p) => ((p.x = 250), (p.y = 120)));
    run(m, 0.3);
    expect(m.ball.vx).toBeGreaterThan(0);
    expect(m.score.blue).toBe(0);
  });

  it('왼쪽 골문으로 들어가면 파랑 1점, 넣은 아이가 기록된다', () => {
    const m = playing();
    m.ball.x = FIELD.left + 15;
    m.ball.y = CY;
    m.ball.vx = -200;
    m.ball.vy = 0;
    m.ball.lastTouch = 2;
    m.players.forEach((p) => ((p.x = 250), (p.y = FIELD.top + 6)));
    run(m, 0.5);
    expect(m.score.blue).toBe(1);
    expect(m.phase).toBe('goal');
    expect(m.goals[0]).toMatchObject({ name: '나', team: 'blue', points: 1, own: false });
  });

  it('자책골은 own으로 남는다', () => {
    const m = playing();
    m.ball.x = FIELD.left + 15;
    m.ball.y = CY;
    m.ball.vx = -200;
    m.ball.lastTouch = 1; // 빨강이 자기 골에
    m.players.forEach((p) => ((p.x = 250), (p.y = FIELD.top + 6)));
    run(m, 0.5);
    expect(m.score.blue).toBe(1);
    expect(m.goals[0].own).toBe(true);
  });

  it('마지막 1분은 한 골 2점이고 알림이 한 번 뜬다', () => {
    const m = playing({ matchTime: 61 });
    let announced = 0;
    for (let t = 0; t < 1.5; t += TICK) {
      step(m);
      announced += m.events.filter((e) => e.e === 'double').length;
    }
    expect(announced).toBe(1);
    m.ball.x = FIELD.right - 15;
    m.ball.y = CY;
    m.ball.vx = 200;
    m.ball.vy = 0;
    m.ball.lastTouch = 1;
    m.players.forEach((p) => ((p.x = 100), (p.y = FIELD.top + 6)));
    run(m, 0.5);
    expect(m.score.red).toBe(2);
    expect(m.goals[0].points).toBe(2);
  });

  it('골 뒤에는 먹힌 팀 공으로 가운데에서 다시 시작한다', () => {
    const m = playing();
    m.ball.x = FIELD.right - 15;
    m.ball.y = CY;
    m.ball.vx = 200;
    m.ball.lastTouch = 1;
    m.players.forEach((p) => ((p.x = 100), (p.y = FIELD.top + 6)));
    run(m, 0.5);
    expect(m.score.red).toBe(1);
    run(m, GOAL_PAUSE);
    expect(m.phase).toBe('kickoff');
    expect(m.ball.x).toBe(CX);
    const blue = m.players.find((p) => p.team === 'blue');
    // 파랑(먹힌 팀)이 공 바로 옆
    expect(Math.hypot(blue.x - CX, blue.y - CY)).toBeLessThan(10);
  });

  it('시간이 다 되면 끝난다', () => {
    const m = playing({ matchTime: 2 });
    run(m, 2.2);
    expect(m.phase).toBe('end');
    expect(result(m).winner).toBe(null);
  });

  it('슛은 보는 방향과 상관없이 상대 골로, 게이지가 찰수록 세게 · 패스는 우리 팀 쪽으로', () => {
    const team = [
      { id: 1, name: '가', team: 'red' },
      { id: 3, name: '다', team: 'red' },
      { id: 2, name: '나', team: 'blue' },
    ];
    const m = createMatch(team);
    run(m, KICKOFF_FREEZE + 0.1);
    const [a, c, b] = m.players;
    a.x = 100;
    a.y = 60;
    a.fx = 1;
    a.fy = 0;
    c.x = 100;
    c.y = 120;
    b.x = 280;
    b.y = 20;
    m.ball.x = 105;
    m.ball.y = 60;
    m.ball.vx = m.ball.vy = 0;
    setInput(m, 1, { dx: 0, dy: 0, pass: true });
    step(m);
    expect(m.ball.vy).toBeGreaterThan(Math.abs(m.ball.vx)); // 아래쪽(다)으로
    // 슛
    run(m, 0.4);
    m.ball.x = a.x + 5;
    m.ball.y = a.y;
    m.ball.vx = m.ball.vy = 0;
    a.fx = -1; // 반대쪽을 보고 있어도
    setInput(m, 1, { dx: 0, dy: 0, shoot: true, power: 0 });
    step(m);
    const weak = m.ball.vx;
    expect(weak).toBeGreaterThan(60); // 빨강은 오른쪽 골로
    run(m, 0.4);
    m.ball.owner = null;
    m.ball.x = a.x + 5;
    m.ball.y = a.y;
    m.ball.vx = m.ball.vy = 0;
    setInput(m, 1, { dx: 0, dy: 0, shoot: true, power: 1 });
    step(m);
    expect(m.ball.vx).toBeGreaterThan(weak * 1.4);
  });

  it('인원이 안 맞아도 자리가 모두 경기장 안이다', () => {
    for (const n of [1, 2, 5, 6, 7]) {
      const f = formation(n);
      expect(f).toHaveLength(n);
      for (const s of f) {
        expect(CX - s.x).toBeGreaterThan(FIELD.left);
        expect(CY + s.y).toBeGreaterThan(FIELD.top);
        expect(CY + s.y).toBeLessThan(FIELD.bottom);
      }
    }
    const five = [1, 2, 3, 4, 5].map((i) => ({ id: i, name: 'r' + i, team: 'red' }));
    const six = [6, 7, 8, 9, 10, 11].map((i) => ({ id: i, name: 'b' + i, team: 'blue' }));
    const m = createMatch([...five, ...six]);
    for (const p of m.players) {
      expect(p.x).toBeGreaterThan(FIELD.left);
      expect(p.x).toBeLessThan(FIELD.right);
    }
  });

  it('공에 닿으면 발 앞에 붙어 같이 간다 (드리블), 공을 가지면 조금 느리다', () => {
    const m = playing();
    const [a, b] = m.players;
    b.x = 280;
    b.y = 130;
    a.x = 100;
    a.y = 60;
    m.ball.x = 106;
    m.ball.y = 60;
    m.ball.vx = m.ball.vy = 0;
    setInput(m, 1, { dx: 1, dy: 0 });
    step(m);
    expect(m.ball.owner).toBe(1);
    const x0 = a.x;
    run(m, 1);
    expect(m.ball.owner).toBe(1);
    expect(m.ball.x).toBeGreaterThan(a.x);
    const carried = a.x - x0;
    expect(carried).toBeGreaterThan(34);
    expect(carried).toBeLessThan(45); // 보통 속도(46)보다 느림
  });

  it('스탠딩 태클: 붙어서 누르면 바로 뺏고, 뒤에서(백태클)도 된다', () => {
    const m = playing();
    const [a, b] = m.players;
    // 파랑(b)이 오른쪽을 보고 공을 몰고, 빨강(a)은 바로 뒤
    m.ball.owner = 2;
    m.ball.safe = 0;
    b.x = 120;
    b.y = 60;
    b.fx = 1;
    b.fy = 0;
    a.x = 110;
    a.y = 60;
    a.fx = 1;
    a.fy = 0;
    setInput(m, 1, { pass: true });
    step(m);
    expect(m.events.some((e) => e.e === 'steal')).toBe(true);
    expect(m.ball.owner).toBe(1);
    expect(b.stun).toBeGreaterThan(0);
    // 막 뺏은 아이는 잠깐 안 뺏긴다
    b.stun = 0;
    b.tackleCool = 0;
    setInput(m, 2, { pass: true });
    step(m);
    expect(m.ball.owner).toBe(1);
  });

  it('멀리서 태클하면 헛발 → 잠깐 느려진다', () => {
    const m = playing();
    const [a, b] = m.players;
    m.ball.owner = 2;
    m.ball.safe = 0;
    b.x = 200;
    b.y = 60;
    a.x = 100;
    a.y = 60;
    setInput(m, 1, { pass: true });
    step(m);
    expect(m.ball.owner).toBe(2);
    expect(a.whiff).toBeGreaterThan(0);
  });

  it('패스·슛만 눌러도 움직이던 방향은 그대로', () => {
    const m = playing();
    setInput(m, 1, { dx: 1, dy: 0 });
    setInput(m, 1, { shoot: true });
    expect(m.players[0].input.dx).toBe(1);
  });
});
