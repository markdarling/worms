// hud.js — DOM HUD for Worms: Armistice (overlays the game canvas).
//
// Contract (ARCHITECTURE.md):
//   new Hud(rootEl, callbacks)   callbacks: { onWeaponSelect(id), onFuseSelect(n), onSkip() }
//   update(simState, phase)
//   showPassDevice(playerName, onReady)
//   showGameOver(winnerName)
//   setReplayMode(on, {onSkip, onSpeed})
//
// Extras exposed for the integrator (not in the contract, safe to ignore):
//   toggleWeaponPanel(force?)  — open/close the weapon panel (Tab / right-click)
//   setGameName(name)          — top-bar title (defaults to "Worms: Armistice")
//   setTeams(teams)            — [{name, color}] if sim state lacks team info
//
// All nodes are built once and mutated only when values change — no per-frame
// DOM rebuilds. Styling lives entirely in resources/css/game.css.
//
// Body class hooks driven here: 'sudden-death' (with the renderer),
// 'replay-mode' while a replay is showing.

import { getWeaponIcon, resolveTeamColor } from './sprites.js';

const WEAPONS = [
  { id: 'bazooka', label: 'Bazooka' },
  { id: 'grenade', label: 'Grenade' },
  { id: 'cluster', label: 'Cluster Bomb' },
  { id: 'shotgun', label: 'Shotgun' },
  { id: 'firepunch', label: 'Fire Punch' },
  { id: 'dynamite', label: 'Dynamite' },
  { id: 'airstrike', label: 'Air Strike' },
  { id: 'teleport', label: 'Teleport' },
  { id: 'skip', label: 'Skip Go' },
];

const FUSE_WEAPONS = new Set(['grenade', 'cluster']);

const KEYBINDINGS = [
  ['← →', 'walk'],
  ['↵', 'jump'],
  ['⌫', 'backflip'],
  ['↑ ↓', 'aim'],
  ['Space', 'hold: charge · release: fire'],
  ['1–5', 'grenade fuse'],
  ['Click', 'target (teleport / air strike)'],
  ['Drag / edges', 'pan camera'],
];

const PHASE_LABELS = {
  'move': 'Move', 'retreat': 'Retreat!', 'resolving': '…',
  'turn-over': 'Turn over', 'game-over': 'Game over',
};

function el(tag, className, parent, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
}

export class Hud {
  constructor(rootEl, callbacks = {}) {
    this.root = rootEl;
    this.cb = callbacks;
    this._last = {}; // change-detection cache
    this._teamRows = [];
    this._teamMax = [];
    this._overlay = null;
    this._replayEl = null;
    this._suddenBannerShown = false;

    rootEl.classList.add('hud');
    this._build();
  }

  // -----------------------------------------------------------------------
  // DOM construction (once)
  // -----------------------------------------------------------------------

  _build() {
    const n = (this._n = {});

    // ---- Top bar ----
    const top = el('div', 'hud-top', this.root);
    n.title = el('div', 'hud-title', top, 'Worms: Armistice');

    const wind = el('div', 'hud-wind', top);
    el('span', 'hud-wind__label', wind, 'WIND');
    const windBar = el('div', 'hud-wind__bar', wind);
    n.windFillL = el('div', 'hud-wind__fill hud-wind__fill--left', windBar);
    n.windFillR = el('div', 'hud-wind__fill hud-wind__fill--right', windBar);
    n.windChevL = el('div', 'hud-wind__chevrons hud-wind__chevrons--left', windBar, '‹‹‹‹');
    n.windChevR = el('div', 'hud-wind__chevrons hud-wind__chevrons--right', windBar, '››››');
    el('div', 'hud-wind__notch', windBar);

    const turnBox = el('div', 'hud-turnbox', top);
    n.turn = el('div', 'hud-turn', turnBox, 'Turn 1 · Round 1');
    n.phase = el('div', 'hud-phase', turnBox, '');

    // ---- Stamina (left) ----
    const stam = el('div', 'hud-stamina', this.root);
    n.stamLabel = el('div', 'hud-stamina__label', stam, 'STAMINA');
    const sbar = el('div', 'hud-stamina__bar', stam);
    n.stamFill = el('div', 'hud-stamina__fill', sbar);
    n.retreatFill = el('div', 'hud-stamina__retreat', sbar);
    el('div', 'hud-stamina__divider', sbar);

    // ---- Power bar (bottom-left, vertical) ----
    n.power = el('div', 'hud-power', this.root);
    el('div', 'hud-power__label', n.power, 'POWER');
    const pbar = el('div', 'hud-power__bar', n.power);
    n.powerFill = el('div', 'hud-power__fill', pbar);

    // ---- Team health (bottom centre) ----
    n.teams = el('div', 'hud-teams', this.root);

    // ---- Weapon panel (right slide-in) ----
    n.panel = el('div', 'hud-weapons', this.root);
    el('div', 'hud-weapons__title', n.panel, 'Weapons');
    const grid = el('div', 'hud-weapons__grid', n.panel);
    n.cells = {};
    for (const w of WEAPONS) {
      const cell = el('button', 'hud-weapon', grid);
      cell.type = 'button';
      cell.dataset.id = w.id;
      cell.title = w.label;
      const icon = getWeaponIcon(w.id);
      icon.className = 'hud-weapon__icon';
      cell.appendChild(icon);
      const ammo = el('span', 'hud-weapon__ammo', cell, '∞');
      cell.addEventListener('click', () => {
        if (cell.classList.contains('is-disabled')) return;
        if (w.id === 'skip') { this.cb.onSkip && this.cb.onSkip(); return; }
        this.cb.onWeaponSelect && this.cb.onWeaponSelect(w.id);
      });
      n.cells[w.id] = { cell, ammo, lastAmmo: '∞' };
    }

    // Fuse selector (visible for grenade/cluster): label on top, buttons below.
    n.fuseRow = el('div', 'hud-fuse', n.panel);
    el('span', 'hud-fuse__label', n.fuseRow, 'FUSE');
    const fuseBtnRow = el('div', 'hud-fuse__btns', n.fuseRow);
    n.fuseBtns = [];
    for (let i = 1; i <= 5; i++) {
      const b = el('button', 'hud-fuse__btn', fuseBtnRow, `${i}s`);
      b.type = 'button';
      b.addEventListener('click', () => this.cb.onFuseSelect && this.cb.onFuseSelect(i));
      n.fuseBtns.push(b);
    }

    // ---- Keybinding hint strip (collapsible, bottom-right) ----
    const keys = el('div', 'hud-keys', this.root);
    const keysToggle = el('button', 'hud-keys__toggle', keys, 'Controls ▾');
    keysToggle.type = 'button';
    const keysBody = el('div', 'hud-keys__body', keys);
    for (const [k, desc] of KEYBINDINGS) {
      const row = el('div', 'hud-keys__row', keysBody);
      el('kbd', 'hud-keys__kbd', row, k);
      el('span', 'hud-keys__desc', row, desc);
    }
    keysToggle.addEventListener('click', () => {
      const open = keys.classList.toggle('is-open');
      keysToggle.textContent = open ? 'Controls ▴' : 'Controls ▾';
    });

    // ---- Sudden death banner (hidden until triggered) ----
    n.sudden = el('div', 'hud-sudden', this.root, 'SUDDEN DEATH — the water rises!');
  }

  // -----------------------------------------------------------------------
  // Frame update
  // -----------------------------------------------------------------------

  update(state, phase) {
    if (!state) return;
    const n = this._n;
    const L = this._last;

    // Wind [-1..1]
    const wind = state.wind || 0;
    if (wind !== L.wind) {
      L.wind = wind;
      const mag = Math.min(1, Math.abs(wind));
      n.windFillL.style.width = wind < 0 ? `${mag * 50}%` : '0%';
      n.windFillR.style.width = wind > 0 ? `${mag * 50}%` : '0%';
      n.windChevL.classList.toggle('is-on', wind < -0.02);
      n.windChevR.classList.toggle('is-on', wind > 0.02);
    }

    // Turn / round
    const turnText = `Turn ${state.turnNumber ?? 1} · Round ${state.round ?? 1}`;
    if (turnText !== L.turnText) {
      L.turnText = turnText;
      n.turn.textContent = turnText;
    }
    const phaseText = PHASE_LABELS[phase] || '';
    if (phaseText !== L.phaseText) {
      L.phaseText = phaseText;
      n.phase.textContent = phaseText;
      n.phase.classList.toggle('is-retreat', phase === 'retreat');
    }

    // Stamina bar (assumed budgets: 100 main + 25 retreat, per DESIGN.md)
    const stamina = clamp01((state.stamina ?? 0) / 100);
    const retreat = clamp01((state.retreatStamina ?? 0) / 25);
    if (stamina !== L.stamina) {
      L.stamina = stamina;
      n.stamFill.style.width = `${stamina * 80}%`; // main = 80% of track (100/125)
      n.stamFill.classList.toggle('is-low', stamina <= 0.2);
      n.stamFill.classList.toggle('is-mid', stamina > 0.2 && stamina <= 0.5);
      // Numeric readout — discrete costs (jump -10, backflip -15) are hard to
      // read from an 80%-of-track fill alone.
      n.stamLabel.textContent = `STAMINA ${Math.ceil(state.stamina ?? 0)}`;
    }
    if (retreat !== L.retreat) {
      L.retreat = retreat;
      n.retreatFill.style.width = `${retreat * 20}%`; // reserve = 20% of track
    }

    // Power charge bar
    const power = state.power || 0;
    if (power !== L.power) {
      L.power = power;
      n.power.classList.toggle('is-visible', power > 0);
      n.powerFill.style.height = `${clamp01(power) * 100}%`;
    }

    // Active team from the active worm
    const worms = state.worms || [];
    let activeTeam = -1;
    for (const w of worms) {
      if (w.id === state.activeWormId) { activeTeam = w.teamIndex; break; }
    }

    this._updateTeams(state, worms, activeTeam);
    this._updateWeapons(state, activeTeam);

    // Sudden death
    if (state.suddenDeath && !this._suddenBannerShown) {
      this._suddenBannerShown = true;
      document.body.classList.add('sudden-death');
      n.sudden.classList.add('is-visible');
      setTimeout(() => n.sudden.classList.remove('is-visible'), 3500);
    }
  }

  _updateTeams(state, worms, activeTeam) {
    const n = this._n;
    // Count teams from worms (or provided team list).
    let teamCount = this._teams ? this._teams.length : 0;
    for (const w of worms) teamCount = Math.max(teamCount, (w.teamIndex ?? 0) + 1);
    if (teamCount === 0) return;

    // (Re)build rows if the team count changed.
    if (this._teamRows.length !== teamCount) {
      n.teams.textContent = '';
      this._teamRows = [];
      for (let i = 0; i < teamCount; i++) {
        const row = el('div', 'hud-team', n.teams);
        const name = el('span', 'hud-team__name', row, this._teamName(state, i));
        const bar = el('div', 'hud-team__bar', row);
        const fill = el('div', 'hud-team__fill', bar);
        fill.style.background = this._teamColor(state, i, worms);
        this._teamRows.push({ row, name, fill, lastFrac: -1, lastActive: null });
      }
      this._teamMax = new Array(teamCount).fill(1);
    }

    // Totals
    for (let i = 0; i < teamCount; i++) {
      let total = 0;
      for (const w of worms) {
        if ((w.teamIndex ?? 0) === i && w.alive !== false) total += Math.max(0, w.hp || 0);
      }
      this._teamMax[i] = Math.max(this._teamMax[i], total);
      const frac = total / this._teamMax[i];
      const r = this._teamRows[i];
      if (frac !== r.lastFrac) {
        r.lastFrac = frac;
        r.fill.style.width = `${clamp01(frac) * 100}%`;
      }
      const isActive = i === activeTeam;
      if (isActive !== r.lastActive) {
        r.lastActive = isActive;
        r.row.classList.toggle('is-active', isActive);
      }
    }
  }

  _updateWeapons(state, activeTeam) {
    const n = this._n;
    const ammoTable = (state.ammo && state.ammo[activeTeam]) || {};
    const selected = state.selectedWeapon || null;

    for (const w of WEAPONS) {
      const c = n.cells[w.id];
      const raw = ammoTable[w.id];
      const infinite = raw == null || raw === Infinity || raw === -1 || raw === '∞';
      const text = infinite ? '∞' : String(raw);
      if (text !== c.lastAmmo) {
        c.lastAmmo = text;
        c.ammo.textContent = text;
      }
      const disabled = !infinite && raw <= 0;
      c.cell.classList.toggle('is-disabled', disabled);
      c.cell.classList.toggle('is-selected', w.id === selected);
    }

    // Fuse row only for grenade-family weapons.
    const fuseVisible = FUSE_WEAPONS.has(selected);
    if (fuseVisible !== this._last.fuseVisible) {
      this._last.fuseVisible = fuseVisible;
      n.fuseRow.classList.toggle('is-visible', fuseVisible);
    }
    // Engine exposes the fuse as state.grenadeFuse (default 3).
    const fuse = state.grenadeFuse ?? state.fuse ?? state.selectedFuse ?? null;
    if (fuse !== this._last.fuse) {
      this._last.fuse = fuse;
      n.fuseBtns.forEach((b, i) => b.classList.toggle('is-selected', i + 1 === fuse));
    }
  }

  _teamName(state, i) {
    const teams = state.teams || (state.config && state.config.teams) || this._teams;
    return (teams && teams[i] && teams[i].name) || `Team ${i + 1}`;
  }

  _teamColor(state, i, worms) {
    for (const w of worms) {
      if ((w.teamIndex ?? 0) === i) return resolveTeamColor(state, i, w);
    }
    return resolveTeamColor(state, i, null);
  }

  // -----------------------------------------------------------------------
  // Panel / overlays / replay
  // -----------------------------------------------------------------------

  // The weapon dock is always open (horizontal bar across the bottom) — the
  // old slide-in toggle is a no-op kept for call-site compatibility.
  toggleWeaponPanel() {
    return true;
  }

  setGameName(name) {
    this._n.title.textContent = name || 'Worms: Armistice';
  }

  setTeams(teams) {
    this._teams = teams;
    this._teamRows = []; // force rebuild with fresh names/colours
  }

  /** Full-screen hotseat interstitial. Solid background — hides the map. */
  showPassDevice(playerName, onReady) {
    this._removeOverlay();
    const ov = el('div', 'hud-overlay hud-overlay--pass', this.root);
    const card = el('div', 'hud-overlay__card', ov);
    el('div', 'hud-overlay__kicker', card, 'Pass the device to');
    el('div', 'hud-overlay__name', card, playerName);
    const btn = el('button', 'hud-btn hud-btn--big', card, 'Ready!');
    btn.type = 'button';
    btn.addEventListener('click', () => {
      this._removeOverlay();
      onReady && onReady();
    });
    this._overlay = ov;
    btn.focus();
  }

  showGameOver(winnerName) {
    this._removeOverlay();
    const ov = el('div', 'hud-overlay hud-overlay--gameover', this.root);
    const card = el('div', 'hud-overlay__card', ov);
    const draw = !winnerName || String(winnerName).toLowerCase() === 'draw';
    el('div', 'hud-overlay__kicker', card, draw ? 'It’s a…' : 'Victory for');
    el('div', 'hud-overlay__name', card, draw ? 'DRAW!' : winnerName);
    el('div', 'hud-overlay__sub', card, draw ? 'Nobody wriggles away a winner.' : 'The other worms send their regards.');
    const btn = el('a', 'hud-btn hud-btn--big', card, 'Back to lobby');
    btn.href = '/';
    this._overlay = ov;
  }

  setReplayMode(on, opts = {}) {
    document.body.classList.toggle('replay-mode', !!on);
    if (!on) {
      if (this._replayEl) { this._replayEl.remove(); this._replayEl = null; }
      return;
    }
    if (this._replayEl) return;

    const bar = el('div', 'hud-replay', this.root);
    el('span', 'hud-replay__title', bar, '▶ Replaying turn…');
    const speeds = el('span', 'hud-replay__speeds', bar);
    const speedBtns = [];
    for (const s of [1, 2, 4]) {
      const b = el('button', 'hud-replay__speed', speeds, `${s}×`);
      b.type = 'button';
      if (s === 1) b.classList.add('is-active');
      b.addEventListener('click', () => {
        speedBtns.forEach((x) => x.classList.remove('is-active'));
        b.classList.add('is-active');
        opts.onSpeed && opts.onSpeed(s);
      });
      speedBtns.push(b);
    }
    const skip = el('button', 'hud-btn hud-replay__skip', bar, 'Skip ≫');
    skip.type = 'button';
    skip.addEventListener('click', () => opts.onSkip && opts.onSkip());
    this._replayEl = bar;
  }

  _removeOverlay() {
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
    }
  }
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
