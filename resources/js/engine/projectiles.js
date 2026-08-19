// Projectile simulation. Types:
//   bazooka       — wind-affected rocket, explodes on impact
//   grenade       — fused, WA MIN bounce
//   cluster       — fused grenade that pops and splits into clusterlets
//   clusterlet    — submunition, explodes on impact (9s backstop)
//   dynamite      — placed, 5s fuse, barely bounces
//   missile       — airstrike round, wind-affected, explodes on impact
//   homing        — bazooka shell with a steering phase toward (tx, ty)
//   mortar        — fixed-speed shell; ejects 5 mortarlets backwards on impact
//   mortarlet     — mortar submunition, impact
//   banana        — fused, forced MAX bounce, splits into 5 bananalets
//   bananalet     — 75-damage submunition, impact (9s backstop)
//   holygrenade   — fixed 3s fuse AND must be at rest; silence beat, then boom
//   petrol        — bottle: tiny pop on impact + 40 flames
//   napalmmissile — airstrike round that also rains 20 flames
//   carpet        — bouncing strike payload: explodes on EVERY bounce, 5 lives
//   meteor        — armageddon rock (seeded size), impact; `delay` staggers rain
//   arrow         — longbow bolt: 15 dmg + big knock on worms; EMBEDS in terrain

import { C } from './constants.js';
import { applyExplosion, surfaceNormal, dsin, dcos } from './physics.js';
import { spawnFlames } from './fire.js';

const W = C.WEAPONS;

function spec(type) {
  switch (type) {
    case 'bazooka': return W.bazooka;
    case 'grenade': return W.grenade;
    case 'cluster': return W.cluster;
    case 'clusterlet': return { dmg: W.cluster.subDmg, radius: W.cluster.subRadius, knock: W.cluster.subKnock };
    case 'dynamite': return W.dynamite;
    case 'missile': return W.airstrike;
    case 'homing': return W.homing;
    case 'mortar': return W.mortar;
    case 'mortarlet': return { dmg: W.mortar.subDmg, radius: W.mortar.subRadius, knock: W.mortar.subKnock };
    case 'banana': return W.banana;
    case 'bananalet': return { dmg: W.banana.subDmg, radius: W.banana.subRadius, knock: W.banana.subKnock };
    case 'holygrenade': return W.holygrenade;
    case 'petrol': return W.petrol;
    case 'napalmmissile': return W.napalm;
    case 'carpet': return W.carpetbomb;
    default: return null; // meteor carries its own seeded spec; arrow never explodes
  }
}

// Explode the moment they touch terrain or a worm:
const IMPACT_TYPES = {
  bazooka: 1, clusterlet: 1, missile: 1, homing: 1, mortar: 1, mortarlet: 1,
  bananalet: 1, petrol: 1, napalmmissile: 1, meteor: 1,
};
const WIND_TYPES = { bazooka: 1, missile: 1, homing: 1, napalmmissile: 1 };
function bounceSpec(type) {
  const s = spec(type);
  return s && s.e !== undefined ? { e: s.e, f: s.f } : null;
}

export class Projectile {
  constructor(type, x, y, vx, vy, opts = {}) {
    this.type = type;
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.fuse = opts.fuse !== undefined ? opts.fuse : -1; // ticks; -1 = impact only
    this.owner = opts.owner !== undefined ? opts.owner : -1;
    this.age = 0;
    this.resting = false;
    this.talked = false; // 'ohno' emitted once
    this.dead = false;
    // Extra per-type state (0 defaults keep the snapshot array shape fixed):
    this.delay = opts.delay || 0;        // meteor: ticks before entering the world
    this.tx = opts.tx || 0;              // homing target
    this.ty = opts.ty || 0;
    this.life = opts.life || 0;          // carpet: bounces left
    this.primed = 0;                     // holygrenade: silence countdown (0 = not primed)
    this.dmg = opts.dmg || 0;            // meteor: seeded explosion spec
    this.radius = opts.radius || 0;
    this.knock = opts.knock || 0;
  }

  step(sim) {
    if (this.delay > 0) {
      this.delay--;
      if (this.delay === 0) sim.events.push({ type: 'meteor', x: this.x, y: this.y });
      return;
    }
    this.age++;

    // Holy hand grenade: fuse elapsed AND at rest -> one agonising beat, then boom.
    if (this.type === 'holygrenade') {
      if (this.primed > 0) {
        this.primed--;
        if (this.primed === 0) this.explode(sim);
        return;
      }
      const hs = W.holygrenade;
      if ((this.age >= hs.fuseTicks && this.resting) || this.age >= hs.backstopTicks) {
        this.primed = hs.silenceTicks;
        this.vx = 0;
        this.vy = 0;
        this.resting = true;
        return;
      }
    } else if (this.fuse >= 0 && this.age >= this.fuse) {
      this.explode(sim);
      return;
    }

    if (this.resting) {
      // Support carved away? Fall again.
      if (!sim.terrain.solid(this.x, this.y + 3)) this.resting = false;
      else return;
    }

    if (WIND_TYPES[this.type]) this.vx += sim.wind * C.WIND_ACCEL * C.DT;

    if (this.type === 'homing') {
      const hs = W.homing;
      if (this.age >= hs.lifeTicks) { this.explode(sim); return; }
      if (this.age >= hs.lockTick && this.age < hs.homingTicks) {
        // Powered flight: weak steering toward the target — misses orbit it.
        const dx = this.tx - this.x;
        const dy = this.ty - this.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1) {
          this.vx += (dx / d) * hs.accel * C.DT;
          this.vy += (dy / d) * hs.accel * C.DT;
        }
        const sp = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        if (sp > hs.maxSpeed) {
          this.vx = (this.vx / sp) * hs.maxSpeed;
          this.vy = (this.vy / sp) * hs.maxSpeed;
        }
      } else {
        this.vy += C.GRAVITY * C.DT; // ballistic before lock / after expiry
      }
    } else if (this.type === 'arrow') {
      this.vy += C.GRAVITY * 0.35 * C.DT; // fast, flat arc
    } else {
      this.vy += C.GRAVITY * C.DT;
    }

    const dx = this.vx * C.DT;
    const dy = this.vy * C.DT;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    const sx = dx / steps;
    const sy = dy / steps;
    const impactExplode = IMPACT_TYPES[this.type] === 1;

    for (let i = 0; i < steps; i++) {
      const nx = this.x + sx;
      const ny = this.y + sy;
      if (ny > sim.waterLevel) {
        sim.events.push({ type: 'splash', x: nx, y: sim.waterLevel });
        this.dead = true;
        return;
      }
      if (nx < -80 || nx > sim.config.width + 80 || ny < -3000) {
        this.dead = true;
        return;
      }
      if (impactExplode || this.type === 'arrow' || this.type === 'carpet') {
        for (let k = 0; k < sim.worms.length; k++) {
          const w = sim.worms[k];
          if (!w.alive) continue;
          if (w.id === this.owner && this.age < 12) continue; // muzzle grace
          const ddx = w.x - nx;
          const ddy = w.y - ny;
          const hr = C.WORM_RADIUS + 3;
          if (ddx * ddx + ddy * ddy < hr * hr) {
            this.x = nx;
            this.y = ny;
            if (this.type === 'arrow') this.arrowHitWorm(sim, w);
            else if (this.type === 'carpet') this.carpetPop(sim);
            else this.explode(sim);
            return;
          }
        }
      }
      if (sim.terrain.solid(nx, ny)) {
        if (this.type === 'arrow') {
          this.x = nx;
          this.y = ny;
          this.arrowEmbed(sim);
          return;
        }
        if (this.type === 'carpet') {
          this.carpetPop(sim);
          return;
        }
        if (impactExplode) {
          this.explode(sim); // at last free position
          return;
        }
        this.bounce(sim, nx, ny);
        return; // remainder of tick forfeited after a bounce — imperceptible
      }
      this.x = nx;
      this.y = ny;
    }
  }

  // WA-style bounce: keep `f` of the tangential and `e` of the normal component.
  bounce(sim, cx, cy) {
    const bs = bounceSpec(this.type);
    const n = surfaceNormal(sim.terrain, cx, cy);
    const vdn = this.vx * n.x + this.vy * n.y;
    const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    const vtx = this.vx - vdn * n.x;
    const vty = this.vy - vdn * n.y;
    this.vx = vtx * bs.f - bs.e * vdn * n.x;
    this.vy = vty * bs.f - bs.e * vdn * n.y;
    if (speed > 40) sim.events.push({ type: 'bounce', x: this.x, y: this.y });
    const nsp = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if ((nsp < 18 && n.y < -0.4) || nsp < 8) this.rest(sim);
  }

  rest(sim) {
    this.resting = true;
    this.vx = 0;
    this.vy = 0;
    if (!this.talked) {
      // Nearest living worm within earshot goes wide-eyed.
      let best = null;
      let bestD = 70 * 70;
      for (let i = 0; i < sim.worms.length; i++) {
        const w = sim.worms[i];
        if (!w.alive) continue;
        const dx = w.x - this.x;
        const dy = w.y - this.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) { bestD = d2; best = w; }
      }
      if (best) {
        sim.events.push({ type: 'wormTalk', wormId: best.id, kind: 'ohno' });
        this.talked = true;
      }
    }
  }

  // Carpet: explodes on every contact, keeps bouncing until its lives run out.
  carpetPop(sim) {
    const cs = W.carpetbomb;
    applyExplosion(sim, this.x, this.y, cs, this.owner);
    this.life--;
    if (this.life <= 0) { this.dead = true; return; }
    // Apply the bounce AFTER the carve so it keeps marching across the terrain.
    this.vx = this.vx * cs.f;
    this.vy = -(Math.abs(this.vy) * cs.e + 60);
  }

  arrowHitWorm(sim, w) {
    this.dead = true;
    const ls = W.longbow;
    const sp = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    const ux = sp > 0.001 ? this.vx / sp : 0;
    const uy = sp > 0.001 ? this.vy / sp : -1;
    sim._damageWorm(w, ls.dmg, w.x, w.y);
    w.vx += ux * ls.knock;
    w.vy += uy * ls.knock - 60;
    if (!w.airborne) { w.airborne = true; w.y -= 1; }
  }

  // Arrows that hit terrain become part of the landscape (climbable).
  arrowEmbed(sim) {
    this.dead = true;
    const ls = W.longbow;
    const sp = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    const ux = sp > 0.001 ? this.vx / sp : 0;
    const uy = sp > 0.001 ? this.vy / sp : 1;
    paintStamp(sim.terrain, this.x, this.y, ux, uy, ls.stampLen, ls.stampThick);
    // Cosmetic angle only (event payload never feeds sim state).
    sim.events.push({ type: 'arrowStuck', x: this.x, y: this.y, angle: Math.atan2(uy, ux) });
  }

  explode(sim) {
    this.dead = true;
    const es = this.type === 'meteor'
      ? { dmg: this.dmg, radius: this.radius, knock: this.knock }
      : spec(this.type);
    applyExplosion(sim, this.x, this.y, es, this.owner);

    if (this.type === 'cluster' || this.type === 'banana') {
      // Bomblets eject -45..+45 deg from vertical, speeds up to 9% below max.
      const cs = W[this.type];
      const subType = this.type === 'cluster' ? 'clusterlet' : 'bananalet';
      for (let i = 0; i < cs.subCount; i++) {
        const a = (sim._rng() * 2 - 1) * cs.subSpread;
        const s = cs.subSpeed * (1 - sim._rng() * 0.09);
        sim.projectiles.push(new Projectile(
          subType, this.x, this.y - 4,
          dsin(a) * s, -dcos(a) * s,
          { owner: this.owner, fuse: cs.subFuse },
        ));
      }
    } else if (this.type === 'mortar') {
      // Clusters eject roughly OPPOSITE to the shell's travel direction.
      const ms = W.mortar;
      const sp = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
      const rx = sp > 0.001 ? -this.vx / sp : 0;
      const ry = sp > 0.001 ? -this.vy / sp : -1;
      for (let i = 0; i < ms.subCount; i++) {
        const a = (sim._rng() * 2 - 1) * ms.subSpread;
        const s = ms.subSpeed * (1 - sim._rng() * 0.09);
        const ca = dcos(a);
        const sa = dsin(a);
        sim.projectiles.push(new Projectile(
          'mortarlet', this.x, this.y - 3,
          (rx * ca - ry * sa) * s, (rx * sa + ry * ca) * s,
          { owner: this.owner, fuse: 540 },
        ));
      }
    } else if (this.type === 'petrol') {
      spawnFlames(sim, this.x, this.y, W.petrol.flames, { spread: 120, up: 150 });
    } else if (this.type === 'napalmmissile') {
      spawnFlames(sim, this.x, this.y, W.napalm.flamesPerMissile, {
        spread: 100, up: 160, vx: sim.wind * 60, // very wind-sensitive rain
      });
    }
  }

  serialize() {
    return [
      this.type, this.x, this.y, this.vx, this.vy,
      this.fuse, this.age, this.owner,
      this.resting ? 1 : 0, this.talked ? 1 : 0,
      this.delay, this.tx, this.ty, this.life, this.primed,
      this.dmg, this.radius, this.knock,
    ];
  }

  static deserialize(a) {
    const p = new Projectile(a[0], a[1], a[2], a[3], a[4], { fuse: a[5], owner: a[7] });
    p.age = a[6];
    p.resting = a[8] === 1;
    p.talked = a[9] === 1;
    // v1 snapshots stop at index 9; the extras default to 0.
    p.delay = a[10] || 0;
    p.tx = a[11] || 0;
    p.ty = a[12] || 0;
    p.life = a[13] || 0;
    p.primed = a[14] || 0;
    p.dmg = a[15] || 0;
    p.radius = a[16] || 0;
    p.knock = a[17] || 0;
    return p;
  }
}

// Stamp a rotated rectangle of ORDINARY destructible terrain (arrow embeds,
// girders). Writes terrain.data directly and maintains version/dirtyRects —
// the Terrain class has no add() method, so this helper owns terrain-add.
// (ux, uy) is the along-axis unit vector; all arithmetic is deterministic.
export function paintStamp(terrain, cx, cy, ux, uy, len, thick) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const hl = len / 2;
  const ht = thick / 2;
  for (let t = -hl; t <= hl; t += 0.5) {
    for (let s = -ht; s <= ht; s += 0.5) {
      const x = Math.round(cx + ux * t - uy * s);
      const y = Math.round(cy + uy * t + ux * s);
      if (x < 0 || y < 0 || x >= terrain.width || y >= terrain.height) continue;
      terrain.data[y * terrain.width + x] = 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (minX === Infinity) return;
  terrain.version++;
  terrain.dirtyRects.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
}
