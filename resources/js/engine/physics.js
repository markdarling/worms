// Worm/terrain physics + deterministic math helpers.
//
// Determinism note: JS guarantees bit-exact IEEE-754 results for + - * / and
// Math.sqrt, but NOT for Math.sin/cos (implementation-defined). All trig that
// feeds simulation state goes through dsin/dcos below (pure arithmetic).

import { C } from './constants.js';

const PI = Math.PI;
const TAU = PI * 2;

// Deterministic sine: range-reduce to [-pi/2, pi/2], odd Taylor to x^9
// (max err ~4e-6 — far below anything gameplay-visible, and identical everywhere).
export function dsin(a) {
  a = a % TAU;
  if (a > PI) a -= TAU;
  else if (a < -PI) a += TAU;
  if (a > PI / 2) a = PI - a;
  else if (a < -PI / 2) a = -PI - a;
  const x2 = a * a;
  return a * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 / 362880))));
}

export function dcos(a) {
  return dsin(a + PI / 2);
}

// Worm body sample points (circle r = WORM_RADIUS, feet at +5).
const BODY_PTS = [
  [0, 0],
  [0, 5], [3, 4], [-3, 4],   // feet
  [5, 0], [-5, 0],           // sides
  [0, -5], [3, -4], [-3, -4], // head
];

export function bodyCollides(terrain, x, y) {
  for (let i = 0; i < BODY_PTS.length; i++) {
    if (terrain.solid(x + BODY_PTS[i][0], y + BODY_PTS[i][1])) return true;
  }
  return false;
}

export function grounded(terrain, worm) {
  return bodyCollides(terrain, worm.x, worm.y + 1);
}

// One tick of walking. Accumulates sub-pixel motion; resolves in 1px steps with
// auto-step-up (STEP_UP) and ground snap (SNAP_DOWN). Walking past a drop taller
// than SNAP_DOWN tips the worm into a natural fall.
export function walk(terrain, worm, dir) {
  worm.walkAccum += C.WALK_SPEED * C.DT;
  while (worm.walkAccum >= 1) {
    worm.walkAccum -= 1;
    if (!walkPixel(terrain, worm, dir)) { worm.walkAccum = 0; break; } // wall
    if (worm.airborne) { worm.walkAccum = 0; break; } // walked off an edge
  }
}

function walkPixel(terrain, worm, dir) {
  const nx = worm.x + dir;
  for (let rise = 0; rise <= C.STEP_UP; rise++) {
    if (!bodyCollides(terrain, nx, worm.y - rise)) {
      worm.x = nx;
      worm.y -= rise;
      let drop = 0;
      while (drop < C.SNAP_DOWN && !bodyCollides(terrain, worm.x, worm.y + 1)) {
        worm.y += 1;
        drop++;
      }
      if (!bodyCollides(terrain, worm.x, worm.y + 1)) {
        worm.airborne = true;
        worm.vx = dir * C.WALK_SPEED;
        worm.vy = 0;
      }
      return true;
    }
  }
  return false; // blocked by a wall taller than STEP_UP
}

// One tick of ballistic worm motion (jumps, knockback). Sub-steps at <=1px so
// fast knocks can't tunnel. Returns {landed, impact} — impact = |v| at contact,
// used for fall damage.
export function wormAirStep(terrain, worm) {
  worm.vy += C.GRAVITY * C.DT;
  const dx = worm.vx * C.DT;
  const dy = worm.vy * C.DT;
  const impact = Math.sqrt(worm.vx * worm.vx + worm.vy * worm.vy);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  const sx = dx / steps;
  const sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    if (worm.vx !== 0) {
      if (!bodyCollides(terrain, worm.x + sx, worm.y)) worm.x += sx;
      else worm.vx = 0; // wall: slide
    }
    if (!bodyCollides(terrain, worm.x, worm.y + sy)) {
      worm.y += sy;
    } else if (sy > 0) {
      worm.airborne = false;
      worm.vx = 0;
      worm.vy = 0;
      worm.walkAccum = 0;
      return { landed: true, impact };
    } else {
      worm.vy = 0; // bonked ceiling
    }
  }
  return { landed: false, impact: 0 };
}

// Estimate terrain surface normal at a contact point by summing vectors away
// from nearby solid pixels. Good enough for chunky grenade bounces.
export function surfaceNormal(terrain, x, y) {
  let nx = 0, ny = 0;
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      if (dx * dx + dy * dy > 18) continue;
      if (terrain.solid(x + dx, y + dy)) { nx -= dx; ny -= dy; }
    }
  }
  const l = Math.sqrt(nx * nx + ny * ny);
  if (l < 0.001) return { x: 0, y: -1 };
  return { x: nx / l, y: ny / l };
}

// Circular explosion: carve terrain, radial damage + knockback with falloff.
// Hits every worm in range including the firer (self-damage is sacred).
// spec: {dmg, radius, knock}. ownerId only flavours the 'laugh' taunt.
export function applyExplosion(sim, cx, cy, spec, ownerId = -1) {
  sim.terrain.destroy(cx, cy, spec.radius);
  sim.events.push({
    type: 'explosion', x: cx, y: cy, r: spec.radius,
    strength: Math.min(1, spec.dmg / 75),
  });
  let laughed = false;
  for (let i = 0; i < sim.worms.length; i++) {
    const worm = sim.worms[i];
    if (!worm.alive) continue;
    const dx = worm.x - cx;
    const dy = worm.y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    const dmgR = spec.radius + C.WORM_RADIUS;
    if (d < dmgR) {
      // 1.25x plateau => near-centre hits deal full listed damage
      const amount = Math.round(spec.dmg * Math.min(1, 1.25 * (1 - d / dmgR)));
      if (amount > 0) {
        sim._damageWorm(worm, amount, worm.x, worm.y);
        if (!laughed && ownerId >= 0) {
          const owner = sim._wormById(ownerId);
          if (owner && owner.alive && owner.teamIndex !== worm.teamIndex) {
            sim.events.push({ type: 'wormTalk', wormId: ownerId, kind: 'laugh' });
            laughed = true;
          }
        }
      }
    }
    const knockR = spec.radius * C.KNOCK_RADIUS_MULT;
    if (d < knockR && spec.knock > 0) {
      const kf = 1 - d / knockR;
      const sp = spec.knock * kf;
      const ux = d > 0.001 ? dx / d : 0;
      const uy = d > 0.001 ? dy / d : -1;
      worm.vx += ux * sp;
      worm.vy += uy * sp * 0.7 - sp * 0.5; // upward bias: chunky launches
      if (!worm.airborne) { worm.airborne = true; worm.y -= 1; }
    }
  }
  // Crates caught in the blast are destroyed.
  for (let i = 0; i < sim.crates.length; i++) {
    const c = sim.crates[i];
    const dx = c.x - cx, dy = c.y - cy;
    if (dx * dx + dy * dy < spec.radius * spec.radius) c.dead = true;
  }
  sim.crates = sim.crates.filter((c) => !c.dead);

  const knockR2 = spec.radius * C.KNOCK_RADIUS_MULT;

  // Mines are hurled further than worms by blasts (classic chain-reactions).
  if (sim.mines) {
    for (let i = 0; i < sim.mines.length; i++) {
      const m = sim.mines[i];
      if (m.dead) continue;
      const dx = m.x - cx, dy = m.y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < knockR2 && spec.knock > 0) {
        const kf = (1 - d / knockR2) * 1.3;
        const sp = spec.knock * kf;
        const ux = d > 0.001 ? dx / d : 0;
        const uy = d > 0.001 ? dy / d : -1;
        m.vx += ux * sp;
        m.vy += uy * sp * 0.7 - sp * 0.5;
        m.resting = false;
        m.calm = 0;
      }
    }
  }

  // Oil drums caught in (or near) the blast cook off — they detonate on
  // their own next step, so chains unfold over ticks instead of recursing.
  if (sim.drums) {
    for (let i = 0; i < sim.drums.length; i++) {
      const dr = sim.drums[i];
      if (dr.dead || dr.hit) continue;
      const dx = dr.x - cx, dy = dr.y - cy;
      const trig = spec.radius + C.DRUM.triggerPad;
      if (dx * dx + dy * dy < trig * trig) dr.hit = true;
    }
  }

  // Flames get hurled around and re-energised by nearby blasts.
  if (sim.flames) {
    for (let i = 0; i < sim.flames.length; i++) {
      const f = sim.flames[i];
      if (f.dead) continue;
      const dx = f.x - cx, dy = f.y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < knockR2 && spec.knock > 0) {
        const kf = 1 - d / knockR2;
        const sp = spec.knock * kf * 0.8;
        const ux = d > 0.001 ? dx / d : 0;
        const uy = d > 0.001 ? dy / d : -1;
        f.vx += ux * sp;
        f.vy += uy * sp - sp * 0.3;
        f.resting = false;
        if (f.turnsLeft < 2) f.turnsLeft = 2; // partial lifetime reset
      }
    }
  }

  // Walkers: sheep caught in a blast go up too (chain); donkeys are immovable.
  if (sim.walkers) {
    for (let i = 0; i < sim.walkers.length; i++) {
      const wk = sim.walkers[i];
      if (wk.dead || wk.kind !== 'sheep') continue;
      const dx = wk.x - cx, dy = wk.y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < spec.radius + 6) wk.explodeNext = true;
      else if (d < knockR2 && spec.knock > 0) {
        const kf = 1 - d / knockR2;
        const sp = spec.knock * kf;
        wk.vx += (d > 0.001 ? dx / d : 0) * sp;
        wk.vy += (d > 0.001 ? dy / d : -1) * sp * 0.7 - sp * 0.5;
        if (!wk.airborne) { wk.airborne = true; wk.y -= 1; }
      }
    }
  }
}

// Scan terrain for standable spawn spots: top of each solid run per sampled
// column, with body clearance + headroom, above water. Deterministic order
// (left to right, top to bottom). `step` is the column stride: 12 for the
// legacy spawn scan, 8 for placement.js's reachability graph (MAPGEN.md 3.1).
export function findSpawnSpots(terrain, waterLevel, step = 12) {
  const spots = [];
  for (let x = 16; x < terrain.width - 16; x += step) {
    let y = 12;
    while (y < waterLevel - 8) {
      if (terrain.solid(x, y)) {
        const py = y - C.WORM_RADIUS - 1;
        if (
          py > 16 &&
          !bodyCollides(terrain, x, py) &&
          bodyCollides(terrain, x, py + 1) &&
          !terrain.solid(x, py - 10) &&
          !terrain.solid(x, py - 14)
        ) {
          spots.push({ x, y: py });
        }
        while (y < waterLevel - 8 && terrain.solid(x, y)) y++;
      } else {
        y++;
      }
    }
  }
  return spots;
}
