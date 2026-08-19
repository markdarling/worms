// Projectile simulation. Types:
//   bazooka    — wind-affected rocket, explodes on impact
//   grenade    — fused, bounces
//   cluster    — fused grenade that pops and splits into clusterlets
//   clusterlet — submunition, explodes on impact (safety fuse as backstop)
//   dynamite   — placed, 5s fuse, barely bounces
//   missile    — airstrike round, wind-affected, explodes on impact

import { C } from './constants.js';
import { applyExplosion, surfaceNormal } from './physics.js';

const W = C.WEAPONS;

const EXPLODE_SPECS = {
  bazooka: { dmg: W.bazooka.dmg, radius: W.bazooka.radius, knock: W.bazooka.knock },
  grenade: { dmg: W.grenade.dmg, radius: W.grenade.radius, knock: W.grenade.knock },
  cluster: { dmg: W.cluster.dmg, radius: W.cluster.radius, knock: W.cluster.knock },
  clusterlet: { dmg: W.cluster.subDmg, radius: W.cluster.subRadius, knock: W.cluster.subKnock },
  dynamite: { dmg: W.dynamite.dmg, radius: W.dynamite.radius, knock: W.dynamite.knock },
  missile: { dmg: W.airstrike.dmg, radius: W.airstrike.radius, knock: W.airstrike.knock },
};

const IMPACT_TYPES = { bazooka: 1, clusterlet: 1, missile: 1 };
const WIND_TYPES = { bazooka: 1, missile: 1 };
const BOUNCE_SPECS = {
  grenade: { e: W.grenade.restitution, f: W.grenade.friction },
  cluster: { e: W.cluster.restitution, f: W.cluster.friction },
  dynamite: { e: W.dynamite.restitution, f: W.dynamite.friction },
};

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
  }

  step(sim) {
    this.age++;
    if (this.fuse >= 0 && this.age >= this.fuse) {
      this.explode(sim);
      return;
    }
    if (this.resting) {
      // Support carved away? Fall again.
      if (!sim.terrain.solid(this.x, this.y + 3)) this.resting = false;
      else return;
    }
    if (WIND_TYPES[this.type]) this.vx += sim.wind * C.WIND_ACCEL * C.DT;
    this.vy += C.GRAVITY * C.DT;

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
      if (impactExplode) {
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
            this.explode(sim);
            return;
          }
        }
      }
      if (sim.terrain.solid(nx, ny)) {
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

  bounce(sim, cx, cy) {
    const spec = BOUNCE_SPECS[this.type];
    const n = surfaceNormal(sim.terrain, cx, cy);
    const vdn = this.vx * n.x + this.vy * n.y;
    const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    const vtx = this.vx - vdn * n.x;
    const vty = this.vy - vdn * n.y;
    this.vx = vtx * spec.f - spec.e * vdn * n.x;
    this.vy = vty * spec.f - spec.e * vdn * n.y;
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

  explode(sim) {
    this.dead = true;
    applyExplosion(sim, this.x, this.y, EXPLODE_SPECS[this.type], this.owner);
    if (this.type === 'cluster') {
      const cs = W.cluster;
      for (let i = 0; i < cs.subCount; i++) {
        const r1 = sim._rng();
        const r2 = sim._rng();
        sim.projectiles.push(new Projectile(
          'clusterlet',
          this.x, this.y - 4,
          (r1 * 2 - 1) * cs.subSpreadVx,
          -(cs.subVyMin + r2 * cs.subVyRange),
          { owner: this.owner, fuse: 300 }, // fuse = backstop; they pop on impact
        ));
      }
    }
  }

  serialize() {
    return [
      this.type, this.x, this.y, this.vx, this.vy,
      this.fuse, this.age, this.owner,
      this.resting ? 1 : 0, this.talked ? 1 : 0,
    ];
  }

  static deserialize(a) {
    const p = new Projectile(a[0], a[1], a[2], a[3], a[4], { fuse: a[5], owner: a[7] });
    p.age = a[6];
    p.resting = a[8] === 1;
    p.talked = a[9] === 1;
    return p;
  }
}
