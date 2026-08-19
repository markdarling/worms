// Destructible bitmap terrain. Uint8Array(width*height), 1 = solid.
// Generation: layered seeded sinusoids + value noise island silhouette with
// edge taper into the sea, carved pockets/overhangs, surface lumps and the
// occasional floating island. Grass/soil colouring is presentation's job.

import { makeRng, hashSeed } from './rng.js';
import { dsin } from './physics.js';
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
    const g = makeRng(hashSeed(seed, 0x7e44));
    const nseedA = hashSeed(seed, 11);
    const nseedB = hashSeed(seed, 23);
    const nseedC = hashSeed(seed, 37);

    // Surface silhouette: base line + 4 sinusoid octaves + 2 noise octaves.
    // A per-seed drama factor makes some maps gentle rolling hills and others
    // jagged peaks and deep bays — classic Worms maps vary wildly per match.
    const drama = 0.85 + g() * 0.75;
    const waves = [];
    const cycles = [1.5 + g(), 3 + g() * 2, 6 + g() * 3, 11 + g() * 5];
    const amps = [0.11, 0.06, 0.03, 0.016];
    for (let o = 0; o < 4; o++) {
      waves.push({ k: (TAU * cycles[o]) / width, amp: height * amps[o] * drama, ph: g() * TAU });
    }
    const baseY = height * 0.44;
    const margin = width * 0.11;
    const surf = new Float64Array(width);
    const bottom = new Float64Array(width);
    for (let x = 0; x < width; x++) {
      let s = baseY;
      for (let o = 0; o < 4; o++) s += waves[o].amp * dsin(x * waves[o].k + waves[o].ph);
      s += (noise1(nseedA, x, 140) - 0.5) * height * 0.14;
      s += (noise1(nseedB, x, 48) - 0.5) * height * 0.05;
      if (s < height * 0.14) s = height * 0.14;
      // Taper into the sea at both edges: surface sinks below the seabed line.
      const e = Math.min(x, width - 1 - x) / margin;
      const et = e >= 1 ? 1 : e * e * (3 - 2 * e);
      s = (height + 60) * (1 - et) + s * et;
      surf[x] = s;
      let b = height * 0.925 + (noise1(nseedC, x, 150) - 0.5) * height * 0.06;
      if (b > height - 18) b = height - 18; // guaranteed water gap at the bottom
      bottom[x] = b;
    }
    for (let x = 0; x < width; x++) {
      const y0 = Math.floor(surf[x]);
      const y1 = Math.floor(bottom[x]);
      for (let y = Math.max(0, y0); y <= y1 && y < height; y++) t.data[y * width + x] = 1;
    }

    // Sea channels: most maps split into 2-3 separate islands, the classic
    // Worms archipelago look. Slanted, noisy-edged gaps carved to the seabed.
    const channels = g() < 0.65 ? 1 + (g() < 0.35 ? 1 : 0) : 0;
    for (let i = 0; i < channels; i++) {
      const nsD = hashSeed(seed, 51 + i * 2);
      const nsE = hashSeed(seed, 52 + i * 2);
      const cx = width * (channels === 1 ? 0.3 + g() * 0.4 : 0.22 + i * 0.42 + g() * 0.16);
      const cw = 55 + g() * 85;
      const slant = (g() - 0.5) * 0.5;
      for (let y = 0; y < height; y++) {
        const c = cx + slant * (y - height * 0.5) + (noise1(nsD, y, 60) - 0.5) * 46;
        const half = (cw / 2) * (0.75 + 0.5 * noise1(nsE, y, 90));
        const x0 = Math.max(0, Math.floor(c - half));
        const x1 = Math.min(width - 1, Math.ceil(c + half));
        const row = y * width;
        for (let x = x0; x <= x1; x++) t.data[row + x] = 0;
      }
    }

    // Carve pockets and caves — some intersect the surface for bays/overhangs.
    // Mix round pockets with wide, squashed ellipses (Worms caves are broad).
    const pockets = 10 + Math.floor(g() * 7);
    for (let i = 0; i < pockets; i++) {
      const px = width * (0.08 + g() * 0.84);
      const f = g();
      const r = 16 + g() * 46;
      const wide = g() < 0.45;
      const sy = surf[Math.floor(px)];
      if (sy > height) continue;
      const py = sy - 20 + (f * 1.1) * (height * 0.9 - sy);
      if (wide) t._ellipse(px, py, r * 1.6, r * 0.65, 0);
      else t._circle(px, py, r, 0);
    }

    // Tunnel caves: random walks of overlapping carve-circles through the
    // interior, giving winding passages and dramatic overhangs.
    const tunnels = 1 + Math.floor(g() * 3);
    for (let i = 0; i < tunnels; i++) {
      let tx = width * (0.15 + g() * 0.7);
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

    // Additive lumps at the surface: bumps and overhang lips.
    const lumps = 5 + Math.floor(g() * 4);
    for (let i = 0; i < lumps; i++) {
      const lx = width * (0.1 + g() * 0.8);
      const off = g();
      const r = 10 + g() * 26;
      const sy = surf[Math.floor(lx)];
      if (sy > height * 0.95) continue;
      t._circle(lx, sy - 4 + off * 18, r, 1);
    }

    // Occasional floating islands.
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
