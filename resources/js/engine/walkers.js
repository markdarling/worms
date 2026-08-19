// Autonomous world entities: Mine (placed weapon / mine strike payload),
// Sheep (the walker template for the whole animal family) and the Concrete
// Donkey set-piece. All fully deterministic — pathing is a pure function of
// terrain + spawn state; the only rng is consumed at spawn time by the caller.

import { C } from './constants.js';
import { applyExplosion, walk, wormAirStep, grounded, bodyCollides, surfaceNormal } from './physics.js';

// ---------------------------------------------------------------------- Mine
// States: arming (placer can retreat over it) -> idle -> triggered (3s fuse,
// flashing + beeping) -> explode | dud (sizzles, never pops).
export class Mine {
  constructor(id, x, y, opts = {}) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.vx = opts.vx || 0;
    this.vy = opts.vy || 0;
    this.state = 'arming';
    this.timer = opts.armTicks !== undefined ? opts.armTicks : C.MINE.armTicks;
    this.dud = opts.dud ? 1 : 0;
    this.owner = opts.owner !== undefined ? opts.owner : -1;
    this.calm = 0; // consecutive slow ground contacts — forces rest on slopes
    this.resting = false;
    this.dead = false;
  }

  step(sim) {
    // --- physics: MAX-bounce grenade-like body, shoved around by blasts ---
    if (this.resting) {
      if (!sim.terrain.solid(this.x, this.y + 3)) { this.resting = false; this.calm = 0; }
    }
    if (!this.resting) {
      this.vy += C.GRAVITY * C.DT;
      const dx = this.vx * C.DT;
      const dy = this.vy * C.DT;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
      const sx = dx / steps;
      const sy = dy / steps;
      for (let i = 0; i < steps; i++) {
        const nx = this.x + sx;
        const ny = this.y + sy;
        if (ny > sim.waterLevel) {
          sim.events.push({ type: 'splash', x: nx, y: sim.waterLevel });
          this.dead = true;
          return;
        }
        if (nx < -40 || nx > sim.config.width + 40) { this.dead = true; return; }
        if (sim.terrain.solid(nx, ny)) {
          const n = surfaceNormal(sim.terrain, nx, ny);
          const vdn = this.vx * n.x + this.vy * n.y;
          const vtx = this.vx - vdn * n.x;
          const vty = this.vy - vdn * n.y;
          this.vx = vtx * C.MINE.f - C.MINE.e * vdn * n.x;
          this.vy = vty * C.MINE.f - C.MINE.e * vdn * n.y;
          const nsp = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
          // Slow contact on a slope can jitter forever (96% tangential keep +
          // gravity re-feed): a long streak of calm contacts also means rest.
          if (nsp < 45) this.calm++;
          else this.calm = 0;
          if ((nsp < 18 && n.y < -0.4) || nsp < 8 || this.calm > 60) {
            this.resting = true;
            this.vx = 0;
            this.vy = 0;
          }
          break;
        }
        this.x = nx;
        this.y = ny;
      }
    }

    // --- state machine ---
    if (this.state === 'arming') {
      this.timer--;
      if (this.timer <= 0) {
        this.state = 'idle';
        sim.events.push({ type: 'mineArmed', x: this.x, y: this.y });
      }
    } else if (this.state === 'idle') {
      const r = C.MINE.proximity;
      for (let i = 0; i < sim.worms.length; i++) {
        const w = sim.worms[i];
        if (!w.alive) continue;
        const dx = w.x - this.x;
        const dy = w.y - this.y;
        if (dx * dx + dy * dy < r * r) {
          this.state = 'triggered';
          this.timer = C.MINE.fuseTicks;
          sim.events.push({ type: 'mineTriggered', x: this.x, y: this.y });
          break;
        }
      }
    } else if (this.state === 'triggered') {
      this.timer--;
      if (this.timer <= 0) {
        if (this.dud) {
          this.state = 'dud'; // sizzles, never pops
        } else {
          this.dead = true;
          applyExplosion(sim, this.x, this.y, C.MINE, this.owner);
        }
      }
    }
  }

  serialize() {
    return [
      this.id, this.x, this.y, this.vx, this.vy,
      this.state, this.timer, this.dud, this.owner,
      this.resting ? 1 : 0, this.calm,
    ];
  }

  static deserialize(a) {
    const m = new Mine(a[0], a[1], a[2], { vx: a[3], vy: a[4], owner: a[8], dud: a[7] === 1 });
    m.state = a[5];
    m.timer = a[6];
    m.resting = a[9] === 1;
    m.calm = a[10] || 0;
    return m;
  }
}

// WA's 6-slot dud pool: outcomes are pre-rolled in blocks of six, so duds
// cluster realistically. Pure function of (gameSeed, mineIndex) — no state.
import { makeRng, hashSeed } from './rng.js';
export function mineDudRoll(gameSeed, mineIndex) {
  const pool = Math.floor(mineIndex / 6);
  const slot = mineIndex % 6;
  const rng = makeRng(hashSeed(gameSeed, 0xd06d, pool));
  let dud = false;
  for (let i = 0; i <= slot; i++) dud = rng() < C.MINE.dudChance;
  return dud;
}

// --------------------------------------------------------------------- Sheep
// The walker template. Walks fast in its facing direction, hops when blocked,
// reverses when a hop doesn't clear, collects crates for its owner, detonates
// on: manual command, timeout (20s), or blast damage (explodeNext).
export class Sheep {
  constructor(id, x, y, dir, owner, teamIndex) {
    this.id = id;
    this.kind = 'sheep';
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.dir = dir;
    this.facing = dir;
    this.owner = owner;
    this.teamIndex = teamIndex;
    this.age = 0;
    this.airborne = true; // released mid-stride; settles immediately if grounded
    this.walkAccum = 0;
    this.justHopped = false;
    this.progress = 0; // px advanced since last hop-landing (for reverse logic)
    this.explodeNext = false;
    this.dead = false;
  }

  step(sim) {
    this.age++;
    const spec = C.WEAPONS.sheep;
    if (this.explodeNext || this.age >= spec.timeoutTicks) {
      this.explode(sim);
      return;
    }
    if (this.y > sim.waterLevel) {
      sim.events.push({ type: 'splash', x: this.x, y: sim.waterLevel });
      this.dead = true;
      return;
    }

    if (this.airborne) {
      const res = wormAirStep(sim.terrain, this);
      if (res.landed) this.progress = 0;
    } else {
      if (!grounded(sim.terrain, this)) {
        this.airborne = true;
        this.vx = this.dir * C.WALK_SPEED * spec.walkMult;
        this.vy = 0;
      } else {
        // Wall test: blocked when even a STEP_UP rise can't clear the next px
        // (sub-pixel walk accumulation makes "didn't move this tick" useless).
        let blocked = true;
        for (let rise = 0; rise <= C.STEP_UP; rise++) {
          if (!bodyCollides(sim.terrain, this.x + this.dir, this.y - rise)) {
            blocked = false;
            break;
          }
        }
        if (blocked) {
          // Hop over it; if the last hop didn't clear anything, give up and
          // turn around (WA sheep bumbling).
          if (this.justHopped && this.progress < 4) {
            this.dir = -this.dir;
            this.justHopped = false;
          } else {
            this.vx = this.dir * spec.hopVx;
            this.vy = spec.hopVy;
            this.airborne = true;
            this.y -= 1;
            this.justHopped = true;
            this.progress = 0;
            sim.events.push({ type: 'sheepBaa', x: this.x, y: this.y });
          }
        } else {
          const x0 = this.x;
          this.facing = this.dir;
          for (let i = 0; i < spec.walkMult; i++) walk(sim.terrain, this, this.dir);
          const moved = Math.abs(this.x - x0);
          this.progress += moved;
          if (moved > 2) this.justHopped = false; // cleared the obstacle
        }
      }
    }

    // Collects crates for its owner en route!
    for (let i = 0; i < sim.crates.length; i++) {
      const c = sim.crates[i];
      if (c.falling || c.dead) continue;
      if (Math.abs(this.x - c.x) < 12 && Math.abs(this.y - c.y) < 14) {
        sim.ammo[this.teamIndex][c.weapon] += c.amount;
        c.dead = true;
        sim.events.push({
          type: 'crateCollected', wormId: this.owner,
          contents: { weapon: c.weapon, amount: c.amount },
        });
      }
    }
    sim.crates = sim.crates.filter((c) => !c.dead);
  }

  explode(sim) {
    this.dead = true;
    const spec = C.WEAPONS.sheep;
    applyExplosion(sim, this.x, this.y, spec, this.owner);
  }

  serialize() {
    return [
      'sheep', this.id, this.x, this.y, this.vx, this.vy,
      this.dir, this.owner, this.teamIndex, this.age,
      this.airborne ? 1 : 0, this.walkAccum,
      this.justHopped ? 1 : 0, this.progress,
      this.explodeNext ? 1 : 0,
    ];
  }

  static deserialize(a) {
    const s = new Sheep(a[1], a[2], a[3], a[6], a[7], a[8]);
    s.vx = a[4];
    s.vy = a[5];
    s.age = a[9];
    s.airborne = a[10] === 1;
    s.walkAccum = a[11];
    s.justHopped = a[12] === 1;
    s.progress = a[13];
    s.explodeNext = a[14] === 1;
    s.facing = s.dir;
    return s;
  }
}

// -------------------------------------------------------------------- Donkey
// THE super weapon. Falls at the target x, stomping 100/78 explosions through
// the entire column of terrain beneath it until it exits into water.
export class Donkey {
  constructor(id, x, owner) {
    this.id = id;
    this.kind = 'donkey';
    this.x = x;
    this.y = -60;
    this.vy = 0;
    this.owner = owner;
    this.cooldown = 0;
    this.stomps = 0;
    this.dead = false;
  }

  step(sim) {
    const spec = C.WEAPONS.donkey;
    this.vy = Math.min(spec.fallSpeed, this.vy + C.GRAVITY * C.DT);
    this.y += this.vy * C.DT;
    if (this.cooldown > 0) this.cooldown--;
    if (this.y > sim.waterLevel) {
      sim.events.push({ type: 'splash', x: this.x, y: sim.waterLevel });
      this.dead = true;
      return;
    }
    if (this.cooldown === 0 && (
      bodyCollides(sim.terrain, this.x, this.y + 16) ||
      sim.terrain.solid(this.x, this.y + 20)
    )) {
      sim.events.push({ type: 'donkeyStomp', x: this.x, y: this.y });
      applyExplosion(sim, this.x, this.y + 12, spec, this.owner);
      this.vy = spec.bounceVy; // slight bounce up, then slam again
      this.cooldown = spec.stompCooldown;
      this.stomps++;
      if (this.stomps >= spec.maxStomps) this.dead = true; // safety bound
    }
  }

  serialize() {
    return ['donkey', this.id, this.x, this.y, this.vy, this.owner, this.cooldown, this.stomps];
  }

  static deserialize(a) {
    const d = new Donkey(a[1], a[2], a[5]);
    d.y = a[3];
    d.vy = a[4];
    d.cooldown = a[6];
    d.stomps = a[7];
    return d;
  }
}

export function deserializeWalker(a) {
  return a[0] === 'sheep' ? Sheep.deserialize(a) : Donkey.deserialize(a);
}
