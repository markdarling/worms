// Fire / flame system — shared by petrol bomb, napalm strike and flame thrower.
//
// A flame is a tiny physics body (gravity + strong wind while airborne; sticks
// on flat ground, slides down slopes) that persists ACROSS turns, shrinking
// each turn (FIRE_TURNS). Flames damage worms on contact in ~0.5s bundles,
// capped per worm per turn (sim.fireLedger). Worm bodies extinguish flames
// (FIRE_BURNS contacts kill a flamelet). A global cap (FIRE_CAP) removes the
// oldest flames first — deterministically, by entity id (ids are monotonic).
//
// CRITICAL settle rule: a RESTING flame counts as settled — standing fires must
// never block turn end; only flames still in motion do.
//
// Determinism: spawn velocities come from sim._rng() in fixed order; slope
// sliding is a pure function of the terrain (no rng).

import { C } from './constants.js';
import { surfaceNormal } from './physics.js';

export class Flame {
  constructor(id, x, y, vx, vy, opts = {}) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.turnsLeft = C.FIRE_TURNS;
    this.burns = 0;      // worm-contacts absorbed so far
    this.cd = 0;         // ticks until it can damage again
    this.carve = opts.carve ? 1 : 0; // flamethrower flames bite terrain on landing
    this.slid = 0;       // slope-slide guard: a flame can't slide forever
    this.resting = false;
    this.dead = false;
  }

  step(sim) {
    if (this.resting) {
      // Support carved away? Fall again.
      if (!sim.terrain.solid(this.x, this.y + 2)) this.resting = false;
    }
    if (!this.resting) {
      this.vx += sim.wind * C.FIRE_WIND_ACCEL * C.DT;
      this.vy += C.GRAVITY * C.FIRE_GRAV_SCALE * C.DT;
      const dx = this.vx * C.DT;
      const dy = this.vy * C.DT;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
      const sx = dx / steps;
      const sy = dy / steps;
      for (let i = 0; i < steps; i++) {
        const nx = this.x + sx;
        const ny = this.y + sy;
        if (ny > sim.waterLevel) { this.dead = true; return; }
        if (nx < -40 || nx > sim.config.width + 40) { this.dead = true; return; }
        if (sim.terrain.solid(nx, ny)) {
          this._land(sim);
          break;
        }
        this.x = nx;
        this.y = ny;
      }
    }
    this._burnWorms(sim);
  }

  _land(sim) {
    if (this.carve) sim.terrain.destroy(this.x, this.y, C.WEAPONS.flamethrower.carveR);
    const n = surfaceNormal(sim.terrain, this.x, this.y + 1);
    if (Math.abs(n.x) > 0.55 && this.slid < 120) {
      // Steep slope: keep sliding downhill (the napalm-into-water kill).
      // The slide budget stops V-shaped pits ping-ponging a flame forever.
      this.slid++;
      this.vx = n.x * 25;
      this.vy = 0;
    } else {
      this.resting = true;
      this.vx = 0;
      this.vy = 0;
    }
  }

  _burnWorms(sim) {
    if (this.cd > 0) { this.cd--; return; }
    const r = C.FIRE_RADIUS;
    for (let i = 0; i < sim.worms.length; i++) {
      const w = sim.worms[i];
      if (!w.alive) continue;
      const dx = w.x - this.x;
      const dy = w.y - this.y;
      if (dx * dx + dy * dy >= r * r) continue;
      if (sim.fireLedger[w.id] >= C.FIRE_TURN_CAP) continue;
      sim.fireLedger[w.id] += C.FIRE_DMG;
      sim._damageWorm(w, C.FIRE_DMG, w.x, w.y); // counts as damage -> ends control
      // Flames push worms along the stream/drift direction.
      w.vx += this.vx * 0.2;
      w.vy -= 20;
      if (!w.airborne) { w.airborne = true; w.y -= 1; }
      this.cd = C.FIRE_DMG_COOLDOWN;
      this.burns++;
      if (this.burns >= C.FIRE_BURNS) this.dead = true; // bodies smother fire
      break; // one worm per bundle — damage splits across a pile
    }
  }

  serialize() {
    return [
      this.id, this.x, this.y, this.vx, this.vy,
      this.turnsLeft, this.burns, this.cd, this.carve,
      this.resting ? 1 : 0, this.slid,
    ];
  }

  static deserialize(a) {
    const f = new Flame(a[0], a[1], a[2], a[3], a[4], { carve: a[8] === 1 });
    f.turnsLeft = a[5];
    f.burns = a[6];
    f.cd = a[7];
    f.carve = a[8];
    f.resting = a[9] === 1;
    f.slid = a[10] || 0;
    return f;
  }
}

// Spawn `count` flames scattered from (x, y). Velocity pattern comes from
// sim._rng() in fixed order (2 calls per flame). Enforces the global cap by
// evicting oldest flames (lowest id — sim.flames is kept in spawn order).
export function spawnFlames(sim, x, y, count, opts = {}) {
  const spread = opts.spread !== undefined ? opts.spread : 120;
  const up = opts.up !== undefined ? opts.up : 140;
  for (let i = 0; i < count; i++) {
    const r1 = sim._rng();
    const r2 = sim._rng();
    const vx = (opts.vx || 0) + (r1 * 2 - 1) * spread;
    const vy = (opts.vy || 0) - r2 * up;
    const f = new Flame(sim.entitySeq++, x, y - 2, vx, vy, { carve: opts.carve });
    sim.flames.push(f);
  }
  while (sim.flames.length > C.FIRE_CAP) {
    const old = sim.flames.shift(); // oldest first (spawn order == id order)
    sim.events.push({ type: 'flameOut', x: old.x, y: old.y });
  }
  if (count > 0 && !opts.quiet) sim.events.push({ type: 'fireStarted', x, y });
}

// One tick for every flame; fixed order, dead flames swept after.
export function stepFlames(sim) {
  for (let i = 0; i < sim.flames.length; i++) {
    if (!sim.flames[i].dead) sim.flames[i].step(sim);
  }
  let removed = false;
  for (let i = 0; i < sim.flames.length; i++) {
    if (sim.flames[i].dead) {
      sim.events.push({ type: 'flameOut', x: sim.flames[i].x, y: sim.flames[i].y });
      removed = true;
    }
  }
  if (removed) sim.flames = sim.flames.filter((f) => !f.dead);
}

// Turn-boundary decay: each flame shrinks one step; expired flames go out.
export function decayFlames(sim) {
  for (let i = 0; i < sim.flames.length; i++) {
    const f = sim.flames[i];
    f.turnsLeft--;
    if (f.turnsLeft <= 0) {
      f.dead = true;
      sim.events.push({ type: 'flameOut', x: f.x, y: f.y });
    }
  }
  sim.flames = sim.flames.filter((f) => !f.dead);
}
