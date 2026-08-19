// Replay browser: step through a game's recorded turns with ◀ ▶, re-watch,
// and copy a shareable deep-link (/games/{id}/replay/{turn}) for any moment.
//
// Self-contained: builds its own DOM + styles so it never conflicts with the
// HUD. Each viewed turn rebuilds a fresh Sim (fast — the engine simulates at
// hundreds of thousands of ticks/sec) and plays that turn's command stream.

import { Sim } from '../engine/sim.js';
import { Renderer } from './renderer.js';
import { Camera } from './camera.js';
import { ReplayPlayer } from './replay.js';

const BAR_CSS = `
.replay-bar {
    position: fixed; left: 50%; bottom: 86px; transform: translateX(-50%);
    display: flex; align-items: center; gap: 8px;
    background: rgba(10, 14, 22, 0.88); border: 2px solid rgba(255,255,255,0.18);
    border-radius: 14px; padding: 8px 12px; z-index: 60;
    font-family: 'Arial Rounded MT Bold', 'Verdana', sans-serif;
    color: #fff; box-shadow: 0 6px 18px rgba(0,0,0,0.45);
    pointer-events: auto;
}
.replay-bar button {
    background: rgba(255,255,255,0.12); color: #fff; border: 0;
    border-radius: 9px; padding: 7px 12px; font: inherit; font-size: 13px;
    cursor: pointer; transition: background 0.12s;
}
.replay-bar button:hover:not(:disabled) { background: rgba(255,255,255,0.26); }
.replay-bar button:disabled { opacity: 0.35; cursor: default; }
.replay-bar .replay-label { font-size: 13px; padding: 0 6px; min-width: 130px; text-align: center; }
.replay-bar .replay-label small { display: block; font-size: 10px; opacity: 0.7; }
.replay-bar .replay-speed.on { background: #e8b445; color: #1b1408; }
.replay-bar .replay-copied { background: #45c860 !important; color: #06220c; }
.replay-open-btn {
    position: fixed; right: 18px; bottom: 62px; z-index: 55;
    background: rgba(10, 14, 22, 0.82); color: #fff; border: 2px solid rgba(255,255,255,0.18);
    border-radius: 12px; padding: 9px 14px; font: bold 13px 'Arial Rounded MT Bold', 'Verdana', sans-serif;
    cursor: pointer; pointer-events: auto;
}
.replay-open-btn:hover { background: rgba(30, 40, 58, 0.92); }
.net-banner {
    position: fixed; top: 64px; left: 50%; transform: translateX(-50%);
    background: rgba(10, 14, 22, 0.88); border: 2px solid rgba(255,255,255,0.18);
    border-radius: 12px; padding: 10px 18px; z-index: 58;
    font: bold 14px 'Arial Rounded MT Bold', 'Verdana', sans-serif; color: #fff;
    display: flex; align-items: center; gap: 10px; pointer-events: none;
}
.net-banner .net-dot {
    width: 9px; height: 9px; border-radius: 50%; background: #e8b445;
    animation: net-pulse 1.4s ease-in-out infinite;
}
@keyframes net-pulse { 0%,100% { opacity: 0.35; } 50% { opacity: 1; } }
.turn-gate {
    position: fixed; inset: 0; z-index: 70; display: grid; place-items: center;
    background: rgba(8, 10, 16, 0.55); pointer-events: auto;
}
.turn-gate-card {
    background: #fdf6e3; color: #2b2028; border: 3px solid #2b2028; border-radius: 16px;
    padding: 28px 40px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    font-family: 'Arial Rounded MT Bold', 'Verdana', sans-serif;
}
.turn-gate-card small { display: block; letter-spacing: 0.12em; opacity: 0.6; font-size: 11px; }
.turn-gate-card h2 { margin: 6px 0 16px; font-size: 30px; }
.turn-gate-card button {
    background: linear-gradient(180deg, #7ede4f, #45c828); color: #fff; border: 2px solid #2f7edb;
    border-radius: 10px; padding: 10px 26px; font: bold 16px inherit; cursor: pointer;
}
`;

function injectStyles() {
    if (document.getElementById('replay-ui-css')) return;
    const s = document.createElement('style');
    s.id = 'replay-ui-css';
    s.textContent = BAR_CSS;
    document.head.appendChild(s);
}

// Floating "Replays" button for the live game view. latestTurn is a getter so
// turns committed during this session immediately become browsable.
export function mountReplayButton({ gameId, latestTurn, inLiveTurn }) {
    injectStyles();
    const btn = document.createElement('button');
    btn.className = 'replay-open-btn';
    btn.textContent = '📽 Replays';
    btn.addEventListener('click', () => {
        const n = latestTurn?.() ?? 0;
        if (n < 1) { alert('No turns have been played yet.'); return; }
        if (inLiveTurn?.() && !confirm('Leave the current turn? Unfinished moves will be lost.')) return;
        location.href = `/games/${gameId}/replay/${n}`;
    });
    document.body.appendChild(btn);
}

// Pulsing status banner for remote games ("Waiting for Blue Team…").
let netBannerEl = null;
export function showNetBanner(text) {
    injectStyles();
    if (!netBannerEl) {
        netBannerEl = document.createElement('div');
        netBannerEl.className = 'net-banner';
        netBannerEl.innerHTML = '<span class="net-dot"></span><span class="net-text"></span>';
        document.body.appendChild(netBannerEl);
    }
    netBannerEl.querySelector('.net-text').textContent = text;
    netBannerEl.style.display = 'flex';
}
export function hideNetBanner() {
    if (netBannerEl) netBannerEl.style.display = 'none';
}

// "You're up!" gate before a remote player's own turn — an explicit start
// click (also satisfies the browser's user-gesture rule for audio).
export function showTurnGate(teamName) {
    injectStyles();
    return new Promise((resolve) => {
        const gate = document.createElement('div');
        gate.className = 'turn-gate';
        gate.innerHTML = `
            <div class="turn-gate-card">
                <small>IT'S YOUR TURN</small>
                <h2></h2>
                <button type="button">Take the turn!</button>
            </div>`;
        gate.querySelector('h2').textContent = teamName;
        gate.querySelector('button').addEventListener('click', () => {
            gate.remove();
            resolve();
        });
        document.body.appendChild(gate);
    });
}

export class ReplayBrowser {
    constructor({ canvas, config, game, hud }) {
        this.canvas = canvas;
        this.config = config;
        this.game = game;         // { id, name, turns: [...] } from the API
        this.hud = hud;
        this.turn = 1;
        this._playing = false;
        this._player = null;
        this._idleRaf = 0;
        this._speed = 1;
        injectStyles();
        this._buildBar();
    }

    async start(turnN) {
        document.body.classList.add('replay-mode');
        await this._show(clamp(turnN, 1, this.game.turns.length));
    }

    _buildBar() {
        const bar = document.createElement('div');
        bar.className = 'replay-bar';
        bar.innerHTML = `
            <button data-act="prev" title="Previous turn">◀</button>
            <div class="replay-label"><span data-el="title"></span><small data-el="sub"></small></div>
            <button data-act="next" title="Next turn">▶</button>
            <button data-act="again" title="Watch this turn again">⟳</button>
            <button data-act="speed1" class="replay-speed on">1×</button>
            <button data-act="speed2" class="replay-speed">2×</button>
            <button data-act="speed4" class="replay-speed">4×</button>
            <button data-act="share" title="Copy a link to this turn">🔗 Share</button>
            <button data-act="exit">Back to game</button>
        `;
        bar.addEventListener('click', (e) => {
            const act = e.target?.dataset?.act;
            if (!act) return;
            if (act === 'prev') this._show(this.turn - 1);
            else if (act === 'next') this._show(this.turn + 1);
            else if (act === 'again') this._show(this.turn);
            else if (act.startsWith('speed')) this._setSpeed(Number(act.slice(5)), e.target);
            else if (act === 'share') this._share(e.target);
            else if (act === 'exit') location.href = `/games/${this.game.id}`;
        });
        document.body.appendChild(bar);
        this.bar = bar;
        this.$ = (sel) => bar.querySelector(sel);
    }

    _setSpeed(n, btnEl) {
        this._speed = n;
        this._player?.setSpeed(n);
        for (const b of this.bar.querySelectorAll('.replay-speed')) b.classList.remove('on');
        btnEl.classList.add('on');
    }

    async _share(btnEl) {
        const url = `${location.origin}/games/${this.game.id}/replay/${this.turn}`;
        if (copyText(url)) {
            btnEl.classList.add('replay-copied');
            btnEl.textContent = '✓ Copied';
            setTimeout(() => { btnEl.classList.remove('replay-copied'); btnEl.textContent = '🔗 Share'; }, 1600);
        } else {
            prompt('Copy this replay link:', url);
        }
    }

    _teamNameFor(turnRecord) {
        return this.config.teams[turnRecord.player_position]?.name ?? `Team ${turnRecord.player_position + 1}`;
    }

    async _show(n) {
        const turns = this.game.turns;
        n = clamp(n, 1, turns.length);

        // Abort any playback in progress, stop idle rendering.
        if (this._playing) this._player?.skip();
        cancelAnimationFrame(this._idleRaf);
        this.turn = n;
        history.replaceState(null, '', `/games/${this.game.id}/replay/${n}`);

        this.$('[data-el="title"]').textContent = `Turn ${n} / ${turns.length}`;
        this.$('[data-el="sub"]').textContent = this._teamNameFor(turns[n - 1]);
        this.$('[data-act="prev"]').disabled = n <= 1;
        this.$('[data-act="next"]').disabled = n >= turns.length;

        // Fresh deterministic rebuild up to the turn before n, then play n.
        const sim = Sim.newGame(this.config);
        const camera = new Camera(window.innerWidth, window.innerHeight, this.config.width, this.config.height);
        const renderer = new Renderer(this.canvas, sim, camera);
        const player = new ReplayPlayer(sim, renderer, camera);
        player.setSpeed(this._speed);
        this._player = player;
        this.sim = sim;
        this.renderer = renderer;

        sim.drainEvents();
        player.fastForward(turns.slice(0, n - 1));
        renderer.handleEvents([]);

        this._playing = true;
        await player.play(
            [turns[n - 1]],
            () => this.hud?.update?.(sim.state, sim.phase),
            () => this.hud?.update?.(sim.state, sim.phase),
        );
        this._playing = false;

        // Keep the settled scene alive (water, particles) until the next action.
        let last = performance.now();
        const idle = (now) => {
            renderer.handleEvents(sim.drainEvents());
            renderer.render(now - last);
            last = now;
            this._idleRaf = requestAnimationFrame(idle);
        };
        this._idleRaf = requestAnimationFrame(idle);
    }
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

// Clipboard API needs a secure context (HTTPS/localhost) — on plain HTTP
// (worms.test) fall back to a temp textarea + execCommand. Async clipboard
// writes are fired without awaiting; execCommand covers the insecure case.
function copyText(text) {
    if (window.isSecureContext && navigator.clipboard) {
        navigator.clipboard.writeText(text).catch(() => {});
        return true;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return ok;
}
