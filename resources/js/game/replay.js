// Replays recorded turns through a live Sim — paced (cinematic) or instant.
// Because the sim is deterministic, a replay IS the original turn.

import { decodeCommands } from '../engine/commands.js';

export class ReplayPlayer {
    constructor(sim, renderer, camera) {
        this.sim = sim;
        this.renderer = renderer;
        this.camera = camera;
        this.speed = 1;
        this._skip = false;
    }

    setSpeed(n) { this.speed = n; }
    skip() { this._skip = true; }

    // Instantly apply turns with no rendering (used for "skip to game").
    fastForward(turns) {
        for (const t of turns) {
            this.sim.beginTurn(t.number);
            for (const cmd of decodeCommands(t.commands)) this.sim.step(cmd);
            this.sim.drainEvents();
        }
    }

    // Cinematic playback of a list of turn records. onTurnEnd fires after each
    // turn settles (not for turns fast-forwarded by skip).
    async play(turns, onTurnStart, onFrame, onTurnEnd) {
        this._skip = false;
        for (const t of turns) {
            this.sim.beginTurn(t.number);
            onTurnStart?.(t);
            const cmds = decodeCommands(t.commands);
            let i = 0;
            await new Promise((resolve) => {
                let last = performance.now();
                let acc = 0;
                const frame = (now) => {
                    if (this._skip) {
                        // Finish this turn instantly, silently.
                        while (i < cmds.length) this.sim.step(cmds[i++]);
                        this.sim.drainEvents();
                        resolve();
                        return;
                    }
                    acc += Math.min(now - last, 100) * this.speed;
                    last = now;
                    const tickMs = 1000 / 60;
                    let steps = 0;
                    while (acc >= tickMs && i < cmds.length && steps < 8 * this.speed) {
                        this.sim.step(cmds[i++]);
                        acc -= tickMs;
                        steps++;
                    }
                    this.renderer.handleEvents(this.sim.drainEvents());
                    this.renderer.render(now - last); // renderer drives the camera
                    onFrame?.();
                    if (i >= cmds.length) {
                        // Commands done — keep rendering so the final
                        // explosion/particles settle before moving on.
                        if (!settleUntil) settleUntil = now + 1200;
                        if (now >= settleUntil) { resolve(); return; }
                    }
                    requestAnimationFrame(frame);
                };
                let settleUntil = 0;
                requestAnimationFrame(frame);
            });
            if (this._skip) {
                // Skip applies to the whole backlog: finish the rest instantly.
                const rest = turns.slice(turns.indexOf(t) + 1);
                this.fastForward(rest);
                break;
            }
            onTurnEnd?.(t);
        }
    }

}
