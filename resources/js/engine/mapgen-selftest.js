// MAPGEN self-test. Run: node resources/js/engine/mapgen-selftest.js
// Owned by the ENGINE-MAPGEN track (selftest.js belongs to ENGINE-WEAPONS).
//
// Modes:
//   node mapgen-selftest.js               assertions + perf
//   node mapgen-selftest.js --bmp <dir>   dump 2 seeds per archetype as BMPs
//   node mapgen-selftest.js --stats <n>   repair/re-roll stats over n seeds

import { writeFileSync } from 'fs';
import { Terrain, pickArchetype, ARCHETYPE_NAMES } from './terrain.js';
import { generateWorld, generateWorldDetailed, __mapgenTest } from './placement.js';
import { findSpawnSpots, bodyCollides } from './physics.js';
import { C } from './constants.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, label) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL  ${label}`);
  }
}

function section(name) {
  console.log(`\n[${name}]`);
}

const TEAMS_2x4 = [
  { name: 'A', worms: ['a1', 'a2', 'a3', 'a4'] },
  { name: 'B', worms: ['b1', 'b2', 'b3', 'b4'] },
];
const TEAMS_4x4 = [0, 1, 2, 3].map((t) => ({
  name: 'T' + t, worms: [0, 1, 2, 3].map((k) => `w${t}${k}`),
}));
const TEAMS_4x8 = [0, 1, 2, 3].map((t) => ({
  name: 'T' + t, worms: Array.from({ length: 8 }, (_, k) => `w${t}${k}`),
}));

// --- plain 24-bit BMP dumper (no deps) ---
function bmp(t, spots, path) {
  const W = t.width, H = t.height, row = W * 3, pad = (4 - (row % 4)) % 4;
  const size = 54 + (row + pad) * H, b = Buffer.alloc(size);
  b.write('BM'); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14); b.writeInt32LE(W, 18); b.writeInt32LE(-H, 22);
  b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28);
  const water = Math.round(C.WATER_LEVEL * (H / C.WORLD_H));
  let o = 54;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r, g, bl;
      if (t.data[y * W + x]) {
        const grass = !t.solid(x, y - 3);
        if (grass) { r = 74; g = 190; bl = 60; } else { r = 122; g = 76; bl = 34; }
      } else if (y > water) { r = 34; g = 90; bl = 180; }
      else { const f = y / H; r = 128 + f * 60; g = 190 + f * 40; bl = 235; }
      b[o++] = bl; b[o++] = g; b[o++] = r;
    }
    o += pad;
  }
  // spawn markers: red 7x7 squares
  if (spots) {
    for (const s of spots) {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const x = Math.round(s.x) + dx, y = Math.round(s.y) + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const p = 54 + y * (row + pad) + x * 3;
          b[p] = 40; b[p + 1] = 40; b[p + 2] = 235;
        }
      }
    }
  }
  writeFileSync(path, b);
}

function seedsPerArchetype(perArch) {
  const found = ARCHETYPE_NAMES.map(() => []);
  for (let seed = 1; seed < 4000; seed++) {
    const a = pickArchetype(seed);
    if (found[a].length < perArch) found[a].push(seed);
    if (found.every((f) => f.length >= perArch)) break;
  }
  return found;
}

// --- mode: BMP dump ---
const argv = process.argv.slice(2);
if (argv[0] === '--bmp') {
  const dir = argv[1] || '.';
  const found = seedsPerArchetype(2);
  for (let a = 0; a < ARCHETYPE_NAMES.length; a++) {
    for (const seed of found[a]) {
      const { terrain, spots } = generateWorld(seed, C.WORLD_W, C.WORLD_H, TEAMS_2x4);
      const p = `${dir}/map-${ARCHETYPE_NAMES[a]}-${seed}.bmp`;
      bmp(terrain, spots, p);
      console.log(p);
    }
  }
  process.exit(0);
}

// --- mode: repair stats ---
if (argv[0] === '--stats') {
  const n = Number(argv[1] || 200);
  const counts = { clean: 0, ramp: 0, reroll: 0, plateau: 0 };
  const perArch = ARCHETYPE_NAMES.map(() => 0);
  let t0 = performance.now();
  for (let seed = 1; seed <= n; seed++) {
    const { meta } = generateWorldDetailed(seed, C.WORLD_W, C.WORLD_H, TEAMS_2x4);
    perArch[meta.archetype]++;
    if (meta.plateau) counts.plateau++;
    else if (meta.attempts > 1) counts.reroll++;
    else if (meta.rampUsed) counts.ramp++;
    else counts.clean++;
  }
  const dt = performance.now() - t0;
  console.log(`seeds: ${n}  clean: ${counts.clean}  ramp: ${counts.ramp}  reroll: ${counts.reroll}  plateau: ${counts.plateau}`);
  console.log('archetypes:', ARCHETYPE_NAMES.map((nm, i) => `${nm}=${perArch[i]}`).join(' '));
  console.log(`total ${dt.toFixed(0)}ms, avg ${(dt / n).toFixed(1)}ms/world`);
  process.exit(0);
}

// --- assertions ---
section('archetype pick');
{
  const seen = ARCHETYPE_NAMES.map(() => 0);
  for (let s = 1; s <= 600; s++) seen[pickArchetype(s)]++;
  assert(seen.every((c) => c > 0), 'all 6 archetypes appear across 600 seeds');
  for (let s = 1; s <= 50; s++) {
    if (pickArchetype(s) !== pickArchetype(s)) { assert(false, 'pickArchetype deterministic'); break; }
  }
  assert(true, 'pickArchetype deterministic');
}

section('terrain invariants (30 seeds, default size)');
{
  let ok = { gap: true, rle: true, det: true, surface: true };
  for (let seed = 101; seed < 131; seed++) {
    const t = Terrain.generate(seed, C.WORLD_W, C.WORLD_H);
    // bottom water gap
    for (let i = (t.height - 17) * t.width; i < t.data.length; i++) {
      if (t.data[i] !== 0) { ok.gap = false; break; }
    }
    // serialize round-trip exact
    const t2 = Terrain.deserialize(t.serialize());
    if (t2.width !== t.width || t2.height !== t.height) ok.rle = false;
    else {
      for (let i = 0; i < t.data.length; i++) {
        if (t.data[i] !== t2.data[i]) { ok.rle = false; break; }
      }
    }
    // bit-identical regeneration
    const t3 = Terrain.generate(seed, C.WORLD_W, C.WORLD_H);
    for (let i = 0; i < t.data.length; i++) {
      if (t.data[i] !== t3.data[i]) { ok.det = false; break; }
    }
    // standable surface exists
    const water = Math.round(C.WATER_LEVEL * (t.height / C.WORLD_H));
    if (findSpawnSpots(t, water, 12).length < 20) ok.surface = false;
  }
  assert(ok.gap, 'bottom water gap (17 rows) preserved on every seed');
  assert(ok.rle, 'serialize/deserialize round-trip exact');
  assert(ok.det, 'Terrain.generate bit-identical across runs');
  assert(ok.surface, 'every seed has a standable surface (>=20 spots)');
}

section('generateWorld (30 seeds x teams variants)');
{
  let allOk = {
    count: true, stand: true, aboveWater: true, nan: true,
    spacing: true, det: true, region: true, plateau0: true,
  };
  let minSpacingSeen = Infinity;
  const teamsFor = (seed) => (seed % 3 === 0 ? TEAMS_4x4 : TEAMS_2x4);
  for (let seed = 201; seed < 231; seed++) {
    const teams = teamsFor(seed);
    const need = teams.reduce((n, t) => n + t.worms.length, 0);
    const r1 = generateWorldDetailed(seed, C.WORLD_W, C.WORLD_H, teams);
    const r2 = generateWorldDetailed(seed, C.WORLD_W, C.WORLD_H, teams);
    const { terrain, spots, meta, waterLevel } = r1;
    if (meta.plateau) allOk.plateau0 = false;
    if (spots.length !== need) allOk.count = false;
    // determinism: identical spots + identical terrain
    if (JSON.stringify(r1.spots) !== JSON.stringify(r2.spots)) allOk.det = false;
    else {
      const d1 = terrain.serialize().data;
      const d2 = r2.terrain.serialize().data;
      if (d1 !== d2) allOk.det = false;
    }
    // standable, above water, no NaN
    for (const s of spots) {
      if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) allOk.nan = false;
      if (bodyCollides(terrain, s.x, s.y) || !bodyCollides(terrain, s.x, s.y + 1)) allOk.stand = false;
      if (s.y >= waterLevel - 8) allOk.aboveWater = false;
    }
    // pairwise spacing >= the relaxed minimum actually used
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const dx = spots[i].x - spots[j].x;
        const dy = spots[i].y - spots[j].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < meta.spacing - 1e-9) allOk.spacing = false;
        if (d < minSpacingSeen) minSpacingSeen = d;
      }
    }
    // every spawn's region passes the verdict (recompute independently)
    const scan = findSpawnSpots(terrain, waterLevel, __mapgenTest.SCAN_STEP);
    const { regions, regionOf, totalCols } = __mapgenTest.buildRegions(scan, terrain);
    const v = __mapgenTest.verdict(scan, regions, totalCols, need, C.WORLD_W, meta.archetype);
    if (!v.ok) allOk.region = false;
    else {
      const accepted = new Set(v.accepted);
      const spotKey = new Map();
      for (let i = 0; i < scan.length; i++) spotKey.set(scan[i].x * 100000 + scan[i].y, regionOf[i]);
      for (const s of spots) {
        const ri = spotKey.get(s.x * 100000 + s.y);
        if (ri === undefined || !accepted.has(ri)) allOk.region = false;
      }
    }
  }
  assert(allOk.count, 'every worm gets a spot (spots.length === total worms)');
  assert(allOk.stand, 'every spawn is standable (clear body, solid below)');
  assert(allOk.aboveWater, 'every spawn is above water');
  assert(allOk.nan, 'no NaNs in spots');
  assert(allOk.spacing, 'pairwise spacing >= relaxed minimum used');
  assert(allOk.det, 'generateWorld bit-identical across two runs');
  assert(allOk.region, 'every spawn sits in a verdict-accepted region');
  assert(allOk.plateau0, 'no seed in the sweep needed the plateau fallback');
  console.log(`  (min pairwise spacing seen: ${minSpacingSeen.toFixed(1)}px)`);
}

section('edge cases');
{
  // 32 worms (4 teams x 8) — handled gracefully
  const r = generateWorldDetailed(777, C.WORLD_W, C.WORLD_H, TEAMS_4x8);
  assert(r.spots.length === 32, '32 worms all placed');
  assert(r.spots.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y)), '32-worm spots finite');
  // team counts as numbers
  const rn = generateWorld(778, C.WORLD_W, C.WORLD_H, [3, 5]);
  assert(rn.spots.length === 8, 'numeric team counts accepted');
  // big map
  const rb = generateWorld(779, 3200, 1000, TEAMS_2x4);
  assert(rb.spots.length === 8, '3200x1000 world places 8 worms');
  assert(rb.terrain.width === 3200 && rb.terrain.height === 1000, 'big terrain dims');
  // team interleave sanity: teams are not fully segregated left/right on a
  // healthy 2-team map (max team x-span overlaps the other team's span)
  const ri = generateWorldDetailed(881, C.WORLD_W, C.WORLD_H, TEAMS_2x4);
  const t0x = ri.spots.slice(0, 4).map((s) => s.x);
  const t1x = ri.spots.slice(4).map((s) => s.x);
  const overlap = Math.min(Math.max(...t0x), Math.max(...t1x)) - Math.max(Math.min(...t0x), Math.min(...t1x));
  assert(overlap > 0, 'team x-ranges interleave (overlap > 0)');
}

section('performance');
{
  // warm-up
  generateWorld(1, C.WORLD_W, C.WORLD_H, TEAMS_2x4);
  let tTyp = 0;
  const NT = 20;
  for (let i = 0; i < NT; i++) {
    const t0 = performance.now();
    generateWorld(300 + i, C.WORLD_W, C.WORLD_H, TEAMS_2x4);
    tTyp += performance.now() - t0;
  }
  let tBigMax = 0, tBigSum = 0;
  const NB = 10;
  for (let i = 0; i < NB; i++) {
    const t0 = performance.now();
    generateWorld(400 + i, 3200, 1000, TEAMS_4x8);
    const dt = performance.now() - t0;
    tBigSum += dt;
    if (dt > tBigMax) tBigMax = dt;
  }
  console.log(`  typical 2400x900: ${(tTyp / NT).toFixed(1)}ms avg`);
  console.log(`  3200x1000 (32 worms): ${(tBigSum / NB).toFixed(1)}ms avg, ${tBigMax.toFixed(1)}ms max`);
  assert(tTyp / NT < 40, 'typical generateWorld < 40ms');
  assert(tBigMax < 100, 'worst 3200x1000 generateWorld < 100ms');
}

section('repair ladder sweep (120 seeds)');
{
  const stats = { clean: 0, ramp: 0, reroll: 0, plateau: 0 };
  for (let seed = 1000; seed < 1120; seed++) {
    const { meta } = generateWorldDetailed(seed, C.WORLD_W, C.WORLD_H, TEAMS_2x4);
    if (meta.plateau) stats.plateau++;
    else if (meta.attempts > 1) stats.reroll++;
    else if (meta.rampUsed) stats.ramp++;
    else stats.clean++;
  }
  console.log(`  clean: ${stats.clean}  ramp: ${stats.ramp}  reroll: ${stats.reroll}  plateau: ${stats.plateau}`);
  assert(stats.plateau === 0, 'plateau fallback never needed across sweep');
  assert(stats.clean + stats.ramp >= 100, 'at least 100/120 seeds resolve without re-roll');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('failures:');
  for (const f of failures) console.log('  - ' + f);
}
process.exit(failed ? 1 : 0);
