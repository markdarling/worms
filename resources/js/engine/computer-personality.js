import { hashSeed } from './rng.js';

export const PERSONALITIES = {
    bruiser: { id: 'bruiser', name: 'Bruiser', friendlyRisk: 1.45, safety: 0.55, thrift: 0.55, finish: 28,
        prefers: ['baseballbat', 'firepunch', 'dragonball', 'dynamite', 'minigun', 'shotgun'] },
    trickster: { id: 'trickster', name: 'Trickster', friendlyRisk: 1.85, safety: 0.9, thrift: 0.75, finish: 18,
        prefers: ['grenade', 'cluster', 'banana', 'petrol', 'sheep', 'mine', 'homing'] },
    survivor: { id: 'survivor', name: 'Survivor', friendlyRisk: 2.5, safety: 1.65, thrift: 1.25, finish: 12,
        prefers: ['teleport', 'longbow', 'shotgun', 'grenade', 'airstrike'] },
};

export function computerPersonality(config, teamIndex) {
    return PERSONALITIES[config.computerPersonality] ?? Object.values(PERSONALITIES)[
        (hashSeed(config.seed, 0x50455253) + teamIndex) % 3
    ];
}

// Deliberately applied AFTER evaluating and selecting the ideal tactic.
// Separate RNG stream: candidate order/search depth cannot optimize away error.
export function imperfectShot(shot, config, turn, wormId) {
    const hard = config.difficulty === 'hard';
    let seed = hashSeed(config.seed, turn, wormId, 0x41494d);
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const angleError = (random() + random() - 1) * (hard ? 0.022 : 0.065);
    const powerError = Math.round((random() + random() - 1) * (hard ? 3 : 8));
    const targetError = (random() + random() - 1) * (hard ? 7 : 22);
    const melee = ['baseballbat', 'firepunch', 'dragonball', 'axe', 'prod', 'dynamite', 'mine', 'sheep', 'teleport', 'skip'].includes(shot.weapon);
    return { ...shot,
        angle: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, shot.angle + (melee ? 0 : angleError))),
        power: shot.power == null ? undefined : Math.max(2, Math.min(73, shot.power + powerError)),
        target: shot.target ? { ...shot.target, x: shot.target.x + (shot.weapon === 'teleport' ? 0 : targetError) } : undefined,
    };
}
