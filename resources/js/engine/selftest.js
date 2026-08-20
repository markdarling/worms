// Engine self-test. Run: node resources/js/engine/selftest.js
// Definition of done for the ENGINE track — every assertion must pass.

import { Terrain } from './terrain.js';
import { Sim } from './sim.js';
import { C } from './constants.js';
import { encodeCommands, decodeCommands, normalizeInput } from './commands.js';
import { Flame } from './fire.js';
import { mineDudRoll, Drum } from './walkers.js';
import * as P from './physics.js';

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
  }
}

function section(name) {
  console.log(`\n[${name}]`);
}

function ticks(n, o = {}) {
  return Array.from({ length: n }, () => ({ ...o }));
}

const MAX_TURN_TICKS = 60 * 120;

// Runs one full turn: beginTurn, scripted inputs, then idle until turn resolves.
function runTurn(sim, turnNumber, inputs) {
  sim.beginTurn(turnNumber);
  const events = [];
  for (let i = 0; i < inputs.length; i++) {
    if (sim.phase === 'turn-over' || sim.phase === 'game-over') break;
    sim.step(inputs[i]);
    events.push(...sim.drainEvents());
  }
  let guard = 0;
  while (sim.phase !== 'turn-over' && sim.phase !== 'game-over') {
    sim.step({});
    events.push(...sim.drainEvents());
    if (++guard > MAX_TURN_TICKS) throw new Error(`turn ${turnNumber} never resolved`);
  }
  return events;
}

// Continue an already-begun turn: scripted inputs then idle to resolution.
function collect(sim, inputs) {
  const evs = [];
  for (const i of inputs) {
    if (sim.phase === 'turn-over' || sim.phase === 'game-over') break;
    sim.step(i);
    evs.push(...sim.drainEvents());
  }
  let g = 0;
  while (sim.phase !== 'turn-over' && sim.phase !== 'game-over') {
    sim.step({});
    evs.push(...sim.drainEvents());
    if (++g > MAX_TURN_TICKS) throw new Error('never settled');
  }
  return evs;
}

const baseConfig = {
  seed: 123456789,
  teams: [
    { name: 'Reds', color: '#e33', worms: ['Alpha', 'Bravo', 'Charlie', 'Delta'] },
    { name: 'Blues', color: '#36e', worms: ['Echo', 'Foxtrot', 'Golf', 'Hotel'] },
  ],
};

// Controlled world: flat slab at y=500, worms at known spots. Immune to mapgen
// changes — used for all behaviour spot checks.
const flatConfig = {
  seed: 42,
  suddenDeathRound: 99,
  teams: [
    { name: 'A', color: '#e33', worms: ['A1', 'A2'] },
    { name: 'B', color: '#36e', worms: ['B1', 'B2'] },
  ],
};
function flatSim(extra = {}) {
  const sim = Sim.newGame({ ...flatConfig, ...extra });
  const flat = new Terrain(2400, 900);
  for (let y = 500; y < 840; y++) for (let x = 0; x < 2400; x++) flat.data[y * 2400 + x] = 1;
  sim.terrain = flat;
  // Hazards (rules >= 2) were placed on the generated terrain we just threw
  // away — clear them so behaviour tests stay controlled.
  sim.mines = [];
  sim.drums = [];
  const xs = [300, 700, 1100, 1500]; // ids 0,1 = team A; 2,3 = team B
  sim.worms.forEach((w, i) => {
    w.x = xs[i]; w.y = 494; w.airborne = false; w.facing = 1; w.aimAngle = 0;
  });
  return sim;
}

// ---------------------------------------------------------------- (a) terrain
section('a. terrain generation');
for (const seed of [1, 424242, 987654321]) {
  const t = Terrain.generate(seed, 2400, 900);
  let solidCount = 0;
  for (let i = 0; i < t.data.length; i++) solidCount += t.data[i];
  const frac = solidCount / t.data.length;
  assert(frac > 0.15 && frac < 0.7, `seed ${seed}: solid fraction ${(frac * 100).toFixed(1)}% in (15%, 70%)`);
  const spots = P.findSpawnSpots(t, 840);
  assert(spots.length >= 16, `seed ${seed}: standable surface (${spots.length} spawn spots)`);
  const aboveWater = spots.every((s) => s.y < 840);
  assert(aboveWater, `seed ${seed}: all spawn spots above water`);
}

// ------------------------------------------------- (b) terrain serialization
section('b. terrain serialize round-trip');
{
  const t = Terrain.generate(77, 2400, 900);
  t.destroy(1200, 400, 38); // include some craters
  t.destroy(600, 500, 50);
  const ser = t.serialize();
  const t2 = Terrain.deserialize(ser);
  let identical = t.width === t2.width && t.height === t2.height && t.data.length === t2.data.length;
  if (identical) {
    for (let i = 0; i < t.data.length; i++) {
      if (t.data[i] !== t2.data[i]) { identical = false; break; }
    }
  }
  assert(identical, 'deserialize(serialize(t)) is bit-identical');
  const ser2 = t2.serialize();
  assert(ser.data === ser2.data, 're-serialize produces identical string');
  assert(typeof ser.data === 'string', 'serialized payload is a base64 string');
}

// --------------------------------------------------------------- (c) newGame
section('c. Sim.newGame placement');
{
  const sim = Sim.newGame(baseConfig);
  assert(sim.worms.length === 8, 'all 8 worms created');
  assert(sim.worms.every((w) => w.alive), 'all worms alive');
  assert(sim.worms.every((w) => w.y < sim.waterLevel), 'all worms above water');
  assert(sim.worms.every((w) => P.grounded(sim.terrain, w)), 'all worms standing on solid ground');
  assert(sim.worms.every((w) => !P.bodyCollides(sim.terrain, w.x, w.y)), 'no worm embedded in terrain');
}

// ----------------------------------------------------------- (d) determinism
section('d. determinism across runs');
{
  const turn1 = [
    ...ticks(30, { right: true }),
    ...ticks(35, { aimUp: true }),
    ...ticks(50, { charge: true }),
    ...ticks(1, {}), // release -> bazooka fires
  ];
  const turn2 = [
    ...ticks(1, { weapon: 'grenade', fuse: 2 }),
    ...ticks(20, { left: true }),
    ...ticks(25, { aimUp: true }),
    ...ticks(40, { charge: true }),
    ...ticks(1, {}), // release -> grenade fires
  ];
  const turn3 = [
    ...ticks(10, { right: true }),
    ...ticks(1, { jump: true }),
    ...ticks(60, {}),
    ...ticks(30, { charge: true }),
    ...ticks(1, {}), // bazooka again
  ];
  const scripts = [turn1, turn2, turn3];

  const simA = Sim.newGame(baseConfig);
  const simB = Sim.newGame(baseConfig);
  assert(simA.stateHash() === simB.stateHash(), 'fresh games hash identically');

  let allEqual = true;
  let firedSomething = false;
  for (let n = 1; n <= scripts.length; n++) {
    const evA = runTurn(simA, n, scripts[n - 1]);
    runTurn(simB, n, scripts[n - 1]);
    if (simA.stateHash() !== simB.stateHash()) { allEqual = false; break; }
    if (evA.some((e) => e.type === 'fire')) firedSomething = true;
  }
  assert(allEqual, 'identical command streams -> identical stateHash after each turn');
  assert(firedSomething, 'scripted turns actually fired weapons');
  assert(simA.terrain.version > 0, 'terrain was destroyed during scripted turns (explosions landed)');
}

// -------------------------------------------------- (e) snapshot round-trip
section('e. snapshot round-trip');
{
  const sim = Sim.newGame(baseConfig);
  runTurn(sim, 1, [...ticks(25, { right: true }), ...ticks(45, { charge: true }), ...ticks(1, {})]);
  const snap = sim.snapshot();
  assert(snap.v === 2, 'snapshot version is 2');
  const sim2 = Sim.fromSnapshot(baseConfig, snap);
  assert(sim.stateHash() === sim2.stateHash(), 'fromSnapshot(snapshot()) -> equal stateHash');

  // Deeper: both continue with identical commands and stay in lockstep.
  const t2script = [...ticks(1, { weapon: 'grenade', fuse: 3 }), ...ticks(30, { charge: true }), ...ticks(1, {})];
  runTurn(sim, 2, t2script);
  runTurn(sim2, 2, t2script);
  assert(sim.stateHash() === sim2.stateHash(), 'restored sim stays in lockstep for the next turn');

  // Mid-turn snapshot (worm mid-walk, charging) must also round-trip.
  const sim3 = Sim.newGame(baseConfig);
  sim3.beginTurn(1);
  for (const inp of [...ticks(17, { right: true }), ...ticks(9, { charge: true })]) sim3.step(inp);
  const sim4 = Sim.fromSnapshot(baseConfig, sim3.snapshot());
  assert(sim3.stateHash() === sim4.stateHash(), 'mid-turn snapshot round-trips');
  for (const inp of ticks(20, { charge: true })) { sim3.step(inp); sim4.step(inp); }
  let guard = 0;
  while (sim3.phase !== 'turn-over' && sim3.phase !== 'game-over') {
    sim3.step({}); sim4.step({});
    if (++guard > MAX_TURN_TICKS) throw new Error('mid-turn continuation never resolved');
  }
  assert(sim3.stateHash() === sim4.stateHash(), 'mid-turn restored sim finishes the turn in lockstep');

  // v1 snapshots (pre-arsenal) must still load: old 4-slot ammo + defaults.
  const v1 = JSON.parse(JSON.stringify(sim.snapshot()));
  v1.v = 1;
  v1.ammo = v1.ammo.map((a) => a.slice(0, 4));
  delete v1.flames; delete v1.mines; delete v1.walkers;
  delete v1.burst; delete v1.flamer; delete v1.carve; delete v1.kami;
  delete v1.quakeTicks; delete v1.chuteOpen; delete v1.pendingTarget;
  delete v1.mineCounter; delete v1.entitySeq; delete v1.fireLedger;
  v1.crates = v1.crates.map((c) => c.slice(0, 6));
  v1.projectiles = v1.projectiles.map((p) => p.slice(0, 10));
  const simV1 = Sim.fromSnapshot(baseConfig, v1);
  assert(simV1.ammo[0].cluster === sim.ammo[0].cluster, 'v1 read: original ammo preserved');
  assert(simV1.ammo[0].banana === C.WEAPONS.banana.ammo, 'v1 read: new weapons get default ammo');
  assert(simV1.flames.length === 0 && simV1.mines.length === 0, 'v1 read: arsenal state defaults empty');
}

// ------------------------------------------------------------- (f) commands
section('f. commands encode/decode');
{
  const stream = [
    {}, {}, {},
    { left: true }, { left: true }, { left: true },
    { left: true, jump: true },
    { aimUp: true, charge: true },
    { aimUp: true, charge: true },
    { weapon: 'grenade', fuse: 4 },
    { fire: true },
    { weapon: 'teleport' },
    { fire: true, target: { x: 123.5, y: 456.25 } },
    { fire: true, target: { x: 123.5, y: 456.25 } },
    { weapon: 'girder', fuse: 8 }, // expansion: girder angles use fuse 1..8
    { fire: true, target: { x: 800, y: 300 } },
    {},
  ];
  const normalized = stream.map(normalizeInput);
  const enc = encodeCommands(stream);
  const dec = decodeCommands(enc);
  assert(dec.length === stream.length, 'decoded length matches');
  assert(JSON.stringify(dec) === JSON.stringify(normalized), 'round-trip lossless vs normalized inputs');
  assert(normalized[14].fuse === 8, 'fuse range extends to 8 (girder angles)');
  assert(enc.runs.length < stream.length, `RLE compresses runs (${enc.runs.length} runs for ${stream.length} ticks)`);
  const enc2 = encodeCommands(dec);
  assert(JSON.stringify(enc) === JSON.stringify(enc2), 're-encode is stable');
  assert(JSON.stringify(JSON.parse(JSON.stringify(enc))) === JSON.stringify(enc), 'encoded form is JSON-able');
}

// ---------------------------------------------------------- (g) full game
section('g. scripted game reaches game-over');
{
  const tinyConfig = {
    seed: 555,
    wormHp: 30,
    suddenDeathRound: 99,
    teams: [
      { name: 'A', color: '#e33', worms: ['Solo'] },
      { name: 'B', color: '#36e', worms: ['Duo'] },
    ],
  };
  const sim = Sim.newGame(tinyConfig);
  // Team A's worm places dynamite at its own feet and doesn't retreat.
  // 75 dmg > 30 hp: guaranteed deterministic self-destruct -> B wins.
  const script = [
    ...ticks(1, { weapon: 'dynamite' }),
    ...ticks(1, { fire: true }),
  ];
  let turns = 0;
  runTurn(sim, 1, script);
  turns++;
  while (sim.phase !== 'game-over' && turns < 10) {
    turns++;
    runTurn(sim, turns, script); // whoever is up does the same silly thing
  }
  assert(sim.phase === 'game-over', `game over reached in ${turns} turn(s)`);
  assert(sim.winner === 1, `winner is team 1 (got ${JSON.stringify(sim.winner)})`);
  const a = sim.worms.find((w) => w.teamIndex === 0);
  assert(!a.alive, 'team 0 worm died to its own dynamite');
}

// ---------------------------------------- (h) wind / crate derivation stable
section('h. wind & crate derivation stable');
{
  const simA = Sim.newGame(baseConfig);
  const simB = Sim.newGame(baseConfig);
  let windsEqual = true;
  let cratesEqual = true;
  let sawCrate = false;
  const winds = [];
  for (let n = 1; n <= 12; n++) {
    // Play minimal turns (skip) so beginTurn's derivations run in real flow.
    runTurn(simA, n, [{ weapon: 'skip' }, { fire: true }]);
    runTurn(simB, n, [{ weapon: 'skip' }, { fire: true }]);
    if (simA.wind !== simB.wind) windsEqual = false;
    winds.push(simA.wind);
    const ca = JSON.stringify(simA.crates.map((c) => [c.x, c.weapon, c.amount]));
    const cb = JSON.stringify(simB.crates.map((c) => [c.x, c.weapon, c.amount]));
    if (ca !== cb) cratesEqual = false;
    if (simA.crates.length > 0) sawCrate = true;
    if (simA.phase === 'game-over') break;
  }
  assert(windsEqual, 'wind identical across sims for 12 turns');
  assert(cratesEqual, 'crate drops identical across sims');
  assert(winds.some((w) => w !== winds[0]), 'wind actually varies between turns');
  console.log(`        winds: ${winds.join(', ')}${sawCrate ? '  (crates dropped)' : '  (no crates this seed)'}`);
  assert(simA.stateHash() === simB.stateHash(), 'hashes equal after 12 skip turns');
}

// -------------------------------------- (i) behaviour spot checks (the feel)
section('i. gameplay behaviour spot checks');
{
  const cfg = {
    seed: 2024,
    teams: [
      { name: 'A', color: '#e33', worms: ['A1', 'A2'] },
      { name: 'B', color: '#36e', worms: ['B1', 'B2'] },
    ],
  };

  // Grenade: bounces then explodes on fuse
  {
    const sim = Sim.newGame(cfg);
    sim.beginTurn(1);
    sim.drainEvents();
    const evs = collect(sim, [{ weapon: 'grenade', fuse: 3 }, ...ticks(45, { charge: true }), {}]);
    assert(evs.some((e) => e.type === 'bounce'), 'grenade bounces');
    assert(evs.filter((e) => e.type === 'explosion').length === 1, 'grenade explodes exactly once (on fuse)');
  }

  // Cluster: main pop + 5 submunitions (flat world — mapgen-proof)
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    const evs = collect(sim, [{ weapon: 'cluster', fuse: 2 }, ...ticks(20, { aimUp: true }), ...ticks(40, { charge: true }), {}]);
    assert(evs.filter((e) => e.type === 'explosion').length === 6, 'cluster: 1 main + 5 sub explosions');
  }

  // Shotgun: two shots via the mid-shotgun retreat state
  {
    const sim = Sim.newGame(cfg);
    sim.beginTurn(1);
    sim.drainEvents();
    for (const i of [{ weapon: 'shotgun' }, { fire: true }]) sim.step(i);
    assert(sim.phase === 'retreat' && sim.pendingShots === 1, 'after 1st shotgun shot: retreat + pending second shot');
    for (const i of [{}, ...ticks(10, { aimDown: true }), { fire: true }]) sim.step(i);
    assert(sim.pendingShots === 0, 'second shotgun shot fired');
    collect(sim, []);
    assert(sim.phase === 'turn-over', 'shotgun turn resolves');
  }

  // Fall damage ends the turn during the move phase (classic rule)
  {
    const sim = Sim.newGame(cfg);
    sim.beginTurn(1);
    sim.drainEvents();
    const w = sim.worms.find((x) => x.id === sim.activeWormId);
    // Carve a clear shaft so the lifted worm has open air on any map seed
    // (denser cave generation can otherwise embed the teleported test worm).
    sim.terrain.destroy(w.x, w.y - 60, 55);
    sim.terrain.destroy(w.x, w.y - 130, 55);
    w.y -= 120;
    w.airborne = true;
    const evs = collect(sim, ticks(200, {}));
    const fd = evs.find((e) => e.type === 'fallDamage');
    assert(!!fd && fd.amount > 0, `fall from 120px hurts (${fd && fd.amount} dmg)`);
    assert(sim.phase === 'turn-over', 'fall damage in move phase ended the turn');
  }

  // Wind changes the bazooka's landing point (flat world — mapgen-proof)
  {
    const shot = (turn) => {
      const s = flatSim();
      s.beginTurn(turn);
      s.drainEvents();
      const evs = collect(s, [...ticks(30, { aimUp: true }), ...ticks(60, { charge: true }), {}]);
      const ex = evs.find((e) => e.type === 'explosion');
      return { wind: s.wind, x: ex ? ex.x : null };
    };
    const a = shot(1);
    const b = shot(3);
    assert(a.wind !== b.wind && a.x !== null && b.x !== null && a.x !== b.x,
      `wind shifts identical shots (wind ${a.wind} -> x ${Math.round(a.x)}, wind ${b.wind} -> x ${Math.round(b.x)})`);
  }

  // Sudden death: accelerating water rise + hp decay (floored at 1) from the
  // configured round
  {
    const sim = flatSim();
    sim.config.suddenDeathRound = 2;
    const w0 = sim.waterLevel;
    sim.worms[3].hp = 4; // decay must floor at 1hp, never kill
    let sawSuddenDeath = false;
    let sawRise = false;
    for (let n = 1; n <= 6 && sim.phase !== 'game-over'; n++) {
      sim.beginTurn(n);
      for (const e of sim.drainEvents()) {
        if (e.type === 'suddenDeath') sawSuddenDeath = true;
        if (e.type === 'waterRise') sawRise = true;
      }
      collect(sim, [{ weapon: 'skip' }, { fire: true }]);
    }
    assert(sawSuddenDeath && sawRise, 'suddenDeath + waterRise events emitted');
    // Turns 3+4 are round 2 (+WATER_RISE each), turns 5+6 round 3 (+ACCEL more).
    const expect = w0 + 2 * C.WATER_RISE + 2 * (C.WATER_RISE + C.WATER_RISE_ACCEL);
    assert(sim.waterLevel === expect, `water rise accelerates per round (${w0} -> ${sim.waterLevel}, expected ${expect})`);
    const decayed = sim.worms[0];
    assert(decayed.hp === C.WORM_HP - 4 * C.SUDDEN_DEATH_DECAY,
      `worms wither ${C.SUDDEN_DEATH_DECAY}hp per sudden-death turn (hp ${decayed.hp})`);
    assert(sim.worms[3].alive && sim.worms[3].hp === 1,
      `decay floors at 1hp and never kills (hp ${sim.worms[3].hp})`);
  }

  // Rules v2: weapon memory, health crates, pre-placed hazards, oil drums.
  // All gated on config.rules >= 2 so v1 games replay unchanged.
  {
    // Weapon memory: the team's selection survives to its next turn.
    const sim = flatSim({ rules: 2 });
    sim.beginTurn(1); // team A
    collect(sim, [{ weapon: 'grenade' }, { weapon: 'skip', fire: true }]);
    sim.beginTurn(2); // team B
    assert(sim.selectedWeapon === 'bazooka', 'weapon memory is per-team (B starts on bazooka)');
    collect(sim, [{ weapon: 'skip', fire: true }]);
    sim.beginTurn(3); // team A again
    assert(sim.selectedWeapon === 'grenade', `team A remembers its grenade (got ${sim.selectedWeapon})`);

    const v1 = flatSim();
    v1.beginTurn(1);
    collect(v1, [{ weapon: 'grenade' }, { weapon: 'skip', fire: true }]);
    v1.beginTurn(2);
    collect(v1, [{ weapon: 'skip', fire: true }]);
    v1.beginTurn(3);
    assert(v1.selectedWeapon === 'bazooka', 'rules v1 games keep the bazooka reset');
  }
  {
    // Health crate: collected on contact, heals past nothing (no cap).
    const sim = flatSim({ rules: 2 });
    sim.beginTurn(1);
    sim.drainEvents();
    const aw = sim.worms.find((w) => w.id === sim.activeWormId);
    aw.hp = 40;
    sim.crates.push({ x: aw.x, y: aw.y, vx: 0, vy: 0, falling: false, kind: 'health', weapon: null, amount: C.CRATE_HEALTH });
    const evs = collect(sim, [{}, { weapon: 'skip', fire: true }]);
    const got = evs.find((e) => e.type === 'crateCollected');
    assert(aw.hp === 40 + C.CRATE_HEALTH && got && got.contents.health === C.CRATE_HEALTH,
      `health crate heals +${C.CRATE_HEALTH} (hp ${aw.hp})`);
  }
  {
    // Pre-placed hazards: seeded, deterministic, clear of worm spawns.
    const mk = () => Sim.newGame({ ...baseConfig, rules: 2 });
    const s1 = mk();
    assert(s1.mines.length >= 2 && s1.drums.length >= 1,
      `hazards placed (${s1.mines.length} mines, ${s1.drums.length} drums)`);
    assert(s1.mines.every((m) => m.state === 'idle'), 'map mines are armed from turn one');
    const clear = s1.mines.concat(s1.drums).every((h) =>
      s1.worms.every((w) => Math.hypot(w.x - h.x, w.y - h.y) > 40));
    assert(clear, 'hazards spawn clear of every worm');
    const s2 = mk();
    assert(
      JSON.stringify(s1.mines.map((m) => m.serialize())) === JSON.stringify(s2.mines.map((m) => m.serialize())) &&
      JSON.stringify(s1.drums.map((d) => d.serialize())) === JSON.stringify(s2.drums.map((d) => d.serialize())),
      'hazard placement is deterministic per seed');
    const v1 = Sim.newGame(baseConfig);
    assert(v1.mines.length === 0 && v1.drums.length === 0, 'rules v1 maps stay hazard-free');
  }
  {
    // Oil drum: a nearby blast cooks it off — real explosion + burning oil.
    const sim = flatSim({ rules: 2 });
    sim.beginTurn(1);
    sim.drainEvents();
    sim.drums.push(new Drum(9000, 2000, 490)); // far from every worm
    P.applyExplosion(sim, 2010, 486, { dmg: 30, radius: 24, knock: 200 });
    const evs = collect(sim, [{}, {}, { weapon: 'skip', fire: true }]);
    const drumGone = sim.drums.length === 0;
    const boomed = evs.filter((e) => e.type === 'explosion').length >= 1;
    assert(drumGone && boomed && sim.flames.length > 0,
      `drum chain-detonates and spills fire (${sim.flames.length} flames)`);
    // Snapshot round-trip carries drums + weapon memory.
    sim.drums.push(new Drum(9001, 2100, 490));
    const snap = JSON.parse(JSON.stringify(sim.snapshot()));
    const back = Sim.fromSnapshot({ ...flatConfig, rules: 2 }, snap);
    assert(JSON.stringify(back.snapshot()) === JSON.stringify(sim.snapshot()),
      'rules-2 snapshot (drums, teamWeapons, crate kinds) round-trips');
  }

  // Stamina: exhausted worm stops moving but the turn continues; jump refused
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    const aw = sim.worms.find((x) => x.id === sim.activeWormId);
    const x0 = aw.x;
    for (let i = 0; i < 1100 && sim.phase === 'move'; i++) sim.step({ right: true });
    assert(sim.stamina === 0, 'walking drains stamina to 0 (6/s over ~16.6s)');
    assert(Math.round(aw.x - x0) === 467, `100 stamina buys ~467px of waddle (got ${Math.round(aw.x - x0)})`);
    const x1 = aw.x;
    for (let i = 0; i < 60; i++) sim.step({ right: true });
    assert(aw.x === x1 && sim.phase === 'move', 'exhausted worm cannot move but turn continues (aim/fire still allowed)');
    sim.step({ jump: true });
    assert(!aw.airborne, 'jump refused at 0 stamina');
  }

  // Drowning: a worm knocked into the sea splashes and dies
  {
    const sim = Sim.newGame(cfg);
    sim.beginTurn(1);
    sim.drainEvents();
    const victim = sim.worms[3];
    victim.x = 100;
    victim.y = sim.waterLevel - 50;
    victim.airborne = true;
    victim.vx = -80;
    const evs = [];
    for (let i = 0; i < 400 && victim.alive; i++) { sim.step({}); evs.push(...sim.drainEvents()); }
    assert(!victim.alive, 'worm in water dies');
    assert(evs.some((e) => e.type === 'splash') && evs.some((e) => e.type === 'wormDied'), 'splash + wormDied emitted');
  }

  // Teleport: instant move, ends the turn
  {
    const sim = Sim.newGame(cfg);
    sim.beginTurn(1);
    sim.drainEvents();
    const w = sim.worms.find((x) => x.id === sim.activeWormId);
    const spots = P.findSpawnSpots(sim.terrain, sim.waterLevel);
    const dest = spots[Math.floor(spots.length / 2)];
    collect(sim, [{ weapon: 'teleport' }, { fire: true, target: { x: dest.x, y: dest.y } }]);
    assert(Math.abs(w.x - dest.x) < 2 && Math.abs(w.y - dest.y) < 8, 'teleport moved the worm to target');
    assert(sim.phase === 'turn-over', 'teleport ended the turn');
    assert(sim.ammo[w.teamIndex].teleport === 1, 'teleport ammo consumed (2 -> 1)');
  }
}

// ----------------------------------------- (j) WA power-3 stat corrections
section('j. WA stat corrections applied');
{
  assert(C.WEAPONS.grenade.dmg === 50 && C.WEAPONS.grenade.radius === 38, 'grenade 50 dmg / r38 (bazooka-class blast)');
  assert(C.WEAPONS.cluster.dmg === 20 && C.WEAPONS.cluster.radius === 18 && C.WEAPONS.cluster.subRadius === 18, 'cluster 20/18 + sub r18');
  assert(C.WEAPONS.shotgun.craterR === 18, 'shotgun crater r18 (WA 47px)');
  assert(C.WEAPONS.dynamite.radius === 58, 'dynamite r58 (WA 147px)');
  assert(C.WEAPONS.airstrike.radius === 24, 'airstrike r24 each (WA 61px)');
  assert(C.WEAPONS.grenade.e === 0.3 && C.WEAPONS.grenade.f === 0.96, 'grenade uses WA MIN bounce (-4% h / -70% v)');
  assert(C.WEAPONS.banana.e === 0.6, 'banana forced MAX bounce');
}

// ------------------------------------------------ (k) arsenal: projectiles
section('k. arsenal — projectiles');
{
  // Homing missile: click target, steers in, explodes on the mark.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    const evs = collect(sim, [
      { weapon: 'homing', target: { x: 1100, y: 490 } },
      ...ticks(20, { aimUp: true }), ...ticks(40, { charge: true }), {},
    ]);
    const ex = evs.find((e) => e.type === 'explosion');
    assert(!!ex && Math.abs(ex.x - 1100) < 80, `homing steers to the clicked target (hit x=${ex && Math.round(ex.x)})`);
    assert(sim.worms[2].hp < 100, 'homing damaged the worm at the target');
    assert(sim.ammo[0].homing === 1, 'homing ammo consumed (2 -> 1)');
  }

  // Mortar: no charge (tap fire), shell + 5 backward-ejected bomblets.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    const evs = collect(sim, [{ weapon: 'mortar' }, ...ticks(30, { aimUp: true }), { fire: true }]);
    assert(evs.filter((e) => e.type === 'explosion').length === 6, 'mortar: shell + 5 cluster explosions');
    assert(evs.filter((e) => e.type === 'explosion').every((e) => e.r === 14), 'mortar craters are r14');
  }

  // Banana: 1 + 5 dynamite-power explosions.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    const evs = collect(sim, [{ weapon: 'banana', fuse: 1 }, ...ticks(25, { aimUp: true }), ...ticks(30, { charge: true }), {}]);
    const bigs = evs.filter((e) => e.type === 'explosion' && e.r === 58);
    assert(bigs.length === 6, `banana: 6 x r58 explosions (got ${bigs.length})`);
  }

  // Holy hand grenade: fixed 3s fuse AND at-rest, then the silence beat.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    for (const i of [{ weapon: 'holygrenade' }, ...ticks(10, { aimUp: true }), ...ticks(25, { charge: true }), {}]) sim.step(i);
    let t = 0;
    let exTick = -1;
    let exR = 0;
    while (sim.phase !== 'turn-over' && t < 5000) {
      sim.step({});
      t++;
      for (const e of sim.drainEvents()) {
        if (e.type === 'explosion' && exTick < 0) { exTick = t; exR = e.r; }
      }
    }
    assert(exR === 78, 'holy grenade blast is r78 (the biggest hand-thrown)');
    // Fuse (180) starts at the throw, a few ticks before this loop begins;
    // anything >= 200 proves the at-rest wait plus the 40-tick silence beat.
    assert(exTick >= 200,
      `holy waits for fuse + rest + silence beat (exploded at tick ${exTick})`);
  }

  // Longbow: 2 arrows, turn continues between them, arrows EMBED as terrain.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    const evs = [];
    for (const i of [{ weapon: 'longbow' }, ...ticks(20, { aimDown: true }), { fire: true }]) {
      sim.step(i);
      evs.push(...sim.drainEvents());
    }
    assert(sim.phase === 'retreat' && sim.pendingShots === 1, 'after 1st arrow: turn continues, 2nd owed');
    for (const i of [{}, { fire: true }]) { sim.step(i); evs.push(...sim.drainEvents()); }
    evs.push(...collect(sim, []));
    const stuck = evs.filter((e) => e.type === 'arrowStuck');
    assert(stuck.length === 2, `both arrows embedded (${stuck.length} arrowStuck events)`);
    assert(stuck.every((e) => sim.terrain.solid(e.x, e.y) ||
      sim.terrain.solid(e.x - 2, e.y) || sim.terrain.solid(e.x, e.y - 2)),
      'embedded arrows are solid terrain');
    assert(sim.ammo[0].longbow === 2, 'longbow: one ammo per pair of arrows');
  }

  // Carpet bomb: 5 carpets x explosion on EVERY bounce.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    sim.ammo[0].carpetbomb = 1; // crate-only
    const evs = collect(sim, [{ weapon: 'carpetbomb' }, { fire: true, target: { x: 1800, y: 400 } }]);
    const pops = evs.filter((e) => e.type === 'explosion' && e.r === 24).length;
    assert(pops >= 10 && pops <= 25, `carpets explode on every bounce (${pops} explosions)`);
  }
}

// -------------------------------------------------- (l) arsenal: guns/melee
section('l. arsenal — guns & melee');
{
  // Handgun/uzi/minigun: correct round counts, live re-aim, cumulative damage.
  for (const [gun, rounds] of [['handgun', 6], ['uzi', 10], ['minigun', 20]]) {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    sim.worms[2].x = 380; // enemy pinned in the stream
    sim.worms[2].y = 494;
    const evs = collect(sim, [{ weapon: gun }, { fire: true }, ...ticks(80, {})]);
    const shots = evs.filter((e) => e.type === 'fire' && e.weapon === gun).length;
    assert(shots === rounds, `${gun}: ${rounds} rounds fired (got ${shots})`);
    assert(sim.worms[2].hp < 100, `${gun}: pinned worm took damage (hp ${sim.worms[2].hp})`);
    assert(sim.phase === 'turn-over', `${gun}: turn ends after the burst`);
  }

  // Battle axe: 50% of current hp, min 1, NO knockback.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    sim.worms[2].x = 312;
    sim.worms[2].y = 494;
    collect(sim, [{ weapon: 'axe' }, { fire: true }]);
    assert(sim.worms[2].hp === 50, `axe halves current hp (100 -> ${sim.worms[2].hp})`);
    assert(Math.abs(sim.worms[2].x - 312) < 1, 'axe applies NO knockback');
  }
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    sim.worms[2].x = 312;
    sim.worms[2].y = 494;
    sim.worms[2].hp = 1;
    collect(sim, [{ weapon: 'axe' }, { fire: true }]);
    assert(!sim.worms[2].alive, 'axe always deals at least 1 (finishes a 1hp worm)');
  }

  // Prod: zero damage, victim nudged off its spot.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    sim.worms[2].x = 310;
    sim.worms[2].y = 494;
    collect(sim, [{ weapon: 'prod' }, { fire: true }]);
    assert(sim.worms[2].hp === 100, 'prod deals no damage');
    assert(sim.worms[2].x > 311, `prod nudged the victim forward (x ${Math.round(sim.worms[2].x)})`);
  }

  // Baseball bat: 30 dmg + huge aimable knock.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    sim.worms[2].x = 312;
    sim.worms[2].y = 494;
    const evs = collect(sim, [{ weapon: 'baseballbat' }, ...ticks(30, { aimUp: true }), { fire: true }]);
    const dmg = evs.find((e) => e.type === 'damage' && e.wormId === 2);
    assert(!!dmg && dmg.amount === 30, 'bat deals 30');
    assert(Math.abs(sim.worms[2].x - 312) > 100, `bat launches the victim a great distance (${Math.round(Math.abs(sim.worms[2].x - 312))}px)`);
  }

  // Dragon ball: 30 dmg, flat fling, first worm only.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    sim.worms[2].x = 312;
    sim.worms[2].y = 494;
    const evs = collect(sim, [{ weapon: 'dragonball' }, { fire: true }]);
    const dmg = evs.find((e) => e.type === 'damage' && e.wormId === 2);
    assert(!!dmg && dmg.amount === 30, 'dragon ball deals 30');
    assert(sim.worms[2].x - 312 > 30, 'dragon ball flings the victim flat and far');
  }

  // Kamikaze: straight carve, path damage, the user always dies.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    sim.worms[2].x = 400;
    sim.worms[2].y = 494;
    const evs = collect(sim, [{ weapon: 'kamikaze' }, { fire: true }]);
    assert(!sim.worms[0].alive, 'kamikaze: the user always dies');
    assert(sim.worms[2].hp <= 70, `kamikaze: worm in the path took 30+ (hp ${sim.worms[2].hp})`);
    assert(!sim.terrain.solid(360, 498), 'kamikaze carved a tunnel through the path');
    assert(evs.filter((e) => e.type === 'wormDied' && e.wormId === 0).length === 1, 'no double death event for the kamikaze worm');
  }
}

// ----------------------------------------------- (m) arsenal: fire & mines
section('m. arsenal — fire system & mines');
{
  // Petrol: flames spawn, the turn ENDS with flames still burning (critical),
  // and the fire decays away over the following turns.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    const evs = collect(sim, [{ weapon: 'petrol' }, ...ticks(15, { aimUp: true }), ...ticks(30, { charge: true }), {}]);
    assert(evs.some((e) => e.type === 'fireStarted'), 'petrol emits fireStarted');
    assert(sim.flames.length > 0, `flames alive at turn end (${sim.flames.length})`);
    assert(sim.phase === 'turn-over', 'turn ended WITH flames still burning (resting flames settle)');
    assert(sim.flames.every((f) => f.resting), 'all surviving flames are at rest');
    for (let n = 2; n <= 6 && sim.phase !== 'game-over'; n++) {
      runTurn(sim, n, [{ weapon: 'skip' }, { fire: true }]);
    }
    assert(sim.flames.length === 0, 'flames fully decay within 4 turns');
  }

  // Flame damage: per-turn cap per worm, worm bodies extinguish flames.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    for (let i = 0; i < 2; i++) {
      const f = new Flame(sim.entitySeq++, sim.worms[2].x, sim.worms[2].y, 0, 0);
      f.resting = true;
      sim.flames.push(f);
    }
    for (let i = 0; i < 900; i++) sim.step({});
    const burned = 100 - sim.worms[2].hp;
    assert(burned > 0, `standing in fire hurts (${burned} dmg)`);
    assert(burned <= C.FIRE_TURN_CAP, `fire damage capped at ${C.FIRE_TURN_CAP}/worm/turn (took ${burned})`);
    assert(sim.flames.length < 2, 'worm body extinguished flames (3 burns each)');
  }

  // Napalm: 5 half-power missiles + a big wind-driven fire.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    const evs = collect(sim, [{ weapon: 'napalm' }, { fire: true, target: { x: 1900, y: 400 } }]);
    assert(evs.filter((e) => e.type === 'explosion' && e.r === 24).length === 5, 'napalm: 5 x r24 missile explosions');
    assert(evs.filter((e) => e.type === 'fireStarted').length === 5, 'napalm: each missile starts a fire');
    assert(sim.flames.length > 0 && sim.flames.length <= C.FIRE_CAP, `flamelet budget respected (${sim.flames.length} <= ${C.FIRE_CAP})`);
    assert(sim.phase === 'turn-over', 'napalm turn resolves with fires burning');
  }

  // Flamethrower: 56-flame stream, capped burn on a pinned worm.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    sim.worms[2].x = 345;
    sim.worms[2].y = 494;
    collect(sim, [{ weapon: 'flamethrower' }, { fire: true }, ...ticks(130, {})]);
    assert(sim.worms[2].hp < 100, `flamethrower burned the pinned worm (hp ${sim.worms[2].hp})`);
    assert(100 - sim.worms[2].hp <= C.FIRE_TURN_CAP, 'flamethrower damage respects the per-turn cap');
    assert(sim.ammo[0].flamethrower === 0, 'flamethrower ammo consumed');
  }

  // Placed mine: arming delay -> idle; proximity trigger -> 3s fuse -> boom.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    const evs = collect(sim, [{ weapon: 'mine' }, { fire: true }, ...ticks(60, { right: true })]);
    assert(sim.mines.length === 1 && sim.mines[0].state === 'idle', 'mine placed, armed after the delay');
    assert(evs.some((e) => e.type === 'mineArmed'), 'mineArmed event emitted');
    assert(sim.phase === 'turn-over', 'armed resting mine does not block turn end');
    // Next turn: the enemy walks into the proximity diamond.
    sim.mines[0].dud = 0; // force live (dud pool tested separately)
    sim.mines[0].x = sim.worms[2].x + 30;
    sim.mines[0].y = sim.worms[2].y;
    sim.beginTurn(2);
    sim.drainEvents();
    const evs2 = collect(sim, ticks(90, { right: true }));
    assert(evs2.some((e) => e.type === 'mineTriggered'), 'proximity triggered the mine');
    assert(evs2.some((e) => e.type === 'explosion' && e.r === 38), 'mine explodes 50/r38 after the 3s fuse');
    assert(sim.worms[2].hp < 100, `the walker paid for it (hp ${sim.worms[2].hp})`);
  }

  // Dud pool: deterministic, clustered per 6, some duds at the default 20%.
  {
    const rolls1 = Array.from({ length: 60 }, (_, i) => mineDudRoll(999, i));
    const rolls2 = Array.from({ length: 60 }, (_, i) => mineDudRoll(999, i));
    assert(JSON.stringify(rolls1) === JSON.stringify(rolls2), 'dud pool rolls are deterministic');
    const duds = rolls1.filter(Boolean).length;
    assert(duds >= 1 && duds <= 30, `dud pool produces duds at a plausible rate (${duds}/60)`);
  }

  // Mine strike: 5 live mines rain down, settle, and the turn ends.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    sim.ammo[0].minestrike = 1; // crate-only
    collect(sim, [{ weapon: 'minestrike' }, { fire: true, target: { x: 1900, y: 400 } }]);
    assert(sim.mines.length === 5, `mine strike dropped 5 mines (${sim.mines.length})`);
    assert(sim.mines.every((m) => m.resting), 'strike mines bounced and settled');
    assert(sim.phase === 'turn-over', 'mine strike turn resolves');
  }
}

// ------------------------------------------ (n) arsenal: walkers & diggers
section('n. arsenal — walkers, diggers, girder');
{
  // Sheep: walks, second fire detonates, dynamite-class blast.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    for (const i of [{ weapon: 'sheep' }, { fire: true }]) sim.step(i);
    const sx0 = sim.walkers[0].x;
    for (let i = 0; i < 60; i++) sim.step({});
    const sx1 = sim.walkers[0].x;
    assert(sx1 - sx0 > 20, `sheep walks fast in its facing direction (${Math.round(sx1 - sx0)}px in 1s)`);
    sim.step({ fire: true });
    const evs = collect(sim, []);
    assert(evs.some((e) => e.type === 'explosion' && e.r === 58), 'second fire press detonates (75/r58)');
    assert(sim.walkers.length === 0 && sim.phase === 'turn-over', 'sheep gone, turn resolves');
  }

  // Sheep: 20s timeout backstop + crate collection for the owner.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    sim.crates.push({ x: 400, y: 490, vx: 0, vy: 0, falling: false, weapon: 'banana', amount: 1 });
    const evs = collect(sim, [{ weapon: 'sheep' }, { fire: true }]);
    assert(evs.some((e) => e.type === 'crateCollected' && e.wormId === 0), 'sheep collects crates for its owner');
    assert(sim.ammo[0].banana === 2, 'collected banana credited to the owning team');
    assert(evs.some((e) => e.type === 'explosion' && e.r === 58), 'unattended sheep self-destructs (timeout)');
    assert(sim.phase === 'turn-over', 'sheep timeout still ends the turn');
  }

  // Blowtorch: digs a horizontal tunnel through a cliff.
  {
    const sim = flatSim();
    for (let y = 380; y < 500; y++) for (let x = 420; x < 560; x++) sim.terrain.data[y * 2400 + x] = 1;
    sim.worms[0].x = 408;
    sim.beginTurn(1);
    sim.drainEvents();
    const x0 = sim.worms[0].x;
    collect(sim, [{ weapon: 'blowtorch' }, { fire: true }]);
    assert(sim.worms[0].x - x0 > 60, `blowtorch advanced the worm through rock (${Math.round(sim.worms[0].x - x0)}px)`);
    assert(!sim.terrain.solid(470, 494), 'blowtorch carved a walkable tunnel');
    assert(sim.worms[0].hp === 100 && sim.phase === 'turn-over', 'digger unhurt, turn resolves');
  }

  // Pneumatic drill: straight down, seeded Gaussian depth, no fall damage.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    const y0 = sim.worms[0].y;
    collect(sim, [{ weapon: 'drill' }, { fire: true }]);
    const depth = sim.worms[0].y - y0;
    assert(depth >= C.WEAPONS.drill.depthMin - 8 && depth <= C.WEAPONS.drill.depthMax + 8,
      `drill depth ${Math.round(depth)}px within the seeded band`);
    assert(sim.worms[0].hp === 100, 'no fall damage during the dig');
    assert(sim.phase === 'turn-over', 'drill turn ends');
  }

  // Girder: fuse picks the angle, click places ORDINARY destructible terrain.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    const evs = collect(sim, [{ weapon: 'girder', fuse: 1 }, { fire: true, target: { x: 380, y: 420 } }]);
    assert(evs.some((e) => e.type === 'girderPlaced'), 'girderPlaced event emitted');
    assert(sim.terrain.solid(380, 420), 'girder pixels are solid terrain');
    sim.terrain.destroy(380, 420, 20);
    assert(!sim.terrain.solid(380, 420), 'girder terrain is destructible (ordinary, not steel)');
    assert(sim.ammo[0].girder === 2, 'girder ammo consumed');
  }
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    // Refused: overlapping a worm; refused: out of range. Costs nothing.
    sim.step({ weapon: 'girder', fuse: 1 });
    sim.step({ fire: true, target: { x: sim.worms[1].x, y: sim.worms[1].y } });
    sim.step({});
    sim.step({ fire: true, target: { x: 1400, y: 300 } });
    assert(sim.ammo[0].girder === 3 && sim.phase === 'move', 'girder refused on overlap/out-of-range, no cost');
  }

  // Concrete donkey: stomps a column of 100/r78 blasts down to the water.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    sim.ammo[0].donkey = 1; // crate-only
    const evs = collect(sim, [{ weapon: 'donkey' }, { fire: true, target: { x: 1900, y: 400 } }]);
    const stomps = evs.filter((e) => e.type === 'donkeyStomp').length;
    assert(stomps >= 3, `donkey stomped repeatedly (${stomps} stomps)`);
    assert(evs.some((e) => e.type === 'explosion' && e.r === 78), 'each stomp is a 100/r78 blast');
    assert(!sim.terrain.solid(1900, 700), 'donkey destroyed the entire column beneath it');
    assert(sim.phase === 'turn-over', 'donkey exits into water, turn resolves');
  }
}

// ------------------------------------------- (o) arsenal: set-pieces & utils
section('o. arsenal — set-pieces & utilities');
{
  // Earthquake: seeded impulses shake every body, no direct damage.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    sim.ammo[0].earthquake = 1; // crate-only
    const xs0 = sim.worms.map((w) => w.x);
    const evs = collect(sim, [{ weapon: 'earthquake' }, { fire: true }]);
    assert(evs.some((e) => e.type === 'earthquake'), 'earthquake event emitted');
    const moved = sim.worms.reduce((s, w, i) => s + Math.abs(w.x - xs0[i]), 0);
    assert(moved > 10, `worms got bounced around (${Math.round(moved)}px total)`);
    assert(sim.worms.every((w) => w.hp === 100), 'earthquake itself deals no direct damage');
    assert(sim.phase === 'turn-over', 'earthquake turn resolves');
  }

  // Armageddon: 20-30 seeded meteors rain across the whole map.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    sim.ammo[0].armageddon = 1; // crate-only
    const evs = collect(sim, [{ weapon: 'armageddon' }, { fire: true }]);
    const meteors = evs.filter((e) => e.type === 'meteor').length;
    assert(meteors >= C.WEAPONS.armageddon.minMeteors && meteors <= C.WEAPONS.armageddon.maxMeteors,
      `armageddon: ${meteors} meteors (20-30)`);
    const exs = evs.filter((e) => e.type === 'explosion');
    assert(exs.length >= 10 && exs.every((e) => e.r >= 38 && e.r <= 78), 'meteor blasts span r38-r78');
    assert(sim.phase === 'turn-over' || sim.phase === 'game-over', 'the shower ends the turn');
  }

  // Parachute: deploys mid-air, slow drift, no fall damage, turn CONTINUES.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    sim.wind = 0.2; // gentle deterministic breeze for a bounded drift
    const w = sim.worms[0];
    w.y -= 250;
    w.airborne = true;
    sim.step({ weapon: 'parachute' });
    sim.step({ fire: true });
    assert(sim.chuteOpen, 'parachute deployed while airborne');
    const evs = [];
    for (let i = 0; i < 800 && w.airborne; i++) { sim.step({}); evs.push(...sim.drainEvents()); }
    assert(!w.airborne && w.hp === 100 && !evs.some((e) => e.type === 'fallDamage'),
      'soft landing: no fall damage from 250px');
    assert(!sim.chuteOpen, 'chute closes on landing');
    assert(sim.phase === 'move', 'parachute is a utility: the turn continues');
    assert(sim.ammo[0].parachute === 1, 'parachute ammo consumed');
  }

  // Select worm: click a teammate, control switches, turn continues.
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    sim.step({ weapon: 'selectworm' });
    sim.step({ fire: true, target: { x: 700, y: 494 } });
    assert(sim.activeWormId === 1, 'selectworm switched control to the clicked teammate');
    assert(sim.phase === 'move', 'selectworm is a utility: the turn continues');
    assert(sim.ammo[0].selectworm === 0, 'selectworm ammo consumed');
    // The new worm can still act.
    const evs = collect(sim, [{ weapon: 'bazooka' }, ...ticks(30, { charge: true }), {}]);
    assert(evs.some((e) => e.type === 'fire' && e.weapon === 'bazooka'), 'switched worm fired normally');
  }
}

// -------------------------------------- (p) snapshots mid-everything (v2)
section('p. snapshot v2 mid-action round-trips');
{
  // Mid-burst (uzi, with live re-aim after restore).
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    for (const i of [{ weapon: 'uzi' }, { fire: true }, ...ticks(8, { aimUp: true })]) sim.step(i);
    const snap = sim.snapshot();
    assert(Array.isArray(snap.burst) && snap.burst[0] === 'uzi' && snap.burst[1] > 0, 'burst state captured mid-spray');
    const sim2 = Sim.fromSnapshot(flatConfig, snap);
    assert(sim.stateHash() === sim2.stateHash(), 'mid-burst snapshot round-trips');
    for (const i of ticks(30, { aimDown: true })) { sim.step(i); sim2.step(i); }
    collect(sim, []);
    collect(sim2, []);
    assert(sim.stateHash() === sim2.stateHash(), 'restored sim finishes the burst in lockstep (re-aim included)');
  }

  // Mid-sheep (walker state + manual detonation after restore).
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    for (const i of [{ weapon: 'sheep' }, { fire: true }, ...ticks(40, {})]) sim.step(i);
    const snap = sim.snapshot();
    assert(snap.walkers.length === 1 && snap.walkers[0][0] === 'sheep', 'walking sheep captured in snapshot');
    const sim2 = Sim.fromSnapshot(flatConfig, snap);
    assert(sim.stateHash() === sim2.stateHash(), 'mid-sheep snapshot round-trips');
    for (const i of [...ticks(20, {}), { fire: true }]) { sim.step(i); sim2.step(i); }
    collect(sim, []);
    collect(sim2, []);
    assert(sim.stateHash() === sim2.stateHash(), 'restored sim detonates the sheep in lockstep');
  }

  // Mid-fire (flames burning across the snapshot boundary).
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    for (const i of [{ weapon: 'petrol' }, ...ticks(15, { aimUp: true }), ...ticks(30, { charge: true }), {}, ...ticks(40, {})]) sim.step(i);
    const snap = sim.snapshot();
    assert(snap.flames.length > 0, 'live flames captured in snapshot');
    const sim2 = Sim.fromSnapshot(flatConfig, snap);
    assert(sim.stateHash() === sim2.stateHash(), 'mid-fire snapshot round-trips');
    collect(sim, []);
    collect(sim2, []);
    runTurn(sim, 2, [{ weapon: 'skip' }, { fire: true }]);
    runTurn(sim2, 2, [{ weapon: 'skip' }, { fire: true }]);
    assert(sim.stateHash() === sim2.stateHash(), 'fire decays identically across turns after restore');
  }

  // Mid-carve (drill half-dug).
  {
    const sim = flatSim();
    sim.beginTurn(1);
    sim.drainEvents();
    for (const i of [{ weapon: 'drill' }, { fire: true }, ...ticks(50, {})]) sim.step(i);
    const snap = sim.snapshot();
    assert(Array.isArray(snap.carve) && snap.carve[0] === 'drill', 'carve state captured mid-dig');
    const sim2 = Sim.fromSnapshot(flatConfig, snap);
    assert(sim.stateHash() === sim2.stateHash(), 'mid-carve snapshot round-trips');
    collect(sim, []);
    collect(sim2, []);
    assert(sim.stateHash() === sim2.stateHash(), 'restored sim finishes the dig in lockstep');
  }
}

// --------------------------- (q) full-game determinism with the new arsenal
section('q. full-game determinism across the arsenal');
{
  const cfg = {
    seed: 777001,
    suddenDeathRound: 99,
    teams: [
      { name: 'A', color: '#e33', worms: ['A1', 'A2'] },
      { name: 'B', color: '#36e', worms: ['B1', 'B2'] },
    ],
  };
  const simA = Sim.newGame(cfg);
  const simB = Sim.newGame(cfg);
  for (const s of [simA, simB]) {
    for (let t = 0; t < 2; t++) {
      s.ammo[t].earthquake = 1; // grant the crate-only pieces used below
    }
  }
  // 13 turns using 12+ new weapons. Target-based turns compute coordinates
  // from simA's state pre-turn (identical in simB by induction).
  const scripts = [
    () => [{ weapon: 'mortar' }, ...ticks(25, { aimUp: true }), { fire: true }],
    () => [{ weapon: 'handgun' }, ...ticks(5, { aimDown: true }), { fire: true }],
    () => [{ weapon: 'grenade', fuse: 2 }, ...ticks(30, { charge: true }), {}],
    () => [{ weapon: 'uzi' }, { fire: true }, ...ticks(30, { aimUp: true })],
    () => [{ weapon: 'petrol' }, ...ticks(20, { aimUp: true }), ...ticks(25, { charge: true }), {}],
    () => [{ weapon: 'sheep' }, { fire: true }, ...ticks(80, {}), { fire: true }],
    () => [{ weapon: 'drill' }, { fire: true }],
    () => [{ weapon: 'longbow' }, ...ticks(15, { aimDown: true }), { fire: true }, {}, { fire: true }],
    () => [{ weapon: 'mine' }, { fire: true }, ...ticks(50, { left: true })],
    () => {
      const w = simA._active();
      return [{ weapon: 'girder', fuse: 3 }, { fire: true, target: { x: w.x + 60, y: w.y - 90 } },
        {}, { weapon: 'skip' }, { fire: true }]; // skip fallback if placement refused
    },
    () => [{ weapon: 'banana', fuse: 1 }, ...ticks(28, { charge: true }), {}],
    () => [{ weapon: 'earthquake' }, { fire: true }, {}, { weapon: 'skip' }, { fire: true }],
    () => [{ weapon: 'holygrenade' }, ...ticks(12, { aimUp: true }), ...ticks(24, { charge: true }), {}],
  ];
  let lockstep = true;
  let turnsPlayed = 0;
  const weaponsFired = new Set();
  for (let n = 1; n <= scripts.length; n++) {
    if (simA.phase === 'game-over') break;
    const script = scripts[n - 1]();
    const evA = runTurn(simA, n, script);
    runTurn(simB, n, script);
    turnsPlayed++;
    for (const e of evA) if (e.type === 'fire') weaponsFired.add(e.weapon);
    if (simA.stateHash() !== simB.stateHash()) { lockstep = false; break; }
  }
  assert(lockstep, `two sims stay in lockstep across ${turnsPlayed} arsenal turns`);
  const newOnes = [...weaponsFired].filter((w) => ![
    'bazooka', 'grenade', 'cluster', 'shotgun', 'firepunch', 'dynamite', 'airstrike', 'teleport', 'skip',
  ].includes(w));
  assert(newOnes.length >= 10, `script exercised ${newOnes.length} new weapons (${newOnes.join(', ')})`);
  const snap = simA.snapshot();
  const simC = Sim.fromSnapshot(cfg, snap);
  assert(simA.stateHash() === simC.stateHash(), 'end-of-game snapshot round-trips');
  assert(JSON.stringify(JSON.parse(JSON.stringify(snap))).length > 0, 'snapshot is JSON-able');
}

// ----------------------------------------------------------------- summary
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('ALL ENGINE SELF-TESTS PASSED');
