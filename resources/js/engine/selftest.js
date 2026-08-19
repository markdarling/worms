// Engine self-test. Run: node resources/js/engine/selftest.js
// Definition of done for the ENGINE track — every assertion must pass.

import { Terrain } from './terrain.js';
import { Sim } from './sim.js';
import { encodeCommands, decodeCommands, normalizeInput } from './commands.js';
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

const baseConfig = {
  seed: 123456789,
  teams: [
    { name: 'Reds', color: '#e33', worms: ['Alpha', 'Bravo', 'Charlie', 'Delta'] },
    { name: 'Blues', color: '#36e', worms: ['Echo', 'Foxtrot', 'Golf', 'Hotel'] },
  ],
};

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
    {},
  ];
  const normalized = stream.map(normalizeInput);
  const enc = encodeCommands(stream);
  const dec = decodeCommands(enc);
  assert(dec.length === stream.length, 'decoded length matches');
  assert(JSON.stringify(dec) === JSON.stringify(normalized), 'round-trip lossless vs normalized inputs');
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
  const collect = (sim, inputs) => {
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

  // Cluster: main pop + 5 submunitions
  {
    const sim = Sim.newGame(cfg);
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

  // Wind changes the bazooka's landing point
  {
    const shot = (turn) => {
      const s = Sim.newGame(cfg);
      s.beginTurn(turn);
      s.drainEvents();
      const evs = collect(s, [...ticks(30, { aimUp: true }), ...ticks(60, { charge: true }), {}]);
      const ex = evs.find((e) => e.type === 'explosion');
      return { wind: s.wind, x: ex ? ex.x : null };
    };
    const a = shot(1); // wind 0.63
    const b = shot(3); // wind 0.48
    assert(a.wind !== b.wind && a.x !== null && b.x !== null && a.x !== b.x,
      `wind shifts identical shots (wind ${a.wind} -> x ${Math.round(a.x)}, wind ${b.wind} -> x ${Math.round(b.x)})`);
  }

  // Sudden death: water rises from the configured round, worms can drown
  {
    const sim = Sim.newGame({ ...cfg, suddenDeathRound: 2 });
    const w0 = sim.waterLevel;
    let sawSuddenDeath = false;
    let sawRise = false;
    for (let n = 1; n <= 4 && sim.phase !== 'game-over'; n++) {
      sim.beginTurn(n);
      for (const e of sim.drainEvents()) {
        if (e.type === 'suddenDeath') sawSuddenDeath = true;
        if (e.type === 'waterRise') sawRise = true;
      }
      collect(sim, [{ weapon: 'skip' }, { fire: true }]);
    }
    assert(sawSuddenDeath && sawRise, 'suddenDeath + waterRise events emitted');
    assert(sim.waterLevel === w0 + 24, `water rose 12px per turn from round 2 (${w0} -> ${sim.waterLevel})`);
  }

  // Stamina: exhausted worm stops moving but the turn continues; jump refused
  {
    const flat = new Terrain(2400, 900);
    for (let y = 500; y < 840; y++) for (let x = 0; x < 2400; x++) flat.data[y * 2400 + x] = 1;
    const sim = Sim.newGame(cfg);
    sim.terrain = flat;
    sim.worms.forEach((w, i) => { w.x = 400 + i * 300; w.y = 494; w.airborne = false; });
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

// ----------------------------------------------------------------- summary
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('ALL ENGINE SELF-TESTS PASSED');
