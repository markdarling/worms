// sprites.js — sprite / drawing library for Worms: Armistice.
//
// Two layers:
//   1. Ripped Worms Armageddon sheets (public/assets/sprites/, see
//      resources/assets/ripped/MANIFEST.md) loaded + chroma-keyed by
//      initAssets(). Preferred whenever loaded.
//   2. The original procedural canvas art, kept intact as an automatic
//      fallback for anything missing / failed / not yet loaded.
//
// Conventions (documented assumptions — see renderer.js header too):
//   - facing: 1 = right, -1 = left. Ripped worm frames natively face LEFT.
//   - aimAngle: radians, 0 = horizontal in the facing direction, positive = up.
//   - (x, y) for a worm / gravestone is the engine CENTRE (feet at y+5);
//     crates are centre with feet at y+6. The procedural painters treated
//     (x, y) as feet; sprite paths anchor feet at the true ground contact.
//   - t is a monotonically increasing time in seconds (drives anims).
//   - Aim strips are 32-frame ANGLE TABLES: frame 0 = straight up,
//     frame 16 = horizontal, frame 31 = straight down (measured).
//   - Projectile strips are 32-frame 360° tables: frame 0 = nose up,
//     rotating clockwise in screen coords (measured).

export const OUTLINE = '#33131f';

// ---------------------------------------------------------------------------
// Ripped asset store
// ---------------------------------------------------------------------------

const ASSET_BASE = '/assets/sprites/';
const KEYS = {
  lav: [128, 128, 192],
  khaki: [192, 192, 128],
  black: [0, 0, 0],
};

// fh defaults to 60. `whole` = single image, not a film strip.
// `pixels` = also keep ImageData (terrain bake sampling).
const SHEET_DEFS = {
  wormIdle: { file: 'worm-idle.png', key: 'lav' },
  wormBlink: { file: 'worm-blink.png', key: 'lav' },
  wormWalk: { file: 'worm-walk.png', key: 'lav' },
  wormFall: { file: 'worm-fall.png', key: 'lav' },
  wormFly: { file: 'worm-fly.png', key: 'lav' },
  aimBazooka: { file: 'worm-aim-bazooka.png', key: 'lav' },
  aimGrenade: { file: 'worm-throw-grenade.png', key: 'lav' },
  aimCluster: { file: 'worm-throw-cluster.png', key: 'lav' },
  aimShotgun: { file: 'worm-aim-shotgun.png', key: 'lav' },
  parachute: { file: 'worm-parachute.png', fw: 90, fh: 90, key: 'khaki' },
  projShell: { file: 'proj-bazooka-shell.png', key: 'lav' },
  projGrenade: { file: 'proj-grenade.png', key: 'lav' },
  projCluster: { file: 'proj-cluster.png', key: 'lav' },
  projBomblet: { file: 'proj-cluster-bomblet.png', key: 'lav' },
  projDynamite: { file: 'proj-dynamite.png', key: 'lav' },
  gravestone: { file: 'gravestone-1.png', key: 'khaki' },
  crate: { file: 'crate-weapon.png', key: 'khaki' },
  crosshair: { file: 'ui-crosshair.png', key: 'lav' },
  arrow: { file: 'ui-arrow-down.png', key: 'lav' },
  terrainSoil: { file: 'terrain-forest-texture.png', whole: true, pixels: true },
  terrainGrass: { file: 'terrain-forest-grass.png', whole: true, pixels: true },
  skyGradient: { file: 'terrain-forest-gradient.png', whole: true },
  backdrop: { file: 'terrain-forest-back.png', whole: true, key: 'black' },
};

// Weapon-id -> ripped icon file (manifest naming).
const ICON_FILES = {
  bazooka: 'icon-bazooka.png',
  grenade: 'icon-grenade.png',
  cluster: 'icon-cluster.png',
  shotgun: 'icon-shotgun.png',
  firepunch: 'icon-firepnch.png',
  dynamite: 'icon-dynamite.png',
  airstrike: 'icon-airstrke.png',
  teleport: 'icon-teleport.png',
  skip: 'icon-skipgo.png',
};

let assetsReady = false;
const sheets = {};     // name -> {canvas, fw, fh, frames}
const pixelData = {};  // name -> ImageData
const iconBitmaps = {}; // weapon id -> ImageBitmap

/**
 * Fetch, chroma-key and slice all ripped sheets. Resolves even when files
 * are missing (each failure warns and leaves the procedural fallback active).
 */
export async function initAssets() {
  if (typeof document === 'undefined' || assetsReady) return;
  const jobs = [];
  for (const [name, def] of Object.entries(SHEET_DEFS)) jobs.push(loadSheet(name, def));
  for (const [id, file] of Object.entries(ICON_FILES)) jobs.push(loadIcon(id, file));
  await Promise.all(jobs);
  assetsReady = true;
}

async function fetchBitmap(file) {
  const res = await fetch(ASSET_BASE + file);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

async function loadSheet(name, def) {
  try {
    const bmp = await fetchBitmap(def.file);
    const c = makeCanvas(bmp.width, bmp.height);
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    if (def.key) chromaKey(cx, c.width, c.height, KEYS[def.key], def.key === 'black' ? 10 : 30);
    if (def.pixels) pixelData[name] = cx.getImageData(0, 0, c.width, c.height);
    const fw = def.fw || 60;
    const fh = def.fh || 60;
    sheets[name] = def.whole
      ? { canvas: c, fw: c.width, fh: c.height, frames: 1 }
      : { canvas: c, fw, fh, frames: Math.max(1, Math.floor(c.height / fh)) };
  } catch (e) {
    console.warn(`[assets] ${def.file} unavailable — procedural fallback (${e.message})`);
  }
}

async function loadIcon(id, file) {
  try {
    iconBitmaps[id] = await fetchBitmap(file);
  } catch (e) {
    console.warn(`[assets] ${file} unavailable — procedural icon (${e.message})`);
  }
}

/** Key colour (± tolerance, with a soft edge band) to transparency. */
function chromaKey(cx, w, h, key, tol) {
  const img = cx.getImageData(0, 0, w, h);
  const d = img.data;
  const [kr, kg, kb] = key;
  const tol2 = tol * tol;
  const soft2 = tol2 * 4; // up to 2×tol: partial alpha for blended edges
  for (let i = 0; i < d.length; i += 4) {
    const dr = d[i] - kr;
    const dg = d[i + 1] - kg;
    const db = d[i + 2] - kb;
    const dist2 = dr * dr + dg * dg + db * db;
    if (dist2 <= tol2) d[i + 3] = 0;
    else if (dist2 <= soft2) d[i + 3] = Math.min(255, Math.round(255 * (Math.sqrt(dist2) - tol) / tol));
  }
  cx.putImageData(img, 0, 0);
}

// ---- Sprite geometry (measured from the sheets) ---------------------------
const WORM_SCALE = 0.66; // 26px worm content -> ~17px on screen
const WORM_FOOT = 43;    // foot row within the 60px frame
const FRAME_C = 30;      // frame centre (content is centred at ~30)

/** aimAngle [-π/2..π/2] (+up) -> 32-frame aim-table index (0=up..31=down). */
function aimFrame(aim) {
  const a = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, aim || 0));
  return Math.round(((Math.PI / 2 - a) / Math.PI) * 31);
}

/** Screen angle (atan2(vy, vx), +y down) -> 32-frame rotation-table index. */
function rotFrame(angle) {
  const f = Math.round(((angle + Math.PI / 2) / (Math.PI * 2)) * 32);
  return ((f % 32) + 32) % 32;
}

function blitFrame(ctx, sheet, idx, s) {
  // Draws frame `idx` centred on the current origin at scale s (crisp pixels).
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    sheet.canvas, 0, idx * sheet.fh, sheet.fw, sheet.fh,
    -FRAME_C * s, -FRAME_C * s, sheet.fw * s, sheet.fh * s,
  );
  ctx.imageSmoothingEnabled = prev;
}

// Per-worm motion tracking (position deltas between draw calls) so the
// sprite path can pick walk / fall frames without engine changes.
const _motion = new Map();

function motionFor(seed, x, y, t) {
  let m = _motion.get(seed);
  if (!m) {
    m = { x, y, t, walkUntil: -1, airUntil: -1, dist: 0 };
    _motion.set(seed, m);
  }
  const dt = t - m.t;
  if (dt > 0 && dt < 0.5) {
    const dx = x - m.x;
    const dy = y - m.y;
    if (Math.abs(dx) > 0.05) {
      m.walkUntil = t + 0.14;
      m.dist += Math.abs(dx);
    }
    if (Math.abs(dy) > 2) m.airUntil = t + 0.15; // fast vertical => airborne
  }
  m.x = x; m.y = y; m.t = t;
  return m;
}

// Renderer-facing asset accessors ------------------------------------------

/** {soil, grass} ImageData for the terrain bake, or null when unavailable. */
export function getTerrainAssets() {
  if (!assetsReady) return null;
  if (!pixelData.terrainSoil && !pixelData.terrainGrass) return null;
  return { soil: pixelData.terrainSoil || null, grass: pixelData.terrainGrass || null };
}

/** Ripped sky gradient (8x916 strip) to stretch across the canvas, or null. */
export function getSkyImage() {
  return (assetsReady && sheets.skyGradient) ? sheets.skyGradient.canvas : null;
}

/** Ripped distant background silhouette (black keyed out), or null. */
export function getBackdropImage() {
  return (assetsReady && sheets.backdrop) ? sheets.backdrop.canvas : null;
}

// Fallback team palette (index -> colour) used when the sim state does not
// carry team colours. Integration can override per-worm via worm.teamColor /
// worm.color, or per-team via state.teams[i].color — see resolveTeamColor.
export const TEAM_COLORS = ['#e84545', '#3d7bff', '#3fbf53', '#ffc21c'];

/** Best-effort team colour lookup against the contract's loose state shape. */
export function resolveTeamColor(state, teamIndex, worm) {
  if (worm && (worm.teamColor || worm.color)) return worm.teamColor || worm.color;
  const teams = state && (state.teams || (state.config && state.config.teams));
  if (teams && teams[teamIndex] && teams[teamIndex].color) return teams[teamIndex].color;
  return TEAM_COLORS[teamIndex % TEAM_COLORS.length];
}

const WORM_BODY = '#f78fb0';
const WORM_HI = '#ffc9da';
const WORM_SHADE = '#d96f93';

// ---------------------------------------------------------------------------
// Worm
// ---------------------------------------------------------------------------

function beanPath(ctx) {
  // Drawn facing right, feet at (0, 0), ~14px tall.
  ctx.beginPath();
  ctx.moveTo(-4.8, -0.8);
  ctx.bezierCurveTo(-5.6, -5.6, -3.8, -9.6, -0.8, -11.6); // back rising to head
  ctx.bezierCurveTo(0.6, -13.4, 3.4, -13.4, 4.3, -11.4); // top of head
  ctx.bezierCurveTo(5.1, -9.6, 4.5, -8.0, 3.0, -7.2); // chin
  ctx.bezierCurveTo(4.6, -5.6, 5.4, -3.2, 4.8, -1.0); // belly
  ctx.bezierCurveTo(4.2, 1.3, -4.2, 1.3, -4.8, -0.8); // base
  ctx.closePath();
}

/**
 * drawWorm(ctx, {x, y, facing, aimAngle, hp, teamColor, active, expression, t, seed})
 * expression: 'normal' | 'ohno'  (dead worms are drawn as gravestones by the renderer)
 * Optional extras used by the sprite path: weapon (selected weapon id for the
 * active worm — picks the matching aim-pose angle table).
 */
export function drawWorm(ctx, o) {
  if (assetsReady && sheets.wormIdle) {
    drawWormSprite(ctx, o);
    return;
  }
  drawWormProcedural(ctx, o);
}

function drawWormSprite(ctx, o) {
  const {
    x, y, facing = 1, aimAngle = 0, active = false, t = 0, seed = 0, weapon = null,
  } = o;
  const m = motionFor(seed, x, y, t);

  // Frame selection: airborne > walking > aim pose (active) > idle/blink.
  let sheet = sheets.wormIdle;
  let idx = 0;
  const aimSheets = {
    bazooka: sheets.aimBazooka,
    grenade: sheets.aimGrenade,
    cluster: sheets.aimCluster,
    shotgun: sheets.aimShotgun,
  };
  if (t < m.airUntil && (sheets.wormFall || sheets.wormFly)) {
    if (sheets.wormFall) {
      sheet = sheets.wormFall;
      idx = Math.floor(t * 10) % sheet.frames;
    } else {
      sheet = sheets.wormFly;
      idx = aimFrame(aimAngle);
    }
  } else if (t < m.walkUntil && sheets.wormWalk) {
    sheet = sheets.wormWalk;
    idx = Math.floor(m.dist / 1.6) % sheet.frames; // cycle driven by distance
  } else if (active && weapon && aimSheets[weapon]) {
    sheet = aimSheets[weapon];
    idx = aimFrame(aimAngle);
  } else {
    const blinkPhase = (t + seed * 0.61) % 4.4;
    if (sheets.wormBlink && blinkPhase < 0.3) {
      sheet = sheets.wormBlink;
      idx = Math.floor(blinkPhase / 0.05) % sheets.wormBlink.frames;
    } else {
      idx = Math.floor(t * 10 + seed * 3.7) % sheet.frames;
    }
  }

  ctx.save();
  ctx.translate(x, y + 5); // engine centre -> feet on the ground

  if (active) {
    ctx.globalAlpha = 0.28 + 0.12 * Math.sin(t * 5);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(0, 0.8, 6.5, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (facing === 1) ctx.scale(-1, 1); // sheets natively face left
  const s = WORM_SCALE;
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    sheet.canvas, 0, idx * sheet.fh, sheet.fw, sheet.fh,
    -FRAME_C * s, -WORM_FOOT * s, sheet.fw * s, sheet.fh * s,
  );
  ctx.imageSmoothingEnabled = prev;
  ctx.restore();
}

function drawWormProcedural(ctx, o) {
  const {
    x, y, facing = 1, aimAngle = 0, hp = 100, teamColor = '#e84545',
    active = false, expression = 'normal', t = 0, seed = 0,
  } = o;

  ctx.save();
  ctx.translate(x, y);

  // Breathe: gentle squash-and-stretch anchored at the feet.
  const breathe = 1 + 0.035 * Math.sin(t * 2.2 + seed * 1.71);
  ctx.scale(facing, 1);
  ctx.scale(1 / Math.sqrt(breathe), breathe);

  // Body
  beanPath(ctx);
  ctx.fillStyle = WORM_BODY;
  ctx.fill();

  // Belly highlight + base shade
  ctx.save();
  beanPath(ctx);
  ctx.clip();
  ctx.fillStyle = WORM_HI;
  ctx.beginPath();
  ctx.ellipse(1.6, -4.6, 3.0, 4.2, -0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = WORM_SHADE;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.ellipse(-1.2, 0.4, 5.4, 2.0, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Team bandana across the forehead (inside the clip so it hugs the head).
  ctx.strokeStyle = teamColor;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(1.4, -7.4, 4.6, -2.5, -0.55);
  ctx.stroke();
  ctx.restore();

  // Bandana knot poking out the back.
  ctx.fillStyle = teamColor;
  ctx.beginPath();
  ctx.moveTo(-2.6, -11.0);
  ctx.lineTo(-4.6, -12.4);
  ctx.lineTo(-3.4, -10.0);
  ctx.closePath();
  ctx.fill();

  // Cartoon outline
  beanPath(ctx);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.3;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // ---- Face ----
  const ohno = expression === 'ohno';
  const blinking = !ohno && ((t * 0.5 + seed * 0.377) % 3.1) < 0.09;
  const eyeRx = ohno ? 2.1 : 1.6;
  const eyeRy = ohno ? 2.7 : 2.1;
  const eyes = [
    { ex: 0.9, ey: -9.9 },
    { ex: 3.3, ey: -9.5 },
  ];

  if (blinking) {
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 0.9;
    for (const e of eyes) {
      ctx.beginPath();
      ctx.moveTo(e.ex - 1.4, e.ey);
      ctx.lineTo(e.ex + 1.4, e.ey);
      ctx.stroke();
    }
  } else {
    // Pupils track the aim direction (aim is relative to facing => local +x forward).
    const pdx = Math.cos(aimAngle) * (ohno ? 0.4 : 0.8);
    const pdy = -Math.sin(aimAngle) * (ohno ? 0.5 : 0.9);
    for (const e of eyes) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(e.ex, e.ey, eyeRx, eyeRy, -0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1a1017';
      ctx.beginPath();
      ctx.arc(e.ex + pdx, e.ey + pdy, ohno ? 0.55 : 0.75, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Mouth
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 0.9;
  if (ohno) {
    ctx.fillStyle = '#5c1d2e';
    ctx.beginPath();
    ctx.ellipse(3.4, -6.4, 1.0, 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (hp <= 25) {
    ctx.beginPath();
    ctx.moveTo(2.4, -6.2);
    ctx.lineTo(4.2, -6.5);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(3.1, -6.9, 1.2, 0.35, 1.9);
    ctx.stroke();
  }

  // Active worm gets a faint glow ring at the feet.
  if (active) {
    ctx.globalAlpha = 0.28 + 0.12 * Math.sin(t * 5);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(0, 0.8, 6.5, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Gravestone
// ---------------------------------------------------------------------------

export function drawGravestone(ctx, x, y, t = 0) {
  if (assetsReady && sheets.gravestone) {
    const sh = sheets.gravestone;
    const idx = Math.floor(t * 10) % sh.frames;
    const s = 0.66; // 28px stone content -> ~18px, foot row 33
    ctx.save();
    ctx.translate(x, y + 5); // same ground line as worm feet
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sh.canvas, 0, idx * sh.fh, sh.fw, sh.fh, -FRAME_C * s, -33 * s, sh.fw * s, sh.fh * s);
    ctx.imageSmoothingEnabled = prev;
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(x, y);

  // Mound
  ctx.fillStyle = '#5d4426';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(0, 0.5, 8.5, 2.6, 0, Math.PI, 0);
  ctx.fill();
  ctx.stroke();

  // Stone: rounded-top slab
  const grad = ctx.createLinearGradient(-6, -16, 6, 0);
  grad.addColorStop(0, '#b7bcc4');
  grad.addColorStop(1, '#7d838e');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-5.5, 0);
  ctx.lineTo(-5.5, -9);
  ctx.arc(0, -9, 5.5, Math.PI, 0);
  ctx.lineTo(5.5, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Cross engraving
  ctx.strokeStyle = '#4c515b';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(0, -12.2);
  ctx.lineTo(0, -5.2);
  ctx.moveTo(-2.6, -10);
  ctx.lineTo(2.6, -10);
  ctx.stroke();

  // Tiny grass tufts, gently waving.
  ctx.strokeStyle = '#4aa02a';
  ctx.lineWidth = 1;
  const sway = Math.sin(t * 1.7) * 0.7;
  for (const gx of [-7, 6.4]) {
    ctx.beginPath();
    ctx.moveTo(gx, 0.5);
    ctx.lineTo(gx + sway, -3);
    ctx.stroke();
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Crate (+ parachute)
// ---------------------------------------------------------------------------

export function drawCrate(ctx, x, y, { parachute = false, t = 0 } = {}) {
  if (assetsReady && sheets.crate) {
    const sh = sheets.crate;
    // Frames 45+ are the collect-dissolve — loop the spin/shine cycle only.
    const spinFrames = Math.min(45, sh.frames);
    const idx = Math.floor(t * 12) % spinFrames;
    const s = 0.5; // 33px crate content -> ~16px wide, foot row 45
    ctx.save();
    ctx.translate(x, y + 6); // engine crate centre -> feet (CRATE_HALF_H)
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    if (parachute && sheets.parachute) {
      // Canopy occupies the top ~50 rows of the 90x90 frames (worm hangs
      // below — cropped off). Bottom of canopy sits just above the crate.
      const p = sheets.parachute;
      const pf = Math.floor(t * 12) % p.frames;
      const ps = 0.5;
      ctx.drawImage(
        p.canvas, 0, pf * p.fh, p.fw, 50,
        -45 * ps, -15 - 50 * ps, p.fw * ps, 50 * ps,
      );
    }
    ctx.drawImage(sh.canvas, 0, idx * sh.fh, sh.fw, sh.fh, -FRAME_C * s, -45 * s, sh.fw * s, sh.fh * s);
    ctx.imageSmoothingEnabled = prev;
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(x, y);

  if (parachute) {
    const sway = Math.sin(t * 2.3) * 0.12;
    ctx.save();
    ctx.rotate(sway);
    // Strings
    ctx.strokeStyle = '#e9e2cf';
    ctx.lineWidth = 0.8;
    for (const sx of [-8, -3, 3, 8]) {
      ctx.beginPath();
      ctx.moveTo(sx * 1.6, -34);
      ctx.lineTo(sx * 0.75, -14);
      ctx.stroke();
    }
    // Canopy: red/white segments
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = OUTLINE;
    for (let i = 0; i < 4; i++) {
      const a0 = Math.PI + (i / 4) * Math.PI;
      const a1 = Math.PI + ((i + 1) / 4) * Math.PI;
      ctx.fillStyle = i % 2 ? '#f2f0e6' : '#e04141';
      ctx.beginPath();
      ctx.moveTo(0, -34);
      ctx.arc(0, -34, 14, a0, a1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, -34, 14, Math.PI, 0);
    ctx.stroke();
    ctx.restore();
  }

  // Box: 16×14 wooden crate with planks.
  const w = 16, h = 14;
  const grad = ctx.createLinearGradient(0, -h, 0, 0);
  grad.addColorStop(0, '#c98b46');
  grad.addColorStop(1, '#9c6428');
  ctx.fillStyle = grad;
  ctx.fillRect(-w / 2, -h, w, h);

  // Plank lines
  ctx.strokeStyle = '#7a4a1c';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2, -h / 2);
  ctx.moveTo(-w / 2 + 1, -h);
  ctx.lineTo(w / 2 - 1, 0);
  ctx.stroke();

  // Edge frame + outline
  ctx.strokeStyle = '#b57a37';
  ctx.lineWidth = 2;
  ctx.strokeRect(-w / 2 + 1.5, -h + 1.5, w - 3, h - 3);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.3;
  ctx.strokeRect(-w / 2, -h, w, h);

  // Health-cross style marker (classic crate stamp)
  ctx.fillStyle = '#f5efdd';
  ctx.fillRect(-2, -h / 2 - 4.5, 4, 9);
  ctx.fillRect(-4.5, -h / 2 - 2, 9, 4);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 0.8;
  ctx.strokeRect(-2, -h / 2 - 4.5, 4, 9);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------

/** Bazooka shell, rotated to `angle` (radians, direction of travel), with flame. */
export function drawShell(ctx, x, y, angle, t = 0) {
  if (assetsReady && sheets.projShell) {
    ctx.save();
    ctx.translate(x, y);
    blitFrame(ctx, sheets.projShell, rotFrame(angle), 0.6);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // Exhaust flame (flickers)
  const f = 4 + Math.sin(t * 40) * 1.6;
  ctx.fillStyle = '#ffb63c';
  ctx.beginPath();
  ctx.moveTo(-5, 0);
  ctx.lineTo(-5 - f, -2.2);
  ctx.lineTo(-5 - f * 1.7, 0);
  ctx.lineTo(-5 - f, 2.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffe9a8';
  ctx.beginPath();
  ctx.moveTo(-5, 0);
  ctx.lineTo(-5 - f * 0.8, -1);
  ctx.lineTo(-5 - f * 0.8, 1);
  ctx.closePath();
  ctx.fill();

  // Body
  ctx.fillStyle = '#7f8c66';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-5, -2.6);
  ctx.lineTo(2.5, -2.6);
  ctx.quadraticCurveTo(7, 0, 2.5, 2.6);
  ctx.lineTo(-5, 2.6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Red nose
  ctx.fillStyle = '#e04141';
  ctx.beginPath();
  ctx.moveTo(2.5, -2.6);
  ctx.quadraticCurveTo(7, 0, 2.5, 2.6);
  ctx.closePath();
  ctx.fill();

  // Fins
  ctx.fillStyle = '#5b6647';
  ctx.beginPath();
  ctx.moveTo(-5, -2.6);
  ctx.lineTo(-7, -4.2);
  ctx.lineTo(-4, -2.6);
  ctx.moveTo(-5, 2.6);
  ctx.lineTo(-7, 4.2);
  ctx.lineTo(-4, 2.6);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/** Grenade: green sphere with highlight; `angle` gives a slow tumble. */
export function drawGrenade(ctx, x, y, angle = 0) {
  if (assetsReady && sheets.projGrenade) {
    ctx.save();
    ctx.translate(x, y);
    blitFrame(ctx, sheets.projGrenade, rotFrame(angle), 0.55);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = '#3f8f36';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Cap + pin
  ctx.fillStyle = '#8b8f96';
  ctx.fillRect(-1.6, -6.4, 3.2, 2.6);
  ctx.strokeStyle = '#c9ccd1';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.arc(2.6, -6, 1.6, 0, Math.PI * 2);
  ctx.stroke();
  // Highlight
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(-1.4, -1.6, 1.5, 1.0, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Cluster bomblet: small grey-green ball. */
export function drawClusterBomblet(ctx, x, y, angle = 0) {
  if (assetsReady && sheets.projBomblet) {
    const sh = sheets.projBomblet;
    const idx = Math.floor(Math.abs(angle) * 1.5) % sh.frames;
    ctx.save();
    ctx.translate(x, y);
    blitFrame(ctx, sh, idx, 0.8);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = '#6d7d5a';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.arc(-0.8, -0.9, 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Dynamite: red stick standing on end, fizzing fuse. (x,y) = bottom-centre. */
export function drawDynamite(ctx, x, y, t = 0) {
  if (assetsReady && sheets.projDynamite) {
    const sh = sheets.projDynamite;
    const idx = Math.floor(t * 15) % sh.frames;
    const s = 0.66; // 23px stick content -> ~15px, foot row 38
    ctx.save();
    ctx.translate(x, y);
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sh.canvas, 0, idx * sh.fh, sh.fw, sh.fh, -FRAME_C * s, -38 * s, sh.fw * s, sh.fh * s);
    ctx.imageSmoothingEnabled = prev;
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(x, y);

  // Stick
  ctx.fillStyle = '#d8382e';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  roundRectPath(ctx, -3.2, -14, 6.4, 14, 1.6);
  ctx.fill();
  ctx.stroke();
  // Bands
  ctx.fillStyle = '#a8241c';
  ctx.fillRect(-3.2, -11, 6.4, 1.8);
  ctx.fillRect(-3.2, -5, 6.4, 1.8);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(-2.4, -13.4, 1.5, 12.8);

  // Fuse
  ctx.strokeStyle = '#e8dcc0';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.quadraticCurveTo(1.5, -17.5, 4, -17.8);
  ctx.stroke();

  // Fizz spark
  const s = 1.6 + Math.sin(t * 30) * 0.9;
  ctx.fillStyle = '#ffd23c';
  spark(ctx, 4, -17.8, s);
  ctx.fillStyle = '#fff4c0';
  spark(ctx, 4, -17.8, s * 0.45);

  ctx.restore();
}

function spark(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rr = i % 2 ? r : r * 0.4;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Crosshair & active-worm arrow
// ---------------------------------------------------------------------------

export function drawCrosshair(ctx, x, y, t = 0, aimAngle = null, facing = 1) {
  if (assetsReady && sheets.crosshair) {
    const idx = aimAngle == null ? 16 : aimFrame(aimAngle);
    ctx.save();
    ctx.translate(x, y);
    if (facing === 1) ctx.scale(-1, 1); // table matches the left-facing aim strips
    blitFrame(ctx, sheets.crosshair, idx, 0.75);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  const pulse = 1 + 0.08 * Math.sin(t * 6);
  ctx.scale(pulse, pulse);
  ctx.strokeStyle = '#e33030';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(0, 0, 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    ctx.moveTo(dx * 3.2, dy * 3.2);
    ctx.lineTo(dx * 8.5, dy * 8.5);
  }
  ctx.stroke();
  ctx.fillStyle = '#e33030';
  ctx.beginPath();
  ctx.arc(0, 0, 1.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Bouncing "you are here" arrow. (x, y) = point the tip should hover above. */
export function drawArrow(ctx, x, y, t = 0, color = '#ffde3c') {
  if (assetsReady && sheets.arrow) {
    // Bounce is baked into the 30-frame strip; red is the authentic colour.
    const sh = sheets.arrow;
    const idx = Math.floor(t * 15) % sh.frames;
    const s = 0.7;
    ctx.save();
    ctx.translate(x, y);
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    // Lift the strip so the bouncing tip clears the name/HP tag pills.
    ctx.drawImage(sh.canvas, 0, idx * sh.fh, sh.fw, sh.fh, -FRAME_C * s, -16 - sh.fh * s, sh.fw * s, sh.fh * s);
    ctx.imageSmoothingEnabled = prev;
    ctx.restore();
    return;
  }
  const bounce = Math.abs(Math.sin(t * 4)) * 6;
  ctx.save();
  ctx.translate(x, y - 24 - bounce);
  ctx.fillStyle = color;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 12); // tip (points down)
  ctx.lineTo(-7, 2);
  ctx.lineTo(-3.5, 2);
  ctx.lineTo(-3.5, -6);
  ctx.lineTo(3.5, -6);
  ctx.lineTo(3.5, 2);
  ctx.lineTo(7, 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Clouds (cached canvases, 3 variants)
// ---------------------------------------------------------------------------

const cloudCache = [];

export function getCloud(variant) {
  const v = ((variant % 3) + 3) % 3;
  if (cloudCache[v]) return cloudCache[v];
  const c = makeCanvas(150, 70);
  const ctx = c.getContext('2d');
  const blobs = [
    // per-variant puff layouts: [cx, cy, r]
    [[40, 45, 20], [70, 35, 26], [102, 42, 22], [122, 50, 13], [24, 52, 12]],
    [[35, 48, 16], [60, 38, 22], [88, 34, 24], [115, 44, 18], [130, 52, 10]],
    [[45, 42, 24], [80, 38, 28], [110, 46, 18], [28, 50, 13]],
  ][v];
  // Base (slightly grey-blue underside)
  ctx.fillStyle = '#dfeaf2';
  for (const [bx, by, r] of blobs) {
    ctx.beginPath();
    ctx.arc(bx, by + 3, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Bright top
  ctx.fillStyle = '#ffffff';
  for (const [bx, by, r] of blobs) {
    ctx.beginPath();
    ctx.arc(bx, by, r * 0.92, 0, Math.PI * 2);
    ctx.fill();
  }
  cloudCache[v] = c;
  return c;
}

// ---------------------------------------------------------------------------
// Weapon panel icons — 56×56 canvases drawn in 28-unit space (display at 28px).
// ---------------------------------------------------------------------------

const iconCache = new Map();
const realIconCache = new Map();

export function getWeaponIcon(id) {
  // Ripped 32x32 panel icons (drawn as-is on their dark panel design).
  if (iconBitmaps[id]) {
    if (realIconCache.has(id)) return realIconCache.get(id);
    const c = makeCanvas(32, 32);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(iconBitmaps[id], 0, 0);
    realIconCache.set(id, c);
    return c;
  }
  if (iconCache.has(id)) return iconCache.get(id);
  const c = makeCanvas(56, 56);
  const ctx = c.getContext('2d');
  ctx.scale(2, 2);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const fn = ICON_PAINTERS[id] || paintUnknownIcon;
  fn(ctx);
  iconCache.set(id, c);
  return c;
}

const ICON_PAINTERS = {
  bazooka(ctx) {
    ctx.save();
    ctx.translate(14, 14);
    ctx.rotate(-Math.PI / 4);
    // Tube
    ctx.fillStyle = '#5f7a45';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.4;
    roundRectPath(ctx, -11, -3, 22, 6, 2);
    ctx.fill();
    ctx.stroke();
    // Muzzle flare end
    ctx.fillStyle = '#46592f';
    ctx.fillRect(7, -3.6, 4, 7.2);
    ctx.strokeRect(7, -3.6, 4, 7.2);
    // Sight + grip
    ctx.fillStyle = '#3c4a29';
    ctx.fillRect(-2, -6, 2.5, 3);
    ctx.fillRect(-1, 3, 3, 4);
    ctx.restore();
  },
  grenade(ctx) {
    ctx.save();
    ctx.translate(14, 16);
    ctx.scale(1.9, 1.9);
    drawGrenade(ctx, 0, 0, 0);
    ctx.restore();
  },
  cluster(ctx) {
    ctx.save();
    ctx.translate(13, 13);
    ctx.scale(1.5, 1.5);
    drawGrenade(ctx, 0, 0, 0);
    ctx.restore();
    drawClusterBomblet(ctx, 22, 20, 0.4);
    drawClusterBomblet(ctx, 18, 24, -0.3);
    drawClusterBomblet(ctx, 24, 25, 0.9);
  },
  shotgun(ctx) {
    ctx.save();
    ctx.translate(14, 14);
    ctx.rotate(-Math.PI / 5);
    // Barrels
    ctx.fillStyle = '#5b6470';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.2;
    roundRectPath(ctx, -3, -2.6, 15, 2.4, 1);
    ctx.fill(); ctx.stroke();
    roundRectPath(ctx, -3, 0.4, 15, 2.4, 1);
    ctx.fill(); ctx.stroke();
    // Stock
    ctx.fillStyle = '#8a5a2b';
    ctx.beginPath();
    ctx.moveTo(-3, -2.6);
    ctx.lineTo(-11, 1.5);
    ctx.lineTo(-10, 5.5);
    ctx.lineTo(-3, 2.8);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  },
  firepunch(ctx) {
    // Rising fist with motion lines.
    ctx.save();
    ctx.translate(15, 15);
    ctx.fillStyle = '#f7b98f';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.4;
    roundRectPath(ctx, -5.5, -8, 11, 10, 3.5);
    ctx.fill(); ctx.stroke();
    // Knuckle lines
    ctx.lineWidth = 0.9;
    for (let i = -3; i <= 3; i += 2.7) {
      ctx.beginPath();
      ctx.moveTo(i, -8);
      ctx.lineTo(i, -5.5);
      ctx.stroke();
    }
    // Cuff
    ctx.fillStyle = '#d8382e';
    roundRectPath(ctx, -5, 2, 10, 4, 1.5);
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // Whoosh
    ctx.strokeStyle = '#ffb63c';
    ctx.lineWidth = 1.6;
    for (const dx of [-9, 9]) {
      ctx.beginPath();
      ctx.moveTo(dx, 8);
      ctx.lineTo(dx, -1);
      ctx.stroke();
    }
    ctx.restore();
  },
  dynamite(ctx) {
    ctx.save();
    ctx.translate(14, 24);
    ctx.scale(1.35, 1.35);
    drawDynamite(ctx, 0, 0, 1.2);
    ctx.restore();
  },
  airstrike(ctx) {
    // Three falling missiles under a swoosh.
    ctx.strokeStyle = '#7d8b99';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(3, 6);
    ctx.quadraticCurveTo(14, 1, 25, 6);
    ctx.stroke();
    for (const [mx, d] of [[7, 0], [14, 3], [21, 0]]) {
      ctx.save();
      ctx.translate(mx, 15 + d);
      ctx.rotate(Math.PI / 2);
      ctx.scale(0.75, 0.75);
      drawShell(ctx, 0, 0, 0, 0);
      ctx.restore();
    }
  },
  teleport(ctx) {
    // Beam with sparkles.
    const g = ctx.createLinearGradient(0, 4, 0, 26);
    g.addColorStop(0, 'rgba(120,190,255,0.15)');
    g.addColorStop(0.5, 'rgba(120,190,255,0.85)');
    g.addColorStop(1, 'rgba(120,190,255,0.2)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(9, 3);
    ctx.lineTo(19, 3);
    ctx.lineTo(16.5, 25);
    ctx.lineTo(11.5, 25);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#4d9fe0';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    spark(ctx, 10, 9, 2);
    spark(ctx, 17.5, 15, 2.6);
    spark(ctx, 12, 21, 1.7);
  },
  skip(ctx) {
    // White surrender flag.
    ctx.strokeStyle = '#8a5a2b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(9, 4);
    ctx.lineTo(9, 25);
    ctx.stroke();
    ctx.fillStyle = '#f5f2e8';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(9, 4.5);
    ctx.quadraticCurveTo(16, 8.5, 23, 5);
    ctx.lineTo(23, 13);
    ctx.quadraticCurveTo(16, 16.5, 9, 12.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  },
};

function paintUnknownIcon(ctx) {
  ctx.fillStyle = '#666';
  ctx.font = 'bold 18px "Arial Rounded MT Bold", Verdana, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', 14, 15);
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

export function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
