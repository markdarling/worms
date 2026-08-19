// Weapon firing logic. fire() returns how the turn proceeds:
//   'retreat' — weapon used, retreat window opens
//   'again'   — multi-shot weapon (shotgun/longbow): one more shot owed
//   'end'     — turn-ending weapon (teleport, skip, kamikaze, set-pieces)
//   'utility' — used but the turn CONTINUES (parachute, selectworm)
//   'invalid' — nothing happened (bad target / no ammo); no state consumed
//
// This module also owns the tick-systems for weapons that act over time on the
// active worm: hitscan bursts (handgun/uzi/minigun), the flamethrower stream,
// blowtorch/drill carving, the kamikaze flight and the earthquake. sim.js
// calls stepBurst/stepFlamer/stepCarve/stepKami/stepQuake each tick in that
// fixed order (rng consumption order is part of the protocol).

import { C } from './constants.js';
import { dsin, dcos, bodyCollides, grounded, applyExplosion } from './physics.js';
import { Projectile, paintStamp } from './projectiles.js';
import { Mine, Sheep, Donkey, mineDudRoll } from './walkers.js';
import { spawnFlames } from './fire.js';

export const WEAPON_IDS = [
  'bazooka', 'grenade', 'cluster', 'shotgun', 'firepunch',
  'dynamite', 'airstrike', 'teleport', 'skip',
  'homing', 'mortar', 'banana', 'holygrenade', 'axe', 'prod', 'baseballbat',
  'dragonball', 'handgun', 'uzi', 'minigun', 'longbow', 'petrol', 'napalm',
  'flamethrower', 'mine', 'minestrike', 'carpetbomb', 'sheep', 'kamikaze',
  'blowtorch', 'drill', 'girder', 'parachute', 'earthquake', 'donkey',
  'armageddon', 'selectworm',
];

const PI = Math.PI;

export function needsCharge(id) {
  return !!C.WEAPONS[id] && !!C.WEAPONS[id].charged;
}

export function hasAmmo(sim, teamIndex, id) {
  const a = sim.ammo[teamIndex];
  return a[id] === undefined ? true : a[id] > 0;
}

function consume(sim, teamIndex, id) {
  if (sim.ammo[teamIndex][id] !== undefined) sim.ammo[teamIndex][id]--;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Targets can be clicked any tick during the move phase (sim.pendingTarget)
// or arrive with the fire tick itself.
function getTarget(sim, input) {
  return input.target || sim.pendingTarget;
}

// All living worms (id order) inside a facing-forward box, excluding self.
function wormsInBox(sim, worm, reach, rangeX, rangeY) {
  const out = [];
  for (let i = 0; i < sim.worms.length; i++) {
    const o = sim.worms[i];
    if (!o.alive || o === worm) continue;
    const dx = o.x - (worm.x + worm.facing * reach);
    const dy = o.y - worm.y;
    if (Math.abs(dx) <= rangeX && Math.abs(dy) <= rangeY) out.push(o);
  }
  return out;
}

// One instant bullet: walks the ray, bites terrain or hits the first worm.
export function hitscanRay(sim, worm, dirx, diry, spec) {
  for (let t = 8; t <= spec.range; t += 2) {
    const px = worm.x + dirx * t;
    const py = worm.y + diry * t;
    if (py > sim.waterLevel) {
      sim.events.push({ type: 'splash', x: px, y: sim.waterLevel });
      return;
    }
    if (px < 0 || px > sim.config.width) return;
    for (let i = 0; i < sim.worms.length; i++) {
      const o = sim.worms[i];
      if (!o.alive || o === worm) continue;
      const dx = o.x - px;
      const dy = o.y - py;
      const hr = C.WORM_RADIUS + 2;
      if (dx * dx + dy * dy < hr * hr) {
        sim.terrain.destroy(px, py, spec.craterR);
        sim.events.push({ type: 'explosion', x: px, y: py, r: spec.craterR, strength: 0.2 });
        sim._damageWorm(o, spec.dmg, o.x, o.y);
        o.vx += dirx * spec.knock;
        o.vy += diry * spec.knock - 20;
        if (!o.airborne) { o.airborne = true; o.y -= 1; }
        return;
      }
    }
    if (sim.terrain.solid(px, py)) {
      sim.terrain.destroy(px, py, spec.craterR);
      sim.events.push({ type: 'explosion', x: px, y: py, r: spec.craterR, strength: 0.2 });
      return;
    }
  }
}

// Shared strike template (airstrike, napalm, mine strike, carpet bomb):
// plane at world-top releases `count` payloads at fixed spacing whose windless
// arc lands the salvo on target.x. cb(x0, y0, vx0, vy0, i) spawns one payload.
function strikeDrop(sim, worm, t, spec, cb) {
  const dirS = worm.facing >= 0 ? 1 : -1; // left/right key picks approach side
  const vx0 = dirS * spec.mvx;
  const vy0 = spec.mvy;
  const y0 = -40;
  const drop = Math.max(50, t.y - y0);
  const tt = (-vy0 + Math.sqrt(vy0 * vy0 + 2 * C.GRAVITY * drop)) / C.GRAVITY;
  for (let i = 0; i < spec.count; i++) {
    const ox = (i - (spec.count - 1) / 2) * spec.spacing;
    cb(t.x + ox - vx0 * tt, y0 - i * 6, vx0, vy0, i);
  }
}

export function fire(sim, worm, id, power, input) {
  const spec = C.WEAPONS[id];
  if (!spec || !hasAmmo(sim, worm.teamIndex, id)) return 'invalid';

  const dirx = dcos(worm.aimAngle) * worm.facing;
  const diry = -dsin(worm.aimAngle);
  const mx = worm.x + dirx * (C.WORM_RADIUS + 5);
  const my = worm.y + diry * (C.WORM_RADIUS + 5) - 2;
  // Cosmetic only (event payload) — never feeds sim state, so Math.atan2 is fine.
  const angle = Math.atan2(diry, dirx);
  const fireEvent = () => sim.events.push({ type: 'fire', weapon: id, x: mx, y: my, angle, power });

  switch (id) {
    case 'skip':
      return 'end';

    case 'teleport': {
      const t = getTarget(sim, input);
      if (!t) return 'invalid';
      if (t.x < 8 || t.x > sim.config.width - 8 || t.y < 8 || t.y >= sim.config.height) return 'invalid';
      if (bodyCollides(sim.terrain, t.x, t.y)) return 'invalid';
      consume(sim, worm.teamIndex, id);
      sim.events.push({ type: 'fire', weapon: id, x: t.x, y: t.y, angle: 0, power: 0 });
      worm.x = t.x;
      worm.y = t.y;
      worm.vx = 0;
      worm.vy = 0;
      worm.walkAccum = 0;
      worm.airborne = !grounded(sim.terrain, worm); // may drop (or drown) during resolving
      return 'end';
    }

    // ------------------------------------------------------------ hitscan
    case 'shotgun': {
      fireEvent();
      hitscanRay(sim, worm, dirx, diry, C.WEAPONS.shotgun);
      return sim.pendingShots > 0 ? 'retreat' : 'again';
    }

    case 'handgun':
    case 'uzi':
    case 'minigun': {
      consume(sim, worm.teamIndex, id);
      // Bullets fire on a cadence via stepBurst (one 'fire' event per bullet);
      // aim stays LIVE between shots.
      sim.burst = { weapon: id, left: spec.burst, tick: 0 };
      return 'retreat';
    }

    case 'longbow': {
      if (sim.pendingShots === 0) consume(sim, worm.teamIndex, id); // 1 ammo = 2 arrows
      const a = clamp(worm.aimAngle, -spec.aimClamp, spec.aimClamp);
      const ax = dcos(a) * worm.facing;
      const ay = -dsin(a);
      fireEvent();
      sim.projectiles.push(new Projectile('arrow',
        worm.x + ax * (C.WORM_RADIUS + 4), worm.y + ay * (C.WORM_RADIUS + 4) - 2,
        ax * spec.speed, ay * spec.speed, { owner: worm.id }));
      return sim.pendingShots > 0 ? 'retreat' : 'again';
    }

    // -------------------------------------------------------------- melee
    case 'firepunch': {
      sim.events.push({ type: 'fire', weapon: id, x: worm.x, y: worm.y, angle, power: 0 });
      sim.terrain.destroy(worm.x + worm.facing * 8, worm.y - 2, spec.notchR);
      const hits = wormsInBox(sim, worm, spec.reach, spec.rangeX, spec.rangeY);
      for (let i = 0; i < hits.length; i++) {
        const o = hits[i];
        sim._damageWorm(o, spec.dmg, o.x, o.y);
        o.vx += worm.facing * spec.knockVx;
        o.vy += spec.knockVy; // the uppercut
        if (!o.airborne) { o.airborne = true; o.y -= 1; }
      }
      return 'retreat';
    }

    case 'axe': {
      consume(sim, worm.teamIndex, id);
      sim.events.push({ type: 'fire', weapon: id, x: worm.x, y: worm.y, angle, power: 0 });
      // 50% of CURRENT hp, min 1. NO knockback, no crater — bypasses the whole
      // damage-reaction fling; hits everything in the arc, through thin terrain.
      const hits = wormsInBox(sim, worm, spec.reach, spec.rangeX, spec.rangeY);
      for (let i = 0; i < hits.length; i++) {
        const o = hits[i];
        sim._damageWorm(o, Math.max(1, Math.floor(o.hp / 2)), o.x, o.y);
      }
      return 'retreat';
    }

    case 'prod': {
      sim.events.push({ type: 'fire', weapon: id, x: worm.x, y: worm.y, angle, power: 0 });
      // A feather-push. Deals no damage — pure humiliation physics.
      const hits = wormsInBox(sim, worm, spec.reach, spec.rangeX, spec.rangeY);
      for (let i = 0; i < hits.length; i++) {
        const o = hits[i];
        o.vx += worm.facing * spec.knockVx;
        o.vy += spec.knockVy;
        if (!o.airborne) { o.airborne = true; o.y -= 1; }
      }
      return 'retreat';
    }

    case 'baseballbat': {
      consume(sim, worm.teamIndex, id);
      sim.events.push({ type: 'fire', weapon: id, x: worm.x, y: worm.y, angle, power: 0 });
      // Knock angle aimable 0..75 degrees up; 45 for max distance.
      const a = clamp(worm.aimAngle, 0, spec.aimMaxDeg * PI / 180);
      const kx = dcos(a) * worm.facing * spec.knock;
      const ky = -dsin(a) * spec.knock;
      const hits = wormsInBox(sim, worm, spec.reach, spec.rangeX, spec.rangeY);
      for (let i = 0; i < hits.length; i++) {
        const o = hits[i];
        sim._damageWorm(o, spec.dmg, o.x, o.y);
        o.vx += kx;
        o.vy += ky - 30;
        if (!o.airborne) { o.airborne = true; o.y -= 1; }
      }
      return 'retreat';
    }

    case 'dragonball': {
      sim.events.push({ type: 'fire', weapon: id, x: worm.x, y: worm.y, angle, power: 0 });
      // Horizontal short-range energy ball; FIRST worm only, flat fling.
      const hits = wormsInBox(sim, worm, spec.reach, spec.rangeX, spec.rangeY);
      if (hits.length > 0) {
        const o = hits[0];
        sim._damageWorm(o, spec.dmg, o.x, o.y);
        o.vx += worm.facing * spec.knockVx;
        o.vy += spec.knockVy;
        if (!o.airborne) { o.airborne = true; o.y -= 1; }
      }
      return 'retreat';
    }

    case 'kamikaze': {
      consume(sim, worm.teamIndex, id);
      sim.events.push({ type: 'fire', weapon: id, x: worm.x, y: worm.y, angle, power: 0 });
      // 8-direction: aim quantised to 45-degree steps, facing picks the side.
      const q = clamp(Math.round(worm.aimAngle / (PI / 4)), -2, 2);
      let kx, ky;
      if (q === 2) { kx = 0; ky = -1; }
      else if (q === -2) { kx = 0; ky = 1; }
      else { kx = dcos(q * PI / 4) * worm.facing; ky = -dsin(q * PI / 4); }
      sim.kami = { dirx: kx, diry: ky, ticksLeft: spec.ticks, hit: [] };
      return 'end'; // the worm is already dead — it just doesn't know it yet
    }

    // -------------------------------------------------------- projectiles
    case 'bazooka':
    case 'homing': {
      const t = id === 'homing' ? getTarget(sim, input) : null;
      if (id === 'homing' && !t) return 'invalid';
      consume(sim, worm.teamIndex, id);
      const sp = spec.speedMin + power * (spec.speedMax - spec.speedMin);
      fireEvent();
      sim.projectiles.push(new Projectile(id, mx, my, dirx * sp, diry * sp, {
        owner: worm.id, tx: t ? t.x : 0, ty: t ? t.y : 0,
      }));
      return 'retreat';
    }

    case 'mortar': {
      consume(sim, worm.teamIndex, id);
      // Fixed launch speed, aim only; steepest aim isn't quite vertical.
      const a = clamp(worm.aimAngle, -spec.aimClamp, spec.aimClamp);
      const ax = dcos(a) * worm.facing;
      const ay = -dsin(a);
      fireEvent();
      sim.projectiles.push(new Projectile('mortar',
        worm.x + ax * (C.WORM_RADIUS + 5), worm.y + ay * (C.WORM_RADIUS + 5) - 2,
        ax * spec.fixedSpeed, ay * spec.fixedSpeed, { owner: worm.id }));
      return 'retreat';
    }

    case 'grenade':
    case 'cluster':
    case 'banana': {
      consume(sim, worm.teamIndex, id);
      const sp = spec.speedMin + power * (spec.speedMax - spec.speedMin);
      fireEvent();
      sim.projectiles.push(new Projectile(id, mx, my, dirx * sp, diry * sp, {
        fuse: Math.min(sim.grenadeFuse, 5) * C.TICK_HZ, owner: worm.id,
      }));
      return 'retreat';
    }

    case 'holygrenade':
    case 'petrol': {
      consume(sim, worm.teamIndex, id);
      const sp = spec.speedMin + power * (spec.speedMax - spec.speedMin);
      fireEvent();
      sim.projectiles.push(new Projectile(id, mx, my, dirx * sp, diry * sp, {
        owner: worm.id, // holy: fixed fuse handled internally; petrol: impact
      }));
      return 'retreat';
    }

    case 'dynamite': {
      consume(sim, worm.teamIndex, id);
      sim.events.push({ type: 'fire', weapon: id, x: worm.x, y: worm.y, angle: 0, power: 0 });
      sim.projectiles.push(new Projectile('dynamite', worm.x, worm.y - 2, 0, 0, {
        fuse: spec.fuseTicks, owner: worm.id,
      }));
      return 'retreat'; // now RUN
    }

    // ------------------------------------------------------------ strikes
    case 'airstrike': {
      const t = getTarget(sim, input);
      if (!t) return 'invalid';
      consume(sim, worm.teamIndex, id);
      sim.events.push({ type: 'fire', weapon: id, x: t.x, y: t.y, angle: 0, power: 0 });
      strikeDrop(sim, worm, t, spec, (x, y, vx, vy) => {
        sim.projectiles.push(new Projectile('missile', x, y, vx, vy, { owner: worm.id }));
      });
      return 'retreat';
    }

    case 'napalm': {
      const t = getTarget(sim, input);
      if (!t) return 'invalid';
      consume(sim, worm.teamIndex, id);
      sim.events.push({ type: 'fire', weapon: id, x: t.x, y: t.y, angle: 0, power: 0 });
      strikeDrop(sim, worm, t, spec, (x, y, vx, vy) => {
        sim.projectiles.push(new Projectile('napalmmissile', x, y, vx, vy, { owner: worm.id }));
      });
      return 'retreat';
    }

    case 'minestrike': {
      const t = getTarget(sim, input);
      if (!t) return 'invalid';
      consume(sim, worm.teamIndex, id);
      sim.events.push({ type: 'fire', weapon: id, x: t.x, y: t.y, angle: 0, power: 0 });
      strikeDrop(sim, worm, t, spec, (x, y, vx, vy) => {
        const dud = mineDudRoll(sim.config.seed, sim.mineCounter++);
        const m = new Mine(sim.entitySeq++, x, y, {
          vx, vy, owner: worm.id, dud, armTicks: 180, // arms after the fall
        });
        m.resting = false;
        sim.mines.push(m);
      });
      return 'retreat';
    }

    case 'carpetbomb': {
      const t = getTarget(sim, input);
      if (!t) return 'invalid';
      consume(sim, worm.teamIndex, id);
      sim.events.push({ type: 'fire', weapon: id, x: t.x, y: t.y, angle: 0, power: 0 });
      strikeDrop(sim, worm, t, spec, (x, y, vx, vy) => {
        sim.projectiles.push(new Projectile('carpet', x, y, vx, vy, {
          owner: worm.id, life: spec.bounces,
        }));
      });
      return 'retreat';
    }

    // ------------------------------------------------------- placed / area
    case 'mine': {
      consume(sim, worm.teamIndex, id);
      sim.events.push({ type: 'fire', weapon: id, x: worm.x, y: worm.y, angle: 0, power: 0 });
      const dud = mineDudRoll(sim.config.seed, sim.mineCounter++);
      sim.mines.push(new Mine(sim.entitySeq++, worm.x + worm.facing * 2, worm.y, {
        owner: worm.id, dud,
      }));
      // Classic guarantee: minimum 5s retreat with a full reserve.
      sim.retreatStamina = sim.config.retreatStamina;
      return 'retreat';
    }

    case 'sheep': {
      consume(sim, worm.teamIndex, id);
      sim.events.push({ type: 'fire', weapon: id, x: worm.x, y: worm.y, angle: 0, power: 0 });
      sim.walkers.push(new Sheep(sim.entitySeq++,
        worm.x + worm.facing * 10, worm.y - 2, worm.facing, worm.id, worm.teamIndex));
      sim.events.push({ type: 'sheepBaa', x: worm.x, y: worm.y });
      return 'retreat'; // second fire press detonates (handled in _handleRetreat)
    }

    case 'flamethrower': {
      consume(sim, worm.teamIndex, id);
      fireEvent();
      sim.flamer = { left: spec.flames, tick: 0 };
      return 'retreat';
    }

    case 'blowtorch': {
      consume(sim, worm.teamIndex, id);
      // Three angles per facing: +22.5, 0, -22.5 from the current aim.
      const q = clamp(Math.round(worm.aimAngle / (PI / 8)), -1, 1);
      const a = q * PI / 8;
      sim.events.push({ type: 'fire', weapon: id, x: worm.x, y: worm.y, angle, power: 0 });
      sim.carve = {
        kind: 'torch',
        dirx: dcos(a) * worm.facing, diry: -dsin(a),
        ticksLeft: spec.maxTicks, tick: 0,
        ledger: sim.worms.map(() => [0, 0]), // [hitIndex, totalDealt] per worm id
      };
      return 'retreat';
    }

    case 'drill': {
      consume(sim, worm.teamIndex, id);
      sim.events.push({ type: 'fire', weapon: id, x: worm.x, y: worm.y, angle: 0, power: 0 });
      // Depth is seeded-random, Gaussian. Irwin-Hall (sum of 12 uniforms - 6)
      // approximates a standard normal with pure +- arithmetic — bit-exact on
      // every JS engine (Math.log/exp are implementation-approximated, so
      // Box-Muller would not be).
      let g = -6;
      for (let i = 0; i < 12; i++) g += sim._rng();
      const depth = clamp(Math.round(spec.depthMean + g * spec.depthSigma),
        spec.depthMin, spec.depthMax);
      sim.carve = {
        kind: 'drill',
        dirx: 0, diry: 1,
        ticksLeft: Math.round(depth / (spec.speed * C.DT)), tick: 0,
        ledger: sim.worms.map(() => [0, 0]),
      };
      return 'retreat';
    }

    case 'girder': {
      const t = getTarget(sim, input);
      if (!t) return 'invalid';
      const gdx = t.x - worm.x;
      const gdy = t.y - worm.y;
      if (gdx * gdx + gdy * gdy > spec.range * spec.range) return 'invalid';
      // 8 angles in 22.5-degree steps, selected via input.fuse 1..8.
      const ga = ((sim.grenadeFuse - 1) * PI) / 8;
      const ux = dcos(ga);
      const uy = -dsin(ga);
      // Placement validation: sample along the beam; refuse if it would overlap
      // a worm/mine/crate/walker or land in mostly-solid rock (beep, no cost).
      let solidHits = 0;
      let samples = 0;
      for (let s = -spec.len / 2; s <= spec.len / 2; s += 4) {
        const px = t.x + ux * s;
        const py = t.y + uy * s;
        samples++;
        if (sim.terrain.solid(px, py)) solidHits++;
        for (let i = 0; i < sim.worms.length; i++) {
          const o = sim.worms[i];
          if (o.alive && Math.abs(o.x - px) < 10 && Math.abs(o.y - py) < 10) return 'invalid';
        }
        for (let i = 0; i < sim.mines.length; i++) {
          const m = sim.mines[i];
          if (!m.dead && Math.abs(m.x - px) < 8 && Math.abs(m.y - py) < 8) return 'invalid';
        }
        for (let i = 0; i < sim.crates.length; i++) {
          const c = sim.crates[i];
          if (!c.dead && Math.abs(c.x - px) < 10 && Math.abs(c.y - py) < 10) return 'invalid';
        }
        for (let i = 0; i < sim.walkers.length; i++) {
          const wk = sim.walkers[i];
          if (!wk.dead && Math.abs(wk.x - px) < 10 && Math.abs(wk.y - py) < 10) return 'invalid';
        }
      }
      if (solidHits * 2 > samples) return 'invalid';
      consume(sim, worm.teamIndex, id);
      // WA truth: a placed girder is ORDINARY destructible terrain — the
      // "indestructible steel" is a myth. Steel look is presentation's job.
      paintStamp(sim.terrain, t.x, t.y, ux, uy, spec.len, spec.thick);
      sim.events.push({ type: 'girderPlaced', x: t.x, y: t.y, angle: ga });
      return 'retreat';
    }

    // -------------------------------------------------------- set-pieces
    case 'earthquake': {
      consume(sim, worm.teamIndex, id);
      sim.events.push({ type: 'fire', weapon: id, x: worm.x, y: worm.y, angle: 0, power: 0 });
      sim.events.push({ type: 'earthquake' });
      sim.quakeTicks = spec.ticks;
      return 'end';
    }

    case 'donkey': {
      const t = getTarget(sim, input);
      if (!t) return 'invalid';
      consume(sim, worm.teamIndex, id);
      sim.events.push({ type: 'fire', weapon: id, x: t.x, y: 0, angle: 0, power: 0 });
      sim.walkers.push(new Donkey(sim.entitySeq++, t.x, worm.id));
      return 'retreat';
    }

    case 'armageddon': {
      consume(sim, worm.teamIndex, id);
      sim.events.push({ type: 'fire', weapon: id, x: worm.x, y: 0, angle: 0, power: 0 });
      // Seeded meteor schedule: count, then per meteor x/delay/size/velocity.
      const n = spec.minMeteors + Math.floor(sim._rng() * (spec.maxMeteors - spec.minMeteors + 1));
      for (let i = 0; i < n; i++) {
        const x = Math.round(sim._rng() * sim.config.width);
        const delay = 1 + Math.floor(sim._rng() * spec.spreadTicks);
        const dmg = Math.round(spec.dmgMin + sim._rng() * (spec.dmgMax - spec.dmgMin));
        const radius = Math.round(spec.radiusMin +
          ((dmg - spec.dmgMin) / (spec.dmgMax - spec.dmgMin)) * (spec.radiusMax - spec.radiusMin));
        const vx = (sim._rng() * 2 - 1) * spec.vxSpread;
        sim.projectiles.push(new Projectile('meteor', x, -50, vx, spec.vy, {
          owner: worm.id, delay, dmg, radius, knock: Math.round(dmg * 4),
        }));
      }
      return 'end';
    }

    // ---------------------------------------------------------- utilities
    case 'parachute': {
      if (sim.chuteOpen) { sim.chuteOpen = false; return 'utility'; } // Space closes it
      if (!worm.airborne) return 'invalid';
      consume(sim, worm.teamIndex, id);
      sim.chuteOpen = true;
      sim.events.push({ type: 'fire', weapon: id, x: worm.x, y: worm.y, angle: 0, power: 0 });
      return 'utility'; // turn CONTINUES — it's an aerial state
    }

    case 'selectworm': {
      const t = getTarget(sim, input);
      if (!t) return 'invalid';
      let pick = null;
      for (let i = 0; i < sim.worms.length; i++) {
        const o = sim.worms[i];
        if (!o.alive || o.teamIndex !== worm.teamIndex || o.id === worm.id) continue;
        const dx = o.x - t.x;
        const dy = o.y - t.y;
        if (dx * dx + dy * dy < spec.pickRadius * spec.pickRadius) { pick = o; break; }
      }
      if (!pick) return 'invalid';
      consume(sim, worm.teamIndex, id);
      sim.activeWormId = pick.id;
      sim.events.push({ type: 'fire', weapon: id, x: pick.x, y: pick.y, angle: 0, power: 0 });
      return 'utility'; // turn continues with the new worm, stamina intact
    }
  }
  return 'invalid';
}

// ---------------------------------------------------------------------------
// Tick-systems (called from sim._stepWorld in fixed order)
// ---------------------------------------------------------------------------

// Hitscan bursts: one bullet per cadence with a seeded jitter; the player can
// keep re-aiming between shots (aim input stays live during the burst).
export function stepBurst(sim) {
  const b = sim.burst;
  if (!b) return;
  const worm = sim._active();
  if (!worm || !worm.alive) { sim.burst = null; return; }
  const spec = C.WEAPONS[b.weapon];
  if (b.tick % spec.cadence === 0) {
    const j = (sim._rng() * 2 - 1) * spec.jitterDeg * PI / 180;
    const a = worm.aimAngle + j;
    const dirx = dcos(a) * worm.facing;
    const diry = -dsin(a);
    // Cosmetic angle for the muzzle flash.
    sim.events.push({
      type: 'fire', weapon: b.weapon,
      x: worm.x + dirx * (C.WORM_RADIUS + 4), y: worm.y + diry * (C.WORM_RADIUS + 4) - 2,
      angle: Math.atan2(diry, dirx), power: 0,
    });
    hitscanRay(sim, worm, dirx, diry, spec);
    b.left--;
  }
  b.tick++;
  if (b.left <= 0) sim.burst = null; // retreat clock resumes
}

// Flame thrower stream: flames launched from the muzzle over ~2s along the
// (live) aim. Self-hit cancels the attack via the damage-ends-turn rule.
export function stepFlamer(sim) {
  const fl = sim.flamer;
  if (!fl) return;
  const worm = sim._active();
  if (!worm || !worm.alive) { sim.flamer = null; return; }
  const spec = C.WEAPONS.flamethrower;
  if (fl.tick % spec.cadence === 0) {
    const j = (sim._rng() * 2 - 1) * spec.jitterDeg * PI / 180;
    const s = spec.speed * (0.9 + sim._rng() * 0.2);
    const a = worm.aimAngle + j;
    const dirx = dcos(a) * worm.facing;
    const diry = -dsin(a);
    spawnFlames(sim,
      worm.x + dirx * (C.WORM_RADIUS + 5), worm.y + diry * (C.WORM_RADIUS + 5) - 1,
      1, { vx: dirx * s, vy: diry * s, spread: 0, up: 0, carve: true, quiet: fl.tick > 0 });
    fl.left--;
  }
  fl.tick++;
  if (fl.left <= 0) sim.flamer = null;
}

// Blowtorch / pneumatic drill: the worm advances along the carve vector,
// chewing a worm-height channel. Damage follows the diminishing 15/7/5/3...
// series, capped at 45 per worm per turn (ledger shared by both tools).
export function stepCarve(sim) {
  const cv = sim.carve;
  if (!cv) return;
  const worm = sim._active();
  if (!worm || !worm.alive) { sim.carve = null; return; }
  const spec = C.WEAPONS[cv.kind === 'torch' ? 'blowtorch' : 'drill'];
  const step = spec.speed * C.DT;
  worm.x += cv.dirx * step;
  worm.y += cv.diry * step;
  sim.terrain.destroy(worm.x + cv.dirx * 5, worm.y + cv.diry * 5, spec.carveR);

  if (cv.tick % spec.hitEvery === 0) {
    const hx = worm.x + cv.dirx * 8;
    const hy = worm.y + cv.diry * 8;
    for (let i = 0; i < sim.worms.length; i++) {
      const o = sim.worms[i];
      if (!o.alive || o.id === worm.id) continue;
      const dx = o.x - hx;
      const dy = o.y - hy;
      if (dx * dx + dy * dy >= 12 * 12) continue;
      const led = cv.ledger[o.id];
      const next = C.CARVE_DMG_SERIES[Math.min(led[0], C.CARVE_DMG_SERIES.length - 1)];
      if (led[1] + next > C.CARVE_DMG_CAP) continue;
      led[0]++;
      led[1] += next;
      sim._damageWorm(o, next, o.x, o.y);
      if (cv.kind === 'torch') {
        o.vx += cv.dirx * C.WEAPONS.blowtorch.push;
        o.vy += cv.diry * 30 - 30;
      } else {
        // Drilled worms are knocked left/right RANDOMLY (turn rng!).
        o.vx += (sim._rng() < 0.5 ? -1 : 1) * 70;
        o.vy -= 40;
      }
      if (!o.airborne) { o.airborne = true; o.y -= 1; }
    }
  }

  cv.tick++;
  cv.ticksLeft--;
  let done = cv.ticksLeft <= 0;
  // Blowtorch ends early when it breaks into open air.
  if (!done && cv.kind === 'torch' && cv.tick > 30) {
    if (!sim.terrain.solid(worm.x + cv.dirx * 12, worm.y + cv.diry * 6) &&
        !sim.terrain.solid(worm.x + cv.dirx * 18, worm.y + cv.diry * 8)) {
      done = true;
    }
  }
  if (done) {
    sim.carve = null;
    // Drill quirk: the turn then ends with NO retreat.
    if (cv.kind === 'drill') sim.endRetreat = true;
  }
}

// Kamikaze flight: dead-straight carve, 30 damage + shunt to every worm in the
// path (once each), then a final blast — which IS the user's death (no normal
// damage->turn-end reaction; the turn already ended when the flight began).
export function stepKami(sim) {
  const k = sim.kami;
  if (!k) return;
  const worm = sim._active();
  if (!worm || !worm.alive) { sim.kami = null; return; }
  const spec = C.WEAPONS.kamikaze;
  const step = spec.speed * C.DT;
  worm.x += k.dirx * step;
  worm.y += k.diry * step;
  sim.terrain.destroy(worm.x, worm.y, spec.carveR);

  for (let i = 0; i < sim.worms.length; i++) {
    const o = sim.worms[i];
    if (!o.alive || o.id === worm.id) continue;
    if (k.hit.indexOf(o.id) >= 0) continue;
    const dx = o.x - worm.x;
    const dy = o.y - worm.y;
    if (dx * dx + dy * dy < 12 * 12) {
      k.hit.push(o.id);
      sim._damageWorm(o, spec.pathDmg, o.x, o.y);
      o.vx += k.dirx * spec.pathKnock;
      o.vy += k.diry * spec.pathKnock - 60;
      if (!o.airborne) { o.airborne = true; o.y -= 1; }
    }
  }

  k.ticksLeft--;
  const out = worm.x < 4 || worm.x > sim.config.width - 4 || worm.y < 4;
  if (k.ticksLeft <= 0 || out || worm.y > sim.waterLevel) {
    sim.kami = null;
    if (worm.y > sim.waterLevel) return; // sea kamikaze: the drown check takes it
    // The blast IS the death: kill first so applyExplosion can't double-dip.
    worm.alive = false;
    worm.hp = 0;
    applyExplosion(sim, worm.x, worm.y, spec, worm.id);
    sim.events.push({ type: 'wormDied', wormId: worm.id, x: worm.x, y: worm.y });
  }
}

// Earthquake: seeded impulses to every physics body every `every` ticks for
// ~4s. No direct damage — kills come from falls, mines and water. The only
// weapon that moves crates. Iteration order is fixed: worms (id order), mines,
// walkers, crates.
export function stepQuake(sim) {
  if (sim.quakeTicks <= 0) return;
  const spec = C.WEAPONS.earthquake;
  if (sim.quakeTicks % spec.every === 0) {
    for (let i = 0; i < sim.worms.length; i++) {
      const w = sim.worms[i];
      if (!w.alive) continue;
      w.vx += (sim._rng() * 2 - 1) * spec.impulse;
      w.vy -= sim._rng() * spec.lift + 20;
      if (!w.airborne) { w.airborne = true; w.y -= 1; }
    }
    for (let i = 0; i < sim.mines.length; i++) {
      const m = sim.mines[i];
      if (m.dead) continue;
      m.vx += (sim._rng() * 2 - 1) * spec.impulse;
      m.vy -= sim._rng() * spec.lift + 20;
      m.resting = false;
      m.calm = 0;
    }
    for (let i = 0; i < sim.walkers.length; i++) {
      const wk = sim.walkers[i];
      if (wk.dead || wk.kind !== 'sheep') continue;
      wk.vx += (sim._rng() * 2 - 1) * spec.impulse;
      wk.vy -= sim._rng() * spec.lift + 20;
      if (!wk.airborne) { wk.airborne = true; wk.y -= 1; }
    }
    for (let i = 0; i < sim.crates.length; i++) {
      const c = sim.crates[i];
      if (c.dead) continue;
      c.vx = (c.vx || 0) + (sim._rng() * 2 - 1) * spec.impulse;
      c.vy = -(sim._rng() * spec.lift + 10);
      c.falling = true;
    }
  }
  sim.quakeTicks--;
}
