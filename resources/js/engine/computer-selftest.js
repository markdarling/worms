import assert from 'node:assert/strict';
import { Sim } from './sim.js';
import { planComputerTurn } from './computer.js';
import { encodeCommands, decodeCommands } from './commands.js';
for (const difficulty of ['normal', 'hard']) {
    for (const seed of [1, 424242, 987654321]) {
        const config = { rules: 2, seed, width: 1800, height: 800, difficulty,
            teams: [{ name: 'Red', color: '#ee4444', worms: ['A', 'B'] }, { name: 'Blue', color: '#4488ff', worms: ['C', 'D'] }] };
        const sim = Sim.newGame(config);
        sim.beginTurn(1);
        const snapshot = sim.snapshot();
        const hash = sim.stateHash();
        const start = performance.now();
        const commands = planComputerTurn(config, snapshot);
        assert.equal(sim.stateHash(), hash, 'planning must not mutate live world');
        assert(commands.some(c => c.fire), 'computer must take an action');
        const replay = Sim.fromSnapshot(config, snapshot);
        for (const cmd of commands) sim.step(cmd);
        for (const cmd of decodeCommands(encodeCommands(commands))) replay.step(cmd);
        assert(['turn-over', 'game-over'].includes(sim.phase), 'computer must finish its turn');
        assert.equal(sim.stateHash(), replay.stateHash(), 'recording must replay exactly');
        console.log(`${difficulty} seed ${seed}: ${commands.length} ticks, ${Math.round(performance.now() - start)}ms, replay verified`);
    }
}
// An open, short-range shot should damage an opponent rather than waste a turn.
const config = { seed: 123, teams: [{ name: 'A', worms: ['A'] }, { name: 'B', worms: ['B'] }] };
const sim = Sim.newGame(config);
sim.terrain.data.fill(0);
for (let y = 600; y < sim.terrain.height; y++) for (let x = 0; x < sim.terrain.width; x++) sim.terrain.data[y * sim.terrain.width + x] = 1;
sim.worms.forEach((w, i) => { w.x = 600 + i * 120; w.y = 594; w.airborne = false; });
sim.beginTurn(1);
for (const cmd of planComputerTurn(config, sim.snapshot())) sim.step(cmd);
assert(sim.worms[1].hp < 100 || !sim.worms[1].alive, 'computer should damage an exposed enemy');
console.log('Exposed enemy damaged; computer checks passed.');
