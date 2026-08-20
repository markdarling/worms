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
const THEME_BASE = '/assets/themes/';
const KEYS = {
  lav: [128, 128, 192],
  khaki: [192, 192, 128],
  black: [0, 0, 0],
  blue: [32, 32, 248], // worm-longbow.png's odd key (measured, see MANIFEST)
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

  // ---- Arsenal expansion (keys vary per file — recorded in MANIFEST.md) ----
  projHoming: { file: 'proj-homing.png', key: 'khaki' },
  projHomingActive: { file: 'proj-homing-active.png', key: 'khaki' },
  projMortar: { file: 'proj-mortar.png', key: 'khaki' },
  projBanana: { file: 'proj-banana.png', key: 'lav' },
  projHoly: { file: 'proj-holygrenade.png', key: 'lav' },
  mineIdle: { file: 'mine-idle.png', key: 'lav' },
  mineArmed: { file: 'mine-armed.png', key: 'lav' },
  sheepWalk: { file: 'sheep-walk.png', key: 'khaki' },
  sheepFall: { file: 'sheep-fall.png', key: 'khaki' },
  projArrow: { file: 'proj-arrow.png', key: 'khaki' },
  projPetrol: { file: 'proj-petrol.png', key: 'khaki' },
  projStrike: { file: 'proj-airstrike-missile.png', key: 'khaki' },
  projCarpet: { file: 'proj-carpet.png', key: 'lav' },
  fireball: { file: 'proj-fireball.png', fw: 72, fh: 72, key: 'khaki' },
  donkey: { file: 'donkey.png', fw: 158, fh: 123, key: 'khaki' },
  meteor: { file: 'fx-meteor.png', fw: 50, fh: 50, key: 'lav' },
  firePetrol: { file: 'fx-fire-petrol.png', key: 'lav' },
  flame: { file: 'fx-flame.png', key: 'black' },
  flameBig: { file: 'fx-flame-big.png', key: 'lav' },
  strikeMarker: { file: 'ui-airstrike-marker.png', fw: 30, fh: 30, key: 'lav' },

  // Worm weapon poses
  wormJump: { file: 'worm-jump.png', key: 'lav' },
  wormAxe: { file: 'worm-axe.png', fw: 104, fh: 104, key: 'khaki' },
  batAim: { file: 'worm-bat-aim.png', key: 'lav' },
  batSwing: { file: 'worm-bat-swing.png', key: 'lav' },
  wormProd: { file: 'worm-prod.png', key: 'lav' },
  blowtorch: { file: 'worm-blowtorch.png', fw: 80, fh: 80, key: 'khaki' },
  blowtorchAim: { file: 'worm-blowtorch-aim.png', key: 'khaki' },
  wormDrill: { file: 'worm-drill.png', key: 'khaki' },
  kamikaze1: { file: 'worm-kamikaze-1.png', key: 'khaki' },
  kamikaze2: { file: 'worm-kamikaze-2.png', key: 'khaki' },
  kamikaze3: { file: 'worm-kamikaze-3.png', key: 'khaki' },
  kamikaze4: { file: 'worm-kamikaze-4.png', key: 'khaki' },
  kamikaze5: { file: 'worm-kamikaze-5.png', key: 'khaki' },
  handgun: { file: 'worm-handgun.png', key: 'khaki' },
  uzi: { file: 'worm-uzi.png', key: 'lav' },
  minigun: { file: 'worm-minigun.png', fw: 90, fh: 90, key: 'lav' },
  longbow: { file: 'worm-longbow.png', key: 'blue' },
};

// Girders: 9 placement steps × 2 lengths, whole images (dimensions vary per angle).
for (let gi = 0; gi <= 8; gi++) {
  SHEET_DEFS[`girderLong${gi}`] = { file: `girder-long-${gi}.png`, whole: true, key: 'lav' };
  SHEET_DEFS[`girderShort${gi}`] = { file: `girder-short-${gi}.png`, whole: true, key: 'lav' };
}

// ---------------------------------------------------------------------------
// Theme registry (MAPGEN.md §4) — data only, presentation-side.
//   dir:        theme folder under /assets/themes/ (null = legacy forest files)
//   grassTileW: horizontal tile band width sampled from the grass strip
//   grassRows:  strip height in px (16 / 32 / 64 — varies per theme)
//   grassDepth: how many px below the surface count as "grass" in the bake
//   outline:    2px dark edge colour [r,g,b]; outline2: soft second row
//   waterTint:  base water colour [r,g,b] (front layers derived in renderer)
// ---------------------------------------------------------------------------

export const THEMES = {
  forest: {
    dir: null, grassTileW: 64, grassRows: 16, grassDepth: 4,
    outline: [42, 26, 16], outline2: [58, 36, 21], waterTint: [24, 68, 140],
  },
  cheese: {
    dir: 'cheese', grassTileW: 64, grassRows: 16, grassDepth: 4,
    outline: [70, 40, 6], outline2: [96, 58, 12], waterTint: [24, 68, 140],
  },
  desert: {
    dir: 'desert', grassTileW: 64, grassRows: 64, grassDepth: 8,
    outline: [60, 32, 10], outline2: [82, 46, 16], waterTint: [20, 90, 130],
  },
  hell: {
    dir: 'hell', grassTileW: 64, grassRows: 32, grassDepth: 6,
    outline: [46, 8, 4], outline2: [78, 20, 6], waterTint: [110, 24, 14],
  },
  jungle: {
    dir: 'jungle', grassTileW: 64, grassRows: 64, grassDepth: 8,
    outline: [18, 28, 12], outline2: [32, 44, 20], waterTint: [16, 84, 96],
  },
  manhattan: {
    dir: 'manhattan', grassTileW: 64, grassRows: 16, grassDepth: 4,
    outline: [14, 16, 30], outline2: [28, 32, 52], waterTint: [28, 54, 88],
  },
  snow: {
    dir: 'snow', grassTileW: 64, grassRows: 32, grassDepth: 6,
    outline: [56, 72, 122], outline2: [82, 100, 158], waterTint: [22, 58, 124],
  },
  tools: {
    dir: 'tools', grassTileW: 64, grassRows: 16, grassDepth: 4,
    outline: [36, 16, 6], outline2: [56, 28, 12], waterTint: [24, 68, 140],
  },
};

const THEME_NAMES = Object.keys(THEMES).sort(); // stable alphabetical order

// Local deterministic hash (theme choice is presentation-only; only needs to be
// self-consistent per seed so replays render identically — MAPGEN.md §4.3).
function themeHash(a, b) {
  let h = (a | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) ^ (b | 0);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** config.theme wins; else a seeded pick from config.seed (stable ordering). */
export function resolveThemeName(config) {
  const c = config || {};
  if (c.theme && THEMES[c.theme]) return c.theme;
  const seed = Number.isFinite(c.seed) ? c.seed : 0;
  return THEME_NAMES[themeHash(seed, 0x7ee3) % THEME_NAMES.length];
}

let themeName = null;    // resolved theme; null until ensureTheme() runs
let themeVersion = 0;    // bumped when theme art becomes available/changes
const themeSheets = {};  // soil / grass / sky / back canvases (non-forest)
const themePixels = {};  // soil / grass ImageData for the bake
let _themePromise = null;

/**
 * Resolve + load the theme for this game's config. Idempotent; safe to call
 * every frame. Forest needs no extra files (initAssets loads them). Missing
 * theme files fall back to the forest art / procedural colours.
 */
export function ensureTheme(config) {
  if (themeName !== null) return _themePromise || Promise.resolve();
  themeName = resolveThemeName(config);
  const th = THEMES[themeName];
  if (!th.dir || typeof document === 'undefined') {
    themeVersion++;
    return Promise.resolve();
  }
  const base = `${THEME_BASE}${th.dir}/terrain-${themeName}-`;
  const load = async (slot, suffix, key, pixels) => {
    try {
      const bmp = await fetchBitmap(base + suffix, true);
      const c = makeCanvas(bmp.width, bmp.height);
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(bmp, 0, 0);
      if (key) chromaKey(cx, c.width, c.height, KEYS[key], 10);
      if (pixels) themePixels[slot] = cx.getImageData(0, 0, c.width, c.height);
      themeSheets[slot] = c;
    } catch (e) {
      console.warn(`[theme] ${base}${suffix} unavailable — forest/procedural fallback (${e.message})`);
    }
  };
  _themePromise = Promise.all([
    load('soil', 'texture.png', null, true),
    load('grass', 'grass.png', 'black', true),
    load('sky', 'gradient.png', null, false),
    load('back', 'back.png', 'black', false),
  ]).then(() => { themeVersion++; });
  return _themePromise;
}

/** Current theme data (+ name). Valid before ensureTheme resolves (forest). */
export function getThemeParams() {
  const name = themeName || 'forest';
  return { name, ...THEMES[name] };
}

/** Bumped whenever theme art lands — renderer rebakes on change. */
export function getThemeVersion() {
  return themeVersion;
}

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
  // Arsenal expansion — all 28 new ids (MANIFEST.md, verified 32x32).
  homing: 'icon-homing.png',
  mortar: 'icon-mortar.png',
  banana: 'icon-banana.png',
  holygrenade: 'icon-holygrenade.png',
  axe: 'icon-axe.png',
  prod: 'icon-prod.png',
  baseballbat: 'icon-baseballbat.png',
  dragonball: 'icon-dragonball.png',
  handgun: 'icon-handgun.png',
  uzi: 'icon-uzi.png',
  minigun: 'icon-minigun.png',
  longbow: 'icon-longbow.png',
  petrol: 'icon-petrol.png',
  napalm: 'icon-napalm.png',
  flamethrower: 'icon-flamethrower.png',
  mine: 'icon-mine.png',
  minestrike: 'icon-minestrike.png',
  sheep: 'icon-sheep.png',
  kamikaze: 'icon-kamikaze.png',
  blowtorch: 'icon-blowtorch.png',
  drill: 'icon-drill.png',
  girder: 'icon-girder.png',
  parachute: 'icon-parachute.png',
  earthquake: 'icon-earthquake.png',
  donkey: 'icon-donkey.png',
  armageddon: 'icon-armageddon.png',
  selectworm: 'icon-selectworm.png',
  carpetbomb: 'icon-carpetbomb.png',
};

let assetsReady = false;
const sheets = {};     // name -> {canvas, fw, fh, frames}
const pixelData = {};  // name -> ImageData
const iconBitmaps = {}; // weapon id -> ImageBitmap

/**
 * Fetch, chroma-key and slice all ripped sheets. Resolves even when files
 * are missing (each failure warns and leaves the procedural fallback active).
 * Optional `config` also resolves + loads the terrain theme (config.theme ??
 * seeded pick from config.seed); the renderer calls ensureTheme(sim.config)
 * itself, so passing it here is a convenience, not a requirement.
 */
export async function initAssets(config) {
  if (typeof document === 'undefined') return;
  const jobs = [];
  if (config) jobs.push(ensureTheme(config));
  if (!assetsReady) {
    for (const [name, def] of Object.entries(SHEET_DEFS)) jobs.push(loadSheet(name, def));
    for (const [id, file] of Object.entries(ICON_FILES)) jobs.push(loadIcon(id, file));
  }
  await Promise.all(jobs);
  assetsReady = true;
}

async function fetchBitmap(file, absolute = false) {
  const res = await fetch(absolute ? file : ASSET_BASE + file);
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

/**
 * {soil, grass} ImageData for the terrain bake, or null when unavailable.
 * Prefers the selected theme's art; forest files are the fallback.
 */
export function getTerrainAssets() {
  const soil = themePixels.soil || (assetsReady ? pixelData.terrainSoil : null) || null;
  const grass = themePixels.grass || (assetsReady ? pixelData.terrainGrass : null) || null;
  if (!soil && !grass) return null;
  return { soil, grass };
}

/** Sky gradient strip (themed when loaded) to stretch across the canvas. */
export function getSkyImage() {
  if (themeSheets.sky) return themeSheets.sky;
  return (assetsReady && sheets.skyGradient) ? sheets.skyGradient.canvas : null;
}

/** Distant background silhouette (black keyed out; themed when loaded). */
export function getBackdropImage() {
  if (themeSheets.back) return themeSheets.back;
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
  const pose = weapon ? WEAPON_POSES[weapon] : null;
  const poseSheet = pose ? (sheets[pose.sheet] || (pose.alt && sheets[pose.alt])) : null;
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
  } else if (active && poseSheet) {
    sheet = poseSheet;
    if (pose.mode === 'aim32') idx = aimFrame(aimAngle);
    else if (pose.mode === 'anim') idx = Math.floor(t * (pose.fps || 10)) % sheet.frames;
    else idx = Math.min(pose.frame || 0, sheet.frames - 1); // 'hold'
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
  // Anchor generalised for the larger pose frames (80/90/104 px): centre
  // horizontally, foot row at the same relative height as the 60px strips.
  ctx.drawImage(
    sheet.canvas, 0, idx * sheet.fh, sheet.fw, sheet.fh,
    -(sheet.fw / 2) * s, -(sheet.fh * (WORM_FOOT / 60)) * s, sheet.fw * s, sheet.fh * s,
  );
  ctx.imageSmoothingEnabled = prev;
  ctx.restore();
}

// Selected-weapon -> worm pose. mode: 'aim32' (angle table), 'anim', 'hold'.
// Missing sheets fall through `alt`, then to idle — graceful everywhere.
const WEAPON_POSES = {
  bazooka: { sheet: 'aimBazooka', mode: 'aim32' },
  homing: { sheet: 'aimBazooka', mode: 'aim32' },     // WA reuses the shoulder pose
  mortar: { sheet: 'aimBazooka', mode: 'aim32' },
  grenade: { sheet: 'aimGrenade', mode: 'aim32' },
  banana: { sheet: 'aimGrenade', mode: 'aim32' },     // thrown family
  holygrenade: { sheet: 'aimGrenade', mode: 'aim32' },
  petrol: { sheet: 'aimGrenade', mode: 'aim32' },
  cluster: { sheet: 'aimCluster', mode: 'aim32' },
  shotgun: { sheet: 'aimShotgun', mode: 'aim32' },
  handgun: { sheet: 'handgun', mode: 'aim32', alt: 'aimShotgun' },
  uzi: { sheet: 'uzi', mode: 'aim32', alt: 'aimShotgun' },
  minigun: { sheet: 'minigun', mode: 'aim32', alt: 'aimShotgun' },
  longbow: { sheet: 'longbow', mode: 'hold', frame: 4 }, // drawn bow
  baseballbat: { sheet: 'batAim', mode: 'aim32' },
  axe: { sheet: 'wormAxe', mode: 'hold', frame: 0 },
  prod: { sheet: 'wormProd', mode: 'hold', frame: 0 },
  blowtorch: { sheet: 'blowtorchAim', mode: 'hold', frame: 12 }, // torch raised
  flamethrower: { sheet: 'blowtorchAim', mode: 'hold', frame: 12 }, // pose MISSING in rip — reuse torch
  drill: { sheet: 'wormDrill', mode: 'anim', fps: 12 },
  kamikaze: { sheet: 'kamikaze1', mode: 'hold', frame: 0 },
  dynamite: { sheet: 'aimGrenade', mode: 'aim32' },   // generic place stand-in
  mine: { sheet: 'aimGrenade', mode: 'aim32' },
  sheep: { sheet: 'aimGrenade', mode: 'aim32' },
};

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

export function drawCrate(ctx, x, y, { parachute = false, t = 0, health = false } = {}) {
  // Health crates always draw procedurally (white box, red cross) so they
  // read differently from wooden weapon crates at a glance.
  if (!health && assetsReady && sheets.crate) {
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

  // Box: 16×14 crate — wooden planks, or white first-aid box for health.
  const w = 16, h = 14;
  const grad = ctx.createLinearGradient(0, -h, 0, 0);
  grad.addColorStop(0, health ? '#fbf8ee' : '#c98b46');
  grad.addColorStop(1, health ? '#ddd6c2' : '#9c6428');
  ctx.fillStyle = grad;
  ctx.fillRect(-w / 2, -h, w, h);

  if (!health) {
    // Plank lines
    ctx.strokeStyle = '#7a4a1c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(w / 2, -h / 2);
    ctx.moveTo(-w / 2 + 1, -h);
    ctx.lineTo(w / 2 - 1, 0);
    ctx.stroke();
  }

  // Edge frame + outline
  ctx.strokeStyle = health ? '#c9c2ac' : '#b57a37';
  ctx.lineWidth = 2;
  ctx.strokeRect(-w / 2 + 1.5, -h + 1.5, w - 3, h - 3);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.3;
  ctx.strokeRect(-w / 2, -h, w, h);

  // Cross stamp: red on health, cream on weapon crates
  ctx.fillStyle = health ? '#e04141' : '#f5efdd';
  ctx.fillRect(-2, -h / 2 - 4.5, 4, 9);
  ctx.fillRect(-4.5, -h / 2 - 2, 9, 4);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 0.8;
  ctx.strokeRect(-2, -h / 2 - 4.5, 4, 9);

  ctx.restore();
}

// Oil drum hazard: rusty red barrel with hazard band and oily sheen.
export function drawDrum(ctx, x, y, t = 0) {
  ctx.save();
  ctx.translate(x, y);
  const w = 14, h = 18;
  const grad = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  grad.addColorStop(0, '#a33327');
  grad.addColorStop(0.45, '#d0553f');
  grad.addColorStop(1, '#7e2318');
  ctx.fillStyle = grad;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, 2.5);
  else ctx.rect(-w / 2, -h / 2, w, h);
  ctx.fill();
  // Ribs
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.lineWidth = 1.4;
  for (const ry of [-h / 2 + 4, 0, h / 2 - 4]) {
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 1, ry);
    ctx.lineTo(w / 2 - 1, ry);
    ctx.stroke();
  }
  // Hazard label: small warning diamond that glints
  const glint = 0.75 + 0.25 * Math.sin(t * 2.1);
  ctx.save();
  ctx.globalAlpha = glint;
  ctx.fillStyle = '#f2c14b';
  ctx.translate(0, 1);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-3, -3, 6, 6);
  ctx.restore();
  // Outline
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, 2.5);
  else ctx.rect(-w / 2, -h / 2, w, h);
  ctx.stroke();
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
// Arsenal expansion entities
// ---------------------------------------------------------------------------

/** Blit a 32-frame rotation-table sheet by travel angle (shared shortcut). */
function drawRotSheet(ctx, sheet, x, y, angle, scale) {
  ctx.save();
  ctx.translate(x, y);
  blitFrame(ctx, sheet, rotFrame(angle), scale);
  ctx.restore();
}

/**
 * Homing missile. `expired` truthy = homing failed/timed out (red variant —
 * the classic tell). Fallback: bazooka shell with a blue/red nose ring.
 */
export function drawHoming(ctx, x, y, angle, expired = false, t = 0) {
  const sheet = expired ? (sheets.projHomingActive || sheets.projHoming) : sheets.projHoming;
  if (assetsReady && sheet) {
    drawRotSheet(ctx, sheet, x, y, angle, 0.6);
    return;
  }
  drawShell(ctx, x, y, angle, t);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = expired ? '#e33030' : '#3d7bff';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(3, 0, 3.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Homing target marker (click target). Pulses; greyed once homing expired. */
export function drawHomingTarget(ctx, x, y, t = 0, live = true) {
  ctx.save();
  ctx.translate(x, y);
  const pulse = 1 + 0.15 * Math.sin(t * 6);
  ctx.scale(pulse, pulse);
  ctx.strokeStyle = live ? '#3d7bff' : 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    ctx.moveTo(dx * 4, dy * 4);
    ctx.lineTo(dx * 10, dy * 10);
  }
  ctx.stroke();
  ctx.restore();
}

/** Mortar shell. Fallback: stubby grey shell. */
export function drawMortarShell(ctx, x, y, angle) {
  if (assetsReady && sheets.projMortar) {
    drawRotSheet(ctx, sheets.projMortar, x, y, angle, 0.55);
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = '#6f7d8c';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, 0, 5, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#e04141';
  ctx.beginPath();
  ctx.ellipse(3, 0, 2, 2.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Banana bomb (shell and bomblets share the art). Fallback: yellow crescent. */
export function drawBanana(ctx, x, y, angle) {
  if (assetsReady && sheets.projBanana) {
    drawRotSheet(ctx, sheets.projBanana, x, y, angle, 0.55);
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = '#ffd23c';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(0, -2, 6, 0.3, Math.PI - 0.3);
  ctx.arc(0, -4.5, 6.5, Math.PI - 0.4, 0.4, true);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#7a5a10';
  ctx.fillRect(5, -3.4, 2, 2);
  ctx.restore();
}

/** Holy Hand Grenade; `halo` = resting/anticipation beat (golden glow). */
export function drawHolyGrenade(ctx, x, y, angle, t = 0, halo = false) {
  if (halo) {
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.25 * Math.sin(t * 10);
    const g = ctx.createRadialGradient(x, y, 1, x, y, 18);
    g.addColorStop(0, '#fff3b0');
    g.addColorStop(1, 'rgba(255,243,176,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (assetsReady && sheets.projHoly) {
    drawRotSheet(ctx, sheets.projHoly, x, y, angle, 0.62);
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = '#d8c26a';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#8a6d1a';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, -7.5);
  ctx.lineTo(0, -4);
  ctx.moveTo(-1.8, -6.2);
  ctx.lineTo(1.8, -6.2);
  ctx.stroke();
  ctx.restore();
}

/** Petrol bomb bottle. Fallback: green bottle with rag. */
export function drawPetrolBottle(ctx, x, y, angle, t = 0) {
  if (assetsReady && sheets.projPetrol) {
    drawRotSheet(ctx, sheets.projPetrol, x, y, angle, 0.55);
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + Math.PI / 2);
  ctx.fillStyle = '#3c7a4a';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  roundRectPath(ctx, -3, -3, 6, 9, 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillRect(-1.2, -7, 2.4, 4);
  const f = 2 + Math.sin(t * 30);
  ctx.fillStyle = '#ffb63c';
  spark(ctx, 0, -8, f);
  ctx.restore();
}

/** Air/napalm/mine-strike drop missile. Fallback: bazooka shell art. */
export function drawStrikeMissile(ctx, x, y, angle, t = 0) {
  if (assetsReady && sheets.projStrike) {
    drawRotSheet(ctx, sheets.projStrike, x, y, angle, 0.6);
    return;
  }
  drawShell(ctx, x, y, angle, t);
}

/**
 * Longbow arrow (flying or embedded). Sheet's frame 0 points DOWN (measured
 * — MANIFEST), unlike the nose-up projectile tables, hence the π offset.
 */
export function drawArrowProjectile(ctx, x, y, angle) {
  if (assetsReady && sheets.projArrow) {
    ctx.save();
    ctx.translate(x, y);
    blitFrame(ctx, sheets.projArrow, rotFrame(angle + Math.PI), 0.6);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = '#8a5a2b';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-9, 0);
  ctx.lineTo(7, 0);
  ctx.stroke();
  ctx.fillStyle = '#9aa3ad';
  ctx.beginPath();
  ctx.moveTo(11, 0);
  ctx.lineTo(5.5, -2.6);
  ctx.lineTo(5.5, 2.6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e04141';
  ctx.beginPath();
  ctx.moveTo(-9, 0);
  ctx.lineTo(-12, -2.6);
  ctx.lineTo(-10, 0);
  ctx.lineTo(-12, 2.6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Mine. armed = triggered/fuse running: flashes the red-light variant and
 * pulses a warning glow. `angle` picks the roll-table frame (optional).
 */
export function drawMine(ctx, x, y, { armed = false, t = 0, angle = 0 } = {}) {
  const flashOn = armed && (Math.floor(t * 8) % 2 === 0);
  if (armed) {
    ctx.save();
    ctx.globalAlpha = 0.3 + 0.3 * Math.sin(t * 16);
    const g = ctx.createRadialGradient(x, y, 1, x, y, 13);
    g.addColorStop(0, '#ff5a3c');
    g.addColorStop(1, 'rgba(255,90,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  const sheet = flashOn ? (sheets.mineArmed || sheets.mineIdle) : sheets.mineIdle;
  if (assetsReady && sheet) {
    drawRotSheet(ctx, sheet, x, y, angle, 0.55);
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#4a4f45';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, 4.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 4.6, Math.sin(a) * 4.6);
    ctx.lineTo(Math.cos(a) * 6.6, Math.sin(a) * 6.6);
    ctx.stroke();
  }
  ctx.fillStyle = flashOn ? '#ff3c2a' : '#7a2018';
  ctx.beginPath();
  ctx.arc(0, -1, 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Sheep: 8-frame walk cycle; airborne uses the 32-frame fall table. */
export function drawSheep(ctx, x, y, { facing = 1, airborne = false, angle = 0, t = 0 } = {}) {
  if (assetsReady && (sheets.sheepWalk || sheets.sheepFall)) {
    let sheet = sheets.sheepWalk;
    let idx = Math.floor(t * 14) % (sheet ? sheet.frames : 1);
    if (airborne && sheets.sheepFall) {
      sheet = sheets.sheepFall;
      idx = rotFrame(angle);
    }
    ctx.save();
    ctx.translate(x, y + 5);
    if (facing === 1) ctx.scale(-1, 1); // strips face left, like the worm
    const s = 0.66;
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      sheet.canvas, 0, idx * sheet.fh, sheet.fw, sheet.fh,
      -FRAME_C * s, -WORM_FOOT * s, sheet.fw * s, sheet.fh * s,
    );
    ctx.imageSmoothingEnabled = prev;
    ctx.restore();
    return;
  }
  // Procedural sheep: woolly blob + head + trotting legs.
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing, 1);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.2;
  ctx.fillStyle = '#f2efe6';
  for (const [bx, by, r] of [[-3, -6, 4.5], [1, -7.5, 4], [4, -5.5, 3.6], [-6, -4.5, 3.2]]) {
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, -6, 7.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#2b2028';
  ctx.beginPath();
  ctx.ellipse(7.5, -7.5, 3, 2.4, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(8.3, -8.2, 0.8, 0, Math.PI * 2);
  ctx.fill();
  const step = Math.sin(t * 18) * 1.6;
  ctx.strokeStyle = '#2b2028';
  ctx.lineWidth = 1.6;
  for (const [lx, ph] of [[-4, 1], [-1, -1], [2, 1], [5, -1]]) {
    ctx.beginPath();
    ctx.moveTo(lx, -2);
    ctx.lineTo(lx + step * ph, 2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * One flame particle. size 0..1 scales the sprite; seed staggers the loop.
 * Glow is included (renderer draws flames late so the glow reads at night).
 */
export function drawFlame(ctx, x, y, { size = 1, t = 0, seed = 0 } = {}) {
  const s = 0.28 + 0.34 * Math.max(0.15, Math.min(1, size));
  ctx.save();
  ctx.globalAlpha = 0.28 + 0.1 * Math.sin(t * 13 + seed * 2.1);
  const g = ctx.createRadialGradient(x, y - 2, 1, x, y - 2, 16 * s + 6);
  g.addColorStop(0, '#ffce6e');
  g.addColorStop(1, 'rgba(255,150,40,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y - 2, 16 * s + 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const sheet = sheets.flameBig || sheets.flame || sheets.firePetrol;
  if (assetsReady && sheet) {
    const idx = Math.floor(t * 18 + seed * 5.3) % sheet.frames;
    ctx.save();
    ctx.translate(x, y - 6 * s);
    blitFrame(ctx, sheet, idx, s);
    ctx.restore();
    return;
  }
  // Procedural flicker: two teardrops.
  const fl = 1 + 0.25 * Math.sin(t * 21 + seed * 3.7);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s * 2.2, s * 2.2 * fl);
  ctx.fillStyle = '#ff8c28';
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.quadraticCurveTo(4.5, -3, 0, 1);
  ctx.quadraticCurveTo(-4.5, -3, 0, -8);
  ctx.fill();
  ctx.fillStyle = '#ffe27a';
  ctx.beginPath();
  ctx.moveTo(0, -4.5);
  ctx.quadraticCurveTo(2.4, -1.6, 0, 0.6);
  ctx.quadraticCurveTo(-2.4, -1.6, 0, -4.5);
  ctx.fill();
  ctx.restore();
}

/** Carpet-bomb rolled carpet (10-frame bounce anim). */
export function drawCarpet(ctx, x, y, t = 0) {
  if (assetsReady && sheets.projCarpet) {
    const sheet = sheets.projCarpet;
    const idx = Math.floor(t * 14) % sheet.frames;
    ctx.save();
    ctx.translate(x, y);
    blitFrame(ctx, sheet, idx, 0.6);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(t * 6);
  ctx.fillStyle = '#a33a5e';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.1;
  roundRectPath(ctx, -6, -4, 12, 8, 3.5);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#e0b23c';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, 2.4, 0, Math.PI * 1.5);
  ctx.stroke();
  ctx.restore();
}

/** Dragon Ball energy fireball (cosmetic, travels ~40px). */
export function drawFireball(ctx, x, y, angle = 0, t = 0) {
  if (assetsReady && sheets.fireball) {
    const sheet = sheets.fireball;
    const idx = Math.floor(t * 20) % sheet.frames;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    const s = 0.6;
    ctx.drawImage(
      sheet.canvas, 0, idx * sheet.fh, sheet.fw, sheet.fh,
      -(sheet.fw / 2) * s, -(sheet.fh / 2) * s, sheet.fw * s, sheet.fh * s,
    );
    ctx.imageSmoothingEnabled = prev;
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 9);
  g.addColorStop(0, '#fff4c0');
  g.addColorStop(0.5, '#ffb63c');
  g.addColorStop(1, 'rgba(255,110,40,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Concrete Donkey (2-frame stomp bob, scaled to ~50px tall in-world). */
export function drawDonkey(ctx, x, y, t = 0) {
  if (assetsReady && sheets.donkey) {
    const sheet = sheets.donkey;
    const idx = Math.floor(t * 6) % sheet.frames;
    const s = 0.4; // 123px frame -> ~50px
    ctx.save();
    ctx.translate(x, y);
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      sheet.canvas, 0, idx * sheet.fh, sheet.fw, sheet.fh,
      -(sheet.fw / 2) * s, -(sheet.fh / 2) * s, sheet.fw * s, sheet.fh * s,
    );
    ctx.imageSmoothingEnabled = prev;
    ctx.restore();
    return;
  }
  // Procedural: chunky grey donkey silhouette.
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#9aa0a8';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  roundRectPath(ctx, -18, -12, 34, 20, 6); // body
  ctx.fill();
  ctx.stroke();
  roundRectPath(ctx, 12, -24, 12, 18, 4);  // head/neck
  ctx.fill();
  ctx.stroke();
  ctx.beginPath(); // ears
  ctx.moveTo(14, -24);
  ctx.lineTo(12, -32);
  ctx.lineTo(18, -25);
  ctx.moveTo(20, -24);
  ctx.lineTo(22, -32);
  ctx.lineTo(24, -24);
  ctx.stroke();
  for (const lx of [-14, -5, 5, 11]) { // legs
    ctx.fillRect(lx, 8, 5, 12);
    ctx.strokeRect(lx, 8, 5, 12);
  }
  ctx.restore();
}

/** Armageddon meteor: flaming comic head; angle leans it into the dive. */
export function drawMeteor(ctx, x, y, angle = 0, t = 0, scale = 1) {
  if (assetsReady && sheets.meteor) {
    const sheet = sheets.meteor;
    const idx = Math.floor(t * 18) % sheet.frames;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle - Math.PI / 2); // art flames point up; lean along travel
    const s = 0.7 * scale;
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      sheet.canvas, 0, idx * sheet.fh, sheet.fw, sheet.fh,
      -(sheet.fw / 2) * s, -(sheet.fh / 2) * s, sheet.fw * s, sheet.fh * s,
    );
    ctx.imageSmoothingEnabled = prev;
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const r = 7 * scale;
  const g = ctx.createRadialGradient(-r, 0, 1, -r, 0, r * 3);
  g.addColorStop(0, 'rgba(255,180,60,0.9)');
  g.addColorStop(1, 'rgba(255,110,40,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(-r * 1.4, 0, r * 2.4, r * 1.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#7d6b5a';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ---- Girders ---------------------------------------------------------------

// Art: girder-{long|short}-{0..8}.png, 22.5° steps sweeping 180°
// (0 = vertical, 4 = horizontal, 8 = vertical again). WA-scale beams
// (long ≈ 140px) scaled to our world (long ≈ 64px).
const GIRDER_SCALE = 0.46;

/** input.fuse 1..8 -> girder art index 0..7 (8 unique placement angles). */
export function girderIndexForFuse(fuse) {
  const f = ((Math.round(fuse || 1) - 1) % 8 + 8) % 8;
  return f;
}

function girderSheet(index, long) {
  const i = ((index % 9) + 9) % 9;
  return sheets[`${long ? 'girderLong' : 'girderShort'}${i}`] || null;
}

/** Solid girder at (x, y) centre. index 0..8 (22.5° steps from vertical). */
export function drawGirder(ctx, x, y, index = 4, long = true) {
  const sheet = girderSheet(index, long);
  if (assetsReady && sheet) {
    const s = GIRDER_SCALE;
    ctx.save();
    ctx.translate(x, y);
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet.canvas, -(sheet.fw / 2) * s, -(sheet.fh / 2) * s, sheet.fw * s, sheet.fh * s);
    ctx.imageSmoothingEnabled = prev;
    ctx.restore();
    return;
  }
  drawGirderProcedural(ctx, x, y, index, long, null, 1);
}

const girderGhostCache = new Map(); // `${index}:${long}:${valid}` -> canvas

/**
 * Girder placement GHOST (semi-transparent, green = valid / red = blocked).
 * Integration feeds position via renderer.setGhost(); angle index 0..8.
 */
export function drawGirderGhost(ctx, x, y, index = 4, { long = true, valid = true, t = 0 } = {}) {
  const sheet = girderSheet(index, long);
  if (assetsReady && sheet) {
    const key = `${((index % 9) + 9) % 9}:${long}:${valid}`;
    let tinted = girderGhostCache.get(key);
    if (!tinted) {
      tinted = makeCanvas(sheet.fw, sheet.fh);
      const tx = tinted.getContext('2d');
      tx.drawImage(sheet.canvas, 0, 0);
      tx.globalCompositeOperation = 'source-atop';
      tx.fillStyle = valid ? 'rgba(90, 230, 110, 0.5)' : 'rgba(235, 70, 60, 0.55)';
      tx.fillRect(0, 0, sheet.fw, sheet.fh);
      girderGhostCache.set(key, tinted);
    }
    const s = GIRDER_SCALE;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 0.62 + 0.18 * Math.sin(t * 6);
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tinted, -(sheet.fw / 2) * s, -(sheet.fh / 2) * s, sheet.fw * s, sheet.fh * s);
    ctx.imageSmoothingEnabled = prev;
    ctx.restore();
    return;
  }
  drawGirderProcedural(ctx, x, y, index, long, valid ? '#5ae66e' : '#eb463c', 0.6);
}

function drawGirderProcedural(ctx, x, y, index, long, tint, alpha) {
  const len = long ? 64 : 32;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(((index % 9) + 9) % 9 * (Math.PI / 8)); // 0 = vertical
  ctx.globalAlpha = alpha;
  ctx.fillStyle = tint || '#8d99a6';
  ctx.strokeStyle = tint ? 'rgba(0,0,0,0.4)' : OUTLINE;
  ctx.lineWidth = 1.2;
  ctx.fillRect(-4.5, -len / 2, 9, len);
  ctx.strokeRect(-4.5, -len / 2, 9, len);
  if (!tint) {
    ctx.strokeStyle = '#5b6470';
    for (let yy = -len / 2 + 6; yy < len / 2 - 3; yy += 8) {
      ctx.beginPath();
      ctx.moveTo(-4.5, yy);
      ctx.lineTo(4.5, yy + 5);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Animated strike target cursor (airstrike/napalm/mine strike/carpet/donkey). */
export function drawStrikeTarget(ctx, x, y, t = 0) {
  if (assetsReady && sheets.strikeMarker) {
    const sheet = sheets.strikeMarker;
    const idx = Math.floor(t * 20) % sheet.frames;
    ctx.save();
    ctx.translate(x, y);
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      sheet.canvas, 0, idx * sheet.fh, sheet.fw, sheet.fh,
      -sheet.fw / 2, -sheet.fh / 2, sheet.fw, sheet.fh,
    );
    ctx.imageSmoothingEnabled = prev;
    ctx.restore();
    return;
  }
  drawCrosshair(ctx, x, y, t);
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
  const fn = ICON_PAINTERS[id] || ((cx) => paintFallbackIcon(cx, id));
  fn(ctx);
  iconCache.set(id, c);
  return c;
}

// Two-letter monogram fallback so a missing icon file still reads in the dock.
function paintFallbackIcon(ctx, id) {
  const label = String(id || '?').slice(0, 2).toUpperCase();
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRectPath(ctx, 3, 3, 22, 22, 5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#e8e2d2';
  ctx.font = 'bold 11px "Arial Rounded MT Bold", Verdana, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 14, 14.5);
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
