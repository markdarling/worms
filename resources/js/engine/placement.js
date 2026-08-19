// World generation + reachability-guaranteed spawn placement (MAPGEN.md §3).
//
//   generateWorld(seed, width, height, teams) -> { terrain, spots }
//
// spots is an array of {x, y} in worm-id order (teams flattened: team0 worm0,
// team0 worm1, ..., team1 worm0, ...). Every spot sits in a reachability-
// accepted region, min-spacing and team-interleave are applied, and the
// terrain may have been repair-carved. Deterministic from arguments alone;
// never throws for valid inputs (worst case: plateau fallback).
//
// Repair ladder (in order): ramp carve (once per attempt) -> up to 3
// deterministic re-rolls (hashSeed(seed, 0x5EED0 + attempt)) -> plateau
// fallback. The same original seed always walks the same attempt chain, so
// replays/netplay stay in sync.

import { Terrain, pickArchetype, slopePath } from './terrain.js';
import { findSpawnSpots } from './physics.js';
import { makeRng, hashSeed } from './rng.js';
import { C } from './constants.js';

const SCAN_STEP = 8;      // px column stride for the reachability scan
const REACH_DX = 48;      // full-jump horizontal range (JUMP_VX 60, apex ~28px)
const REACH_DY = 30;      // max climb per hop/jump
const FLIP_DX = 24;       // backflip horizontal range (BACKFLIP_VX 30)
const FLIP_DY = 44;       // max climb per backflip (apex ~52px)
const TRACE_DX = 600;     // max span of one surface-relay walk trace
const SPACINGS = [60, 30, 15, 0]; // W:A-style min spacing, relaxed if needed

function teamCounts(teams) {
  const counts = [];
  for (let i = 0; i < teams.length; i++) {
    const t = teams[i];
    if (typeof t === 'number') counts.push(t | 0);
    else if (t && Array.isArray(t.worms)) counts.push(t.worms.length);
    else if (t && typeof t.count === 'number') counts.push(t.count | 0);
    else counts.push(1);
  }
  return counts;
}

// Surface relay: from spot i, walk the terrain surface rightward one pixel
// column at a time, requiring every step to be climbable in both directions
// (|delta| <= STEP_UP — a slope a worm can walk up either way). The first
// spot met within +-6px of the traced surface gets unioned and the relay
// stops (the next spot continues it). Connects steep hillsides where body
// side-clearance suppresses spots, while genuine cliffs stay disconnected.
function surfaceRelay(terrain, spots, byCol, i, union) {
  const a = spots[i];
  let prev = a.y + 6; // ground top under the standing spot
  const up = C.STEP_UP;
  const xEnd = Math.min(a.x + TRACE_DX, terrain.width - 1);
  let cooldown = 0; // columns since the last ledge-step
  for (let x = a.x + 1; x <= xEnd; x++) {
    let next = -1;
    for (let y = prev - up; y <= prev + up + 1; y++) {
      if (terrain.solid(x, y) && !terrain.solid(x, y - 1)) { next = y; break; }
    }
    if (next < 0 && cooldown === 0) {
      // Single ledge-step: a drop/climb up to FLIP_DY is mutually traversable
      // (fall down one way, backflip up the other). Cooldown stops chains of
      // ledge-steps climbing a genuine cliff.
      for (let y = prev - FLIP_DY; y <= prev + FLIP_DY; y++) {
        if (terrain.solid(x, y) && !terrain.solid(x, y - 1)) { next = y; break; }
      }
      if (next >= 0) cooldown = 24;
    }
    if (next < 0) return; // surface too steep / vanished
    if (cooldown > 0) cooldown--;
    prev = next;
    const list = byCol.get(x >> 3);
    if (list && ((x - 16) % SCAN_STEP === 0)) {
      for (let k = 0; k < list.length; k++) {
        const j = list[k];
        if (j === i) continue;
        if (spots[j].x !== x) continue;
        if (Math.abs(spots[j].y + 6 - prev) <= 6) {
          union(i, j);
          return;
        }
      }
    }
  }
}

// Straight-line line-of-sight between two standing spots, endpoint lips
// excluded. Used to validate one-way drop edges (a clear line means the worm
// can walk/hop off the ledge and fall to the lower spot).
function dropLos(terrain, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 20) return true;
  const steps = Math.ceil(len / 6);
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const d = f * len;
    if (d < 12 || len - d < 12) continue; // ignore the ledge lips
    if (terrain.solid(a.x + dx * f, a.y - 4 + dy * f)) return false;
  }
  return true;
}

// Reachability regions over spawn spots (MAPGEN.md 3.1, refined):
// 1. Undirected edges: jump/hop reach (|dx| <= 48, |dy| <= 30) and walk-trace
//    edges (a continuously climbable slope between the spots, |dx| <= 120).
//    Union-find over these gives mutually-walkable groups.
// 2. One-way drop edges (|dx| <= 48, target no more than 30px above, clear
//    line of sight) between groups, then SCC (Tarjan) over the condensed
//    graph: two ledges are one region when each can reach the other via any
//    route (drop off one side, walk back up the other). Still an
//    under-approximation of true reach — never strands a worm.
function buildRegions(spots, terrain) {
  const n = spots.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  // Bucket by scan column; spots arrive sorted by x then y.
  const byCol = new Map();
  for (let i = 0; i < n; i++) {
    const col = spots[i].x >> 3;
    let list = byCol.get(col);
    if (!list) { list = []; byCol.set(col, list); }
    list.push(i);
  }
  // 1a. Jump/hop edges.
  const maxDc = Math.ceil(REACH_DX / SCAN_STEP);
  for (let i = 0; i < n; i++) {
    const a = spots[i];
    const col = a.x >> 3;
    for (let dc = 0; dc <= maxDc; dc++) {
      const list = byCol.get(col + dc);
      if (!list) continue;
      for (let k = 0; k < list.length; k++) {
        const j = list[k];
        if (j <= i) continue;
        const b = spots[j];
        const dx = b.x - a.x;
        if (dx > REACH_DX) continue;
        const ady = Math.abs(b.y - a.y);
        if (ady <= REACH_DY) union(i, j); // jump
        else if (dx <= FLIP_DX && ady <= FLIP_DY) union(i, j); // backflip
      }
    }
  }
  // 1b. Surface-relay walk edges (long climbable slopes without spots).
  for (let i = 0; i < n; i++) surfaceRelay(terrain, spots, byCol, i, union);
  // Condense mutually-walkable groups (first-seen order — deterministic).
  const groupOf = new Int32Array(n);
  let groupCount = 0;
  {
    const rootIndex = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      let gi = rootIndex.get(r);
      if (gi === undefined) {
        gi = groupCount++;
        rootIndex.set(r, gi);
      }
      groupOf[i] = gi;
    }
  }
  // One-way drop edges between groups.
  const adj = [];
  for (let g = 0; g < groupCount; g++) adj.push(new Set());
  for (let i = 0; i < n; i++) {
    const a = spots[i];
    const col = a.x >> 3;
    const maxJumpDc = Math.ceil(REACH_DX / SCAN_STEP);
    for (let dc = -maxJumpDc; dc <= maxJumpDc; dc++) {
      const list = byCol.get(col + dc);
      if (!list) continue;
      for (let k = 0; k < list.length; k++) {
        const j = list[k];
        if (j === i) continue;
        const b = spots[j];
        if (Math.abs(b.x - a.x) > REACH_DX) continue;
        if (groupOf[i] === groupOf[j]) continue;
        if (b.y < a.y - REACH_DY) continue; // target too high: not a drop
        if (adj[groupOf[i]].has(groupOf[j])) continue;
        if (dropLos(terrain, a, b)) adj[groupOf[i]].add(groupOf[j]);
      }
    }
  }
  // Tarjan SCC over the (small) condensed digraph — iterative, deterministic
  // (neighbours visited in ascending group id order).
  const adjList = adj.map((s) => Array.from(s).sort((p, q) => p - q));
  const sccOf = new Int32Array(groupCount).fill(-1);
  {
    const index = new Int32Array(groupCount).fill(-1);
    const low = new Int32Array(groupCount);
    const onStack = new Uint8Array(groupCount);
    const stack = [];
    let idx = 0;
    let sccCount = 0;
    for (let s0 = 0; s0 < groupCount; s0++) {
      if (index[s0] !== -1) continue;
      const work = [[s0, 0]];
      while (work.length) {
        const frame = work[work.length - 1];
        const v = frame[0];
        if (frame[1] === 0) {
          index[v] = idx;
          low[v] = idx;
          idx++;
          stack.push(v);
          onStack[v] = 1;
        }
        let advanced = false;
        while (frame[1] < adjList[v].length) {
          const w = adjList[v][frame[1]++];
          if (index[w] === -1) {
            work.push([w, 0]);
            advanced = true;
            break;
          } else if (onStack[w] && index[w] < low[v]) {
            low[v] = index[w];
          }
        }
        if (advanced) continue;
        if (low[v] === index[v]) {
          for (;;) {
            const w = stack.pop();
            onStack[w] = 0;
            sccOf[w] = sccCount;
            if (w === v) break;
          }
          sccCount++;
        }
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1][0];
          if (low[v] < low[parent]) low[parent] = low[v];
        }
      }
    }
  }
  // Final regions = SCCs, numbered in first-seen spot order. `cols` counts
  // distinct scan columns (spots arrive x-ascending, so a lastX check works).
  const regionOf = new Int32Array(n);
  const regions = [];
  const sccIndex = new Map();
  for (let i = 0; i < n; i++) {
    const s = sccOf[groupOf[i]];
    let ri = sccIndex.get(s);
    if (ri === undefined) {
      ri = regions.length;
      sccIndex.set(s, ri);
      regions.push({ count: 0, cols: 0, lastX: -1, minX: Infinity, maxX: -Infinity, indices: [] });
    }
    const reg = regions[ri];
    reg.count++;
    if (spots[i].x !== reg.lastX) { reg.cols++; reg.lastX = spots[i].x; }
    if (spots[i].x < reg.minX) reg.minX = spots[i].x;
    if (spots[i].x > reg.maxX) reg.maxX = spots[i].x;
    reg.indices.push(i);
    regionOf[i] = ri;
  }
  let totalCols = 0;
  {
    let lastX = -1;
    for (let i = 0; i < n; i++) {
      if (spots[i].x !== lastX) { totalCols++; lastX = spots[i].x; }
    }
  }
  return { regions, regionOf, totalCols };
}

// Verdict (MAPGEN.md 3.1.4, calibrated on measured region structure). The
// fraction tests run over distinct standable *columns* rather than raw spots:
// Worms maps are vertically rich (cave ledges stack several spots per
// column), so a spot-count fraction punishes verticality; column coverage
// captures the intent — "most of the map's width is usable" / "no two big
// halves with everyone on one side".
//   single: R1 holds >= need*4 spots and covers >= 55% of standable columns.
//   multi:  top k<=3 regions, each >= need spots (a full rotation fits) and
//           spanning >= 20% of playfield width, together holding >= need*2
//           spots and >= 35% of standable columns. Worms are then dealt
//           across the accepted regions by the x-sorted team interleave.
function verdict(spots, regions, totalCols, need, width, arch) {
  if (spots.length === 0 || regions.length === 0) {
    return { ok: false, accepted: [], sorted: [] };
  }
  const sorted = regions
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.count - a.r.count || a.r.minX - b.r.minX || a.i - b.i);
  const r1 = sorted[0].r;
  if (r1.count >= need * 4 && r1.cols >= Math.ceil(0.55 * totalCols)) {
    return { ok: true, accepted: [sorted[0].i], sorted };
  }
  const cands = [];
  for (let k = 0; k < sorted.length && cands.length < 3; k++) {
    const r = sorted[k].r;
    if (r.count >= need && r.maxX - r.minX >= 0.2 * width) cands.push(sorted[k]);
  }
  let sum = 0, sumCols = 0;
  for (let k = 0; k < cands.length; k++) {
    sum += cands[k].r.count;
    sumCols += cands[k].r.cols;
  }
  if (cands.length > 0 && sum >= need * 2 && sumCols >= Math.ceil(0.35 * totalCols)) {
    return { ok: true, accepted: cands.map((c) => c.i), sorted };
  }
  return { ok: false, accepted: [], sorted };
}

// Ramp carve (repair step 1): join the two largest regions with a walkable
// (<=45deg, switchbacked) carved ramp + causeway floor where it crosses air.
function rampCarve(terrain, spots, sorted, waterLevel) {
  if (sorted.length < 2) return false;
  const A = sorted[0].r.indices;
  const B = sorted[1].r.indices;
  let best = Infinity, ba = -1, bb = -1;
  for (let i = 0; i < A.length; i++) {
    const a = spots[A[i]];
    for (let j = 0; j < B.length; j++) {
      const b = spots[B[j]];
      const dx = a.x - b.x, dy = a.y - b.y;
      const d = dx * dx + dy * dy;
      if (d < best) { best = d; ba = A[i]; bb = B[j]; }
    }
  }
  if (ba < 0) return false;
  const a = spots[ba], b = spots[bb];
  const yCap = Math.min(waterLevel - 40, terrain.height - 40);
  const path = slopePath(a.x, Math.min(a.y, yCap), b.x, Math.min(b.y, yCap), 6, terrain.width);
  // Pass 1: carve headroom above the walk line.
  for (let i = 0; i < path.length; i++) {
    const px = path[i][0];
    const py = Math.min(path[i][1], yCap);
    terrain._circle(px, py - 10, 13, 0);
  }
  // Pass 2: causeway — a 6px floor strip under the walk line (no-op where the
  // line crosses existing solid, a bridge where it crosses air/water gaps).
  const w = terrain.width, h = terrain.height;
  for (let i = 0; i < path.length; i++) {
    const px = Math.round(path[i][0]);
    const py = Math.min(Math.round(path[i][1]), yCap);
    for (let y = py + 5; y <= py + 10 && y < h - 18; y++) {
      const row = y * w;
      const x0 = Math.max(0, px - 12);
      const x1 = Math.min(w - 1, px + 12);
      for (let x = x0; x <= x1; x++) terrain.data[row + x] = 1;
    }
  }
  return true;
}

// Plateau fallback (repair step 3): unconditionally solvable last resort.
function plateauFallback(seed, width, height) {
  const terrain = Terrain.generate(seed, width, height);
  terrain.data.fill(0); // wipe: the fallback must pass the verdict outright
  const y0 = Math.floor(height * 0.45);
  const x0 = Math.floor(width * 0.15);
  const x1 = Math.floor(width * 0.85);
  for (let y = y0; y < y0 + 50 && y < height - 18; y++) {
    const row = y * width;
    for (let x = x0; x < x1; x++) terrain.data[row + x] = 1;
  }
  terrain.version = 0;
  terrain.dirtyRects = [];
  return terrain;
}

function scanAndJudge(terrain, waterLevel, need, width, arch) {
  const spots = findSpawnSpots(terrain, waterLevel, SCAN_STEP);
  const { regions, regionOf, totalCols } = buildRegions(spots, terrain);
  const v = verdict(spots, regions, totalCols, need, width, arch);
  return { spots, regions, regionOf, totalCols, v };
}

// Full pipeline with diagnostics. generateWorld() is the thin binding wrapper.
export function generateWorldDetailed(seed, width, height, teams) {
  const counts = teamCounts(teams);
  let need = 0;
  for (let i = 0; i < counts.length; i++) need += counts[i];
  const waterLevel = Math.round(C.WATER_LEVEL * (height / C.WORLD_H));

  let terrain = null;
  let judged = null;
  let arch = -1;
  const meta = { attempts: 0, rampUsed: false, plateau: false, archetype: -1, spacing: 0 };

  for (let attempt = 0; attempt <= 3; attempt++) {
    const genSeed = attempt === 0 ? seed : hashSeed(seed, 0x5EED0 + attempt);
    terrain = Terrain.generate(genSeed, width, height);
    arch = pickArchetype(genSeed);
    meta.attempts = attempt + 1;
    meta.rampUsed = false;
    judged = scanAndJudge(terrain, waterLevel, need, width, arch);
    if (judged.v.ok) break;
    // Repair step 1: ramp carve, once, when the top two regions are each
    // individually big enough to host every worm.
    const s = judged.v.sorted;
    if (s.length >= 2 && s[0].r.count >= need && s[1].r.count >= need) {
      if (rampCarve(terrain, judged.spots, s, waterLevel)) {
        judged = scanAndJudge(terrain, waterLevel, need, width, arch);
        if (judged.v.ok) { meta.rampUsed = true; break; }
      }
    }
  }

  if (!judged.v.ok) {
    // Repair step 3: plateau fallback — trivially passes.
    terrain = plateauFallback(seed, width, height);
    arch = pickArchetype(seed);
    meta.plateau = true;
    judged = scanAndJudge(terrain, waterLevel, need, width, arch);
  }
  meta.archetype = arch;

  // --- placement (MAPGEN.md 3.2) ---
  const { spots, regionOf, v } = judged;
  const acceptedSet = new Set(v.accepted);
  const eligible = [];
  for (let i = 0; i < spots.length; i++) {
    if (acceptedSet.has(regionOf[i])) eligible.push(spots[i]);
  }
  const rng = makeRng(hashSeed(seed, 0x51ED));
  const shuffled = eligible.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }
  // Greedy min-spacing, relaxing 60 -> 30 -> 15 -> 0 until everyone seats.
  let chosen = [];
  for (let si = 0; si < SPACINGS.length; si++) {
    const sp = SPACINGS[si];
    const sp2 = sp * sp;
    chosen = [];
    for (let i = 0; i < shuffled.length && chosen.length < need; i++) {
      const s = shuffled[i];
      let ok = true;
      for (let k = 0; k < chosen.length; k++) {
        const dx = chosen[k].x - s.x;
        const dy = chosen[k].y - s.y;
        if (dx * dx + dy * dy < sp2) { ok = false; break; }
      }
      if (ok) chosen.push(s);
    }
    if (chosen.length >= need) { meta.spacing = sp; break; }
  }
  // Backstop that MAPGEN.md 3.3 makes unreachable: verdict guarantees
  // eligible.length >= need, so spacing 0 always seats everyone. If a caller
  // hands us an absurd worm count anyway, reuse spots rather than throw.
  while (chosen.length < need && eligible.length > 0) {
    chosen.push(eligible[chosen.length % eligible.length]);
  }

  // Team interleave: sort by x, deal round-robin to teams that still need
  // spots, then shuffle assignment within each team with the same stream.
  chosen.sort((a, b) => a.x - b.x || a.y - b.y);
  const T = counts.length;
  const perTeam = counts.map(() => []);
  let t = 0;
  for (let i = 0; i < chosen.length; i++) {
    let guard = 0;
    while (perTeam[t].length >= counts[t] && guard++ <= T) t = (t + 1) % T;
    if (guard > T) break;
    perTeam[t].push(chosen[i]);
    t = (t + 1) % T;
  }
  const out = [];
  for (let ti = 0; ti < T; ti++) {
    const list = perTeam[ti];
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    for (let k = 0; k < counts[ti]; k++) {
      const s = list[k] || list[list.length - 1];
      out.push({ x: s.x, y: s.y });
    }
  }

  terrain.version = 0;
  terrain.dirtyRects = [];
  return { terrain, spots: out, meta, waterLevel };
}

// Binding API (ARCHITECTURE.md expansion contract).
export function generateWorld(seed, width, height, teams) {
  const { terrain, spots } = generateWorldDetailed(seed, width, height, teams);
  return { terrain, spots };
}

// Internals exposed for mapgen-selftest.js only.
export const __mapgenTest = { buildRegions, verdict, SCAN_STEP, SPACINGS };
