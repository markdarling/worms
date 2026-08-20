// stats.js — end-of-game statistics, derived by re-simulating the recorded
// turns (the deterministic replay IS the source of truth; nothing is stored).

import { Sim } from '../engine/sim.js';
import { decodeCommands } from '../engine/commands.js';
import { captureHp, diffTurn } from './turncard.js';

/**
 * Replay every turn and total up per-team numbers.
 * Returns [{name, color, dealt, self, kills, lost, biggest, alive}] in team order.
 */
export function computeGameStats(config, turns) {
    const sim = Sim.newGame(config);
    const teams = config.teams.map((t) => ({
        name: t.name,
        color: t.color,
        dealt: 0,   // damage to enemies across the game
        self: 0,    // friendly fire (own team, own worm included)
        kills: 0,   // enemy worms finished during this team's turns
        lost: 0,    // own worms dead by the end
        biggest: 0, // best single-turn damage
        alive: 0,   // survivors
    }));

    sim.drainEvents();
    for (const t of turns) {
        sim.beginTurn(t.number);
        const before = captureHp(sim);
        for (const cmd of decodeCommands(t.commands)) sim.step(cmd);
        sim.drainEvents();
        const s = diffTurn(before, sim, t.player_position);
        const team = teams[t.player_position];
        if (!team) continue;
        team.dealt += s.dealt;
        team.self += s.self;
        team.biggest = Math.max(team.biggest, s.dealt);
        for (const d of s.deaths) {
            if (!d.own) team.kills += 1;
        }
    }

    for (const w of sim.worms) {
        const team = teams[w.teamIndex];
        if (!team) continue;
        if (w.alive) team.alive += 1;
        else team.lost += 1;
    }

    return teams;
}
