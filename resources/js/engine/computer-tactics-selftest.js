import assert from 'node:assert/strict';
import { Sim } from './sim.js';
import { Terrain } from './terrain.js';
import { planComputerDecision } from './computer.js';
import { computerPersonality, imperfectShot } from './computer-personality.js';
import { encodeCommands, decodeCommands } from './commands.js';

function fixture(seed = 1337, personality = 'survivor') {
    const config = { rules: 2, seed, width: 1800, height: 800, difficulty: 'hard', computerPersonality: personality,
        teams: [{ name: 'A', worms: ['A', 'Ally'] }, { name: 'B', worms: ['B', 'Enemy'] }] };
    const sim = Sim.newGame(config);
    sim.terrain = new Terrain(1800, 800);
    for (let y = 500; y < 740; y++) sim.terrain.data.fill(1, y * 1800, (y + 1) * 1800);
    sim.mines = []; sim.drums = [];
    sim.worms.forEach((w, i) => { w.x = [300, 1200, 650, 1500][i]; w.y = 494; w.airborne = false; });
    return { sim, config };
}
function play(sim, config, turn = 1) {
    sim.beginTurn(turn);
    const snapshot = sim.snapshot(), hash = sim.stateHash();
    const decision = planComputerDecision(config, snapshot);
    assert.equal(sim.stateHash(), hash, 'planning cannot mutate the live world');
    const replay = Sim.fromSnapshot(config, snapshot);
    for (const command of decision.commands) sim.step(command);
    for (const command of decodeCommands(encodeCommands(decision.commands))) replay.step(command);
    assert.equal(sim.stateHash(), replay.stateHash(), 'varied tactics must replay exactly');
    assert(['turn-over', 'game-over'].includes(sim.phase), 'tactics must terminate');
    return decision;
}

// A teammate beside the enemy must discourage indiscriminate area damage.
{
    const { sim, config } = fixture(); sim.worms[1].x = 670;
    const decision = play(sim, config);
    assert(sim.worms[0].alive && sim.worms[1].hp >= 85, 'cautious AI should protect its nearby teammate');
    console.log('Friendly-fire discipline:', decision.weapon);
}
// Close-range attacks can knock an enemy off a cliff, rather than maximizing
// raw weapon damage; the real simulation evaluates the drowning outcome.
{
    const { sim, config } = fixture(42, 'bruiser');
    for (let y = 0; y < 800; y++) sim.terrain.data.fill(0, y * 1800 + 500, (y + 1) * 1800);
    sim.worms[0].x = 455; sim.worms[2].x = 482;
    sim.worms[1].x = 100; sim.worms[3].x = 150;
    const decision = play(sim, config);
    assert(!sim.worms[2].alive, 'computer should exploit an exposed cliff-side opponent');
    assert(sim.worms[0].alive, 'knockout should preserve the attacker');
    console.log('Cliff knockout:', decision.weapon);
}
// A series of real turns must use more than the old three-weapon repertoire,
// respect finite ammunition and include actual repositioning/retreat commands.
const used = new Set(); let repositioned = false, retreated = false;
for (const style of ['bruiser', 'trickster', 'survivor']) {
    const { sim, config } = fixture(1337, style);
    sim.worms[2].x = 325;
    for (let turn = 1; turn <= 5 && sim.phase !== 'game-over'; turn++) {
        const d = play(sim, config, turn); if (d.weapon !== 'skip') used.add(d.weapon);
        const fire = d.commands.findIndex(c => c.fire || c.charge);
        repositioned ||= d.commands.slice(0, fire).filter(c => c.left || c.right).length > 15;
        retreated ||= d.commands.slice(fire + 1).filter(c => c.left || c.right).length > 15;
        for (const ammo of sim.ammo) for (const count of Object.values(ammo)) assert(count >= 0, 'no unavailable weapon use');
    }
}
assert(used.size >= 4 && [...used].some(w => !['bazooka', 'shotgun', 'airstrike', 'skip'].includes(w)), 'arsenal variety across real turns');
assert(repositioned && retreated, 'AI must reposition and retreat, not just aim in place');
console.log('Weapons used:', [...used].join(', '));

// Same situation and personality remain reproducible after reload.
{
    const { sim, config } = fixture(81, 'trickster'); sim.beginTurn(1);
    const one = planComputerDecision(config, sim.snapshot()), two = planComputerDecision(config, sim.snapshot());
    assert.deepEqual(one, two);
    assert.equal(one.personality, 'Trickster');
    assert.notDeepEqual(computerPersonality({seed: 4}, 0), computerPersonality({seed: 4}, 1));
}
// Error is stable per turn and stays nonzero on Hard; Normal makes larger
// mistakes. It is independent of weapon-search candidate order.
let normal = 0, hard = 0;
const shot = { weapon: 'bazooka', angle: 0.7, power: 45 };
for (let turn = 1; turn <= 40; turn++) {
    const n = imperfectShot(shot, {seed: 123, difficulty: 'normal'}, turn, 1);
    const h = imperfectShot(shot, {seed: 123, difficulty: 'hard'}, turn, 1);
    normal += Math.abs(n.angle - shot.angle); hard += Math.abs(h.angle - shot.angle);
    assert.deepEqual(n, imperfectShot(shot, {seed: 123, difficulty: 'normal'}, turn, 1));
}
assert(hard > 0 && normal > hard * 2, 'Hard is fallible, Normal has larger aim errors');
console.log('Personality, imperfect aim, tactical movement, ammo and replay checks passed.');
