// Weapon firing logic. fire() returns how the turn proceeds:
//   'retreat' — weapon used, retreat window opens
//   'again'   — shotgun first shot: stay able to fire once more
//   'end'     — turn-ending weapon (teleport, skip): straight to resolving
//   'invalid' — nothing happened (bad target / no ammo); no state consumed

import { C } from './constants.js';
import { dsin, dcos, bodyCollides, grounded } from './physics.js';
import { Projectile } from './projectiles.js';

export const WEAPON_IDS = [
  'bazooka', 'grenade', 'cluster', 'shotgun', 'firepunch',
  'dynamite', 'airstrike', 'teleport', 'skip',
];

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

export function fire(sim, worm, id, power, input) {
  const spec = C.WEAPONS[id];
  if (!spec || !hasAmmo(sim, worm.teamIndex, id)) return 'invalid';

  const dirx = dcos(worm.aimAngle) * worm.facing;
  const diry = -dsin(worm.aimAngle);
  const mx = worm.x + dirx * (C.WORM_RADIUS + 5);
  const my = worm.y + diry * (C.WORM_RADIUS + 5) - 2;
  // Cosmetic only (event payload) — never feeds sim state, so Math.atan2 is fine.
  const angle = Math.atan2(diry, dirx);

  switch (id) {
    case 'skip':
      return 'end';

    case 'teleport': {
      const t = input.target;
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

    case 'shotgun': {
      sim.events.push({ type: 'fire', weapon: id, x: mx, y: my, angle, power: 0 });
      shotgunBlast(sim, worm, dirx, diry);
      return sim.pendingShots > 0 ? 'retreat' : 'again';
    }

    case 'firepunch': {
      const fp = spec;
      sim.events.push({ type: 'fire', weapon: id, x: worm.x, y: worm.y, angle, power: 0 });
      sim.terrain.destroy(worm.x + worm.facing * 8, worm.y - 2, fp.notchR);
      for (let i = 0; i < sim.worms.length; i++) {
        const o = sim.worms[i];
        if (!o.alive || o === worm) continue;
        const dx = o.x - (worm.x + worm.facing * fp.reach);
        const dy = o.y - worm.y;
        if (Math.abs(dx) <= fp.rangeX && Math.abs(dy) <= fp.rangeY) {
          sim._damageWorm(o, fp.dmg, o.x, o.y);
          o.vx += worm.facing * fp.knockVx;
          o.vy += fp.knockVy; // the uppercut
          if (!o.airborne) { o.airborne = true; o.y -= 1; }
        }
      }
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

    case 'airstrike': {
      const t = input.target;
      if (!t) return 'invalid';
      consume(sim, worm.teamIndex, id);
      sim.events.push({ type: 'fire', weapon: id, x: t.x, y: t.y, angle: 0, power: 0 });
      // Strike direction follows the worm's facing at fire time.
      const dirS = worm.facing >= 0 ? 1 : -1;
      const vx0 = dirS * spec.mvx;
      const vy0 = spec.mvy;
      const y0 = -40;
      const drop = Math.max(50, t.y - y0);
      // Lead the spawn x so the (windless) arc lands the salvo on target.x.
      const tt = (-vy0 + Math.sqrt(vy0 * vy0 + 2 * C.GRAVITY * drop)) / C.GRAVITY;
      for (let i = 0; i < spec.count; i++) {
        const ox = (i - (spec.count - 1) / 2) * spec.spacing;
        sim.projectiles.push(new Projectile(
          'missile', t.x + ox - vx0 * tt, y0 - i * 6, vx0, vy0, { owner: worm.id },
        ));
      }
      return 'retreat';
    }

    case 'bazooka': {
      const sp = spec.speedMin + power * (spec.speedMax - spec.speedMin);
      sim.events.push({ type: 'fire', weapon: id, x: mx, y: my, angle, power });
      sim.projectiles.push(new Projectile('bazooka', mx, my, dirx * sp, diry * sp, {
        owner: worm.id,
      }));
      return 'retreat';
    }

    case 'grenade':
    case 'cluster': {
      consume(sim, worm.teamIndex, id);
      const sp = spec.speedMin + power * (spec.speedMax - spec.speedMin);
      sim.events.push({ type: 'fire', weapon: id, x: mx, y: my, angle, power });
      sim.projectiles.push(new Projectile(id, mx, my, dirx * sp, diry * sp, {
        fuse: sim.grenadeFuse * C.TICK_HZ, owner: worm.id,
      }));
      return 'retreat';
    }
  }
  return 'invalid';
}

function shotgunBlast(sim, worm, dirx, diry) {
  const spec = C.WEAPONS.shotgun;
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
        sim.events.push({ type: 'explosion', x: px, y: py, r: spec.craterR, strength: 0.25 });
        sim._damageWorm(o, spec.dmg, o.x, o.y);
        o.vx += dirx * spec.knock;
        o.vy += diry * spec.knock - 40;
        if (!o.airborne) { o.airborne = true; o.y -= 1; }
        return;
      }
    }
    if (sim.terrain.solid(px, py)) {
      sim.terrain.destroy(px, py, spec.craterR);
      sim.events.push({ type: 'explosion', x: px, y: py, r: spec.craterR, strength: 0.25 });
      return;
    }
  }
}
