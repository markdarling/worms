// The deterministic game simulation. Contract: docs/ARCHITECTURE.md (ENGINE track).
//
// Phases: 'move' -> 'retreat' -> 'resolving' -> 'turn-over' | 'game-over'.
// The sim decides all transitions; the caller just steps and reads `phase`.
//
// Determinism: all per-turn randomness comes from makeRng(hashSeed(seed, turn))
// created in beginTurn(). The rng call count is tracked so fromSnapshot() can
// restore mid-turn rng state exactly. No Math.random, no Date, no key-order
// dependent iteration in anything that touches state.
//
// ---------------------------------------------------------------------------
// EVENTS (renderer contract) — each {type, ...}, emitted exactly once:
//   explosion {x, y, r, strength}       damage {wormId, amount, x, y}
//   wormDied {wormId, x, y}             splash {x, y}
//   fire {weapon, x, y, angle, power}   bounce {x, y}
//   crateLanded {x, y, contents}        crateCollected {wormId, contents}
//   fallDamage {wormId, amount}         turnStart {wormId, wind}
//   suddenDeath {}                      waterRise {level}
//   wormTalk {wormId, kind}             (kind: 'ohno'|'laugh'|'grave')
// Arsenal expansion (19/08/2026):
//   fireStarted {x, y}                  flameOut {x, y}
//   mineArmed {x, y}                    mineTriggered {x, y}
//   sheepBaa {x, y}                     earthquake {}
//   donkeyStomp {x, y}                  meteor {x, y}
//   arrowStuck {x, y, angle}            girderPlaced {x, y, angle}
// Note: hitscan bursts (handgun/uzi/minigun) emit one 'fire' event per bullet;
// small bullet bites reuse 'explosion' with strength 0.2.
// ---------------------------------------------------------------------------

import { makeRng, hashSeed, hashString } from './rng.js';
import { C, AMMO_IDS } from './constants.js';
import { Terrain } from './terrain.js';
import { normalizeInput } from './commands.js';
import { Worm } from './worm.js';
import * as P from './physics.js';
import { Projectile } from './projectiles.js';
import * as W from './weapons.js';
import { Flame, stepFlames, decayFlames } from './fire.js';
import { Mine, deserializeWalker } from './walkers.js';

// The mapgen track owns engine/placement.js (expansion contract). Wire it in
// when it exists; fall back to the classic spawn scatter until it lands.
let generateWorld = null;
try {
  const placement = await import('./placement.js');
  generateWorld = placement.generateWorld || null;
} catch {
  generateWorld = null;
}

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

function defaultAmmo() {
  const a = {};
  for (let i = 0; i < AMMO_IDS.length; i++) {
    a[AMMO_IDS[i]] = C.WEAPONS[AMMO_IDS[i]].ammo;
  }
  return a;
}

export class Sim {
  constructor(config, terrain) {
    this.config = config;
    this.terrain = terrain;
    this.worms = [];
    this.projectiles = [];
    this.crates = []; // {x, y, vx, vy, falling, weapon, amount}
    this.flames = []; // fire.js Flame entities — persist across turns
    this.mines = [];  // walkers.js Mine entities — persist across turns
    this.walkers = []; // walkers.js Sheep/Donkey entities
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
    this.grenadeFuse = 3; // 1-5 grenade timer; doubles as girder angle 1-8
    this.power = 0;
    this.charging = false;
    this.pendingShots = 0; // >0 = shotgun/longbow second shot still owed
    this.idleTicks = 0;
    this.endRetreat = false;
    this.retreatTicks = 0;
    this.teamPointer = -1;
    this.teamWormPointers = config.teams.map(() => -1);
    this.ammo = config.teams.map(() => defaultAmmo());
    // Arsenal subsystems (all snapshot v2 state):
    this.burst = null;       // {weapon, left, tick} — hitscan burst in progress
    this.flamer = null;      // {left, tick} — flamethrower stream in progress
    this.carve = null;       // {kind:'torch'|'drill', dirx, diry, ticksLeft, tick, ledger}
    this.kami = null;        // {dirx, diry, ticksLeft, hit[]}
    this.quakeTicks = 0;     // earthquake remaining ticks
    this.chuteOpen = false;  // active worm parachute state
    this.pendingTarget = null; // last {x,y} click this move phase
    this.mineCounter = 0;    // feeds the WA 6-slot dud pool
    this.entitySeq = 0;      // monotonic entity ids (flames/mines/walkers)
    this.fireLedger = [];    // per-worm fire damage this turn (id-indexed)
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
    let terrain;
    let spots = null;
    if (generateWorld) {
      const world = generateWorld(config.seed, config.width, config.height, config.teams);
      terrain = world.terrain;
      spots = world.spots; // worm-id order, reachability + interleave guaranteed
    } else {
      terrain = Terrain.generate(config.seed, config.width, config.height);
    }
    const sim = new Sim(config, terrain);
    sim.fireLedger = [];

    let id = 0;
    if (spots) {
      for (let t = 0; t < config.teams.length; t++) {
        const names = config.teams[t].worms;
        for (let k = 0; k < names.length; k++) {
          const spot = spots[id];
          sim.worms.push(new Worm({
            id, teamIndex: t, name: names[k], x: spot.x, y: spot.y, hp: config.wormHp,
          }));
          id++;
        }
      }
    } else {
      const found = P.findSpawnSpots(terrain, sim.waterLevel);
      const total = config.teams.reduce((n, t) => n + t.worms.length, 0);
      if (found.length < total) throw new Error('terrain generated too few spawn spots');
      const rng = makeRng(hashSeed(config.seed, 0x51ed));
      // Evenly spread picks across the (left-to-right) spot list, then shuffle
      // the assignment so teams aren't sorted spatially.
      const chosen = [];
      for (let i = 0; i < total; i++) {
        let idx = Math.floor(((i + 0.15 + rng() * 0.7) * found.length) / total);
        if (idx >= found.length) idx = found.length - 1;
        chosen.push(found[idx]);
      }
      for (let i = chosen.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = chosen[i];
        chosen[i] = chosen[j];
        chosen[j] = tmp;
      }
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
    }
    sim.fireLedger = sim.worms.map(() => 0);
    return sim;
  }

  static fromSnapshot(rawConfig, snap) {
    const config = mergeConfig(rawConfig);
    const terrain = Terrain.deserialize(snap.terrain);
    const sim = new Sim(config, terrain);
    const v = snap.v || 1;
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
    if (v === 1) {
      // v1 snapshots carried only the four original limited weapons.
      sim.ammo = snap.ammo.map((a) => {
        const full = defaultAmmo();
        full.cluster = a[0];
        full.dynamite = a[1];
        full.airstrike = a[2];
        full.teleport = a[3];
        return full;
      });
    } else {
      sim.ammo = snap.ammo.map((a) => {
        const full = {};
        for (let i = 0; i < AMMO_IDS.length; i++) full[AMMO_IDS[i]] = a[i];
        return full;
      });
    }
    sim.worms = snap.worms.map((a) => Worm.deserialize(a));
    sim.projectiles = snap.projectiles.map((a) => Projectile.deserialize(a));
    sim.crates = snap.crates.map((a) => ({
      x: a[0], y: a[1], vy: a[2], falling: a[3] === 1, weapon: a[4], amount: a[5],
      vx: a[6] || 0,
    }));
    // v2 arsenal state (v1 snapshots have none of it):
    sim.flames = (snap.flames || []).map((a) => Flame.deserialize(a));
    sim.mines = (snap.mines || []).map((a) => Mine.deserialize(a));
    sim.walkers = (snap.walkers || []).map((a) => deserializeWalker(a));
    sim.burst = snap.burst ? { weapon: snap.burst[0], left: snap.burst[1], tick: snap.burst[2] } : null;
    sim.flamer = snap.flamer ? { left: snap.flamer[0], tick: snap.flamer[1] } : null;
    sim.carve = snap.carve ? {
      kind: snap.carve[0], dirx: snap.carve[1], diry: snap.carve[2],
      ticksLeft: snap.carve[3], tick: snap.carve[4],
      ledger: snap.carve[5].map((p) => p.slice()),
    } : null;
    sim.kami = snap.kami ? {
      dirx: snap.kami[0], diry: snap.kami[1], ticksLeft: snap.kami[2],
      hit: snap.kami[3].slice(),
    } : null;
    sim.quakeTicks = snap.quakeTicks || 0;
    sim.chuteOpen = snap.chuteOpen === 1;
    sim.pendingTarget = snap.pendingTarget ? { x: snap.pendingTarget[0], y: snap.pendingTarget[1] } : null;
    sim.mineCounter = snap.mineCounter || 0;
    sim.entitySeq = snap.entitySeq || 0;
    sim.fireLedger = snap.fireLedger ? snap.fireLedger.slice() : sim.worms.map(() => 0);
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

    // Flames shrink at every turn boundary (no rng consumed).
    decayFlames(this);
    this.fireLedger = this.worms.map(() => 0);

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
      this.crates.push({ x, y: -12, vx: 0, vy: 0, falling: true, weapon: pick[0], amount: pick[1] });
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
    this.burst = null;
    this.flamer = null;
    this.carve = null;
    this.kami = null;
    this.quakeTicks = 0;
    this.chuteOpen = false;
    this.pendingTarget = null;
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

  _ownSheep() {
    for (let i = 0; i < this.walkers.length; i++) {
      const w = this.walkers[i];
      if (!w.dead && w.kind === 'sheep' && w.owner === this.activeWormId) return w;
    }
    return null;
  }

  // Attack still unfolding under player agency? Retreat clock waits for it.
  _busy() {
    return this.pendingShots > 0 || !!this.burst || !!this.flamer ||
      !!this.carve || !!this._ownSheep();
  }

  step(rawInput) {
    if (this.phase === 'turn-over' || this.phase === 'game-over') return;
    const input = normalizeInput(rawInput);
    this._activeHit = false;

    if (this.phase === 'move') this._handleMove(input);
    else if (this.phase === 'retreat') this._handleRetreat(input);

    this._stepWorld();

    if ((this.phase === 'move' || this.phase === 'retreat') && this._activeHit) {
      // Classic rule: taking damage ends the turn immediately — and stops any
      // attack still in progress (flamethrower self-hit, mid-burst hits...).
      this.charging = false;
      this.power = 0;
      this.pendingShots = 0;
      this.burst = null;
      this.flamer = null;
      this.carve = null;
      this.phase = 'resolving';
    }
    // Fixed retreat window: exactly RETREAT_TICKS for every weapon. Running out
    // of retreat stamina only stops movement, never the clock; firing again
    // ends the turn early by choice. The clock waits while the attack is still
    // unfolding (second shot owed, burst/stream/carve running, sheep walking).
    if (this.phase === 'retreat' && !this._busy()) {
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
    if (input.target) this.pendingTarget = { x: input.target.x, y: input.target.y };

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

    if (this.carve) {
      // Digging: locked in, but Space cancels the dig.
      const fireEdge = input.fire && !this._prev.fire;
      if (fireEdge) this.carve = null;
      this.idleTicks = 0;
      return;
    }
    if (this.burst || this.flamer) {
      // Mid-burst/stream: no movement, but aim stays LIVE (classic re-aim).
      this._handleAim(input, worm);
      this.idleTicks = 0;
      return;
    }

    const moved = this._handleMovement(input, worm, 'retreatStamina');
    let acted = moved;
    if (this.pendingShots > 0) {
      // Mid-shotgun/longbow: aiming and the next shot are still allowed.
      this._handleAim(input, worm);
      if (input.aimUp || input.aimDown) acted = true;
      const fireEdge = input.fire && !this._prev.fire;
      if (fireEdge) {
        acted = true;
        this._fire(0, input);
      }
    } else {
      const fireEdge = input.fire && !this._prev.fire;
      if (fireEdge) {
        const sheep = this._ownSheep();
        if (sheep) sheep.explodeNext = true; // second press detonates the sheep
        else this.endRetreat = true; // fire again = "done, end my turn"
      }
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
      if (this.chuteOpen && worm.airborne && worm.id === this.activeWormId) {
        // Parachute lean: steer the drift.
        const ps = C.WEAPONS.parachute;
        worm.vx = Math.max(-ps.steer, Math.min(ps.steer, worm.vx + dir * ps.steer * 4 * C.DT));
      } else if (!worm.airborne && this[staminaKey] > 0) {
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
    if (res === 'utility') return; // parachute / selectworm: turn continues
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

    // Active-worm attack systems, fixed order (rng protocol):
    W.stepBurst(this);
    W.stepFlamer(this);
    W.stepCarve(this);
    W.stepKami(this);
    W.stepQuake(this);

    // Projectiles: additions during iteration (cluster split) step next tick.
    const nP = this.projectiles.length;
    for (let i = 0; i < nP; i++) {
      if (!this.projectiles[i].dead) this.projectiles[i].step(this);
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);

    // Mines, then walkers, then flames (all fixed spawn order).
    const nM = this.mines.length;
    for (let i = 0; i < nM; i++) {
      if (!this.mines[i].dead) this.mines[i].step(this);
    }
    this.mines = this.mines.filter((m) => !m.dead);

    const nW = this.walkers.length;
    for (let i = 0; i < nW; i++) {
      if (!this.walkers[i].dead) this.walkers[i].step(this);
    }
    this.walkers = this.walkers.filter((w) => !w.dead);

    stepFlames(this);

    // Airborne worms (fixed id order).
    for (let i = 0; i < this.worms.length; i++) {
      const worm = this.worms[i];
      if (!worm.alive) continue;
      // The carve/kamikaze systems own the active worm's position.
      if ((this.carve || this.kami) && worm.id === this.activeWormId) continue;
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
      const isActive = worm.id === this.activeWormId;
      // Parachute: auto-deploys before a damaging fall when selected.
      if (isActive && !this.chuteOpen && this.selectedWeapon === 'parachute' &&
          (this.phase === 'move' || this.phase === 'retreat') &&
          worm.vy > C.WEAPONS.parachute.autoDeployVy &&
          W.hasAmmo(this, worm.teamIndex, 'parachute')) {
        this.ammo[worm.teamIndex].parachute--;
        this.chuteOpen = true;
        this.events.push({ type: 'fire', weapon: 'parachute', x: worm.x, y: worm.y, angle: 0, power: 0 });
      }
      const chuting = isActive && this.chuteOpen;
      if (chuting) {
        // Slow drift: clamp fall speed, wind pushes the canopy (bounded so a
        // long descent can't accelerate the worm off the map).
        const ps = C.WEAPONS.parachute;
        worm.vx += this.wind * ps.windAccel * C.DT;
        if (worm.vx > ps.steer) worm.vx = ps.steer;
        else if (worm.vx < -ps.steer) worm.vx = -ps.steer;
        // Pre-compensate the gravity wormAirStep is about to add.
        const cap = ps.fallSpeed - C.GRAVITY * C.DT;
        if (worm.vy > cap) worm.vy = cap;
      }
      const res = P.wormAirStep(this.terrain, worm);
      if (res.landed && chuting) {
        this.chuteOpen = false; // soft landing, no fall damage
      } else if (res.landed && res.impact > C.FALL_DMG_THRESHOLD) {
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
      // Horizontal shove (earthquake is the only source).
      if (c.vx) {
        const dx = c.vx * C.DT;
        const nx = c.x + dx;
        if (nx > C.CRATE_HALF_W && nx < this.config.width - C.CRATE_HALF_W &&
            !this.terrain.solid(nx + Math.sign(dx) * C.CRATE_HALF_W, c.y)) {
          c.x = nx;
        } else {
          c.vx = 0;
        }
      }
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
          c.vx = 0;
          c.vy = 0;
          this.events.push({
            type: 'crateLanded', x: c.x, y: c.y,
            contents: { weapon: c.weapon, amount: c.amount },
          });
          break;
        }
        c.y = ny;
      }
      // Tossed upward by a quake: rise, then fall again.
      if (c.falling && !c.dead && c.vy < 0) {
        const ny = c.y + c.vy * C.DT;
        if (!this.terrain.solid(c.x, ny - C.CRATE_HALF_H)) c.y = ny;
        else c.vy = 0;
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
    if (this.burst || this.flamer || this.carve || this.kami) return false;
    if (this.quakeTicks > 0) return false;
    for (let i = 0; i < this.walkers.length; i++) {
      if (!this.walkers[i].dead) return false; // sheep walking / donkey falling
    }
    for (let i = 0; i < this.mines.length; i++) {
      const m = this.mines[i];
      // A moving or fizzing mine blocks turn end; a resting armed mine doesn't.
      if (!m.dead && (!m.resting || m.state === 'triggered')) return false;
    }
    for (let i = 0; i < this.flames.length; i++) {
      // CRITICAL: resting flames count as settled — standing fires never
      // block turn end; only flames still in motion do.
      if (!this.flames[i].resting) return false;
    }
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
      ammo[t] = {};
      for (let i = 0; i < AMMO_IDS.length; i++) {
        ammo[t][AMMO_IDS[i]] = this.ammo[t][AMMO_IDS[i]];
      }
    }
    return {
      worms: this.worms.map((w) => ({
        id: w.id, teamIndex: w.teamIndex, name: w.name, hp: w.hp,
        x: w.x, y: w.y, vx: w.vx, vy: w.vy,
        facing: w.facing, aimAngle: w.aimAngle,
        alive: w.alive, airborne: w.airborne,
        parachute: this.chuteOpen && w.id === this.activeWormId,
      })),
      projectiles: this.projectiles
        .filter((p) => p.delay === 0) // scheduled meteors aren't in the world yet
        .map((p) => ({
          type: p.type, x: p.x, y: p.y, vx: p.vx, vy: p.vy,
          fuseLeft: p.fuse >= 0 ? Math.max(0, p.fuse - p.age) : null,
          resting: p.resting,
          // homing extras for the renderer (target marker + sprite swap):
          homingActive: p.type === 'homing' &&
            p.age >= C.WEAPONS.homing.lockTick && p.age < C.WEAPONS.homing.homingTicks,
          target: p.type === 'homing' ? { x: p.tx, y: p.ty } : null,
          primed: p.primed > 0, // holy grenade: the silence beat
        })),
      flames: this.flames.map((f) => ({
        x: f.x, y: f.y, resting: f.resting, turnsLeft: f.turnsLeft,
      })),
      mines: this.mines.map((m) => ({
        x: m.x, y: m.y, state: m.state, timer: m.timer,
      })),
      walkers: this.walkers.map((w) => ({
        kind: w.kind, x: w.x, y: w.y,
        dir: w.kind === 'sheep' ? w.dir : 0,
        airborne: w.kind === 'sheep' ? w.airborne : true,
      })),
      burst: this.burst ? { weapon: this.burst.weapon, left: this.burst.left } : null,
      flamer: this.flamer ? { left: this.flamer.left } : null,
      carve: this.carve ? { kind: this.carve.kind } : null,
      kamikaze: !!this.kami,
      quake: this.quakeTicks > 0,
      parachuteOpen: this.chuteOpen,
      pendingTarget: this.pendingTarget ? { x: this.pendingTarget.x, y: this.pendingTarget.y } : null,
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
      v: 2,
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
      ammo: this.ammo.map((a) => AMMO_IDS.map((id) => a[id])),
      worms: this.worms.map((w) => w.serialize()),
      projectiles: this.projectiles.map((p) => p.serialize()),
      crates: this.crates.map((c) => [c.x, c.y, c.vy, c.falling ? 1 : 0, c.weapon, c.amount, c.vx || 0]),
      flames: this.flames.map((f) => f.serialize()),
      mines: this.mines.map((m) => m.serialize()),
      walkers: this.walkers.map((w) => w.serialize()),
      burst: this.burst ? [this.burst.weapon, this.burst.left, this.burst.tick] : 0,
      flamer: this.flamer ? [this.flamer.left, this.flamer.tick] : 0,
      carve: this.carve ? [
        this.carve.kind, this.carve.dirx, this.carve.diry,
        this.carve.ticksLeft, this.carve.tick,
        this.carve.ledger.map((p) => p.slice()),
      ] : 0,
      kami: this.kami ? [this.kami.dirx, this.kami.diry, this.kami.ticksLeft, this.kami.hit.slice()] : 0,
      quakeTicks: this.quakeTicks,
      chuteOpen: this.chuteOpen ? 1 : 0,
      pendingTarget: this.pendingTarget ? [this.pendingTarget.x, this.pendingTarget.y] : 0,
      mineCounter: this.mineCounter,
      entitySeq: this.entitySeq,
      fireLedger: this.fireLedger.slice(),
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
