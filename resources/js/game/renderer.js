// renderer.js — canvas renderer for Worms: Armistice.
//
// Contract (ARCHITECTURE.md):
//   new Renderer(canvas, sim, camera)
//   handleEvents(events)  — consume sim.drainEvents() output
//   render(dt)            — draw a full frame
//
// Frame: sky gradient, parallax clouds, baked terrain layer (dirty-rect
// rebakes on terrain.version change), animated layered water, crates, worms
// (name/HP tags, active arrow, aim crosshair), projectiles, particles, fx.
//
// Documented assumptions (contract ambiguities — see final report):
//   - Terrain is reached via sim.terrain (falls back to sim.state.terrain).
//   - aimAngle: radians, 0 = horizontal in facing direction, positive = up.
//   - facing: 1 = right, -1 = left. Worm (x, y) = feet / bottom-centre.
//   - Projectiles expose {x, y, vx, vy} plus a type discriminator in
//     p.type | p.weapon | p.kind (weapon ids per contract).
//   - Crates (if present) live in state.crates as {x, y, ...}; a truthy
//     p.falling / p.parachute means the parachute is still attached.
//   - explosion.strength is roughly damage-sized (0..100) — shake scales off it.
//   - Damage numbers and speech bubbles are CANVAS-drawn (not DOM).
//   - render(dt) calls camera.update(dt) itself; main.js must not double-call
//     (harmless if it does — smoothing just runs slightly faster).
//   - On the suddenDeath event the renderer adds the 'sudden-death' class to
//     document.body (CSS hook for the red vignette pulse).

import {
  drawWorm, drawGravestone, drawCrate, drawShell, drawGrenade,
  drawClusterBomblet, drawDynamite, drawCrosshair, drawArrow, getCloud,
  resolveTeamColor, roundRectPath, OUTLINE,
  getTerrainAssets, getSkyImage, getBackdropImage,
  ensureTheme, getThemeParams, getThemeVersion,
  drawHoming, drawHomingTarget, drawMortarShell, drawBanana, drawHolyGrenade,
  drawPetrolBottle, drawStrikeMissile, drawArrowProjectile, drawMine, drawSheep,
  drawFlame, drawCarpet, drawFireball, drawDonkey, drawMeteor,
  drawGirder, drawGirderGhost, girderIndexForFuse, drawStrikeTarget,
  drawDrum,
} from './sprites.js';
import { sounds } from './sound.js';

// fire {weapon} event -> sound name (mapped onto the ripped WAV set we have;
// weapons with no natural match reuse the closest classic sound).
const FIRE_SOUNDS = {
  bazooka: ['bazooka-fire', 0.6],
  shotgun: ['shotgun-fire', 0.6],
  grenade: ['throw', 0.6],
  cluster: ['throw', 0.6],
  dynamite: ['dynamite-fuse', 0.5],
  firepunch: ['firepunch', 0.6],
  airstrike: ['airstrike', 0.5],
  teleport: ['teleport', 0.6],
  // Arsenal expansion
  homing: ['bazooka-fire', 0.6],
  mortar: ['bazooka-fire', 0.5],
  banana: ['throw', 0.6],
  holygrenade: ['throw', 0.6],
  petrol: ['throw', 0.6],
  longbow: ['throw', 0.5],
  sheep: ['throw', 0.4],
  axe: ['firepunch', 0.6],
  baseballbat: ['firepunch', 0.65],
  dragonball: ['firepunch', 0.6],
  prod: ['firepunch', 0.3],
  kamikaze: ['firepunch', 0.6],
  handgun: ['shotgun-fire', 0.45],
  uzi: ['shotgun-fire', 0.45],
  minigun: ['shotgun-fire', 0.5],
  flamethrower: ['dynamite-fuse', 0.55],
  blowtorch: ['dynamite-fuse', 0.5],
  drill: ['dynamite-fuse', 0.5],
  mine: ['crate-land', 0.45],
  girder: ['crate-land', 0.55],
  minestrike: ['airstrike', 0.5],
  napalm: ['airstrike', 0.5],
  carpetbomb: ['airstrike', 0.5],
  donkey: ['airstrike', 0.45],
  armageddon: ['airstrike', 0.5],
  earthquake: ['explosion', 0.4],
  selectworm: ['worm-select', 0.5],
};

// Weapons whose 'fire' event should also kick off a sustained set-piece shake
// {duration s, magnitude} — earthquake/donkey/armageddon get scaled-up shake.
const SETPIECE_SHAKE = {
  earthquake: { dur: 4.0, mag: 9 },
  donkey: { dur: 3.0, mag: 6 },
  armageddon: { dur: 8.0, mag: 5 },
};

const FONT_STACK = "'Arial Rounded MT Bold', 'Verdana', sans-serif";
const TAG_FONT = `bold 8px ${FONT_STACK}`;
const DMG_FONT = `bold 12px ${FONT_STACK}`;
const BUBBLE_FONT = `bold 9px ${FONT_STACK}`;

const MAX_PARTICLES = 640;

// Water layer wave shapes (colours come from the theme's waterTint —
// front layers are lightened derivatives of the base tint).
const WATER_SHAPES = {
  back: { amp: 4.2, len: 150, speed: 0.55, yoff: -2 },
  front: [
    { amp: 3.2, len: 100, speed: -0.8, yoff: 2 },
    { amp: 2.4, len: 66, speed: 1.25, yoff: 6 },
  ],
};

function lighten([r, g, b], k, add) {
  const f = (v) => Math.min(255, Math.round(v * k + add));
  return [f(r), f(g), f(b)];
}

function buildWaterLayers(tint) {
  const t = tint || [24, 68, 140];
  const f1 = lighten(t, 1.25, 22);
  const f2 = lighten(t, 1.55, 48);
  return {
    back: { ...WATER_SHAPES.back, color: `rgba(${t[0]}, ${t[1]}, ${t[2]}, 0.95)` },
    front: [
      { ...WATER_SHAPES.front[0], color: `rgba(${f1[0]}, ${f1[1]}, ${f1[2]}, 0.62)` },
      { ...WATER_SHAPES.front[1], color: `rgba(${f2[0]}, ${f2[1]}, ${f2[2]}, 0.45)` },
    ],
    droplet: `rgb(${f2[0]}, ${f2[1]}, ${f2[2]})`,
  };
}

const TALK_LINES = { ohno: 'Oh no!', laugh: 'Hehehe!', grave: 'Bye bye!' };

function noise2(x, y) {
  let n = (x | 0) * 374761393 + (y | 0) * 668265263;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967295;
}

export class Renderer {
  constructor(canvas, sim, camera) {
    this.canvas = canvas;
    this.sim = sim;
    this.camera = camera;
    this.ctx = canvas.getContext('2d');
    this.time = 0;

    // Terrain layer cache
    this._tCanvas = null;
    this._tCtx = null;
    this._tVersion = -1;

    // Theme: derived from sim.config (config.theme ?? seeded pick). Loads
    // async; _themeV watches getThemeVersion() and forces a full rebake.
    ensureTheme(sim && sim.config);
    this._themeV = -1;
    this._theme = getThemeParams();
    this._water = buildWaterLayers(this._theme.waterTint);

    // Girder placement ghost — integration feeds it via setGhost().
    this._ghost = null;

    // Sustained set-piece screen shake {t, dur, mag}.
    this._quake = null;

    // Particle pool
    this._parts = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this._parts.push({
        active: false, type: 0, x: 0, y: 0, vx: 0, vy: 0,
        age: 0, life: 1, size: 2, grav: 0, color: '#fff',
      });
    }
    this._partCursor = 0;

    // Transient fx
    this._rings = [];     // {x, y, r, age, dur, color, width}
    this._flashes = [];   // {x, y, r, age, dur}
    this._ripples = [];   // {x, y, age, dur}
    this._numbers = [];   // {x, y, text, color, age, dur}
    this._bubbles = [];   // {wormId, text, age, dur}
    this._graves = new Map();      // wormId -> {x, y, age}
    this._expressions = new Map(); // wormId -> {kind, age, dur}

    this._skyGrad = null;
    this._skyGradH = 0;
    this._suddenDeathSeen = false;
    this._victoryPlayed = false;
    this._jumpTrack = { id: null, y: 0, dy: 0 }; // jump-voice onset detection

    sounds.init();
  }

  /**
   * Girder (or other) placement preview. Integration calls this with the
   * current mouse/target position while girder is selected, null to clear:
   *   renderer.setGhost({x, y, angle: 1..8 (the fuse value), long, valid})
   * The ghost only draws while state.selectedWeapon === 'girder' (or
   * ghost.kind === 'target' for strike-target previews).
   */
  setGhost(ghost) {
    this._ghost = ghost || null;
  }

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------

  handleEvents(events) {
    if (!events) return;
    for (const ev of events) {
      switch (ev.type) {
        case 'explosion':
          this._fxExplosion(ev);
          sounds.play('explosion', { volume: 0.5 });
          break;
        case 'damage': this._fxDamage(ev); break;
        case 'wormDied':
          this._fxWormDied(ev);
          sounds.play('byebye', { volume: 0.7 });
          break;
        case 'splash':
          this._fxSplash(ev);
          sounds.play('splash', { volume: 0.6 });
          break;
        case 'fire': {
          this._fxFire(ev);
          const snd = FIRE_SOUNDS[ev.weapon];
          if (snd) sounds.play(snd[0], { volume: snd[1] });
          const shake = SETPIECE_SHAKE[ev.weapon];
          if (shake) this._quake = { t: 0, dur: shake.dur, mag: shake.mag };
          break;
        }
        case 'bounce':
          this._spawnBurst('dust', ev.x, ev.y, 4, 26, -18, 0.35);
          sounds.play('bounce', { volume: 0.4 });
          break;
        case 'crateLanded':
          this._fxCrateLanded(ev);
          sounds.play('crate-land', { volume: 0.5 });
          break;
        case 'crateCollected':
          this._fxCrateCollected(ev);
          sounds.play('crate-collect', { volume: 0.6 });
          break;
        case 'fallDamage': this._fxFallDamage(ev); break;
        case 'wormTalk':
          this._fxWormTalk(ev);
          if (ev.kind === 'ohno') sounds.play('ohno', { volume: 0.7 });
          else if (ev.kind === 'laugh') sounds.play('laugh', { volume: 0.7 });
          // 'grave' voice already covered by the wormDied byebye.
          break;
        case 'suddenDeath':
          this._suddenDeathSeen = true;
          if (typeof document !== 'undefined') document.body.classList.add('sudden-death');
          this.camera.shake(8);
          break;
        case 'turnStart':
          sounds.play('worm-select', { volume: 0.4 });
          break;

        // ---- Arsenal expansion events (names ASSUMED — engine not final;
        // unknown events fall through harmlessly to the default branch). ----
        case 'earthquake':
        case 'quake':
          this._quake = { t: 0, dur: 4.0, mag: 9 };
          break;
        case 'stomp':          // donkey stomp (explosion event covers the fx)
        case 'donkeyStomp':
          this.camera.shake(18);
          break;
        case 'girderPlaced':
          this._spawnBurst('dust', ev.x || 0, ev.y || 0, 6, 26, -12, 0.4);
          sounds.play('crate-land', { volume: 0.55 });
          break;
        case 'mineTriggered':
        case 'mineArmed':
          sounds.play('bounce', { volume: 0.35 }); // stand-in beep
          break;
        case 'hallelujah':     // HHG anticipation — sample not in the rip yet;
        case 'holyChoir':      // sound.js maps it and fails silently for now
          sounds.play('hallelujah', { volume: 0.8 });
          break;
        case 'homingLock':
          sounds.play('worm-select', { volume: 0.3 });
          break;
        case 'flameIgnite':
        case 'ignite':
          break; // flames render from state; no one-shot fx needed
        case 'waterRise':
        default:
          break; // handled naturally via state / HUD
      }
    }
  }

  _fxExplosion(ev) {
    const r = ev.r || 30;
    // Engine emits strength normalised 0..1 (dmg/75); scale to damage-sized.
    const strength = ev.strength != null ? ev.strength * 100 : r;
    this._flashes.push({ x: ev.x, y: ev.y, r: r * 1.25, age: 0, dur: 0.16 });
    this._rings.push({ x: ev.x, y: ev.y, r: r * 1.6, age: 0, dur: 0.4, color: '#fff2c8', width: 4 });
    this._rings.push({ x: ev.x, y: ev.y, r: r * 1.15, age: 0, dur: 0.3, color: '#ff9d3c', width: 6 });
    // Smoke puffs
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 12 + Math.random() * 26;
      this._spawn('smoke', ev.x + Math.cos(a) * r * 0.3, ev.y + Math.sin(a) * r * 0.3,
        Math.cos(a) * sp, Math.sin(a) * sp - 22, 0.9 + Math.random() * 0.7, 5 + Math.random() * 5, -18);
    }
    // Dirt chunks
    const nDirt = Math.min(24, 8 + (r | 0) / 2);
    for (let i = 0; i < nDirt; i++) {
      const a = -Math.PI * (0.15 + Math.random() * 0.7); // mostly upward
      const sp = 60 + Math.random() * 160;
      this._spawn('dirt', ev.x, ev.y, Math.cos(a) * sp, Math.sin(a) * sp,
        0.7 + Math.random() * 0.6, 1.5 + Math.random() * 2, 340);
    }
    // Embers
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 90;
      this._spawn('ember', ev.x, ev.y, Math.cos(a) * sp, Math.sin(a) * sp - 30,
        0.35 + Math.random() * 0.3, 1.5, 180);
    }
    this.camera.shake(Math.min(22, 3 + strength * 0.2));
  }

  _fxDamage(ev) {
    const worm = this._findWorm(ev.wormId);
    const color = worm
      ? resolveTeamColor(this.sim.state, worm.teamIndex, worm)
      : '#ff4646';
    const x = ev.x != null ? ev.x : (worm ? worm.x : 0);
    const y = ev.y != null ? ev.y : (worm ? worm.y : 0);
    this._numbers.push({ x, y: y - 18, text: String(Math.round(ev.amount)), color, age: 0, dur: 1 });
    this._setExpression(ev.wormId, 'ohno', 1.4);
  }

  _fxWormDied(ev) {
    // The stone spawns where the worm died (often over a fresh crater) and
    // falls to its resting place — _settleGraves owns the drop.
    this._graves.set(ev.wormId, { x: ev.x, y: ev.y, vy: 0, rest: false, age: 0 });
    // Soul drifts up with a halo.
    this._spawn('soul', ev.x, ev.y - 10, 0, -22, 2.4, 6, 0);
    this._spawnBurst('dust', ev.x, ev.y, 6, 30, -20, 0.4);
  }

  _fxSplash(ev) {
    for (let i = 0; i < 14; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
      const sp = 70 + Math.random() * 140;
      this._spawn('droplet', ev.x, ev.y, Math.cos(a) * sp, Math.sin(a) * sp,
        0.5 + Math.random() * 0.5, 1.5 + Math.random() * 1.5, 420);
    }
    this._ripples.push({ x: ev.x, y: ev.y, age: 0, dur: 0.8 });
    this._ripples.push({ x: ev.x, y: ev.y, age: -0.18, dur: 0.8 });
  }

  _fxFire(ev) {
    const a = ev.angle || 0;
    for (let i = 0; i < 5; i++) {
      const sa = a + (Math.random() - 0.5) * 0.6;
      const sp = 30 + Math.random() * 40;
      // Screen-space angle: +aim is up => -y
      this._spawn('smoke', ev.x, ev.y, Math.cos(sa) * sp, -Math.sin(sa) * sp,
        0.4 + Math.random() * 0.3, 3 + Math.random() * 2, -10);
    }
    for (let i = 0; i < 4; i++) {
      const sa = a + (Math.random() - 0.5) * 0.4;
      const sp = 90 + Math.random() * 60;
      this._spawn('spark', ev.x, ev.y, Math.cos(sa) * sp, -Math.sin(sa) * sp,
        0.18, 1.4, 60);
    }
  }

  _fxCrateLanded(ev) {
    // Parachute detach puff
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2;
      this._spawn('puff', ev.x + Math.cos(a) * 6, ev.y - 16 + Math.sin(a) * 5,
        Math.cos(a) * 18, Math.sin(a) * 12 - 14, 0.5 + Math.random() * 0.3, 3.5, -12);
    }
    this._spawnBurst('dust', ev.x, ev.y, 5, 24, -14, 0.35);
  }

  _fxCrateCollected(ev) {
    const worm = this._findWorm(ev.wormId);
    if (!worm) return;
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 20 + Math.random() * 35;
      this._spawn('spark', worm.x, worm.y - 8, Math.cos(a) * sp, Math.sin(a) * sp - 20,
        0.5, 1.6, 40);
    }
    const c = ev.contents;
    let text = '+ammo';
    let color = '#ffd23c';
    if (c && c.health) {
      text = `+${c.health}`;
      color = '#5ee06a'; // healing green
    } else if (typeof c === 'string') text = `+${c}`;
    else if (c && c.weapon) text = `+${c.count || c.n || 1} ${c.weapon}`;
    this._numbers.push({ x: worm.x, y: worm.y - 22, text, color, age: 0, dur: 1.2 });
  }

  _fxFallDamage(ev) {
    const worm = this._findWorm(ev.wormId);
    if (!worm) return;
    this._spawnBurst('dust', worm.x, worm.y, 8, 34, -12, 0.45);
    const color = resolveTeamColor(this.sim.state, worm.teamIndex, worm);
    this._numbers.push({
      x: worm.x, y: worm.y - 18, text: String(Math.round(ev.amount)), color, age: 0, dur: 1,
    });
  }

  _fxWormTalk(ev) {
    const text = TALK_LINES[ev.kind] || TALK_LINES.ohno;
    this._bubbles.push({ wormId: ev.wormId, text, age: 0, dur: 1.5 });
    if (ev.kind === 'ohno') this._setExpression(ev.wormId, 'ohno', 1.5);
  }

  _setExpression(wormId, kind, dur) {
    this._expressions.set(wormId, { kind, age: 0, dur });
  }

  _findWorm(id) {
    const worms = this.sim.state && this.sim.state.worms;
    if (!worms) return null;
    for (const w of worms) if (w.id === id) return w;
    return null;
  }

  /**
   * Jump-voice heuristic: the active worm suddenly launching upward from a
   * near-rest vertical state. (No jump event exists in the sim contract.)
   */
  _trackJump(state, dt) {
    const id = state.activeWormId;
    const jt = this._jumpTrack;
    if (id == null) { jt.id = null; return; }
    const worm = this._findWorm(id);
    if (!worm || worm.alive === false) { jt.id = null; return; }
    if (jt.id !== id) {
      jt.id = id; jt.y = worm.y; jt.dy = 0;
      return;
    }
    const dy = worm.y - jt.y;
    if (dy < -1.5 && jt.dy > -0.3 && this.sim.phase !== 'resolving') {
      sounds.play('jump', { volume: 0.5 });
    }
    jt.dy = dy;
    jt.y = worm.y;
  }

  // -----------------------------------------------------------------------
  // Particles
  // -----------------------------------------------------------------------

  _spawn(type, x, y, vx, vy, life, size, grav) {
    // Rotating scan for a free slot; steal the oldest-cursor slot if full.
    let p = null;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const cand = this._parts[(this._partCursor + i) % MAX_PARTICLES];
      if (!cand.active) { p = cand; this._partCursor = (this._partCursor + i + 1) % MAX_PARTICLES; break; }
    }
    if (!p) { p = this._parts[this._partCursor]; this._partCursor = (this._partCursor + 1) % MAX_PARTICLES; }
    p.active = true;
    p.type = type; p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.age = 0; p.life = life; p.size = size; p.grav = grav;
  }

  _spawnBurst(type, x, y, n, speed, upBias, life) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this._spawn(type, x, y,
        Math.cos(a) * speed * (0.4 + Math.random() * 0.6),
        Math.sin(a) * speed * 0.5 + upBias,
        life * (0.7 + Math.random() * 0.6), 1.5 + Math.random() * 1.5,
        type === 'dust' ? 60 : 200);
    }
  }

  _updateParticles(dt) {
    for (const p of this._parts) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) { p.active = false; continue; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  _drawParticles(ctx) {
    for (const p of this._parts) {
      if (!p.active) continue;
      const k = p.age / p.life;
      switch (p.type) {
        case 'smoke':
          ctx.globalAlpha = (1 - k) * 0.45;
          ctx.fillStyle = '#69625d';
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 + k * 2), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'puff':
          ctx.globalAlpha = (1 - k) * 0.7;
          ctx.fillStyle = '#f2efe6';
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 + k * 1.5), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'dirt':
          ctx.globalAlpha = 1 - k * k;
          ctx.fillStyle = '#6b4223';
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
          break;
        case 'spark':
          ctx.globalAlpha = 1 - k;
          ctx.fillStyle = '#ffe27a';
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'ember':
          ctx.globalAlpha = 1 - k;
          ctx.fillStyle = k < 0.5 ? '#ffb63c' : '#e05a2b';
          ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
          break;
        case 'droplet':
          ctx.globalAlpha = 1 - k * 0.6;
          ctx.fillStyle = this._water.droplet || '#7db8e8';
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'dust':
          ctx.globalAlpha = (1 - k) * 0.55;
          ctx.fillStyle = '#cbb693';
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 + k), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'soul': {
          ctx.globalAlpha = (1 - k) * 0.85;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          // Wispy tail + halo
          ctx.globalAlpha = (1 - k) * 0.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y + p.size, p.size * 0.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffe98a';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y - p.size - 3, p.size * 0.8, p.size * 0.3, 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // -----------------------------------------------------------------------
  // Terrain layer
  // -----------------------------------------------------------------------

  _terrain() {
    return this.sim.terrain || (this.sim.state && this.sim.state.terrain) || null;
  }

  _syncTerrain(terrain) {
    // Theme art arriving (async load) forces a full rebake + water refresh.
    const tv = getThemeVersion();
    if (tv !== this._themeV) {
      this._themeV = tv;
      this._theme = getThemeParams();
      this._water = buildWaterLayers(this._theme.waterTint);
      this._tVersion = -1;
    }
    if (!this._tCanvas || this._tCanvas.width !== terrain.width || this._tCanvas.height !== terrain.height) {
      this._tCanvas = document.createElement('canvas');
      this._tCanvas.width = terrain.width;
      this._tCanvas.height = terrain.height;
      this._tCtx = this._tCanvas.getContext('2d');
      this._tVersion = -1;
    }
    if (this._tVersion === terrain.version) return;

    if (this._tVersion < 0) {
      this._bakeRect(terrain, 0, 0, terrain.width, terrain.height, false);
    } else {
      const rects = (terrain.dirtyRects && terrain.dirtyRects.length)
        ? terrain.dirtyRects.splice(0)
        : [{ x: 0, y: 0, w: terrain.width, h: terrain.height }];
      for (const r of rects) {
        // Expand so grass/outline logic near the edges is recomputed too.
        const m = this._theme.grassDepth + 2;
        const x0 = Math.max(0, (r.x | 0) - m);
        const y0 = Math.max(0, (r.y | 0) - m);
        const x1 = Math.min(terrain.width, Math.ceil(r.x + r.w) + m);
        const y1 = Math.min(terrain.height, Math.ceil(r.y + r.h) + m);
        if (x1 > x0 && y1 > y0) this._bakeRect(terrain, x0, y0, x1 - x0, y1 - y0, true);
      }
    }
    this._tVersion = terrain.version;
  }

  _bakeRect(terrain, x0, y0, w, h, scorch) {
    const W = terrain.width, H = terrain.height;
    const s = (x, y) => {
      if (x < 0 || x >= W || y < 0) return false;
      if (y >= H) return true; // world floor counts as solid (no bottom outline)
      return !!terrain.solid(x, y);
    };
    const img = this._tCtx.createImageData(w, h);
    const d = img.data;

    // Ripped tileable textures (soil fill + grass edging); null -> procedural.
    // All bake parameters are theme-driven (MAPGEN.md §4.2): tile band width,
    // strip height (16/32/64px per theme), grass depth and outline colours.
    const tex = getTerrainAssets();
    const soilTex = tex && tex.soil;
    const grassTex = tex && tex.grass;
    const th = this._theme;
    const GRASS_TILE_W = th.grassTileW || 64;
    const GRASS_DEPTH = th.grassDepth || 4;
    const [o1r, o1g, o1b] = th.outline || [42, 26, 16];
    const [o2r, o2g, o2b] = th.outline2 || [58, 36, 21];
    // Map depth 0..GRASS_DEPTH onto the strip's rows (forest 16px strip:
    // rows 2..10 — same band as before; taller strips sample proportionally).
    const stripRows = grassTex ? grassTex.height : (th.grassRows || 16);
    const rowFor = (depth) => Math.min(
      stripRows - 1,
      Math.round(stripRows * (0.125 + 0.55 * (depth / GRASS_DEPTH))),
    );

    for (let yy = 0; yy < h; yy++) {
      const wy = y0 + yy;
      for (let xx = 0; xx < w; xx++) {
        const wx = x0 + xx;
        if (!s(wx, wy)) continue; // transparent

        const i = (yy * w + xx) * 4;
        const nearAir1 = !s(wx - 1, wy) || !s(wx + 1, wy) || !s(wx, wy - 1) || !s(wx, wy + 1);
        const nearAir2 = nearAir1
          || !s(wx - 2, wy) || !s(wx + 2, wy) || !s(wx, wy - 2) || !s(wx, wy + 2);

        // Depth of contiguous solid above (0 = top surface pixel).
        let depth = 0;
        while (depth <= GRASS_DEPTH && s(wx, wy - 1 - depth)) depth++;

        let r, g, b;
        const n = noise2(wx, wy);

        if (nearAir1) {
          // 2px-ish dark boundary outline (this row + the nearAir2 band below).
          r = o1r; g = o1g; b = o1b;
        } else if (nearAir2 && depth > GRASS_DEPTH) {
          r = o2r; g = o2g; b = o2b; // soft second outline row on soil edges
        } else if (depth <= GRASS_DEPTH && grassTex) {
          // Ripped grass edging: depth maps onto strip rows; the dark blade
          // gaps read as the classic under-grass shadow.
          const gx = wx % GRASS_TILE_W;
          const gy = rowFor(depth);
          const gi = (gy * grassTex.width + gx) * 4;
          r = grassTex.data[gi]; g = grassTex.data[gi + 1]; b = grassTex.data[gi + 2];
          if (r + g + b < 30 && soilTex) {
            // Fully-black gap pixel below the blades -> darkened soil.
            const si = ((wy % soilTex.height) * soilTex.width + (wx % soilTex.width)) * 4;
            r = soilTex.data[si] * 0.45; g = soilTex.data[si + 1] * 0.45; b = soilTex.data[si + 2] * 0.45;
          }
        } else if (depth <= 1) {
          // Bright grass lip top rows.
          r = 150; g = 219; b = 79;
        } else if (depth <= GRASS_DEPTH) {
          if (n < 0.5) { r = 84; g = 176; b = 48; }
          else { r = 101; g = 194; b = 58; }
        } else if (soilTex) {
          // Ripped tileable soil texture fill.
          const si = ((wy % soilTex.height) * soilTex.width + (wx % soilTex.width)) * 4;
          r = soilTex.data[si]; g = soilTex.data[si + 1]; b = soilTex.data[si + 2];
        } else {
          // Soil with texture noise + occasional specks.
          if (n < 0.05) { r = 151; g = 102; b = 56; }        // light rock speck
          else if (n < 0.1) { r = 86; g = 50; b = 23; }      // dark root speck
          else if (n < 0.4) { r = 111; g = 66; b = 29; }
          else if (n < 0.75) { r = 122; g = 74; b = 33; }
          else { r = 131; g = 82; b = 39; }
        }

        if (scorch && nearAir2) {
          // Burnt crater edge: blend toward char.
          const k2 = nearAir1 ? 0.8 : 0.5;
          r = r + (34 - r) * k2;
          g = g + (22 - g) * k2;
          b = b + (16 - b) * k2;
        }

        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
      }
    }
    this._tCtx.putImageData(img, x0, y0);
  }

  // -----------------------------------------------------------------------
  // Frame
  // -----------------------------------------------------------------------

  render(dt) {
    if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
    dt = Math.min(dt, 0.1);
    this.time += dt;

    const canvas = this.canvas;
    const ctx = this.ctx;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const cw = canvas.clientWidth || canvas.width;
    const ch = canvas.clientHeight || canvas.height;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    this.camera.setViewport(cw, ch, dpr);

    const state = this.sim.state || {};
    const phase = this.sim.phase;
    const terrain = this._terrain();
    const worldW = terrain ? terrain.width : this.camera.worldW;
    const worldH = terrain ? terrain.height : this.camera.worldH;
    const waterLevel = state.waterLevel != null ? state.waterLevel : worldH - 40;

    // --- Camera follow: latest *interesting* projectile, else the active
    // worm. Lingering ambience entities (flames, resting mines, embedded
    // arrows) must not hold the camera hostage. ---
    const projectiles = state.projectiles || [];
    let followP = null;
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      const pt = p.type || p.weapon || p.kind || '';
      if (pt === 'flame' || pt === 'fire' || pt === 'arrow-stuck') continue;
      if ((pt === 'mine' || pt === 'arrow') && p.resting) continue;
      followP = p;
      break;
    }
    if (followP) {
      // A projectile in flight always reclaims a manually-panned camera.
      this.camera.resumeFollow?.();
      this.camera.follow(followP.x, followP.y);
    } else if (state.activeWormId != null) {
      const aw = this._findWorm(state.activeWormId);
      if (aw && aw.alive !== false) {
        // The active worm moving (walk, jump, fall, new turn) reclaims a
        // manually-panned camera; while everything is still, the pan holds.
        // Threshold is > sub-pixel so physics-settle jitter doesn't count
        // as movement and cut a manual pan short.
        const lf = this._lastFollow;
        if (!lf || lf.id !== aw.id ||
            Math.abs(aw.x - lf.x) > 0.75 || Math.abs(aw.y - lf.y) > 0.75) {
          if (lf) this.camera.resumeFollow?.();
          this._lastFollow = { id: aw.id, x: aw.x, y: aw.y };
        }
        this.camera.follow(aw.x, aw.y - 20);
      }
    }
    this.camera.update(dt);

    this._updateParticles(dt);
    this._ageFx(dt);
    this._adoptPreexistingGraves(state, waterLevel);
    this._settleGraves(dt, terrain, waterLevel, worldH);
    this._trackJump(state, dt);

    // Sustained set-piece shake (earthquake / donkey / armageddon).
    if (this._quake) {
      this._quake.t += dt;
      const q = this._quake;
      if (q.t >= q.dur) {
        this._quake = null;
      } else {
        const k = 1 - q.t / q.dur;
        this.camera.shake(1.5 + q.mag * k);
      }
    }

    if (phase === 'game-over' && !this._victoryPlayed) {
      this._victoryPlayed = true;
      sounds.play('victory', { volume: 0.7 });
    }

    // --- Screen space: sky + clouds ---
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._drawSky(ctx, cw, ch);
    this._drawClouds(ctx, cw, ch);

    // --- World space ---
    this.camera.apply(ctx);

    // Distant background silhouette (ripped layer, sits behind the terrain).
    const backdrop = getBackdropImage();
    if (backdrop) {
      const bw = backdrop.width;
      const by = waterLevel - backdrop.height + 6;
      ctx.save();
      ctx.globalAlpha = 0.9;
      for (let bx = 0; bx < worldW; bx += bw) {
        ctx.drawImage(backdrop, bx, by);
      }
      ctx.restore();
    }

    if (terrain) {
      this._syncTerrain(terrain);
      ctx.drawImage(this._tCanvas, 0, 0);
    }

    const bounds = this.camera.viewBounds();
    this._drawWaterLayer(ctx, this._water.back, waterLevel, bounds, worldH);

    // Crates
    const crates = state.crates || [];
    for (const c of crates) {
      drawCrate(ctx, c.x, c.y, {
        parachute: !!(c.falling || c.parachute), t: this.time,
        health: c.kind === 'health',
      });
    }

    // Oil drums (pre-placed hazards, rules >= 2)
    const drums = state.drums || [];
    for (const d of drums) {
      drawDrum(ctx, d.x, d.y, this.time);
    }

    // Gravestones (dead worms) — settled by _settleGraves, never hovering
    for (const [, gv] of this._graves) {
      if (gv.y >= waterLevel) continue; // drowned worms leave no stone
      drawGravestone(ctx, gv.x, gv.y, this.time);
    }

    // Worms
    const worms = state.worms || [];
    const activeId = state.activeWormId;
    for (const wm of worms) {
      if (wm.alive === false) continue;
      const expr = this._expressions.get(wm.id);
      drawWorm(ctx, {
        x: wm.x, y: wm.y,
        facing: wm.facing || 1,
        aimAngle: wm.aimAngle || 0,
        hp: wm.hp,
        teamColor: resolveTeamColor(state, wm.teamIndex, wm),
        active: wm.id === activeId,
        expression: expr ? expr.kind : 'normal',
        t: this.time,
        seed: typeof wm.id === 'number' ? wm.id : hashStr(String(wm.id)),
        weapon: wm.id === activeId ? state.selectedWeapon : null,
      });
    }

    // Name + HP tags (drawn after all bodies so they layer on top)
    for (const wm of worms) {
      if (wm.alive === false) continue;
      this._drawTag(ctx, wm, state);
    }

    // Projectiles
    for (const p of projectiles) this._drawProjectile(ctx, p);

    // Auxiliary entity arrays (defensive — the engine may expose flames,
    // mines, sheep, arrows etc. as their own state lists OR as projectiles;
    // both paths render, see _drawProjectile for the type-discriminated path).
    this._drawAuxEntities(ctx, state);

    // Particles + fx rings/flashes
    this._drawParticles(ctx);
    this._drawRingsAndFlashes(ctx);
    this._drawRipples(ctx, waterLevel);

    // Front water
    for (const layer of this._water.front) {
      this._drawWaterLayer(ctx, layer, waterLevel, bounds, worldH);
    }

    // Active worm adornments
    const active = activeId != null ? this._findWorm(activeId) : null;
    if (active && active.alive !== false) {
      if (phase === 'move' && projectiles.length === 0) {
        drawArrow(ctx, active.x, active.y - 24, this.time,
          resolveTeamColor(state, active.teamIndex, active));
      }
      if (phase === 'move' || phase === 'retreat') {
        const aim = active.aimAngle || 0;
        const facing = active.facing || 1;
        const cx = active.x + Math.cos(aim) * 36 * facing;
        const cy = active.y - 8 - Math.sin(aim) * 36;
        drawCrosshair(ctx, cx, cy, this.time, aim, facing);
      }
    }

    // Homing lock marker (assumed engine state: state.homingTarget {x, y};
    // also drawn while a homing projectile carries its own .target).
    const homingTarget = state.homingTarget
      || (state.selectedWeapon === 'homing' && (state.pendingTarget || state.target)) || null;
    if (homingTarget && homingTarget.x != null) {
      drawHomingTarget(ctx, homingTarget.x, homingTarget.y, this.time, true);
    }
    for (const p of projectiles) {
      if ((p.type || p.kind) === 'homing' && p.target && p.target.x != null) {
        drawHomingTarget(ctx, p.target.x, p.target.y, this.time, !p.homingExpired);
      }
    }

    // Placement ghost (girder preview / strike target) fed by integration.
    if (this._ghost && phase === 'move') {
      const gh = this._ghost;
      if (gh.kind === 'target') {
        drawStrikeTarget(ctx, gh.x, gh.y, this.time);
      } else if (state.selectedWeapon === 'girder' || gh.kind === 'girder') {
        drawGirderGhost(ctx, gh.x, gh.y, girderIndexForFuse(gh.angle ?? state.grenadeFuse ?? 1), {
          long: gh.long !== false,
          valid: gh.valid !== false,
          t: this.time,
        });
      }
    }

    // Damage numbers + speech bubbles (world space, screen-legible sizes)
    this._drawNumbers(ctx);
    this._drawBubbles(ctx, worms);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // -----------------------------------------------------------------------
  // Frame helpers
  // -----------------------------------------------------------------------

  _drawSky(ctx, cw, ch) {
    const sky = getSkyImage();
    if (sky) {
      ctx.drawImage(sky, 0, 0, sky.width, sky.height, 0, 0, cw, ch);
      return;
    }
    if (!this._skyGrad || this._skyGradH !== ch) {
      const g = ctx.createLinearGradient(0, 0, 0, ch);
      g.addColorStop(0, '#6cb5ec');
      g.addColorStop(0.55, '#a8d6f5');
      g.addColorStop(1, '#e8f6fd');
      this._skyGrad = g;
      this._skyGradH = ch;
    }
    ctx.fillStyle = this._skyGrad;
    ctx.fillRect(0, 0, cw, ch);
  }

  _drawClouds(ctx, cw, ch) {
    const camLeft = this.camera.x - cw / 2;
    ctx.save();
    for (let i = 0; i < 8; i++) {
      const cloud = getCloud(i);
      const depth = 0.18 + (i % 3) * 0.11;   // parallax factor
      const scale = 0.45 + depth * 1.1;
      const cwid = cloud.width * scale;
      const span = cw + cwid * 2;
      let sx = ((i * 613.7) + this.time * (4 + depth * 14) - camLeft * depth) % span;
      if (sx < 0) sx += span;
      sx -= cwid;
      const sy = 18 + ((i * 137) % 160) * (ch / 800);
      ctx.globalAlpha = 0.55 + depth * 0.9 > 1 ? 1 : 0.55 + depth * 0.9;
      ctx.drawImage(cloud, sx, sy, cwid, cloud.height * scale);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  _drawWaterLayer(ctx, layer, level, bounds, worldH) {
    const x0 = Math.floor(bounds.x) - 16;
    const x1 = Math.ceil(bounds.x + bounds.w) + 16;
    const bottom = Math.max(worldH, bounds.y + bounds.h) + 60;
    const phase = this.time * layer.speed * Math.PI * 2;
    ctx.fillStyle = layer.color;
    ctx.beginPath();
    ctx.moveTo(x0, bottom);
    for (let x = x0; x <= x1; x += 8) {
      const y = level + layer.yoff + Math.sin((x / layer.len) * Math.PI * 2 + phase) * layer.amp;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(x1, bottom);
    ctx.closePath();
    ctx.fill();
  }

  _drawProjectile(ctx, p) {
    const type = p.type || p.weapon || p.kind || 'bazooka';
    const angle = Math.atan2(p.vy || 0, p.vx || 0);
    const spin = p.spin != null ? p.spin : this.time * 5 * ((p.vx || 1) >= 0 ? 1 : -1);
    switch (type) {
      case 'grenade':
        drawGrenade(ctx, p.x, p.y, spin);
        break;
      case 'cluster':
      case 'clusterlet':
      case 'bomblet':
      case 'mortarlet':
        drawClusterBomblet(ctx, p.x, p.y, this.time * 7);
        break;
      case 'dynamite':
        drawDynamite(ctx, p.x, p.y, this.time);
        break;
      case 'crate':
        drawCrate(ctx, p.x, p.y, { parachute: true, t: this.time });
        break;
      case 'bazooka':
      case 'rocket':
      case 'shell':
        drawShell(ctx, p.x, p.y, angle, this.time);
        break;

      // ---- Arsenal expansion (type names ASSUMED — coded defensively) ----
      case 'homing':
        // Red variant once homing has failed/expired (classic tell). Assumed
        // discriminators: p.homingExpired | p.expired | p.homing === false.
        drawHoming(ctx, p.x, p.y, angle,
          !!(p.homingExpired || p.expired || p.homing === false), this.time);
        break;
      case 'mortar':
        drawMortarShell(ctx, p.x, p.y, angle);
        break;
      case 'banana':
      case 'bananalet':
        drawBanana(ctx, p.x, p.y, spin);
        break;
      case 'holygrenade':
        // Golden anticipation halo while resting (waiting for the choir).
        drawHolyGrenade(ctx, p.x, p.y, spin, this.time, !!p.resting);
        break;
      case 'petrol':
        drawPetrolBottle(ctx, p.x, p.y, spin, this.time);
        break;
      case 'airstrike':
      case 'missile':
      case 'strike-missile':
      case 'napalm':
      case 'napalm-missile':
        drawStrikeMissile(ctx, p.x, p.y, angle, this.time);
        break;
      case 'arrow':
      case 'longbow':
        drawArrowProjectile(ctx, p.x, p.y, p.stuckAngle != null ? p.stuckAngle : angle);
        break;
      case 'mine':
        drawMine(ctx, p.x, p.y, {
          armed: !!(p.armed || p.triggered || (p.fuseLeft != null && p.fuseLeft > 0 && p.fuseLeft < 240)),
          t: this.time,
          angle: p.resting ? 0 : spin,
        });
        break;
      case 'sheep':
        drawSheep(ctx, p.x, p.y, {
          facing: p.facing || ((p.vx || 1) >= 0 ? 1 : -1),
          airborne: !!(p.airborne || (!p.resting && Math.abs(p.vy || 0) > 30)),
          angle, t: this.time,
        });
        break;
      case 'carpet':
      case 'carpetbomb':
        drawCarpet(ctx, p.x, p.y, this.time);
        break;
      case 'fireball':
      case 'dragonball':
        drawFireball(ctx, p.x, p.y, angle, this.time);
        break;
      case 'meteor':
        drawMeteor(ctx, p.x, p.y, angle, this.time, p.size || p.scale || 1);
        break;
      case 'donkey':
        drawDonkey(ctx, p.x, p.y, this.time);
        break;
      case 'girder':
        drawGirder(ctx, p.x, p.y, girderIndexForFuse(p.angleIndex ?? p.angle ?? 1), p.long !== false);
        break;
      case 'flame':
      case 'fire':
      case 'flamelet':
        drawFlame(ctx, p.x, p.y, {
          size: p.size != null ? p.size : (p.energy != null ? p.energy : 1),
          t: this.time,
          seed: p.id != null ? p.id : ((p.x * 7 + p.y * 13) | 0) % 32,
        });
        break;

      default:
        ctx.fillStyle = '#3a3a3a';
        ctx.strokeStyle = OUTLINE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }
  }

  /**
   * Defensive rendering of entity lists the engine may expose alongside
   * state.projectiles (exact shape unknowable pre-integration; every field
   * read is optional). Supported: flames/fire, mines, sheep/walkers, arrows,
   * setPieces/entities (type-discriminated via _drawProjectile).
   */
  _drawAuxEntities(ctx, state) {
    const flames = state.flames || state.fire || null;
    if (Array.isArray(flames)) {
      for (let i = 0; i < flames.length; i++) {
        const f = flames[i];
        drawFlame(ctx, f.x, f.y, {
          size: f.size != null ? f.size : (f.energy != null ? f.energy
            : (f.turnsLeft != null ? f.turnsLeft / 4 : 1)),
          t: this.time,
          seed: f.id != null ? f.id : i,
        });
      }
    }
    const mines = state.mines;
    if (Array.isArray(mines)) {
      for (const mn of mines) {
        drawMine(ctx, mn.x, mn.y, {
          armed: !!(mn.armed || mn.triggered),
          t: this.time,
          angle: mn.angle || 0,
        });
      }
    }
    const walkers = state.sheep || state.walkers;
    if (Array.isArray(walkers)) {
      for (const sh of walkers) {
        if (sh.type && sh.type !== 'sheep') { this._drawProjectile(ctx, sh); continue; }
        drawSheep(ctx, sh.x, sh.y, {
          facing: sh.facing || 1,
          airborne: !!sh.airborne,
          angle: Math.atan2(sh.vy || 0, sh.vx || 0),
          t: this.time,
        });
      }
    }
    const arrows = state.arrows;
    if (Array.isArray(arrows)) {
      for (const ar of arrows) {
        drawArrowProjectile(ctx, ar.x, ar.y, ar.angle || 0);
      }
    }
    for (const key of ['setPieces', 'entities']) {
      const list = state[key];
      if (Array.isArray(list)) {
        for (const e of list) this._drawProjectile(ctx, e);
      }
    }
  }

  _drawTag(ctx, wm, state) {
    const color = resolveTeamColor(state, wm.teamIndex, wm);
    const name = wm.name || `Worm ${wm.id}`;
    const hp = String(Math.max(0, Math.round(wm.hp || 0)));
    ctx.font = TAG_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const nameW = ctx.measureText(name).width + 10;
    const hpW = Math.max(18, ctx.measureText(hp).width + 10);

    this._pill(ctx, wm.x, wm.y - 33, nameW, 11, color, name);
    this._pill(ctx, wm.x, wm.y - 21, hpW, 11, color, hp);
  }

  _pill(ctx, cx, cy, w, h, color, text) {
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(20, 8, 14, 0.85)';
    ctx.lineWidth = 1.2;
    roundRectPath(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = 'rgba(20, 8, 14, 0.85)';
    ctx.lineJoin = 'round';
    ctx.strokeText(text, cx, cy + 0.5);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, cx, cy + 0.5);
  }

  _drawRingsAndFlashes(ctx) {
    for (const f of this._flashes) {
      const k = f.age / f.dur;
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.fillStyle = '#fff7dd';
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * (0.6 + k * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
    for (const rg of this._rings) {
      const k = rg.age / rg.dur;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = rg.color;
      ctx.lineWidth = rg.width * (1 - k * 0.6);
      ctx.beginPath();
      ctx.arc(rg.x, rg.y, rg.r * (0.25 + k * 0.75), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  _drawRipples(ctx, waterLevel) {
    for (const rp of this._ripples) {
      if (rp.age < 0) continue;
      const k = rp.age / rp.dur;
      ctx.globalAlpha = (1 - k) * 0.7;
      ctx.strokeStyle = '#cfe8fa';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(rp.x, waterLevel + 2, 6 + k * 30, 2 + k * 5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  _drawNumbers(ctx) {
    ctx.font = DMG_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const n of this._numbers) {
      const k = n.age / n.dur;
      const y = n.y - k * 26;
      ctx.globalAlpha = k < 0.7 ? 1 : (1 - k) / 0.3;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(20, 8, 14, 0.9)';
      ctx.strokeText(n.text, n.x, y);
      ctx.fillStyle = n.color;
      ctx.fillText(n.text, n.x, y);
    }
    ctx.globalAlpha = 1;
  }

  _drawBubbles(ctx, worms) {
    ctx.font = BUBBLE_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const bb of this._bubbles) {
      let wx = null, wy = null;
      for (const wm of worms) {
        if (wm.id === bb.wormId) { wx = wm.x; wy = wm.y; break; }
      }
      if (wx == null) {
        const gv = this._graves.get(bb.wormId);
        if (gv) { wx = gv.x; wy = gv.y; }
      }
      if (wx == null) continue;
      const k = bb.age / bb.dur;
      const alpha = k < 0.85 ? 1 : (1 - k) / 0.15;
      const w = ctx.measureText(bb.text).width + 12;
      const h = 14;
      const bx = wx, by = wy - 46;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#fffdf4';
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.2;
      roundRectPath(ctx, bx - w / 2, by - h / 2, w, h, 5);
      ctx.fill();
      ctx.stroke();
      // Tail
      ctx.beginPath();
      ctx.moveTo(bx - 3, by + h / 2 - 0.5);
      ctx.lineTo(bx + 1, by + h / 2 + 5);
      ctx.lineTo(bx + 4, by + h / 2 - 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#2b2028';
      ctx.fillText(bb.text, bx, by + 0.5);
    }
    ctx.globalAlpha = 1;
  }

  _ageFx(dt) {
    ageArr(this._rings, dt);
    ageArr(this._flashes, dt);
    ageArr(this._ripples, dt);
    ageArr(this._numbers, dt);
    ageArr(this._bubbles, dt);
    for (const [, gv] of this._graves) gv.age += dt;
    for (const [id, ex] of this._expressions) {
      ex.age += dt;
      if (ex.age >= ex.dur) this._expressions.delete(id);
    }
  }

  /**
   * Gravestones obey gravity (cosmetically): a stone spawned over the crater
   * that killed its worm falls until its base finds terrain, and a resting
   * stone whose ground is later blown away starts falling again.
   */
  _settleGraves(dt, terrain, waterLevel, worldH) {
    if (!terrain) return;
    // The sprite's ground line sits at gv.y + 5 (same as worm feet).
    const footSolid = (x, y) => y + 6 >= worldH || terrain.solid(x, y + 6);
    for (const [, gv] of this._graves) {
      if (gv.y >= waterLevel) continue; // sunk — stays sunk
      if (gv.rest) {
        if (!footSolid(gv.x, gv.y)) { gv.rest = false; gv.vy = 0; }
        continue;
      }
      if (gv.snap) {
        while (gv.y < waterLevel && !footSolid(gv.x, gv.y)) gv.y += 1;
        gv.rest = gv.y < waterLevel;
        gv.snap = false;
        continue;
      }
      gv.vy += 350 * dt; // world gravity
      let dy = gv.vy * dt;
      while (dy > 0) {
        const step = Math.min(1, dy);
        dy -= step;
        if (footSolid(gv.x, gv.y + step)) {
          gv.rest = true;
          gv.vy = 0;
          break;
        }
        gv.y += step;
        if (gv.y >= waterLevel) break; // splashes out of sight
      }
    }
  }

  /**
   * Worms already dead in the state without a wormDied event (e.g. booting
   * from a mid-game snapshot) still get a gravestone.
   */
  _adoptPreexistingGraves(state, waterLevel) {
    const worms = state.worms;
    if (!worms) return;
    for (const wm of worms) {
      if (wm.alive === false && !this._graves.has(wm.id)) {
        // snap: settle instantly — no drop animation for pre-existing deaths.
        this._graves.set(wm.id, { x: wm.x, y: wm.y, vy: 0, rest: false, snap: true, age: 1 });
      }
    }
  }
}

function ageArr(arr, dt) {
  for (let i = arr.length - 1; i >= 0; i--) {
    arr[i].age += dt;
    if (arr[i].age >= arr[i].dur) {
      arr[i] = arr[arr.length - 1];
      arr.pop();
    }
  }
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return (h >>> 0) % 1000;
}
