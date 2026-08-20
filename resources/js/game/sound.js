// sound.js — tiny WebAudio sound bank for Worms: Armistice.
//
// Usage: sounds.init() once (renderer constructor), then sounds.play(name).
// The AudioContext starts suspended until the first user gesture (browsers
// block autoplay); a one-time pointerdown/keydown listener resumes it.
// Missing files fail silently (warn once) — the game never depends on audio.

const BASE = '/assets/sounds/';

// Logical name -> file(s). Arrays are variant pools (rotated per play).
const FILES = {
  explosion: ['explosion-1.wav', 'explosion-2.wav', 'explosion-3.wav'],
  splash: 'splash.wav',
  'bazooka-fire': 'bazooka-fire.wav',
  'shotgun-fire': 'shotgun-fire.wav',
  throw: 'throw-release.wav',
  'dynamite-fuse': 'dynamite-fuse.wav',
  firepunch: 'firepunch-impact.wav',
  airstrike: 'airstrike-jet.wav',
  teleport: 'teleport.wav',
  'crate-land': 'crate-land.wav',
  'crate-collect': 'crate-collect.wav',
  bounce: 'grenade-bounce.wav',
  'worm-select': 'worm-select.wav',
  jump: 'voice-jump1.wav',
  ohno: ['voice-uhoh.wav', 'voice-nooo.wav'],
  laugh: 'voice-laugh.wav',
  byebye: 'voice-byebye.wav',
  victory: 'voice-victory.wav',
  // Holy Hand Grenade choir — sample NOT in the current rip (flagged in
  // WEAPONS.md). Wired so dropping hallelujah.wav into public/assets/sounds/
  // just works; until then it 404s once at boot and stays silent.
  hallelujah: 'hallelujah.wav',
};

class SoundBank {
  constructor() {
    this.ctx = null;
    this.buffers = new Map(); // file -> AudioBuffer
    this.variantCursor = new Map(); // name -> next variant index
    this.lastPlayed = new Map(); // name -> ctx.currentTime (dedupe bursts)
    this._initialised = false;
  }

  init() {
    if (this._initialised || typeof window === 'undefined') return;
    this._initialised = true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch (e) {
      return;
    }

    // Autoplay policy: resume on the first user gesture.
    const resume = () => {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);

    // Fetch + decode everything up front (small WAVs); silent per-file failure.
    const files = new Set();
    for (const v of Object.values(FILES)) {
      for (const f of Array.isArray(v) ? v : [v]) files.add(f);
    }
    Promise.all([...files].map((f) => this._load(f))).catch(() => {});
  }

  async _load(file) {
    try {
      const res = await fetch(BASE + file);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const audio = await this.ctx.decodeAudioData(buf);
      this.buffers.set(file, audio);
    } catch (e) {
      console.warn(`[sound] ${file} unavailable (${e.message})`);
    }
  }

  get muted() {
    try { return localStorage.getItem('worms-muted') === '1'; } catch { return false; }
  }

  setMuted(on) {
    try { localStorage.setItem('worms-muted', on ? '1' : '0'); } catch { /* ignore */ }
  }

  play(name, { volume = 1 } = {}) {
    if (this.muted) return;
    if (!this.ctx || this.ctx.state !== 'running') return;
    const entry = FILES[name];
    if (!entry) return;

    // Debounce identical sounds fired in the same burst (e.g. cluster hits).
    const now = this.ctx.currentTime;
    const last = this.lastPlayed.get(name);
    if (last != null && now - last < 0.08) return;
    this.lastPlayed.set(name, now);

    let file;
    if (Array.isArray(entry)) {
      const i = this.variantCursor.get(name) || 0;
      this.variantCursor.set(name, (i + 1) % entry.length);
      file = entry[i];
    } else {
      file = entry;
    }
    const buffer = this.buffers.get(file);
    if (!buffer) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(this.ctx.destination);
    src.start();
  }
}

export const sounds = new SoundBank();
