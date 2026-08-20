// Replays recorded turns through a live Sim — paced (cinematic) or instant.
// Because the sim is deterministic, a replay IS the original turn.
//
// Dead-air compression: async players think for minutes between inputs, and
// every idle tick is faithfully recorded. Watching that 1:1 is watching a
// motionless worm — so playback fast-forwards (IDLE_MULT) through stretches
// where the player gave no input AND the world is settled, after a short
// grace so pauses between actions keep a natural rhythm. Every tick is still
// simulated in order — determinism is untouched, only wall-clock pacing.

import { decodeCommands } from '../engine/commands.js';

const IDLE_MULT = 16;        // fast-forward factor through dead air
const IDLE_GRACE_TICKS = 40; // ~0.7s of quiet before the fast-forward kicks in

function isIdleCmd(c) {
    return !c.left && !c.right && !c.jump && !c.backflip &&
        !c.aimUp && !c.aimDown && !c.charge && !c.fire &&
        !c.weapon && !c.fuse && !c.target;
}

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
            let quiet = 0; // consecutive idle-and-settled ticks
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
                    const mult = quiet >= IDLE_GRACE_TICKS ? IDLE_MULT : 1;
                    acc += Math.min(now - last, 100) * this.speed * mult;
                    last = now;
                    const tickMs = 1000 / 60;
                    let steps = 0;
                    while (acc >= tickMs && i < cmds.length && steps < 8 * this.speed * mult) {
                        const cmd = cmds[i++];
                        this.sim.step(cmd);
                        if (isIdleCmd(cmd) && this.sim._settled()) quiet++;
                        else {
                            // Action resumed mid-burst: drop leftover budget so
                            // the first real input plays at normal pace.
                            if (quiet >= IDLE_GRACE_TICKS) acc = 0;
                            quiet = 0;
                        }
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
