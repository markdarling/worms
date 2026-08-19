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
import { ReplayBrowser, mountReplayButton } from './replay-ui.js';
import { fetchGame, postTurn } from './api.js';

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

    let running = true;
    while (running) {
        if (sim.phase === 'game-over') {
            hud.showGameOver(sim.winner === 'draw' ? null : teamName(sim.winner));
            break;
        }

        const turnNumber = (sim.state.turnNumber ?? 0) + 1;
        sim.beginTurn(turnNumber);
        renderer.handleEvents(sim.drainEvents());
        const activeTeam = sim.state.worms.find((w) => w.id === sim.state.activeWormId)?.teamIndex ?? 0;

        await new Promise((resolve) => hud.showPassDevice(teamName(activeTeam), resolve));

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

function runLiveTurn(sim, renderer, camera, hud, input) {
    return new Promise((resolve) => {
        let last = performance.now();
        let acc = 0;
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
                resolve();
                return;
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
