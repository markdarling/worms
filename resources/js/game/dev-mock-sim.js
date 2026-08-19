// dev-mock-sim.js — tiny FAKE sim for visually testing the presentation
// layer in isolation (dev-harness.html). NOT the engine. Exposes the
// contract shapes: state, phase, terrain {solid, destroy, width, height,
// version, dirtyRects}, drainEvents(), plus a scripted tick(dt) that fires
// projectiles, blows craters, drops crates and makes worms chat.

const W = 1600;
const H = 700;
const WATER = 636;

class MockTerrain {
  constructor() {
    this.width = W;
    this.height = H;
    this.version = 0;
    this.dirtyRects = [];
    this.data = new Uint8Array(W * H);
    this._generate();
  }

  _generate() {
    // Rolling island: sum of sines, tapering into the water at both ends.
    for (let x = 0; x < W; x++) {
      const edge = Math.min(1, Math.min(x, W - x) / 220); // taper
      let surf = 420
        - Math.sin(x / 190) * 70
        - Math.sin(x / 63 + 1.7) * 26
        - Math.sin(x / 29 + 0.4) * 9;
      surf = WATER - (WATER - surf) * edge;
      for (let y = Math.max(0, surf | 0); y < H; y++) this.data[y * W + x] = 1;
    }
    // A floating overhang chunk and a cave pocket.
    this._blob(560, 300, 90, 34, 1);
    this._blob(1010, 470, 70, 48, 0);
  }

  _blob(cx, cy, rx, ry, val) {
    for (let y = cy - ry; y <= cy + ry; y++) {
      for (let x = cx - rx; x <= cx + rx; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.data[y * W + x] = val;
      }
    }
  }

  solid(x, y) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    return this.data[y * W + x] === 1;
  }

  destroy(cx, cy, r) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r * r) this.data[y * W + x] = 0;
      }
    }
    this.version++;
    this.dirtyRects.push({ x: cx - r, y: cy - r, w: r * 2 + 1, h: r * 2 + 1 });
  }
}

export function makeMockSim() {
  const terrain = new MockTerrain();
  const events = [];
  const surfaceY = (x) => {
    for (let y = 0; y < H; y++) if (terrain.solid(x, y)) return y;
    return WATER;
  };

  const teams = [
    { name: 'Red Wrigglers', color: '#e84545' },
    { name: 'Blue Meanies', color: '#3d7bff' },
  ];
  const names = [['Boggy B', 'Clagnut', 'Spadge'], ['Nobby', 'Fusker', 'Dregs']];
  const worms = [];
  const xs = [[260, 470, 700], [900, 1150, 1370]];
  let id = 0;
  for (let ti = 0; ti < 2; ti++) {
    for (let wi = 0; wi < 3; wi++) {
      const x = xs[ti][wi];
      worms.push({
        id: id++, teamIndex: ti, name: names[ti][wi], hp: 100,
        x, y: surfaceY(x), facing: ti === 0 ? 1 : -1, aimAngle: 0.5, alive: true,
      });
    }
  }

  const state = {
    worms,
    projectiles: [],
    crates: [],
    wind: 0.4,
    waterLevel: WATER,
    turnNumber: 3,
    round: 1,
    activeWormId: 0,
    stamina: 100,
    retreatStamina: 25,
    selectedWeapon: 'bazooka',
    fuse: 3,
    ammo: { 0: { cluster: 5, dynamite: 3, airstrike: 2, teleport: 2 }, 1: { cluster: 4, dynamite: 0, airstrike: 2, teleport: 1 } },
    power: 0,
    suddenDeath: false,
    teams,
  };

  let t = 0;
  let nextShot = 2;
  let nextTalk = 4.5;
  let crateDropped = false;
  let charging = false;

  const sim = {
    state,
    phase: 'move',
    terrain,
    drainEvents() { return events.splice(0); },

    tick(dt) {
      t += dt;

      // Active worm waggles its aim; stamina drains and refills.
      const aw = worms.find((w) => w.id === state.activeWormId);
      if (aw) aw.aimAngle = 0.5 + Math.sin(t * 0.6) * 0.45;
      state.stamina = 50 + Math.sin(t * 0.35) * 50;

      // Wind drifts per "turn".
      state.wind = Math.sin(t * 0.13) * 0.9;

      // Crate drop demo.
      if (!crateDropped && t > 1) {
        crateDropped = true;
        state.crates.push({ x: 820, y: 40, vy: 30, falling: true });
      }
      for (const c of state.crates) {
        if (!c.falling) continue;
        c.y += c.vy * dt;
        const ground = surfaceY(c.x);
        if (c.y >= ground) {
          c.y = ground;
          c.falling = false;
          events.push({ type: 'crateLanded', x: c.x, y: c.y, contents: { weapon: 'dynamite', count: 1 } });
        }
      }

      // Charge-and-fire loop.
      if (!charging && t >= nextShot - 0.9) charging = true;
      if (charging) {
        state.power = Math.min(1, state.power + dt * 1.2);
      }
      if (t >= nextShot) {
        nextShot = t + 5.5;
        charging = false;
        const shooter = worms.filter((w) => w.alive)[(Math.random() * worms.filter((w) => w.alive).length) | 0];
        if (shooter) {
          state.activeWormId = shooter.id;
          const targetSide = shooter.x < W / 2 ? 1 : -1;
          shooter.facing = targetSide;
          const angle = 0.9 + Math.random() * 0.4;
          const speed = 340 + state.power * 220;
          const type = Math.random() < 0.35 ? 'grenade' : 'bazooka';
          state.projectiles.push({
            type, x: shooter.x + targetSide * 10, y: shooter.y - 12,
            vx: Math.cos(angle) * speed * targetSide, vy: -Math.sin(angle) * speed,
            fuse: 3,
          });
          events.push({ type: 'fire', weapon: type, x: shooter.x, y: shooter.y - 10, angle, power: state.power });
          sim.phase = 'resolving';
        }
        state.power = 0;
      }

      // Projectile physics.
      for (let i = state.projectiles.length - 1; i >= 0; i--) {
        const p = state.projectiles[i];
        p.vy += 320 * dt;
        if (p.type === 'bazooka') p.vx += state.wind * 60 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        if (p.y >= state.waterLevel) {
          events.push({ type: 'splash', x: p.x, y: state.waterLevel });
          state.projectiles.splice(i, 1);
          continue;
        }
        if (terrain.solid(p.x, p.y)) {
          if (p.type === 'grenade' && p.bounces == null) p.bounces = 2;
          if (p.type === 'grenade' && p.bounces > 0) {
            p.bounces--;
            p.vy *= -0.5;
            p.vx *= 0.7;
            p.y -= 4;
            events.push({ type: 'bounce', x: p.x, y: p.y });
            continue;
          }
          const r = 30;
          terrain.destroy(p.x | 0, p.y | 0, r);
          events.push({ type: 'explosion', x: p.x, y: p.y, r, strength: 50 });
          for (const w of worms) {
            if (!w.alive) continue;
            const d = Math.hypot(w.x - p.x, w.y - p.y);
            if (d < r + 26) {
              const dmg = Math.max(5, Math.round(45 * (1 - d / (r + 30))));
              w.hp -= dmg;
              events.push({ type: 'damage', wormId: w.id, amount: dmg, x: w.x, y: w.y - 10 });
              if (w.hp <= 0) {
                w.alive = false;
                events.push({ type: 'wormTalk', wormId: w.id, kind: 'grave' });
                events.push({ type: 'wormDied', wormId: w.id, x: w.x, y: w.y });
              } else if (d < r + 50) {
                events.push({ type: 'wormTalk', wormId: w.id, kind: 'ohno' });
              }
            } else {
              // Worms settle onto the new terrain.
              w.y = surfaceY(w.x);
            }
          }
          state.projectiles.splice(i, 1);
        }
      }
      if (sim.phase === 'resolving' && state.projectiles.length === 0) sim.phase = 'move';

      // Idle chatter.
      if (t >= nextTalk) {
        nextTalk = t + 7;
        const alive = worms.filter((w) => w.alive);
        const w = alive[(Math.random() * alive.length) | 0];
        if (w) events.push({ type: 'wormTalk', wormId: w.id, kind: 'laugh' });
      }

      // Sudden death demo at 30s.
      if (!state.suddenDeath && t > 30) {
        state.suddenDeath = true;
        events.push({ type: 'suddenDeath' });
      }
      if (state.suddenDeath) state.waterLevel -= dt * 1.2;
    },
  };

  return sim;
}
