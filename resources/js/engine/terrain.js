// Destructible bitmap terrain. Uint8Array(width*height), 1 = solid.
//
// Generation (MAPGEN v2, docs/MAPGEN.md): a weighted archetype table picks one
// of six recipes per seed — Archipelago, Single Island, Highlands, Cavern,
// Floating Chunks, Twin Peaks — all built from shared seeded primitives:
// surface synthesis (sinusoid + value-noise octaves), sea channels, pockets,
// tunnel walks, lumps, floating islands, plus two v2 primitives: blob()
// (Hedgewars-lite distorted polygons) and roof() (cavern ceiling + walls).
// Grass/soil colouring is presentation's job.
//
// RNG tag table (every stream is makeRng(hashSeed(seed, TAG)); never reuse):
//   0xA0C1        archetype pick
//   11, 23, 37    surface value-noise lattices (legacy tags, kept)
//   0x5F0C        surface synthesis params
//   0xC4A7        sea channels (+ per-channel noise lattices 51+2i / 52+2i)
//   0x90CC        pockets
//   0x7A11        tunnel walks
//   0x1A3B        lumps
//   0xF10A        floating islands
//   0x7E44+arch   recipe-specific params (twin peaks uses +5)
//   0x400F        roof params, 0x4010 roof noise, 0x4011 wall noise
//   0xC33E        floating-chunk layout
//   0xB10B+i      blob i params (verts/rough), 0x1B10B+i blob i body
//   0xB41D        MST bridge widths
//   (placement.js) 0x51ED spawn shuffle, 0x5EED0+n deterministic re-rolls

import { makeRng, hashSeed } from './rng.js';
import { dsin, dcos } from './physics.js';
import { C } from './constants.js';

const TAU = Math.PI * 2;

// --- portable base64 (no Buffer/atob dependency) ---
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_REV = (() => {
  const r = new Int8Array(128).fill(-1);
  for (let i = 0; i < 64; i++) r[B64.charCodeAt(i)] = i;
  return r;
})();

function bytesToB64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 63] : '=';
  }
  return out;
}

function b64ToBytes(str) {
  let len = str.length;
  while (len > 0 && str[len - 1] === '=') len--;
  const outLen = Math.floor((len * 3) / 4);
  const out = new Uint8Array(outLen);
  let o = 0, buf = 0, bits = 0;
  for (let i = 0; i < len; i++) {
    buf = (buf << 6) | B64_REV[str.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return out;
}

// 1D value noise on a seeded lattice, smoothstep interpolated, in [0,1).
function noise1(seed, x, scale) {
  const xf = x / scale;
  const xi = Math.floor(xf);
  const f = xf - xi;
  const a = makeRng(hashSeed(seed, xi))();
  const b = makeRng(hashSeed(seed, xi + 1))();
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

// --- archetypes ---
export const ARCHETYPE_NAMES = [
  'archipelago', 'island', 'highlands', 'cavern', 'chunks', 'twinpeaks',
];
const ARCH_WEIGHTS = [0.26, 0.20, 0.16, 0.14, 0.13, 0.11];

// Deterministic archetype index for a seed. Terrain.generate and placement.js
// both consult this — it must stay the very first decision made from a seed.
export function pickArchetype(seed) {
  const roll = makeRng(hashSeed(seed, 0xA0C1))();
  let acc = 0;
  for (let i = 0; i < ARCH_WEIGHTS.length; i++) {
    acc += ARCH_WEIGHTS[i];
    if (roll < acc) return i;
  }
  return 0;
}

// Slope-limited (<=45deg) polyline from a to b, stepping `step` px. When the
// route is steeper than 45deg, the diagonal leg drifts sideways (toward b when
// that helps, else toward the map centre, bouncing off edges) until the height
// is made up, then a horizontal leg returns to b — a walkable Z-ramp, never a
// switchback ladder. Pure arithmetic — deterministic.
export function slopePath(ax, ay, bx, by, step, width) {
  const pts = [];
  let x = ax, y = ay;
  const need = Math.abs(by - ay);
  let dir;
  if (Math.abs(bx - ax) >= need) dir = bx >= ax ? 1 : -1;
  else dir = (ax + bx) / 2 < width / 2 ? 1 : -1;
  const maxSteps = Math.ceil((Math.abs(bx - ax) + 2 * need) / step) * 2 + 80;
  let i = 0;
  // Phase 1: diagonal (<=45deg) until the height difference is made up.
  while (Math.abs(by - y) > step && i++ < maxSteps) {
    pts.push([x, y]);
    y += (by > y ? 1 : -1) * step;
    x += dir * step;
    if (x < 20) { x = 20; dir = 1; }
    if (x > width - 20) { x = width - 20; dir = -1; }
  }
  // Phase 2: horizontal leg to b.
  while (Math.abs(bx - x) > step && i++ < maxSteps) {
    pts.push([x, y]);
    x += (bx > x ? 1 : -1) * step;
  }
  pts.push([bx, by]);
  return pts;
}

// --- generation helpers (module-private) ---

// Raised-cosine bump: full height at centre, 0 at +-hw.
function raisedCos(x, p) {
  const d = Math.abs(x - p.c);
  if (d >= p.hw) return 0;
  return p.hgt * 0.5 * (1 + dcos(Math.PI * (d / p.hw)));
}

// Surface silhouette + seabed + column fill. Returns {surf, bottom}.
// o: {baseYFrac, dramaMin, dramaMax, marginFrac, noiseAMul, minYFrac, peaks}
function synthSurface(t, seed, o) {
  const width = t.width, height = t.height;
  const g = makeRng(hashSeed(seed, 0x5F0C));
  const nseedA = hashSeed(seed, 11);
  const nseedB = hashSeed(seed, 23);
  const nseedC = hashSeed(seed, 37);

  const drama = o.dramaMin + g() * (o.dramaMax - o.dramaMin);
  const cycles = [1.5 + g(), 3 + g() * 2, 6 + g() * 3, 11 + g() * 5];
  const amps = [0.11, 0.06, 0.03, 0.016];
  const waves = [];
  for (let oc = 0; oc < 4; oc++) {
    waves.push({ k: (TAU * cycles[oc]) / width, amp: height * amps[oc] * drama, ph: g() * TAU });
  }
  const baseY = height * o.baseYFrac;
  const margin = width * o.marginFrac;
  const nAmpA = height * 0.14 * (o.noiseAMul || 1);
  const minY = height * (o.minYFrac ?? 0.14);
  const peaks = o.peaks || null;
  const surf = new Float64Array(width);
  const bottom = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    let s = baseY;
    for (let oc = 0; oc < 4; oc++) s += waves[oc].amp * dsin(x * waves[oc].k + waves[oc].ph);
    s += (noise1(nseedA, x, 140) - 0.5) * nAmpA;
    s += (noise1(nseedB, x, 48) - 0.5) * height * 0.05;
    if (peaks) for (let p = 0; p < peaks.length; p++) s -= raisedCos(x, peaks[p]);
    if (s < minY) s = minY;
    surf[x] = s;
  }
  // Slope-limit the silhouette (<= ~67deg, STEP_UP walkable both ways) so the
  // top surface is traversable by construction — cliffs only ever come from
  // carved features, never from octave-noise spikes.
  const LIM = 2.4;
  for (let x = 1; x < width; x++) {
    if (surf[x] > surf[x - 1] + LIM) surf[x] = surf[x - 1] + LIM;
    else if (surf[x] < surf[x - 1] - LIM) surf[x] = surf[x - 1] - LIM;
  }
  for (let x = width - 2; x >= 0; x--) {
    if (surf[x] > surf[x + 1] + LIM) surf[x] = surf[x + 1] + LIM;
    else if (surf[x] < surf[x + 1] - LIM) surf[x] = surf[x + 1] - LIM;
  }
  for (let x = 0; x < width; x++) {
    // Taper into the sea at both edges: surface sinks below the seabed line.
    const e = Math.min(x, width - 1 - x) / margin;
    const et = e >= 1 ? 1 : e * e * (3 - 2 * e);
    surf[x] = (height + 60) * (1 - et) + surf[x] * et;
    let b = height * 0.925 + (noise1(nseedC, x, 150) - 0.5) * height * 0.06;
    if (b > height - 18) b = height - 18; // guaranteed water gap at the bottom
    bottom[x] = b;
  }
  for (let x = 0; x < width; x++) {
    const y0 = Math.floor(surf[x]);
    const y1 = Math.floor(bottom[x]);
    for (let y = Math.max(0, y0); y <= y1 && y < height; y++) t.data[y * width + x] = 1;
  }
  return { surf, bottom };
}

// Sea channels: slanted, noisy-edged gaps carved to the seabed.
// spec: {count, centers?: [fraction,...]}
function carveChannels(t, seed, spec) {
  const width = t.width, height = t.height;
  const g = makeRng(hashSeed(seed, 0xC4A7));
  for (let i = 0; i < spec.count; i++) {
    const nsD = hashSeed(seed, 51 + i * 2);
    const nsE = hashSeed(seed, 52 + i * 2);
    const jitter = g();
    const cw = 55 + g() * 85;
    const slant = (g() - 0.5) * 0.5;
    const cxf = spec.centers
      ? spec.centers[i] + (jitter - 0.5) * 0.05
      : spec.count === 1 ? 0.3 + jitter * 0.4 : 0.22 + i * 0.42 + jitter * 0.16;
    const cx = width * cxf;
    for (let y = 0; y < height; y++) {
      const c = cx + slant * (y - height * 0.5) + (noise1(nsD, y, 60) - 0.5) * 46;
      const half = (cw / 2) * (0.75 + 0.5 * noise1(nsE, y, 90));
      const x0 = Math.max(0, Math.floor(c - half));
      const x1 = Math.min(width - 1, Math.ceil(c + half));
      const row = y * width;
      for (let x = x0; x <= x1; x++) t.data[row + x] = 0;
    }
  }
}

// Carved pockets/caves — some intersect the surface for bays/overhangs.
// spec: {min, max, wideBias}
function carvePockets(t, seed, surf, spec) {
  const width = t.width, height = t.height;
  const g = makeRng(hashSeed(seed, 0x90CC));
  const count = spec.min + Math.floor(g() * (spec.max - spec.min + 1));
  const wideBias = spec.wideBias ?? 0.45;
  for (let i = 0; i < count; i++) {
    const px = width * (0.08 + g() * 0.84);
    const f = g();
    const r = 16 + g() * 46;
    const wide = g() < wideBias;
    const sy = surf[Math.floor(px)];
    if (sy > height) continue;
    const py = sy - 20 + (f * 1.1) * (height * 0.9 - sy);
    if (py - r < sy + 10) {
      // Surface-biting pocket: force a wide, shallow bay whose walls stay
      // within backflip escape height (~44px) so it never traps a worm.
      t._ellipse(px, py, r * 1.7, Math.min(r * 0.65, 30), 0);
    } else if (wide) {
      t._ellipse(px, py, r * 1.6, r * 0.65, 0);
    } else {
      t._circle(px, py, r, 0);
    }
  }
}

// Tunnel caves: random walks of overlapping carve-circles through the interior.
// spec: {min, max, xRanges?: [[x0px,x1px],...]}  (walks round-robin over ranges)
function carveTunnels(t, seed, surf, spec) {
  const width = t.width, height = t.height;
  const g = makeRng(hashSeed(seed, 0x7A11));
  const count = spec.min + Math.floor(g() * (spec.max - spec.min + 1));
  for (let i = 0; i < count; i++) {
    const range = spec.xRanges
      ? spec.xRanges[i % spec.xRanges.length]
      : [width * 0.15, width * 0.85];
    let tx = range[0] + g() * (range[1] - range[0]);
    if (tx < 8) tx = 8;
    if (tx > width - 8) tx = width - 8;
    const sy = surf[Math.floor(tx)];
    if (sy > height * 0.9) continue;
    let ty = sy + 40 + g() * (height * 0.8 - sy - 40 > 0 ? height * 0.8 - sy - 40 : 0);
    let ang = g() * TAU;
    const steps = 8 + Math.floor(g() * 9);
    for (let s = 0; s < steps; s++) {
      const r = 12 + g() * 10;
      t._circle(tx, ty, r, 0);
      ang += (g() - 0.5) * 1.6;
      tx += dsin(ang + Math.PI / 2) * r * 1.2;
      ty += dsin(ang) * r * 0.7;
      if (tx < width * 0.05 || tx > width * 0.95 || ty > height * 0.9 || ty < 40) break;
    }
  }
}

// Additive lumps at the surface: bumps and overhang lips. spec: {min, max}
function addLumps(t, seed, surf, spec) {
  const width = t.width, height = t.height;
  const g = makeRng(hashSeed(seed, 0x1A3B));
  const count = spec.min + Math.floor(g() * (spec.max - spec.min + 1));
  for (let i = 0; i < count; i++) {
    const lx = width * (0.1 + g() * 0.8);
    const off = g();
    const r = 10 + g() * 26;
    const sy = surf[Math.floor(lx)];
    if (sy > height * 0.95) continue;
    t._circle(lx, sy - 4 + off * 18, r, 1);
  }
}

// Occasional floating islands (2 independent 50% rolls, like v1).
function addFloatingIslands(t, seed, surf) {
  const width = t.width, height = t.height;
  const g = makeRng(hashSeed(seed, 0xF10A));
  for (let i = 0; i < 2; i++) {
    const roll = g();
    const fx = width * (0.15 + g() * 0.7);
    const rx = 35 + g() * 55;
    const ry = 12 + g() * 10;
    const lift = 90 + g() * 90;
    if (roll < 0.5) continue;
    const sy = surf[Math.floor(fx)];
    const fy = Math.max(60, Math.min(sy, height * 0.6) - lift);
    t._ellipse(fx, fy, rx, ry, 1);
  }
}

// blob(): Hedgewars-lite distorted polygon (MAPGEN.md 2.1). verts-gon with
// per-vertex random radius, then 3 rounds of midpoint subdivision displacing
// along the edge normal, displacement clamped so it cannot self-intersect
// badly enough to matter on a raster. Scanline even-odd fill.
function blob(t, blobSeed, cx, cy, rBase, verts, rough, val) {
  const r = makeRng(blobSeed);
  let pts = [];
  for (let i = 0; i < verts; i++) {
    const a = (TAU * i) / verts;
    const rad = rBase * (0.6 + r() * 0.8);
    pts.push([cx + dcos(a) * rad, cy + dsin(a) * rad]);
  }
  let ro = rough;
  for (let round = 0; round < 3; round++) {
    const next = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const len = Math.sqrt(ex * ex + ey * ey);
      let disp = (r() - 0.5) * len * ro; // consume even if degenerate
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      if (len < 0.0001) {
        next.push(a, [mx, my]);
        continue;
      }
      const clampD = Math.min(len * 0.45, rBase * 0.35);
      if (disp > clampD) disp = clampD;
      else if (disp < -clampD) disp = -clampD;
      next.push(a, [mx + (ey / len) * disp, my - (ex / len) * disp]);
    }
    pts = next;
    ro *= 0.5;
  }
  fillPolygon(t, pts, val);
}

// Scanline even-odd polygon fill. Clamped so it can never touch the
// guaranteed bottom water gap.
function fillPolygon(t, pts, val) {
  const width = t.width, height = t.height;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i][1] < minY) minY = pts[i][1];
    if (pts[i][1] > maxY) maxY = pts[i][1];
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(height - 18, Math.ceil(maxY));
  const xs = [];
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) {
        xs.push(a[0] + ((b[0] - a[0]) * (yc - a[1])) / (b[1] - a[1]));
      }
    }
    xs.sort((p, q) => p - q);
    const row = y * width;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k]));
      const xb = Math.min(width - 1, Math.floor(xs[k + 1]));
      for (let x = xa; x <= xb; x++) t.data[row + x] = val;
    }
  }
}

// roof(): cavern ceiling — an independent surface line mirrored downward —
// joined to noise-wobbled side walls.
function addRoof(t, seed) {
  const width = t.width, height = t.height;
  const g = makeRng(hashSeed(seed, 0x400F));
  const nsRoof = hashSeed(seed, 0x4010);
  const nsWall = hashSeed(seed, 0x4011);
  const cyc = [2 + g() * 1.5, 5 + g() * 2, 9 + g() * 4];
  const ampMul = 0.8 + g() * 0.6;
  const amps = [0.05, 0.03, 0.015];
  const waves = [];
  for (let oc = 0; oc < 3; oc++) {
    waves.push({ k: (TAU * cyc[oc]) / width, amp: height * amps[oc] * ampMul, ph: g() * TAU });
  }
  const base = height * 0.16;
  for (let x = 0; x < width; x++) {
    let ry = base;
    for (let oc = 0; oc < 3; oc++) ry += waves[oc].amp * dsin(x * waves[oc].k + waves[oc].ph);
    ry += (noise1(nsRoof, x, 120) - 0.5) * height * 0.08;
    if (ry < height * 0.05) ry = height * 0.05;
    if (ry > height * 0.30) ry = height * 0.30;
    const yEnd = Math.floor(ry);
    for (let y = 0; y <= yEnd; y++) t.data[y * width + x] = 1;
  }
  // Side walls, stopping above the guaranteed bottom water gap.
  const wallMax = height - 18;
  for (let y = 0; y < wallMax; y++) {
    const ww = Math.floor(40 + noise1(nsWall, y, 70) * 50);
    const row = y * width;
    for (let x = 0; x < ww; x++) t.data[row + x] = 1;
    for (let x = width - ww; x < width; x++) t.data[row + x] = 1;
  }
}

// Prim's MST over chunk centres, dy-weighted so bridges prefer walkable
// (horizontal-ish) links. Deterministic tie-break: first (lowest) index wins.
function mstEdges(centres) {
  const n = centres.length;
  const inTree = new Uint8Array(n);
  const dist = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n);
  const edges = [];
  inTree[0] = 1;
  for (let j = 1; j < n; j++) {
    const dx = centres[j].x - centres[0].x;
    const dy = (centres[j].y - centres[0].y) * 1.8;
    dist[j] = dx * dx + dy * dy;
    from[j] = 0;
  }
  for (let k = 1; k < n; k++) {
    let best = -1;
    for (let j = 0; j < n; j++) {
      if (!inTree[j] && (best === -1 || dist[j] < dist[best])) best = j;
    }
    inTree[best] = 1;
    edges.push([from[best], best]);
    for (let j = 0; j < n; j++) {
      if (inTree[j]) continue;
      const dx = centres[j].x - centres[best].x;
      const dy = (centres[j].y - centres[best].y) * 1.8;
      const d = dx * dx + dy * dy;
      if (d < dist[j]) {
        dist[j] = d;
        from[j] = best;
      }
    }
  }
  return edges;
}

// --- the six recipes ---

function genArchipelago(t, seed, af) {
  const g = makeRng(hashSeed(seed, 0x7E44 + 0)); // channel count roll
  const { surf } = synthSurface(t, seed, {
    baseYFrac: 0.44, dramaMin: 0.85, dramaMax: 1.3, marginFrac: 0.11,
  });
  carveChannels(t, seed, { count: 1 + (g() < 0.5 ? 1 : 0) });
  carvePockets(t, seed, surf, { min: Math.round(10 * af), max: Math.round(16 * af) });
  carveTunnels(t, seed, surf, { min: 1, max: 3 });
  addLumps(t, seed, surf, { min: Math.round(5 * af), max: Math.round(8 * af) });
  addFloatingIslands(t, seed, surf);
}

function genIsland(t, seed, af) {
  const { surf } = synthSurface(t, seed, {
    baseYFrac: 0.44, dramaMin: 0.7, dramaMax: 1.1, marginFrac: 0.16,
  });
  carvePockets(t, seed, surf, { min: Math.round(12 * af), max: Math.round(18 * af) });
  carveTunnels(t, seed, surf, { min: 1, max: 3 });
  addLumps(t, seed, surf, { min: Math.round(7 * af), max: Math.round(10 * af) });
  addFloatingIslands(t, seed, surf);
}

function genHighlands(t, seed, af) {
  const g = makeRng(hashSeed(seed, 0x7E44 + 2)); // channel count roll
  const { surf } = synthSurface(t, seed, {
    baseYFrac: 0.34, dramaMin: 1.3, dramaMax: 1.7, marginFrac: 0.11, noiseAMul: 1.5,
  });
  carveChannels(t, seed, { count: g() < 0.5 ? 1 : 0 });
  carvePockets(t, seed, surf, {
    min: Math.round(10 * af), max: Math.round(16 * af), wideBias: 0.7,
  });
  carveTunnels(t, seed, surf, { min: 3, max: 5 });
  addLumps(t, seed, surf, { min: Math.round(5 * af), max: Math.round(8 * af) });
  addFloatingIslands(t, seed, surf);
}

function genCavern(t, seed, af) {
  const { surf } = synthSurface(t, seed, {
    baseYFrac: 0.40, dramaMin: 0.7, dramaMax: 1.1, marginFrac: 0.10, minYFrac: 0.36,
  });
  addRoof(t, seed);
  carvePockets(t, seed, surf, { min: Math.round(8 * af), max: Math.round(14 * af) });
  carveTunnels(t, seed, surf, { min: 4, max: 6 });
  addLumps(t, seed, surf, { min: 5, max: 8 });
  // no floating islands in a cavern
}

function genChunks(t, seed, af) {
  const width = t.width, height = t.height;
  const g = makeRng(hashSeed(seed, 0xC33E));
  const cols = g() < 0.5 ? 3 : 4;
  const rows = 2;
  const x0 = width * 0.10;
  const cellW = (width * 0.80) / cols;
  const rowY = [height * 0.30, height * 0.60];
  const rScale = Math.min(1.4, Math.max(0.8, Math.sqrt(af)));
  const water = C.WATER_LEVEL * (height / C.WORLD_H);
  const centres = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const jx = (g() - 0.5) * 0.5 * cellW;
      const jy = (g() - 0.5) * 0.25 * height * 0.3;
      const rBase = (r === 0 ? 85 + g() * 65 : 105 + g() * 75) * rScale;
      const drop = g(); // consume regardless
      if (centres.length >= 5 && drop < 0.18) continue; // 5-8 chunks
      let cx = x0 + (c + 0.5) * cellW + jx;
      let cy = rowY[r] + jy;
      const ext = rBase * 1.8;
      if (cx < ext * 0.6) cx = ext * 0.6;
      if (cx > width - ext * 0.6) cx = width - ext * 0.6;
      if (cy < ext * 0.5 + 30) cy = ext * 0.5 + 30;
      if (cy + ext * 0.7 > water - 30) cy = water - 30 - ext * 0.7;
      centres.push({ x: cx, y: cy, r: rBase });
    }
  }
  for (let i = 0; i < centres.length; i++) {
    const c = centres[i];
    const bs = makeRng(hashSeed(seed, 0xB10B + i));
    const verts = 8 + Math.floor(bs() * 7); // 8-14
    const rough = 0.55 + bs() * 0.25;
    blob(t, hashSeed(seed, 0x1B10B + i), c.x, c.y, c.r, verts, rough, 1);
  }
  // MST bridges: connectivity by construction (Bamboy trick), slope-limited
  // so every bridge is walkable.
  const gB = makeRng(hashSeed(seed, 0xB41D));
  const edges = mstEdges(centres);
  for (let e = 0; e < edges.length; e++) {
    const a = centres[edges[e][0]];
    const b = centres[edges[e][1]];
    const bw = 26 + gB() * 8;
    // Attach near the blob tops so the deck meets the walkable upper flank
    // instead of dead-ending against the blob's side wall.
    const path = slopePath(a.x, a.y - a.r * 0.7, b.x, b.y - b.r * 0.7, 6, width);
    for (let i = 0; i < path.length; i++) {
      let py = path[i][1];
      if (py > height - 40) py = height - 40;
      t._circle(path[i][0], py, bw / 2, 1);
    }
  }
}

function genTwinPeaks(t, seed, af) {
  const width = t.width, height = t.height;
  const g = makeRng(hashSeed(seed, 0x7E44 + 5));
  const peaks = [];
  for (let i = 0; i < 2; i++) {
    const cf = i === 0 ? 0.28 : 0.72;
    peaks.push({
      c: width * (cf + (g() - 0.5) * 0.12),
      hgt: height * (0.28 + g() * 0.12),
      hw: width * (0.12 + g() * 0.06),
    });
  }
  const { surf } = synthSurface(t, seed, {
    baseYFrac: 0.62, dramaMin: 0.5, dramaMax: 0.8, marginFrac: 0.11, peaks,
  });
  carveChannels(t, seed, { count: g() < 0.4 ? 1 : 0, centers: [0.5] });
  carvePockets(t, seed, surf, { min: Math.round(8 * af), max: Math.round(13 * af) });
  carveTunnels(t, seed, surf, {
    min: 2, max: 4,
    xRanges: [
      [peaks[0].c - peaks[0].hw * 0.8, peaks[0].c + peaks[0].hw * 0.8],
      [peaks[1].c - peaks[1].hw * 0.8, peaks[1].c + peaks[1].hw * 0.8],
    ],
  });
  addLumps(t, seed, surf, { min: 4, max: 7 });
  addFloatingIslands(t, seed, surf);
}

const RECIPES = [genArchipelago, genIsland, genHighlands, genCavern, genChunks, genTwinPeaks];

export class Terrain {
  constructor(width, height, data = null) {
    this.width = width;
    this.height = height;
    this.data = data || new Uint8Array(width * height);
    this.version = 0;
    this.dirtyRects = [];
  }

  solid(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= this.width || yi >= this.height) return false;
    return this.data[yi * this.width + xi] === 1;
  }

  _circle(cx, cy, r, val) {
    const w = this.width, h = this.height;
    const icy = Math.round(cy), icx = Math.round(cx);
    const y0 = Math.max(0, icy - Math.ceil(r));
    const y1 = Math.min(h - 1, icy + Math.ceil(r));
    for (let y = y0; y <= y1; y++) {
      const dy = y - icy;
      const half = Math.floor(Math.sqrt(r * r - dy * dy));
      const x0 = Math.max(0, icx - half);
      const x1 = Math.min(w - 1, icx + half);
      const row = y * w;
      for (let x = x0; x <= x1; x++) this.data[row + x] = val;
    }
  }

  _ellipse(cx, cy, rx, ry, val) {
    const icy = Math.round(cy), icx = Math.round(cx);
    const y0 = Math.max(0, icy - Math.ceil(ry));
    const y1 = Math.min(this.height - 1, icy + Math.ceil(ry));
    for (let y = y0; y <= y1; y++) {
      const t = (y - icy) / ry;
      const half = Math.floor(rx * Math.sqrt(Math.max(0, 1 - t * t)));
      const x0 = Math.max(0, icx - half);
      const x1 = Math.min(this.width - 1, icx + half);
      const row = y * this.width;
      for (let x = x0; x <= x1; x++) this.data[row + x] = val;
    }
  }

  // Carve a crater. Bumps `version` and records a dirty rect for the renderer.
  destroy(cx, cy, r) {
    this._circle(cx, cy, r, 0);
    this.version++;
    const x = Math.max(0, Math.floor(cx - r) - 1);
    const y = Math.max(0, Math.floor(cy - r) - 1);
    const x1 = Math.min(this.width, Math.ceil(cx + r) + 1);
    const y1 = Math.min(this.height, Math.ceil(cy + r) + 1);
    this.dirtyRects.push({ x, y, w: x1 - x, h: y1 - y });
  }

  // RLE (varint run lengths of alternating values) + base64. Exact round-trip.
  serialize() {
    const d = this.data;
    const bytes = [];
    bytes.push(d[0]);
    let run = 1;
    const pushVarint = (v) => {
      while (v >= 128) { bytes.push((v & 127) | 128); v = Math.floor(v / 128); }
      bytes.push(v);
    };
    for (let i = 1; i < d.length; i++) {
      if (d[i] === d[i - 1]) run++;
      else { pushVarint(run); run = 1; }
    }
    pushVarint(run);
    return { width: this.width, height: this.height, data: bytesToB64(bytes) };
  }

  static deserialize(obj) {
    const bytes = b64ToBytes(obj.data);
    const data = new Uint8Array(obj.width * obj.height);
    let val = bytes[0];
    let i = 1, o = 0;
    while (i < bytes.length) {
      let run = 0, shift = 1;
      for (;;) {
        const b = bytes[i++];
        run += (b & 127) * shift;
        if (b < 128) break;
        shift *= 128;
      }
      if (val === 1) data.fill(1, o, o + run);
      o += run;
      val = 1 - val;
    }
    return new Terrain(obj.width, obj.height, data);
  }

  static generate(seed, width, height) {
    const t = new Terrain(width, height);
    const arch = pickArchetype(seed);
    // Area factor scales feature counts for non-default map sizes.
    const af = Math.min(2.5, Math.max(0.6, (width * height) / (C.WORLD_W * C.WORLD_H)));
    RECIPES[arch](t, seed, af);

    // Hard guarantee: the bottom water gap survives every archetype/primitive.
    t.data.fill(0, (height - 17) * width);

    // Guarantee a standable top surface (degenerate-seed fallback).
    let standable = 0;
    const water = C.WATER_LEVEL * (height / C.WORLD_H);
    for (let x = Math.floor(width * 0.1); x < width * 0.9; x += 16) {
      let y = 12;
      while (y < water - 20 && !t.solid(x, y)) y++;
      if (y < water - 20 && !t.solid(x, y - 10)) standable++;
    }
    if (standable < 20) {
      for (let y = Math.floor(height * 0.45); y < height * 0.45 + 50; y++) {
        for (let x = Math.floor(width * 0.35); x < width * 0.65; x++) {
          t.data[y * width + x] = 1;
        }
      }
    }

    t.version = 0;
    t.dirtyRects = [];
    return t;
  }
}
