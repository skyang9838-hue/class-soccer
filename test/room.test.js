import { describe, it, expect } from 'vitest';
import {
  createRoster,
  join,
  leave,
  kick,
  randomTeams,
  cycleTeam,
  teamsOf,
  markPlayed,
  canStart,
} from '../src/room.js';

function seeded(seed = 1) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

describe('방', () => {
  it('같은 이름이 접속해 있으면 막고, 나갔다 오면 원래 자리로', () => {
    const r = createRoster();
    expect(join(r, '민수').ok).toBe(true);
    expect(join(r, '민수')).toMatchObject({ ok: false, reason: 'taken' });
    r.kids.get('민수').team = 'blue';
    leave(r, '민수');
    const back = join(r, '민수');
    expect(back).toMatchObject({ ok: true, rejoined: true });
    expect(back.kid.team).toBe('blue');
  });

  it('빈 이름·위험한 글자는 거른다', () => {
    const r = createRoster();
    expect(join(r, '   ').ok).toBe(false);
    expect(join(r, '<b>철수</b>').kid.name).toBe('b철수/b');
  });

  it('내보내면 목록에서 사라진다', () => {
    const r = createRoster();
    join(r, '가');
    kick(r, '가');
    expect(r.kids.size).toBe(0);
  });

  it('랜덤은 최대 인원까지, 지난 판에 안 뛴 아이가 먼저', () => {
    const r = createRoster();
    for (let i = 0; i < 16; i++) join(r, '아이' + i);
    const t1 = randomTeams(r, 12, seeded(3));
    expect(t1.red.length + t1.blue.length).toBe(12);
    expect(Math.abs(t1.red.length - t1.blue.length)).toBeLessThanOrEqual(1);
    markPlayed(r);
    const benched = t1.bench;
    const t2 = randomTeams(r, 12, seeded(9));
    const playing = [...t2.red, ...t2.blue];
    for (const name of benched) expect(playing).toContain(name);
  });

  it('홀수 인원이면 5대6처럼 나뉜다', () => {
    const r = createRoster();
    for (let i = 0; i < 11; i++) join(r, 'k' + i);
    const t = randomTeams(r, 12, seeded(5));
    expect([t.red.length, t.blue.length].sort()).toEqual([5, 6]);
  });

  it('나간 아이는 랜덤에 안 들어간다', () => {
    const r = createRoster();
    join(r, '가');
    join(r, '나');
    join(r, '다');
    leave(r, '다');
    const t = randomTeams(r, 12, seeded(2));
    expect([...t.red, ...t.blue]).not.toContain('다');
  });

  it('이름 누르면 빨강→파랑→관전, 꽉 차면 관전에서 안 들어감', () => {
    const r = createRoster();
    join(r, '가');
    cycleTeam(r, '가');
    expect(r.kids.get('가').team).toBe('red');
    cycleTeam(r, '가');
    expect(r.kids.get('가').team).toBe('blue');
    cycleTeam(r, '가');
    expect(r.kids.get('가').team).toBe(null);
    join(r, '나');
    cycleTeam(r, '나', 1);
    cycleTeam(r, '가', 1);
    expect(r.kids.get('가').team).toBe(null);
  });

  it('양 팀에 한 명씩은 있어야 시작', () => {
    const r = createRoster();
    join(r, '가');
    cycleTeam(r, '가');
    expect(canStart(r)).toBe(false);
    join(r, '나');
    cycleTeam(r, '나');
    cycleTeam(r, '나');
    expect(canStart(r)).toBe(true);
    expect(teamsOf(r)).toEqual({ red: ['가'], blue: ['나'], bench: [] });
  });
});
