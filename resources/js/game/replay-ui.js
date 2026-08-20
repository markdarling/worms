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
import { InputRecorder } from './input.js';
import { captureHp, diffTurn, showTurnCard, showTaunt } from './turncard.js';

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
.replay-bar .replay-again-icon { font-size: 17px; line-height: 1; vertical-align: -2px; }
.replay-bar .replay-label small { display: block; font-size: 10px; opacity: 0.7; }
.replay-bar .replay-speed.on { background: #e8b445; color: #1b1408; }
.replay-bar .replay-copied { background: #45c860 !important; color: #06220c; }
/* Top-right actions cluster, stacked under the turn counter. */
.top-actions {
    position: fixed; right: 12px; top: 122px; z-index: 55;
    display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
}
.top-actions > * {
    display: inline-block; text-decoration: none;
    background: rgba(10, 14, 22, 0.82); color: #fff; border: 2px solid rgba(255,255,255,0.18);
    border-radius: 10px; padding: 6px 12px; font: bold 12px 'Arial Rounded MT Bold', 'Verdana', sans-serif;
    cursor: pointer; pointer-events: auto;
}
.top-actions > *:hover { background: rgba(30, 40, 58, 0.92); }
/* Home icon inside the HUD's turn-counter box (links page for seat holders). */
.hud-turnbox { position: relative; padding-left: 34px !important; }
.hud-homelink {
    position: absolute; left: 9px; top: 50%; transform: translateY(-50%);
    font-size: 15px; text-decoration: none; pointer-events: auto;
    filter: grayscale(35%); transition: filter 0.12s, transform 0.12s;
}
.hud-homelink:hover { filter: none; transform: translateY(-50%) scale(1.15); }
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
.net-banner--turn { border-color: rgba(94, 200, 60, 0.85); }
.net-banner--turn .net-dot { background: #6ee84a; box-shadow: 0 0 9px rgba(110, 232, 74, 0.9); }
.net-banner--turn .net-text { letter-spacing: 0.06em; }
/* Killcam-style replay treatment: red viewfinder frame + corner brackets +
   pulsing record dot with a REPLAY badge. Unmistakably "a recording". */
.replay-frame {
    position: fixed; inset: 10px; z-index: 57; pointer-events: none;
    border: 3px solid rgba(232, 69, 69, 0.85); border-radius: 14px;
    box-shadow: inset 0 0 46px rgba(232, 69, 69, 0.10);
}
.replay-frame::before, .replay-frame::after {
    content: ''; position: absolute; width: 26px; height: 26px;
    border: 4px solid #ff5252;
}
.replay-frame::before { top: -4px; left: -4px; border-right: 0; border-bottom: 0; border-radius: 14px 0 0 0; }
.replay-frame::after { bottom: -4px; right: -4px; border-left: 0; border-top: 0; border-radius: 0 0 14px 0; }
.replay-badge {
    position: fixed; top: 24px; left: 50%; transform: translateX(-50%) translateY(64px);
    z-index: 58; pointer-events: none;
    display: flex; align-items: center; gap: 10px;
    background: rgba(10, 14, 22, 0.88); border: 2px solid rgba(232, 69, 69, 0.7);
    border-radius: 11px; padding: 8px 16px;
    font-family: 'Arial Rounded MT Bold', 'Verdana', sans-serif; color: #fff;
}
.replay-badge .rec-dot {
    width: 11px; height: 11px; border-radius: 50%; background: #ff4040;
    box-shadow: 0 0 9px rgba(255, 64, 64, 0.9);
    animation: net-pulse 1.2s ease-in-out infinite;
}
.replay-badge .replay-word { font-size: 15px; font-weight: bold; letter-spacing: 0.22em; }
.replay-badge .replay-sub { font-size: 12px; opacity: 0.75; }
.replay-badge .replay-skip {
    pointer-events: auto; cursor: pointer; margin-left: 6px;
    background: rgba(255, 255, 255, 0.14); color: #fff; border: 0;
    border-radius: 8px; padding: 5px 11px; font: bold 12px inherit;
}
.replay-badge .replay-skip:hover { background: rgba(255, 255, 255, 0.28); }
`;

function injectStyles() {
    if (document.getElementById('replay-ui-css')) return;
    const s = document.createElement('style');
    s.id = 'replay-ui-css';
    s.textContent = BAR_CSS;
    document.head.appendChild(s);
}

// Floating "Replays" button for the live game view. latestTurn is a getter so
// turns committed during this session immediately become browsable. Where we
// came from (seat link / spectate page) is remembered in sessionStorage so
// "Back to game" can return to the right identity — and seat tokens never
// end up in a shareable replay URL.
const originKey = (gameId) => `worms-replay-origin:${gameId}`;

let topActionsEl = null;
function topActions() {
    injectStyles();
    if (!topActionsEl) {
        topActionsEl = document.createElement('div');
        topActionsEl.className = 'top-actions';
        document.body.appendChild(topActionsEl);
    }
    return topActionsEl;
}

export function mountReplayButton({ gameId, latestTurn, inLiveTurn }) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '📽 Replays';
    btn.addEventListener('click', () => {
        const n = latestTurn?.() ?? 0;
        if (n < 1) { alert('No turns have been played yet.'); return; }
        if (inLiveTurn?.() && !confirm('Leave the current turn? Unfinished moves will be lost.')) return;
        try { sessionStorage.setItem(originKey(gameId), location.pathname); } catch { /* ignore */ }
        location.href = `/games/${gameId}/replay/${n}`;
    });
    topActions().appendChild(btn);
}

// Home icon inside the turn-counter box linking to the game's links page
// (seat holders only — that page holds every team's private link).
export function mountLinkActions({ linksUrl }) {
    if (!linksUrl) return;
    injectStyles();
    const turnbox = document.querySelector('.hud-turnbox');
    if (!turnbox) return;
    const a = document.createElement('a');
    a.className = 'hud-homelink';
    a.href = linksUrl;
    a.title = 'All game links';
    a.textContent = '🏠';
    turnbox.appendChild(a);
}

// Pulsing status banner in the game chrome. kind: 'wait' (amber, default)
// for "Waiting for Blue…", 'turn' (green) for "Your turn".
let netBannerEl = null;
export function showNetBanner(text, kind = 'wait') {
    injectStyles();
    if (!netBannerEl) {
        netBannerEl = document.createElement('div');
        netBannerEl.innerHTML = '<span class="net-dot"></span><span class="net-text"></span>';
        document.body.appendChild(netBannerEl);
    }
    netBannerEl.className = kind === 'turn' ? 'net-banner net-banner--turn' : 'net-banner';
    netBannerEl.querySelector('.net-text').textContent = text;
    netBannerEl.style.display = 'flex';
}
export function hideNetBanner() {
    if (netBannerEl) netBannerEl.style.display = 'none';
}

// Killcam-style "this is a recording" treatment: red viewfinder frame around
// the whole viewport + pulsing record-dot badge reading REPLAY, with a
// subtitle for whose turn is playing. Call repeatedly to update the subtitle.
// Pass { onSkip } to offer a Skip button (catch-up and arrival replays).
let replayFrameEls = null;
export function showReplayFrame(subtitle = '', { onSkip } = {}) {
    injectStyles();
    // body.replay-mode hides the controls hint + weapon dock and adds the
    // letterbox (game.css) — catch-up replays get the same chrome as the
    // replay browser.
    document.body.classList.add('replay-mode');
    if (!replayFrameEls) {
        const frame = document.createElement('div');
        frame.className = 'replay-frame';
        const badge = document.createElement('div');
        badge.className = 'replay-badge';
        badge.innerHTML = '<span class="rec-dot"></span><span class="replay-word">REPLAY</span><span class="replay-sub"></span>'
            + '<button type="button" class="replay-skip">Skip ≫</button>';
        document.body.append(frame, badge);
        replayFrameEls = { frame, badge, skipBtn: badge.querySelector('.replay-skip') };
    }
    replayFrameEls.frame.style.display = 'block';
    replayFrameEls.badge.style.display = 'flex';
    replayFrameEls.badge.querySelector('.replay-sub').textContent = subtitle;
    const { skipBtn } = replayFrameEls;
    skipBtn.style.display = onSkip ? 'inline-block' : 'none';
    skipBtn.onclick = onSkip ?? null;
}
export function hideReplayFrame() {
    document.body.classList.remove('replay-mode');
    if (!replayFrameEls) return;
    replayFrameEls.frame.style.display = 'none';
    replayFrameEls.badge.style.display = 'none';
}

export class ReplayBrowser {
    constructor({ canvas, config, game, hud, gameId }) {
        this.canvas = canvas;
        this.config = config;
        this.game = game;              // { name, turns: [...] } from the API
        this.gameId = gameId ?? game.id; // public URL id (window.GAME_ID)
        this.hud = hud;
        this.turn = 1;
        this._playing = false;
        this._player = null;
        this._idleRaf = 0;
        this._speed = 1;
        // Where the player entered the replay browser from (their seat link or
        // the spectate page). Absent on a direct deep-link — no back button.
        try { this.originPath = sessionStorage.getItem(originKey(this.gameId)); } catch { this.originPath = null; }
        injectStyles();
        this._buildBar();
    }

    async start(turnN) {
        document.body.classList.add('replay-mode');
        showReplayFrame();
        await this._show(clamp(turnN, 1, this.game.turns.length));
    }

    _buildBar() {
        const bar = document.createElement('div');
        bar.className = 'replay-bar';
        bar.innerHTML = `
            <button data-act="prev" title="Previous turn">◀</button>
            <div class="replay-label"><span data-el="title"></span><small data-el="sub"></small></div>
            <button data-act="next" title="Next turn">▶</button>
            <button data-act="again" title="Watch this turn again"><span class="replay-again-icon">⟳</span> Replay</button>
            <button data-act="speed1" class="replay-speed on">1×</button>
            <button data-act="speed2" class="replay-speed">2×</button>
            <button data-act="speed4" class="replay-speed">4×</button>
            <button data-act="share" title="Copy a link to this turn">🔗 Share</button>
            ${this.originPath ? '<button data-act="exit">Back to game</button>' : ''}
        `;
        bar.addEventListener('click', (e) => {
            const act = e.target?.dataset?.act;
            if (!act) return;
            if (act === 'prev') this._show(this.turn - 1);
            else if (act === 'next') this._show(this.turn + 1);
            else if (act === 'again') this._show(this.turn);
            else if (act.startsWith('speed')) this._setSpeed(Number(act.slice(5)), e.target);
            else if (act === 'share') this._share(e.target);
            else if (act === 'exit') location.href = this.originPath;
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
        const url = `${location.origin}/games/${this.gameId}/replay/${this.turn}`;
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
        history.replaceState(null, '', `/games/${this.gameId}/replay/${n}`);

        this.$('[data-el="title"]').textContent = `Turn ${n} / ${turns.length}`;
        this.$('[data-el="sub"]').textContent = this._teamNameFor(turns[n - 1]);
        showReplayFrame(`${this._teamNameFor(turns[n - 1])} · Turn ${n}`);
        this.$('[data-act="prev"]').disabled = n <= 1;
        this.$('[data-act="next"]').disabled = n >= turns.length;

        // Fresh deterministic rebuild up to the turn before n, then play n.
        const sim = Sim.newGame(this.config);
        const camera = new Camera(window.innerWidth, window.innerHeight, this.config.width, this.config.height);
        const renderer = new Renderer(this.canvas, sim, camera);
        // Drag-to-pan + wheel-zoom while watching (recorder stays disabled —
        // no game inputs, just the camera hooks).
        this._input?.detach();
        this._input = new InputRecorder(this.canvas, camera);
        this._input.onPan = (dx, dy) => camera.nudge(dx, dy);
        this._input.attach();
        const player = new ReplayPlayer(sim, renderer, camera);
        player.setSpeed(this._speed);
        this._player = player;
        this.sim = sim;
        this.renderer = renderer;

        sim.drainEvents();
        player.fastForward(turns.slice(0, n - 1));
        renderer.handleEvents([]);

        this._playing = true;
        let hpBefore = null;
        const bloodBefore = sim.worms.some((w) => !w.alive);
        await player.play(
            [turns[n - 1]],
            (t) => {
                hpBefore = captureHp(sim);
                if (t.taunt) showTaunt(this._teamNameFor(t), this.config.teams[t.player_position]?.color, t.taunt);
                this.hud?.update?.(sim.state, sim.phase);
            },
            () => this.hud?.update?.(sim.state, sim.phase),
            (t) => {
                const stats = diffTurn(hpBefore, sim, t.player_position);
                showTurnCard({
                    teamName: this._teamNameFor(t),
                    color: this.config.teams[t.player_position]?.color,
                    stats,
                    firstBlood: !bloodBefore && stats.deaths.length > 0,
                });
            },
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
