// 연습 모드 AI
// 팀마다: 공에 제일 가까운 한 명이 공을 쫓고(가지면 골로 몰고), 우리 골에 제일 가까운 한 명은 막고, 나머지는 자리를 지키며 따라간다.
import { FIELD, CX, CY, formation, setInput } from './game.js';

// think: 한 틱(1/30초)에 판단을 새로 할 확률 → 보통은 약 0.2초에 한 번
const LEVELS = {
  easy: { think: 0.1, shoot: 0.015, aim: 18, range: 80, tackle: 0.012, pass: 0.02 },
  normal: { think: 0.17, shoot: 0.03, aim: 10, range: 100, tackle: 0.03, pass: 0.03 },
  hard: { think: 0.3, shoot: 0.05, aim: 5, range: 125, tackle: 0.06, pass: 0.05 },
};

export function createAI(m, aiIds, level = 'normal') {
  const L = LEVELS[level] || LEVELS.normal;
  const memo = new Map(); // id → { dx, dy }
  const byId = (id) => m.players.find((p) => p.id === id);

  function tick() {
    if (m.phase !== 'play') return;
    const b = m.ball;
    const owner = b.owner != null ? byId(b.owner) : null;
    for (const team of ['red', 'blue']) {
      const mates = m.players.filter((p) => p.team === team);
      // 공 쫓는 선수: 우리 팀이 공을 가졌으면 그 아이, 아니면 공에 제일 가까운 아이
      let chaser = owner && owner.team === team ? owner : null;
      if (!chaser) {
        let best = Infinity;
        for (const p of mates) {
          if (p.stun > 0) continue;
          const d = Math.hypot(p.x - b.x, p.y - b.y);
          if (d < best) {
            best = d;
            chaser = p;
          }
        }
      }
      const slots = formation(mates.length);
      const dir = team === 'red' ? -1 : 1;
      const ownX = team === 'red' ? FIELD.left : FIELD.right;
      let back = null;
      if (mates.length >= 2) {
        let bd = Infinity;
        for (const p of mates) {
          if (p === chaser || !aiIds.has(p.id)) continue;
          const d = Math.abs(p.x - ownX);
          if (d < bd) {
            bd = d;
            back = p;
          }
        }
      }
      mates.forEach((p, i) => {
        if (!aiIds.has(p.id) || p.stun > 0) return;
        if (Math.random() > L.think && memo.has(p.id)) {
          setInput(m, p.id, memo.get(p.id));
          return;
        }
        let o;
        if (p === chaser) o = owner === p ? attack(p, team) : chase(p, team, owner);
        else if (p === back) o = guard(p, ownX, team, owner);
        else o = support(p, slots[i], dir);
        memo.set(p.id, { dx: o.dx, dy: o.dy });
        setInput(m, p.id, o);
      });
    }
  }

  // 공을 가졌다: 골로 몬다, 막히면 비켜 가거나 패스, 가까우면 슛
  function attack(p, team) {
    const gx = team === 'red' ? FIELD.right + 6 : FIELD.left - 6;
    const gy = CY + (Math.random() - 0.5) * L.aim;
    let ux = gx - p.x;
    let uy = gy - p.y;
    const gd = Math.hypot(ux, uy) || 1;
    ux /= gd;
    uy /= gd;
    if (gd < L.range && Math.random() < L.shoot) {
      return { dx: sgn(ux, 0.3), dy: sgn(uy, 0.38), shoot: true, power: 0.3 + Math.random() * 0.6 };
    }
    const block = blocker(p, ux, uy);
    if (block) {
      if (Math.random() < L.pass) return { dx: sgn(ux, 0.3), dy: sgn(uy, 0.38), pass: true, power: Math.random() };
      // 막은 상대를 옆으로 비켜 간다
      const side = (block.x - p.x) * uy - (block.y - p.y) * ux > 0 ? -1 : 1;
      const sx = ux - uy * side * 1.2;
      const sy = uy + ux * side * 1.2;
      return { dx: sgn(sx, 0.3), dy: sgn(sy, 0.3) };
    }
    return { dx: sgn(ux, 0.3), dy: sgn(uy, 0.38) };
  }

  // 공을 쫓는다. 상대가 가졌으면 가까이 가서 태클
  function chase(p, team, owner) {
    const b = m.ball;
    let tx = b.x;
    let ty = b.y;
    if (owner && owner.team !== team) {
      // 공 가진 상대의 앞(우리 골 쪽)으로 끊으러 간다
      const ownX = team === 'red' ? FIELD.left : FIELD.right;
      const gx = ownX - b.x;
      const gy = CY - b.y;
      const gd = Math.hypot(gx, gy) || 1;
      const lead = Math.min(14, Math.hypot(b.x - p.x, b.y - p.y) * 0.5);
      tx = b.x + (gx / gd) * lead;
      ty = b.y + (gy / gd) * lead;
    }
    const dx = tx - p.x;
    const dy = ty - p.y;
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    const o = { dx: sgn(dx, 1.5), dy: sgn(dy, 1.5) };
    if (owner && owner.team !== team && d < 13 && p.tackleCool <= 0 && Math.random() < L.tackle) {
      o.pass = true; // 공 없을 때 패스 키 = 태클
    }
    return o;
  }

  // 공과 우리 골 사이에 선다. 상대가 공을 몰고 오면 태클
  function guard(p, ownX, team, owner) {
    const b = m.ball;
    const vx = b.x - ownX;
    const vy = b.y - CY;
    const d = Math.hypot(vx, vy) || 1;
    const k = Math.min(34, d * 0.45) / d;
    const tx = ownX + vx * k;
    const ty = Math.max(CY - 30, Math.min(CY + 30, CY + vy * k));
    const o = { dx: sgn(tx - p.x, 2), dy: sgn(ty - p.y, 2) };
    if (owner && owner.team !== team) {
      const od = Math.hypot(owner.x - p.x, owner.y - p.y);
      if (od < 22) {
        o.dx = sgn(b.x - p.x, 1.5);
        o.dy = sgn(b.y - p.y, 1.5);
        if (od < 12 && p.tackleCool <= 0 && Math.random() < L.tackle) o.pass = true;
      }
    }
    return o;
  }

  function blocker(p, ux, uy) {
    return m.players.find((q) => {
      if (q.team === p.team) return false;
      const qx = q.x - p.x;
      const qy = q.y - p.y;
      const along = qx * ux + qy * uy;
      return along > 0 && along < 20 && Math.abs(qx * uy - qy * ux) < 8;
    });
  }

  function support(p, slot, dir) {
    const b = m.ball;
    const hx = CX + dir * slot.x * 0.8 + (b.x - CX) * 0.55;
    const hy = CY + slot.y * 0.9 + (b.y - CY) * 0.3;
    const tx = Math.max(FIELD.left + 8, Math.min(FIELD.right - 8, hx));
    const ty = Math.max(FIELD.top + 6, Math.min(FIELD.bottom - 6, hy));
    return { dx: sgn(tx - p.x, 5), dy: sgn(ty - p.y, 5) };
  }

  return { tick };
}

function sgn(v, dead = 0) {
  return v > dead ? 1 : v < -dead ? -1 : 0;
}
