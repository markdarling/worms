// Boot + hotseat game loop.
//
// Flow: fetch game -> rebuild world by deterministic replay of all recorded
// turns (watch or skip) -> loop: pass-device -> live turn (fixed-timestep,
// inputs recorded) -> commit turn to API -> next player. The commit pipeline
// is identical to what a networked client will use.

import { Sim } from '../engine/sim.js';
import { encodeCommands } from '../engine/commands.js';
import { Renderer } from './renderer.js';
import { initAssets } from './sprites.js';
import { Camera } from './camera.js';
import { Hud } from './hud.js';
import { InputRecorder } from './input.js';
import { ReplayPlayer } from './replay.js';
import { ReplayBrowser, mountReplayButton, showNetBanner, hideNetBanner, showTurnGate } from './replay-ui.js';
import { fetchGame, fetchTurnsAfter, postTurn } from './api.js';

const TICK_MS = 1000 / 60;

async function boot() {
    await initAssets();
    const gameId = window.GAME_ID;
    const game = await fetchGame(gameId);
    const config = game.config;

    const canvas = document.getElementById('game-canvas');
    const hudRoot = document.getElementById('hud-root');

    // ---- Replay browser mode (shareable deep-links) -------------------------
    if (window.REPLAY_TURN != null) {
        if (game.turns.length === 0) {
            location.href = `/games/${gameId}`;
            return;
        }
        const hud = new Hud(hudRoot, { onWeaponSelect() {}, onFuseSelect() {}, onSkip() {} });
        hud.setGameName?.(game.name);
        hud.setTeams?.(config.teams);
        const browser = new ReplayBrowser({ canvas, config, game, hud });
        await browser.start(window.REPLAY_TURN);
        return;
    }

    const sim = Sim.newGame(config);
    const camera = new Camera(window.innerWidth, window.innerHeight, config.width, config.height);
    const renderer = new Renderer(canvas, sim, camera);
    const input = new InputRecorder(canvas, camera);
    const hud = new Hud(hudRoot, {
        onWeaponSelect: (id) => { input.selectWeapon(id); hud.toggleWeaponPanel?.(false); },
        onFuseSelect: (n) => input.selectFuse(n),
        onSkip: () => input.requestSkip(),
    });
    const replayer = new ReplayPlayer(sim, renderer, camera);

    hud.setGameName?.(game.name);
    hud.setTeams?.(config.teams);

    input.onTogglePanel = () => hud.toggleWeaponPanel?.();
    input.onPan = (dx, dy) => camera.nudge(dx, dy);
    input.attach();

    const resize = () => {
        camera.resize?.(window.innerWidth, window.innerHeight);
        renderer.resize?.();
    };
    window.addEventListener('resize', resize);
    resize();

    // ---- Rebuild recorded history (silent fast-forward; replays live at
    //      /games/{id}/replay/{turn} via the Replays button) -----------------
    sim.drainEvents();
    if (game.turns.length > 0) {
        replayer.fastForward(game.turns);
        renderer.handleEvents([]); // ensure renderer observes rebuilt terrain
    }
    if (game.snapshot && sim.stateHash() !== undefined && game.turns.length > 0) {
        // Determinism cross-check: log-only in v1.
        try {
            const rebuilt = Sim.fromSnapshot(config, game.snapshot);
            if (rebuilt.stateHash() !== sim.stateHash()) {
                console.warn('Replay/state divergence detected — replayed hash differs from server snapshot.');
            }
        } catch (e) {
            console.warn('Snapshot cross-check failed:', e);
        }
    }

    // ---- Live loop ----------------------------------------------------------
    const teamName = (i) => config.teams[i]?.name ?? `Team ${i + 1}`;

    let committedTurns = game.turns.length;
    let inLiveTurn = false;
    mountReplayButton({
        gameId,
        latestTurn: () => committedTurns,
        inLiveTurn: () => inLiveTurn,
    });

    // Remote mode: this client owns one seat (or none — spectator).
    const remote = game.mode === 'remote';
    const myPosition = window.PLAYER_POSITION;
    const myToken = window.PLAYER_TOKEN;
    const baseTitle = document.title;

    let running = true;
    while (running) {
        if (sim.phase === 'game-over') {
            hideNetBanner();
            hud.showGameOver(sim.winner === 'draw' ? null : teamName(sim.winner));
            break;
        }

        const turnNumber = (sim.state.turnNumber ?? 0) + 1;

        // Peek at who plays next without mutating the live sim (beginTurn has
        // side effects — crates, wind — so probe a snapshot clone instead).
        const peek = Sim.fromSnapshot(config, sim.snapshot());
        peek.beginTurn(turnNumber);
        const nextTeam = peek.state.worms.find((w) => w.id === peek.state.activeWormId)?.teamIndex ?? 0;

        if (remote && nextTeam !== myPosition) {
            // Not our seat: wait for the opponent's committed turn, then play
            // it back cinematically — the async replay feed in action.
            const arrived = await waitForTurns(gameId, turnNumber, teamName(nextTeam), sim, renderer, hud);
            if (!arrived) return; // fetch failure already surfaced
            // replayer.play() runs beginTurn itself — calling it here too would
            // advance the team rotation twice and desync the replay.
            for (const t of arrived) {
                await replayer.play([t], () => hud.update(sim.state, sim.phase), () => hud.update(sim.state, sim.phase));
                committedTurns = t.number;
            }
            continue;
        }

        sim.beginTurn(turnNumber);
        renderer.handleEvents(sim.drainEvents());
        const activeTeam = sim.state.worms.find((w) => w.id === sim.state.activeWormId)?.teamIndex ?? 0;

        if (remote) {
            document.title = `🔴 Your turn! — ${game.name}`;
            await showTurnGate(teamName(activeTeam));
            document.title = baseTitle;
        } else {
            await new Promise((resolve) => hud.showPassDevice(teamName(activeTeam), resolve));
        }

        input.beginTurn();
        input.enabled = true;
        inLiveTurn = true;
        await runLiveTurn(sim, renderer, camera, hud, input);
        inLiveTurn = false;
        input.enabled = false;

        // Commit the recorded turn.
        const gameOver = sim.phase === 'game-over';
        const payload = {
            number: turnNumber,
            player_token: myToken ?? undefined,
            player_position: activeTeam,
            commands: encodeCommands(input.recording),
            snapshot_after: sim.snapshot(),
            state_hash: sim.stateHash(),
            game_over: gameOver,
            winner: gameOver ? (sim.winner === 'draw' ? 'draw' : teamName(sim.winner)) : null,
        };
        try {
            await postTurn(gameId, payload);
            committedTurns = turnNumber;
        } catch (e) {
            if (e.status === 409) {
                alert('This game moved on another device — reloading.');
                location.reload();
                return;
            }
            console.error('Failed to save turn', e);
            alert('Could not save the turn to the server. Check the connection and reload.');
            return;
        }
    }
}

// Poll for the opponent's turn(s). Keeps the scene rendering (water, idle
// animations) while waiting. Resolves with the new turn records, or null on a
// persistent fetch failure (already surfaced to the user).
async function waitForTurns(gameId, expectedTurn, waitingOnName, sim, renderer, hud) {
    showNetBanner(`Waiting for ${waitingOnName}…`);

    let stop = false;
    let last = performance.now();
    const idle = (now) => {
        if (stop) return;
        renderer.handleEvents(sim.drainEvents());
        renderer.render(now - last);
        hud.update(sim.state, sim.phase);
        last = now;
        requestAnimationFrame(idle);
    };
    requestAnimationFrame(idle);

    let failures = 0;
    try {
        for (;;) {
            try {
                const turns = await fetchTurnsAfter(gameId, expectedTurn - 1);
                failures = 0;
                if (turns.length > 0) return turns;
            } catch (e) {
                if (++failures >= 5) {
                    alert('Lost contact with the server. Check the connection and reload.');
                    return null;
                }
            }
            await new Promise((r) => setTimeout(r, 5000));
        }
    } finally {
        stop = true;
        hideNetBanner();
    }
}

// Once the sim reaches turn-over, keep rendering this long so explosions,
// damage numbers and particles finish before the hand-over screen appears.
const SETTLE_MS = 1600;

function runLiveTurn(sim, renderer, camera, hud, input) {
    return new Promise((resolve) => {
        let last = performance.now();
        let acc = 0;
        let settleUntil = 0;
        const frame = (now) => {
            acc += Math.min(now - last, 250);
            const dt = now - last;
            last = now;
            let steps = 0;
            while (acc >= TICK_MS && steps < 6) {
                const cmd = input.sample();
                sim.step(cmd);
                acc -= TICK_MS;
                steps++;
                if (sim.phase === 'turn-over' || sim.phase === 'game-over') break;
            }

            // Click-targeting is only meaningful for these weapons.
            input.targetMode = ['teleport', 'airstrike'].includes(sim.state.selectedWeapon);

            renderer.handleEvents(sim.drainEvents());
            renderer.render(dt); // renderer drives camera follow + update itself
            hud.update(sim.state, sim.phase);

            if (sim.phase === 'turn-over' || sim.phase === 'game-over') {
                // Let the last explosion/damage-number animations play out
                // before handing over.
                if (settleUntil === 0) settleUntil = now + SETTLE_MS;
                if (now >= settleUntil) {
                    resolve();
                    return;
                }
            }
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    });
}

boot().catch((e) => {
    console.error(e);
    document.body.insertAdjacentHTML(
        'beforeend',
        '<div style="position:fixed;inset:0;display:grid;place-items:center;background:#123;color:#fff;font-family:sans-serif;z-index:99"><div>Failed to load the game — see console.</div></div>',
    );
});
