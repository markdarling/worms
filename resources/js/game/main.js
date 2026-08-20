// Boot + hotseat game loop.
//
// Flow: fetch game -> rebuild world by deterministic replay of all recorded
// turns (watch or skip) -> loop: pass-device -> live turn (fixed-timestep,
// inputs recorded) -> commit turn to API -> next player. The commit pipeline
// is identical to what a networked client will use.

import { Sim } from '../engine/sim.js';
import { encodeCommands, decodeCommands } from '../engine/commands.js';
import { Renderer } from './renderer.js';
import { initAssets } from './sprites.js';
import { Camera } from './camera.js';
import { Hud } from './hud.js';
import { InputRecorder } from './input.js';
import { ReplayPlayer } from './replay.js';
import {
    ReplayBrowser, mountReplayButton, mountLinkActions, showNetBanner,
    hideNetBanner, showReplayFrame, hideReplayFrame,
} from './replay-ui.js';
import { fetchGame, fetchTurnsAfter, postTurn, postRematch } from './api.js';
import { initTurnNotifications, notifyYourTurn } from './notify.js';
import { captureHp, diffTurn, showTurnCard, showTaunt } from './turncard.js';
import { computeGameStats } from './stats.js';

const TICK_MS = 1000 / 60;

// Weapons whose aiming involves clicking the map (strikes, placers, pickers).
const TARGET_WEAPONS = new Set([
    'teleport', 'airstrike', 'napalm', 'minestrike', 'carpetbomb',
    'homing', 'girder', 'donkey', 'selectworm',
]);

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
        const browser = new ReplayBrowser({ canvas, config, game, hud, gameId });
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

    // ---- Rebuild recorded history --------------------------------------------
    // Everything up to the player's own last move fast-forwards silently;
    // whatever happened SINCE then (the moves they haven't seen) plays back
    // cinematically before their turn — the async replay feed.
    const remote = game.mode === 'remote';
    const myPosition = window.PLAYER_POSITION;
    // Spectators get a stripped-down HUD (no weapon dock, no controls hint).
    if (remote && myPosition == null) document.body.classList.add('spectator');
    // The tab identifies your seat immediately, so open seats are tellable apart.
    if (myPosition != null) {
        document.title = `Worms — ${config.teams[myPosition]?.name ?? `Team ${myPosition + 1}`}`;
    }
    // Seat holders get a desktop notification when their turn arrives while
    // the tab is hidden (permission asked on their first click/keypress).
    if (remote && myPosition != null) initTurnNotifications();
    // Remember this seat locally so the lobby's "Your games" list can find it
    // again (no accounts — the browser is the identity).
    if (remote && myPosition != null && window.PLAYER_TOKEN) {
        try {
            const seats = JSON.parse(localStorage.getItem('worms-seats') || '{}');
            seats[gameId] = {
                name: game.name,
                position: myPosition,
                team: config.teams[myPosition]?.name,
                color: config.teams[myPosition]?.color,
                url: `/play/${window.PLAYER_TOKEN}`,
                seen: Date.now(),
            };
            localStorage.setItem('worms-seats', JSON.stringify(seats));
        } catch { /* storage unavailable — the links page still exists */ }
    }

    // End-of-turn commentary card: hp captured after beginTurn (so sudden-death
    // decay isn't credited to the acting team), diffed once the turn settles.
    let bloodSeen = false;
    let hpBefore = null;
    const turnCard = {
        begin: () => { hpBefore = captureHp(sim); },
        finish: (actingTeam) => {
            if (!hpBefore) return;
            const stats = diffTurn(hpBefore, sim, actingTeam);
            hpBefore = null;
            const firstBlood = !bloodSeen && stats.deaths.length > 0;
            if (stats.deaths.length > 0) bloodSeen = true;
            showTurnCard({
                teamName: config.teams[actingTeam]?.name ?? `Team ${actingTeam + 1}`,
                color: config.teams[actingTeam]?.color,
                stats,
                firstBlood,
            });
        },
    };

    sim.drainEvents();
    if (game.turns.length > 0) {
        let cinematic = [];
        if (remote && myPosition != null) {
            const lastMine = game.turns.reduce(
                (m, t) => (t.player_position === myPosition ? Math.max(m, t.number) : m), 0,
            );
            // Cap the catch-up replay so a long-untouched game stays watchable.
            const from = Math.max(lastMine + 1, game.turns.length - 5);
            cinematic = game.turns.filter((t) => t.number >= from);
        }
        const instant = game.turns.slice(0, game.turns.length - cinematic.length);
        replayer.fastForward(instant);
        renderer.handleEvents([]); // ensure renderer observes rebuilt terrain
        bloodSeen = sim.worms.some((w) => !w.alive);

        if (cinematic.length > 0) {
            const teamOf = (t) => config.teams[t.player_position]?.name ?? `Team ${t.player_position + 1}`;
            const frameOpts = { onSkip: () => replayer.skip() };
            showReplayFrame('', frameOpts);
            await replayer.play(
                cinematic,
                (t) => {
                    turnCard.begin();
                    showReplayFrame(`${teamOf(t)} · Turn ${t.number}`, frameOpts);
                    if (t.taunt) showTaunt(teamOf(t), config.teams[t.player_position]?.color, t.taunt);
                    hud.update(sim.state, sim.phase);
                },
                () => hud.update(sim.state, sim.phase),
                (t) => turnCard.finish(t.player_position),
            );
            hideReplayFrame();
        }
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
    mountLinkActions({ linksUrl: window.LINKS_URL });

    // Remote mode: this client owns one seat (or none — spectator).
    const myToken = window.PLAYER_TOKEN;
    const baseTitle = document.title;

    let running = true;
    while (running) {
        if (sim.phase === 'game-over') {
            hideNetBanner();
            startIdleRender(sim, renderer, hud); // keep the scene alive behind the banner
            // Stats come from re-simulating the full recorded game (cheap and
            // always true); refetch so turns committed this session are in.
            let stats = null;
            try {
                const full = await fetchGame(gameId);
                stats = computeGameStats(config, full.turns);
            } catch { /* stats are decoration — the overlay still shows */ }
            hud.showGameOver(sim.winner === 'draw' ? null : teamName(sim.winner), {
                stats,
                onRematch: myToken ? async () => {
                    const res = await postRematch(gameId, myToken);
                    location.href = res.links_url;
                } : null,
            });
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
            // Notify NOW if the arrived turns hand the go to us: the cinematic
            // replay below is rAF-driven and stalls while the tab is hidden,
            // so waiting for the banner would mean never notifying. Peek on a
            // clone — the live sim must not advance before the replay.
            try {
                const peekAhead = Sim.fromSnapshot(config, sim.snapshot());
                for (const t of arrived) {
                    peekAhead.beginTurn(t.number);
                    for (const cmd of decodeCommands(t.commands)) peekAhead.step(cmd);
                }
                if (peekAhead.phase !== 'game-over') {
                    peekAhead.beginTurn(arrived[arrived.length - 1].number + 1);
                    const upNext = peekAhead.state.worms.find((w) => w.id === peekAhead.state.activeWormId)?.teamIndex;
                    if (upNext === myPosition) notifyYourTurn(game.name, teamName(myPosition));
                }
            } catch { /* peek is best-effort — the banner still shows */ }
            // replayer.play() runs beginTurn itself — calling it here too would
            // advance the team rotation twice and desync the replay.
            const frameOpts = { onSkip: () => replayer.skip() };
            showReplayFrame('', frameOpts);
            await replayer.play(
                arrived,
                (t) => {
                    turnCard.begin();
                    showReplayFrame(`${teamName(t.player_position)} · Turn ${t.number}`, frameOpts);
                    if (t.taunt) showTaunt(teamName(t.player_position), config.teams[t.player_position]?.color, t.taunt);
                    hud.update(sim.state, sim.phase);
                },
                () => hud.update(sim.state, sim.phase),
                (t) => turnCard.finish(t.player_position),
            );
            hideReplayFrame();
            committedTurns = arrived[arrived.length - 1].number;
            continue;
        }

        sim.beginTurn(turnNumber);
        renderer.handleEvents(sim.drainEvents());
        turnCard.begin();
        const activeTeam = sim.state.worms.find((w) => w.id === sim.state.activeWormId)?.teamIndex ?? 0;

        if (remote) {
            // Your turn starts immediately — signalled in the game chrome
            // (green banner + tab title), not a blocking overlay.
            document.title = `🔴 Your turn! — ${teamName(activeTeam)}`;
            showNetBanner(`Your turn — ${teamName(activeTeam)}`, 'turn');
            notifyYourTurn(game.name, teamName(activeTeam)); // no-op unless hidden
        } else {
            await new Promise((resolve) => hud.showPassDevice(teamName(activeTeam), resolve));
        }

        input.beginTurn();
        input.enabled = true;
        inLiveTurn = true;
        document.body.classList.add('my-turn'); // reveals the weapon dock
        await runLiveTurn(sim, renderer, camera, hud, input);
        turnCard.finish(activeTeam); // your own commentary — brutal honesty included
        document.body.classList.remove('my-turn');
        inLiveTurn = false;
        input.enabled = false;
        if (remote) {
            hideNetBanner();
            document.title = baseTitle;
        }

        // Commit the recorded turn.
        const gameOver = sim.phase === 'game-over';
        // Who's up next (peek on a clone — beginTurn mutates): stored on the
        // server so it can push-notify the right seat and feed lobby status.
        let nextPosition = null;
        if (!gameOver) {
            try {
                const peekNext = Sim.fromSnapshot(config, sim.snapshot());
                peekNext.beginTurn(turnNumber + 1);
                nextPosition = peekNext.state.worms.find((w) => w.id === peekNext.state.activeWormId)?.teamIndex ?? null;
            } catch { /* best-effort */ }
        }
        const payload = {
            number: turnNumber,
            player_token: myToken ?? undefined,
            player_position: activeTeam,
            commands: encodeCommands(input.recording),
            snapshot_after: sim.snapshot(),
            state_hash: sim.stateHash(),
            game_over: gameOver,
            winner: gameOver ? (sim.winner === 'draw' ? 'draw' : teamName(sim.winner)) : null,
            taunt: hud.takeTaunt?.() ?? null,
            next_position: nextPosition,
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

// Keep the scene rendering (water, clouds, idle animations) while no other
// loop is drawing — behind overlays and while waiting. Returns a stop fn.
function startIdleRender(sim, renderer, hud) {
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
    return () => { stop = true; };
}

// Poll for the opponent's turn(s). Keeps the scene rendering while waiting.
// Resolves with the new turn records, or null on a persistent fetch failure
// (already surfaced to the user).
async function waitForTurns(gameId, expectedTurn, waitingOnName, sim, renderer, hud) {
    showNetBanner(`Waiting for ${waitingOnName}…`);
    const stopIdle = startIdleRender(sim, renderer, hud);

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
        stopIdle();
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

            // Click-targeting weapons (strikes, placers, pickers). Homing's
            // click only marks the target — the launch is aimed + charged.
            input.targetMode = TARGET_WEAPONS.has(sim.state.selectedWeapon);
            input.targetFires = sim.state.selectedWeapon !== 'homing';

            // Girder placement ghost follows the cursor; angle from the fuse.
            if (sim.state.selectedWeapon === 'girder' && sim.phase === 'move') {
                input.onHoverWorld = (x, y) => renderer.setGhost?.({
                    x, y, angle: sim.state.grenadeFuse ?? 1,
                });
            } else {
                input.onHoverWorld = null;
                renderer.setGhost?.(null);
            }

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
