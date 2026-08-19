// The deterministic game simulation. Contract: docs/ARCHITECTURE.md (ENGINE track).
//
// Phases: 'move' -> 'retreat' -> 'resolving' -> 'turn-over' | 'game-over'.
// The sim decides all transitions; the caller just steps and reads `phase`.
//
// Determinism: all per-turn randomness comes from makeRng(hashSeed(seed, turn))
// created in beginTurn(). The rng call count is tracked so fromSnapshot() can
// restore mid-turn rng state exactly. No Math.random, no Date, no key-order
// dependent iteration in anything that touches state.

import { makeRng, hashSeed, hashString } from './rng.js';
import { C } from './constants.js';
import { Terrain } from './terrain.js';
import { normalizeInput } from './commands.js';
import { Worm } from './worm.js';
import * as P from './physics.js';
import { Projectile } from './projectiles.js';
import * as W from './weapons.js';

function mergeConfig(config) {
  return {
    seed: config.seed >>> 0,
    width: config.width || C.WORLD_W,
    height: config.height || C.WORLD_H,
    waterLevel: config.waterLevel || Math.round(C.WATER_LEVEL * ((config.height || C.WORLD_H) / C.WORLD_H)),
    teams: config.teams,
    wormHp: config.wormHp || C.WORM_HP,
    stamina: config.stamina || C.STAMINA,
    retreatStamina: config.retreatStamina || C.RETREAT_STAMINA,
    suddenDeathRound: config.suddenDeathRound !== undefined ? config.suddenDeathRound : C.SUDDEN_DEATH_ROUND,
  };
}

export class Sim {
  constructor(config, terrain) {
    this.config = config;
    this.terrain = terrain;
    this.worms = [];
    this.projectiles = [];
    this.crates = []; // {x, y, vy, falling, weapon, amount}
    this.events = [];
    this.wind = 0;
    this.waterLevel = config.waterLevel;
    this.turnNumber = 0;
    this.round = 0;
    this.suddenDeath = false;
    this.phase = 'turn-over';
    this.winner = null;
    this.activeWormId = -1;
    this.stamina = 0;
    this.retreatStamina = 0;
    this.selectedWeapon = 'bazooka';
    this.grenadeFuse = 3;
    this.power = 0;
    this.charging = false;
    this.pendingShots = 0; // >0 = shotgun second shot still owed
    this.idleTicks = 0;
    this.endRetreat = false;
    this.retreatTicks = 0;
    this.teamPointer = -1;
    this.teamWormPointers = config.teams.map(() => -1);
    this.ammo = config.teams.map(() => ({
      cluster: C.WEAPONS.cluster.ammo,
      dynamite: C.WEAPONS.dynamite.ammo,
      airstrike: C.WEAPONS.airstrike.ammo,
      teleport: C.WEAPONS.teleport.ammo,
    }));
    this.rngCalls = 0;
    this._rngRaw = null;
    this._activeHit = false; // transient per-tick flag
    this._prev = { fire: false, charge: false, jump: false, backflip: false };
  }

  // Counted rng so snapshots can restore mid-turn rng state.
  _rng() {
    this.rngCalls++;
    return this._rngRaw();
  }

  static newGame(rawConfig) {
    const config = mergeConfig(rawConfig);
    const terrain = Terrain.generate(config.seed, config.width, config.height);
    const sim = new Sim(config, terrain);

    const spots = P.findSpawnSpots(terrain, sim.waterLevel);
    const total = config.teams.reduce((n, t) => n + t.worms.length, 0);
    if (spots.length < total) throw new Error('terrain generated too few spawn spots');
    const rng = makeRng(hashSeed(config.seed, 0x51ed));
    // Evenly spread picks across the (left-to-right) spot list, then shuffle
    // the assignment so teams aren't sorted spatially.
    const chosen = [];
    for (let i = 0; i < total; i++) {
      let idx = Math.floor(((i + 0.15 + rng() * 0.7) * spots.length) / total);
      if (idx >= spots.length) idx = spots.length - 1;
      chosen.push(spots[idx]);
    }
    for (let i = chosen.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = chosen[i];
      chosen[i] = chosen[j];
      chosen[j] = tmp;
    }
    let id = 0;
    for (let t = 0; t < config.teams.length; t++) {
      const names = config.teams[t].worms;
      for (let k = 0; k < names.length; k++) {
        const spot = chosen[id];
        sim.worms.push(new Worm({
          id, teamIndex: t, name: names[k], x: spot.x, y: spot.y, hp: config.wormHp,
        }));
        id++;
      }
    }
    return sim;
  }

  static fromSnapshot(rawConfig, snap) {
    const config = mergeConfig(rawConfig);
    const terrain = Terrain.deserialize(snap.terrain);
    const sim = new Sim(config, terrain);
    sim.turnNumber = snap.turnNumber;
    sim.round = snap.round;
    sim.waterLevel = snap.waterLevel;
    sim.suddenDeath = snap.suddenDeath === 1;
    sim.phase = snap.phase;
    sim.winner = snap.winner;
    sim.wind = snap.wind;
    sim.activeWormId = snap.activeWormId;
    sim.stamina = snap.stamina;
    sim.retreatStamina = snap.retreatStamina;
    sim.selectedWeapon = snap.selectedWeapon;
    sim.grenadeFuse = snap.grenadeFuse;
    sim.power = snap.power;
    sim.charging = snap.charging === 1;
    sim.pendingShots = snap.pendingShots;
    sim.idleTicks = snap.idleTicks;
    sim.retreatTicks = snap.retreatTicks ?? 0;
    sim.endRetreat = snap.endRetreat === 1;
    sim.teamPointer = snap.teamPointer;
    sim.teamWormPointers = snap.teamWormPointers.slice();
    sim._prev = {
      fire: !!(snap.prevMask & 1), charge: !!(snap.prevMask & 2),
      jump: !!(snap.prevMask & 4), backflip: !!(snap.prevMask & 8),
    };
    sim.ammo = snap.ammo.map((a) => ({
      cluster: a[0], dynamite: a[1], airstrike: a[2], teleport: a[3],
    }));
    sim.worms = snap.worms.map((a) => Worm.deserialize(a));
    sim.projectiles = snap.projectiles.map((a) => Projectile.deserialize(a));
    sim.crates = snap.crates.map((a) => ({
      x: a[0], y: a[1], vy: a[2], falling: a[3] === 1, weapon: a[4], amount: a[5],
    }));
    // Restore mid-turn rng by re-deriving and burning consumed calls.
    if (sim.turnNumber >= 1) {
      sim._rngRaw = makeRng(hashSeed(config.seed, sim.turnNumber));
      for (let i = 0; i < snap.rngCalls; i++) sim._rngRaw();
      sim.rngCalls = snap.rngCalls;
    }
    return sim;
  }

  beginTurn(turnNumber) {
    if (this.phase === 'game-over') return;
    this.turnNumber = turnNumber;
    const nTeams = this.config.teams.length;
    this.round = Math.floor((turnNumber - 1) / nTeams) + 1;
    this._rngRaw = makeRng(hashSeed(this.config.seed, turnNumber));
    this.rngCalls = 0;

    // rng call order is part of the protocol: 1) wind, 2) crate rolls.
    this.wind = Math.round((this._rng() * 2 - 1) * 100) / 100;

    if (this.config.suddenDeathRound > 0 && this.round >= this.config.suddenDeathRound) {
      if (!this.suddenDeath) {
        this.suddenDeath = true;
        this.events.push({ type: 'suddenDeath' });
      }
      this.waterLevel += C.WATER_RISE;
      this.events.push({ type: 'waterRise', level: this.waterLevel });
    }

    if (this._rng() < C.CRATE_CHANCE) {
      const x = Math.round(60 + this._rng() * (this.config.width - 120));
      const pick = C.CRATE_TABLE[Math.floor(this._rng() * C.CRATE_TABLE.length)];
      this.crates.push({ x, y: -12, vy: 0, falling: true, weapon: pick[0], amount: pick[1] });
    }

    // Water rise may drown worms before the turn starts.
    this._drownCheck();
    this._processDeaths();
    if (this._checkGameOver()) return;

    const worm = this._nextWorm();
    if (!worm) { this._checkGameOver(); return; }
    this.activeWormId = worm.id;
    this.stamina = this.config.stamina;
    this.retreatStamina = this.config.retreatStamina;
    this.selectedWeapon = 'bazooka';
    this.power = 0;
    this.charging = false;
    this.pendingShots = 0;
    this.idleTicks = 0;
    this.endRetreat = false;
    this.retreatTicks = 0;
    this._prev = { fire: false, charge: false, jump: false, backflip: false };
    this.phase = 'move';
    this.events.push({ type: 'turnStart', wormId: this.activeWormId, wind: this.wind });
  }

  _nextWorm() {
    const nTeams = this.config.teams.length;
    for (let i = 0; i < nTeams; i++) {
      this.teamPointer = (this.teamPointer + 1) % nTeams;
      const team = this.teamPointer;
      const teamWorms = this.worms.filter((w) => w.teamIndex === team);
      if (!teamWorms.some((w) => w.alive)) continue;
      for (let k = 0; k < teamWorms.length; k++) {
        this.teamWormPointers[team] = (this.teamWormPointers[team] + 1) % teamWorms.length;
        const cand = teamWorms[this.teamWormPointers[team]];
        if (cand.alive) return cand;
      }
    }
    return null;
  }

  _wormById(id) {
    for (let i = 0; i < this.worms.length; i++) {
      if (this.worms[i].id === id) return this.worms[i];
    }
    return null;
  }

  _active() {
    return this._wormById(this.activeWormId);
  }

  step(rawInput) {
    if (this.phase === 'turn-over' || this.phase === 'game-over') return;
    const input = normalizeInput(rawInput);
    this._activeHit = false;

    if (this.phase === 'move') this._handleMove(input);
    else if (this.phase === 'retreat') this._handleRetreat(input);

    this._stepWorld();

    if ((this.phase === 'move' || this.phase === 'retreat') && this._activeHit) {
      // Classic rule: taking damage ends the turn immediately.
      this.charging = false;
      this.power = 0;
      this.pendingShots = 0;
      this.phase = 'resolving';
    }
    // Fixed retreat window: exactly RETREAT_TICKS for every weapon. Running out
    // of retreat stamina only stops movement, never the clock; firing again
    // ends the turn early by choice.
    if (this.phase === 'retreat' && this.pendingShots === 0) {
      this.retreatTicks--;
      if (this.endRetreat || this.retreatTicks <= 0) this.phase = 'resolving';
    }
    if (this.phase === 'resolving' && this._settled()) this._finishTurn();

    this._prev = {
      fire: input.fire, charge: input.charge, jump: input.jump, backflip: input.backflip,
    };
  }

  _handleMove(input) {
    const worm = this._active();
    if (!worm || !worm.alive) return;

    if (input.weapon && C.WEAPONS[input.weapon] && W.hasAmmo(this, worm.teamIndex, input.weapon)) {
      if (input.weapon !== this.selectedWeapon) {
        this.selectedWeapon = input.weapon;
        this.charging = false;
        this.power = 0;
      }
    }
    if (input.fuse) this.grenadeFuse = input.fuse;

    this._handleAim(input, worm);
    if (!this.charging) this._handleMovement(input, worm, 'stamina');

    const spec = C.WEAPONS[this.selectedWeapon];
    const fireEdge = input.fire && !this._prev.fire;
    if (spec.charged) {
      if (input.charge && !this.charging) {
        this.charging = true;
        this.power = 0;
      } else if (this.charging) {
        this.power = Math.min(1, this.power + C.DT / C.CHARGE_TIME);
        if (!input.charge || fireEdge || this.power >= 1) this._fire(this.power, input);
      }
    } else if (fireEdge) {
      this._fire(0, input);
    }
  }

  _handleRetreat(input) {
    const worm = this._active();
    if (!worm || !worm.alive) return;
    const moved = this._handleMovement(input, worm, 'retreatStamina');
    let acted = moved;
    if (this.pendingShots > 0) {
      // Mid-shotgun: aiming and the second shot are still allowed.
      this._handleAim(input, worm);
      if (input.aimUp || input.aimDown) acted = true;
      const fireEdge = input.fire && !this._prev.fire;
      if (fireEdge) {
        acted = true;
        this._fire(0, input);
      }
    } else {
      const fireEdge = input.fire && !this._prev.fire;
      if (fireEdge) this.endRetreat = true; // fire again = "done, end my turn"
    }
    if (acted) this.idleTicks = 0;
    else this.idleTicks++;
  }

  _handleAim(input, worm) {
    if (input.aimUp) {
      worm.aimAngle = Math.min(C.AIM_MAX, worm.aimAngle + C.AIM_RATE * C.DT);
    } else if (input.aimDown) {
      worm.aimAngle = Math.max(C.AIM_MIN, worm.aimAngle - C.AIM_RATE * C.DT);
    }
  }

  // Returns true if any movement input was given (for retreat idle tracking).
  _handleMovement(input, worm, staminaKey) {
    let acted = false;
    const dir = (input.left ? -1 : 0) + (input.right ? 1 : 0);
    if (dir !== 0) {
      worm.facing = dir; // turning is free
      acted = true;
      if (!worm.airborne && this[staminaKey] > 0) {
        P.walk(this.terrain, worm, dir);
        this[staminaKey] = Math.max(0, this[staminaKey] - C.WALK_DRAIN_PER_TICK);
      }
    }
    const jumpEdge = input.jump && !this._prev.jump;
    const flipEdge = input.backflip && !this._prev.backflip;
    if (jumpEdge) acted = true;
    if (flipEdge) acted = true;
    if (jumpEdge && !worm.airborne && this[staminaKey] >= C.JUMP_COST) {
      worm.vx = worm.facing * C.JUMP_VX;
      worm.vy = C.JUMP_VY;
      worm.airborne = true;
      worm.y -= 1;
      worm.walkAccum = 0;
      this[staminaKey] -= C.JUMP_COST;
    } else if (flipEdge && !worm.airborne && this[staminaKey] >= C.BACKFLIP_COST) {
      worm.vx = -worm.facing * C.BACKFLIP_VX;
      worm.vy = C.BACKFLIP_VY;
      worm.airborne = true;
      worm.y -= 1;
      worm.walkAccum = 0;
      this[staminaKey] -= C.BACKFLIP_COST;
    }
    return acted;
  }

  _fire(power, input) {
    const worm = this._active();
    const res = W.fire(this, worm, this.selectedWeapon, power, input);
    this.charging = false;
    this.power = 0;
    if (res === 'invalid') return;
    if (res === 'again') {
      this.phase = 'retreat';
      this.pendingShots = 1;
      this.idleTicks = 0;
      return;
    }
    if (res === 'end') {
      this.phase = 'resolving';
      return;
    }
    this.phase = 'retreat';
    this.pendingShots = 0;
    this.idleTicks = 0;
    this.retreatTicks = C.RETREAT_TICKS; // the clock starts at the final shot
  }

  _stepWorld() {
    this._stepCrates();

    // Projectiles: additions during iteration (cluster split) step next tick.
    const nP = this.projectiles.length;
    for (let i = 0; i < nP; i++) {
      if (!this.projectiles[i].dead) this.projectiles[i].step(this);
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);

    // Airborne worms (fixed id order).
    for (let i = 0; i < this.worms.length; i++) {
      const worm = this.worms[i];
      if (!worm.alive) continue;
      // Ground can vanish beneath a standing worm (crater, digging) — re-check
      // footing every tick so it falls instead of levitating (classic rule).
      if (!worm.airborne) {
        if (!P.grounded(this.terrain, worm)) {
          worm.airborne = true;
          worm.vx = 0;
          worm.vy = 0;
        } else {
          continue;
        }
      }
      const res = P.wormAirStep(this.terrain, worm);
      if (res.landed && res.impact > C.FALL_DMG_THRESHOLD) {
        const amount = Math.min(
          C.FALL_DMG_MAX,
          Math.floor((res.impact - C.FALL_DMG_THRESHOLD) / C.FALL_DMG_DIVISOR),
        );
        if (amount > 0) {
          this.events.push({ type: 'fallDamage', wormId: worm.id, amount });
          this._damageWorm(worm, amount, worm.x, worm.y, true);
        }
      }
    }

    this._drownCheck();
    this._processDeaths();
    this._collectCrates();
  }

  _stepCrates() {
    for (let i = 0; i < this.crates.length; i++) {
      const c = this.crates[i];
      if (!c.falling || c.dead) continue;
      c.vy += C.GRAVITY * C.DT * C.CRATE_FALL_GRAVITY_SCALE;
      let dy = c.vy * C.DT;
      while (dy > 0 && !c.dead && c.falling) {
        const step = Math.min(1, dy);
        dy -= step;
        const ny = c.y + step;
        if (ny + C.CRATE_HALF_H > this.waterLevel) {
          this.events.push({ type: 'splash', x: c.x, y: this.waterLevel });
          c.dead = true;
          break;
        }
        const fy = ny + C.CRATE_HALF_H;
        if (
          this.terrain.solid(c.x, fy) ||
          this.terrain.solid(c.x - C.CRATE_HALF_W + 1, fy) ||
          this.terrain.solid(c.x + C.CRATE_HALF_W - 1, fy)
        ) {
          c.falling = false;
          c.vy = 0;
          this.events.push({
            type: 'crateLanded', x: c.x, y: c.y,
            contents: { weapon: c.weapon, amount: c.amount },
          });
          break;
        }
        c.y = ny;
      }
    }
    this.crates = this.crates.filter((c) => !c.dead);
  }

  _collectCrates() {
    for (let i = 0; i < this.crates.length; i++) {
      const c = this.crates[i];
      if (c.falling || c.dead) continue;
      for (let k = 0; k < this.worms.length; k++) {
        const w = this.worms[k];
        if (!w.alive) continue;
        if (Math.abs(w.x - c.x) < 12 && Math.abs(w.y - c.y) < 14) {
          this.ammo[w.teamIndex][c.weapon] += c.amount;
          c.dead = true;
          this.events.push({
            type: 'crateCollected', wormId: w.id,
            contents: { weapon: c.weapon, amount: c.amount },
          });
          break;
        }
      }
    }
    this.crates = this.crates.filter((c) => !c.dead);
  }

  _damageWorm(worm, amount, x, y, silent = false) {
    worm.hp = Math.max(0, worm.hp - amount);
    if (!silent) this.events.push({ type: 'damage', wormId: worm.id, amount, x, y });
    if (worm.id === this.activeWormId && (this.phase === 'move' || this.phase === 'retreat')) {
      this._activeHit = true;
    }
  }

  _drownCheck() {
    for (let i = 0; i < this.worms.length; i++) {
      const worm = this.worms[i];
      if (!worm.alive) continue;
      if (worm.y > this.waterLevel) {
        worm.alive = false;
        worm.hp = 0;
        this.events.push({ type: 'splash', x: worm.x, y: this.waterLevel });
        this.events.push({ type: 'wormDied', wormId: worm.id, x: worm.x, y: worm.y });
        if (worm.id === this.activeWormId && (this.phase === 'move' || this.phase === 'retreat')) {
          this._activeHit = true;
        }
      }
    }
  }

  _processDeaths() {
    for (let i = 0; i < this.worms.length; i++) {
      const worm = this.worms[i];
      if (!worm.alive || worm.hp > 0) continue;
      worm.alive = false;
      this.events.push({ type: 'wormDied', wormId: worm.id, x: worm.x, y: worm.y });
      this.events.push({ type: 'wormTalk', wormId: worm.id, kind: 'grave' });
      if (worm.id === this.activeWormId && (this.phase === 'move' || this.phase === 'retreat')) {
        this._activeHit = true;
      }
    }
  }

  _settled() {
    if (this.projectiles.length > 0) return false;
    for (let i = 0; i < this.crates.length; i++) {
      if (this.crates[i].falling) return false;
    }
    for (let i = 0; i < this.worms.length; i++) {
      if (this.worms[i].alive && this.worms[i].airborne) return false;
    }
    return true;
  }

  _aliveTeams() {
    const alive = [];
    for (let t = 0; t < this.config.teams.length; t++) {
      if (this.worms.some((w) => w.teamIndex === t && w.alive)) alive.push(t);
    }
    return alive;
  }

  _checkGameOver() {
    const alive = this._aliveTeams();
    if (alive.length <= 1) {
      this.winner = alive.length === 1 ? alive[0] : 'draw';
      this.phase = 'game-over';
      return true;
    }
    return false;
  }

  _finishTurn() {
    if (!this._checkGameOver()) this.phase = 'turn-over';
  }

  get state() {
    const ammo = {};
    for (let t = 0; t < this.ammo.length; t++) {
      ammo[t] = {
        cluster: this.ammo[t].cluster,
        dynamite: this.ammo[t].dynamite,
        airstrike: this.ammo[t].airstrike,
        teleport: this.ammo[t].teleport,
      };
    }
    return {
      worms: this.worms.map((w) => ({
        id: w.id, teamIndex: w.teamIndex, name: w.name, hp: w.hp,
        x: w.x, y: w.y, vx: w.vx, vy: w.vy,
        facing: w.facing, aimAngle: w.aimAngle,
        alive: w.alive, airborne: w.airborne,
      })),
      projectiles: this.projectiles.map((p) => ({
        type: p.type, x: p.x, y: p.y, vx: p.vx, vy: p.vy,
        fuseLeft: p.fuse >= 0 ? Math.max(0, p.fuse - p.age) : null,
        resting: p.resting,
      })),
      crates: this.crates.map((c) => ({
        x: c.x, y: c.y, falling: c.falling,
        contents: { weapon: c.weapon, amount: c.amount },
      })),
      wind: this.wind,
      waterLevel: this.waterLevel,
      turnNumber: this.turnNumber,
      round: this.round,
      activeWormId: this.activeWormId,
      stamina: this.stamina,
      retreatStamina: this.retreatStamina,
      retreatTicks: this.retreatTicks,
      selectedWeapon: this.selectedWeapon,
      grenadeFuse: this.grenadeFuse,
      ammo,
      power: this.power,
      suddenDeath: this.suddenDeath,
    };
  }

  snapshot() {
    const prevMask =
      (this._prev.fire ? 1 : 0) | (this._prev.charge ? 2 : 0) |
      (this._prev.jump ? 4 : 0) | (this._prev.backflip ? 8 : 0);
    return {
      v: 1,
      turnNumber: this.turnNumber,
      round: this.round,
      waterLevel: this.waterLevel,
      suddenDeath: this.suddenDeath ? 1 : 0,
      phase: this.phase,
      winner: this.winner,
      wind: this.wind,
      activeWormId: this.activeWormId,
      stamina: this.stamina,
      retreatStamina: this.retreatStamina,
      selectedWeapon: this.selectedWeapon,
      grenadeFuse: this.grenadeFuse,
      power: this.power,
      charging: this.charging ? 1 : 0,
      pendingShots: this.pendingShots,
      retreatTicks: this.retreatTicks,
      idleTicks: this.idleTicks,
      endRetreat: this.endRetreat ? 1 : 0,
      rngCalls: this.rngCalls,
      teamPointer: this.teamPointer,
      teamWormPointers: this.teamWormPointers.slice(),
      prevMask,
      ammo: this.ammo.map((a) => [a.cluster, a.dynamite, a.airstrike, a.teleport]),
      worms: this.worms.map((w) => w.serialize()),
      projectiles: this.projectiles.map((p) => p.serialize()),
      crates: this.crates.map((c) => [c.x, c.y, c.vy, c.falling ? 1 : 0, c.weapon, c.amount]),
      terrain: this.terrain.serialize(),
    };
  }

  stateHash() {
    return hashString(JSON.stringify(this.snapshot()));
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }
}
