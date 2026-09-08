// Tactical utility planner: legal movement/weapon plans are rehearsed against
// the real terrain and physics. Personality chooses among sensible plans;
// execution error is applied only after selection, never optimized away.
import { Sim } from './sim.js';
import { C } from './constants.js';
import { makeRng, hashSeed } from './rng.js';
import { computerPersonality, imperfectShot } from './computer-personality.js';

const finished = sim => ['turn-over', 'game-over'].includes(sim.phase);
const available = (sim, id, weapon) => sim.ammo[id][weapon] == null || sim.ammo[id][weapon] > 0;
const active = sim => sim.worms.find(w => w.id === sim.activeWormId);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function runStep(sim, commands, command = {}) {
    if (finished(sim)) return [];
    commands.push(command);
    sim.step(command);
    return sim.drainEvents();
}

function sight(terrain, a, b) {
    const d = distance(a, b);
    for (let t = 12; t < d - 8; t += 8) {
        if (terrain.solid(a.x + (b.x - a.x) * t / d, a.y + (b.y - a.y) * t / d - 2)) return false;
    }
    return true;
}

function danger(sim, worm) {
    if (!worm?.alive) return 200;
    let risk = Math.max(0, 65 - (sim.waterLevel - worm.y)) * 0.5;
    for (const enemy of sim.worms) {
        if (!enemy.alive || enemy.teamIndex === worm.teamIndex) continue;
        const d = distance(worm, enemy);
        if (d < 450 && sight(sim.terrain, worm, enemy)) risk += (1 - d / 450) * 15;
        if (d < 45) risk += 14;
    }
    for (const mine of sim.mines) if (!mine.dead && distance(worm, mine) < 45) risk += 20;
    for (const drum of sim.drums) if (!drum.dead && distance(worm, drum) < 55) risk += 12;
    return risk;
}

// Reposition in the real sim, including stamina, ledges, falls and hazards.
function positions(config, snapshot, enemies) {
    const original = Sim.fromSnapshot(config, snapshot);
    const worm = active(original);
    const nearest = enemies[0];
    const toward = nearest?.x < worm.x ? -1 : 1;
    const routes = [[], Array.from({ length: 90 }, () => ({ [toward < 0 ? 'left' : 'right']: true })),
        Array.from({ length: 90 }, () => ({ [toward < 0 ? 'right' : 'left']: true }))];
    // A short approach unlocks melee; larger crossings remain deliberate.
    if (nearest && distance(worm, nearest) < 110 && Math.abs(worm.y - nearest.y) < 24) {
        routes.push(Array.from({ length: Math.min(170, Math.max(1, Math.round((Math.abs(worm.x - nearest.x) - 20) / C.WALK_SPEED * 60))) },
            () => ({ [toward < 0 ? 'left' : 'right']: true })));
    }
    // A jump route can get over a small obstruction, but must pass the same
    // safety checks as walking before it is offered to the tactical search.
    if (nearest && !sight(original.terrain, worm, nearest)) {
        routes.push(Array.from({ length: 100 }, (_, i) => ({ [toward < 0 ? 'left' : 'right']: true, jump: i === 1 })));
    }
    const results = [];
    for (const route of routes) {
        const sim = Sim.fromSnapshot(config, snapshot);
        const commands = [];
        for (const cmd of route) runStep(sim, commands, cmd);
        for (let i = 0; i < 100 && active(sim)?.airborne && !finished(sim); i++) runStep(sim, commands);
        const after = active(sim);
        if (sim.phase !== 'move' || !after?.alive || after.hp < worm.hp || after.airborne) continue;
        if (results.some(p => distance(active(p.sim), after) < 8)) continue;
        results.push({ sim, snapshot: sim.snapshot(), commands });
    }
    return results;
}

function shotCandidates(position, enemies, hard) {
    const sim = position.sim, worm = active(sim), shots = [];
    const add = shot => { if (available(sim, worm.teamIndex, shot.weapon)) shots.push(shot); };
    const nearby = [...enemies].sort((a, b) => distance(worm, a) - distance(worm, b));
    const weak = [...enemies].sort((a, b) => (a.hp * 3 + distance(worm, a)) - (b.hp * 3 + distance(worm, b)))[0];
    const groups = [...enemies].sort((a, b) => {
        const value = e => enemies.filter(other => distance(e, other) < 85).length * 100 - distance(worm, e) * 0.12;
        return value(b) - value(a);
    });
    // Consider a finisher and a clustered target as well as the nearest worm.
    const targets = [...new Set([nearby[0], weak, groups[0], nearby[1]])].filter(Boolean).slice(0, 3);
    for (const enemy of targets) {
        const dx = Math.abs(enemy.x - worm.x), dy = worm.y - enemy.y;
        const direction = enemy.x < worm.x ? -1 : 1;
        const angle = Math.atan2(dy, Math.max(1, dx));
        const d = distance(worm, enemy);
        const common = { direction, angle, enemyId: enemy.id, retreat: -direction };
        if (d < 700 && sight(sim.terrain, worm, enemy)) {
            for (const weapon of ['shotgun', 'handgun', 'uzi', 'minigun']) add({ ...common, weapon });
            if (d < 400) add({ ...common, weapon: 'longbow', angle: angle + d * C.GRAVITY / (2 * 500 ** 2) });
        }
        if (d < 135) add({ ...common, angle: 0, weapon: 'dragonball' });
        if (d < 36 && Math.abs(dy) < 20) {
            for (const weapon of ['firepunch', 'baseballbat', 'axe', 'prod']) add({ ...common, weapon, angle: weapon === 'baseballbat' ? 0.35 : 0 });
        }
        if (d < 55) for (const weapon of ['dynamite', 'mine']) add({ ...common, weapon });
        if (d < 220 && Math.abs(dy) < 55) add({ ...common, weapon: 'sheep', detonate: clamp(Math.round(dx / 80 * 60), 25, 180) });
        if (d < 90 && sight(sim.terrain, worm, enemy)) add({ ...common, weapon: 'flamethrower' });
        // One aerial candidate per enemy and position. Actual rehearsal rejects
        // cave roofs and scores chain reactions and collateral damage.
        if (position.commands.length === 0) {
            for (const weapon of ['airstrike', 'napalm', 'minestrike', 'carpetbomb']) add({ ...common, weapon, target: { x: enemy.x, y: enemy.y } });
        }
        const elevations = hard ? [0.4, 0.7, 1, 1.25] : [0.55, 1];
        for (const elevation of elevations) {
            const denom = 2 * Math.cos(elevation) ** 2 * (dx * Math.tan(elevation) - dy);
            if (denom <= 0) continue;
            const speed = Math.sqrt(C.GRAVITY * dx ** 2 / denom);
            for (const weapon of ['bazooka', 'grenade', 'cluster', 'banana', 'holygrenade', 'petrol', 'homing']) {
                if (!available(sim, worm.teamIndex, weapon)) continue;
                const spec = C.WEAPONS[weapon];
                if (speed > spec.speedMax * 1.15) continue;
                const power = clamp(Math.round((speed - spec.speedMin) / (spec.speedMax - spec.speedMin) * 72), 2, 73);
                const flight = dx / Math.max(20, speed * Math.cos(elevation));
                add({ ...common, weapon, angle: elevation, power, fuse: clamp(Math.ceil(flight + 0.3), 1, 5),
                    target: weapon === 'homing' ? { x: enemy.x, y: enemy.y } : undefined });
            }
            if (Math.abs(speed - 480) < 90) add({ ...common, weapon: 'mortar', angle: elevation });
        }
    }
    return shots;
}

function rehearse(config, position, shot) {
    const sim = Sim.fromSnapshot(config, position.snapshot);
    const commands = [...position.commands];
    const worm = active(sim);
    let terrainPressure = 0;
    let fired = shot.weapon === 'skip';
    const step = (cmd = {}) => {
        for (const event of runStep(sim, commands, cmd)) {
            if (event.type === 'fire' && event.weapon === shot.weapon) fired = true;
            if (event.type === 'explosion') terrainPressure += 0.15;
        }
    };
    step({ weapon: shot.weapon, [shot.direction < 0 ? 'left' : 'right']: true, target: shot.target, fuse: shot.fuse });
    const ticks = Math.round(Math.abs(shot.angle - worm.aimAngle) / (C.AIM_RATE * C.DT));
    const aim = shot.angle > worm.aimAngle ? 'aimUp' : 'aimDown';
    for (let i = 0; i < ticks; i++) step({ [aim]: true });
    if (C.WEAPONS[shot.weapon].charged) for (let i = 0; i < shot.power; i++) step({ charge: true });
    step({ fire: true });
    for (let i = 0; i < 1800 && !finished(sim); i++) {
        const cmd = {};
        if (sim.pendingShots > 0 && i % 35 === 20) cmd.fire = true;
        if (shot.weapon === 'sheep' && i === shot.detonate) cmd.fire = true;
        if (sim.phase === 'retreat' && !sim.pendingShots && !sim.burst && !sim.flamer && i < 150 && shot.retreat) {
            cmd[shot.retreat < 0 ? 'left' : 'right'] = true;
        }
        step(cmd);
        if (i === 1200 && sim.phase === 'move') step({ weapon: 'skip', fire: true });
    }
    return { sim, commands, fired, terrainPressure: Math.min(2, terrainPressure) };
}

function scorePlan(original, result, shot, personality, startDanger) {
    if (!finished(result.sim) || !result.fired) return -Infinity;
    const worm = active(original), after = result.sim.worms.find(w => w.id === worm.id);
    let score = 0;
    let enemyDamage = 0;
    for (const before of original.worms) {
        if (!before.alive) continue;
        const later = result.sim.worms.find(w => w.id === before.id);
        const damage = before.hp - (later.alive ? later.hp : 0);
        if (before.teamIndex === worm.teamIndex) {
            score -= (damage + (!later.alive ? 100 : 0)) * personality.friendlyRisk;
        } else {
            enemyDamage += damage;
            score += damage + (!later.alive ? 45 + personality.finish : 0);
        }
    }
    const healthUrgency = worm.hp < 40 ? 1.7 : 1;
    score += (startDanger - danger(result.sim, after)) * personality.safety * healthUrgency;
    if (after.alive) score += clamp((worm.y - after.y) / 12, -5, 8) * personality.safety;
    const remaining = original.ammo[worm.teamIndex][shot.weapon];
    if (remaining != null) score -= (remaining === 1 ? 9 : 4) * personality.thrift;
    if (shot.weapon === original.teamWeapons[worm.teamIndex]) score -= 7;
    if (enemyDamage > 0 && personality.prefers.includes(shot.weapon)) score += 9;
    if (enemyDamage > 0 && shot.weapon !== 'teleport') score += result.terrainPressure;
    // Small incentive to open terrain when no clean shot exists.
    if (!enemyDamage && !['airstrike', 'napalm', 'carpetbomb'].includes(shot.weapon)) score += result.terrainPressure;
    score -= result.commands.length * 0.0008;
    return score;
}

function defensiveTeleports(position, enemies) {
    const sim = position.sim, worm = active(sim);
    if (!available(sim, worm.teamIndex, 'teleport') || (worm.hp >= 45 && sim.waterLevel - worm.y > 80)) return [];
    const spots = [];
    for (let x = Math.max(20, worm.x - 300); x < Math.min(sim.config.width - 20, worm.x + 300); x += 45) {
        for (let y = 40; y < sim.waterLevel - 70; y += 5) {
            if (!sim.terrain.solid(x, y) && sim.terrain.solid(x, y + 6) &&
                !sim.terrain.solid(x - 5, y) && !sim.terrain.solid(x + 5, y) &&
                enemies.every(e => Math.hypot(e.x - x, e.y - y) > 100)) {
                spots.push({ x, y }); break;
            }
        }
    }
    return spots.sort((a, b) => a.y - b.y).slice(0, 3).map(target => ({ weapon: 'teleport', angle: 0, direction: worm.facing, target }));
}

export function planComputerDecision(config, snapshot) {
    const original = Sim.fromSnapshot(config, snapshot), worm = active(original);
    if (!worm || finished(original)) return { commands: [], weapon: null };
    const personality = computerPersonality(config, worm.teamIndex);
    const rng = makeRng(hashSeed(config.seed, snapshot.turnNumber, worm.id, 0x54414354));
    const enemies = original.worms.filter(w => w.alive && w.teamIndex !== worm.teamIndex)
        .sort((a, b) => distance(worm, a) - distance(worm, b));
    const contexts = positions(config, snapshot, enemies);
    const startDanger = danger(original, worm);
    const ranked = [];
    for (const position of contexts) {
        const shots = [...shotCandidates(position, enemies, config.difficulty === 'hard'), ...defensiveTeleports(position, enemies)];
        for (const shot of shots) {
            const result = rehearse(config, position, shot);
            const score = scorePlan(original, result, shot, personality, startDanger);
            if (Number.isFinite(score)) ranked.push({ position, shot, score });
        }
    }
    ranked.sort((a, b) => b.score - a.score);
    if (!ranked.length) {
        const position = { snapshot, commands: [] };
        const shot = { weapon: 'skip', angle: 0, direction: worm.facing };
        return { commands: rehearse(config, position, shot).commands, weapon: 'skip', personality: personality.name, intent: 'Holding position' };
    }
    // Choice noise varies reasonable decisions; never choose a disastrous
    // alternative simply for variety. One representative per weapon avoids
    // over-weighting weapons that happen to have more trajectory candidates.
    const best = ranked[0].score, seen = new Set();
    const shortlist = ranked.filter(p => {
        if (p.score < best - (config.difficulty === 'hard' ? 9 : 18) || seen.has(p.shot.weapon)) return false;
        seen.add(p.shot.weapon); return true;
    });
    const weights = shortlist.map(p => Math.exp((p.score - best) / 9));
    let roll = rng() * weights.reduce((a, b) => a + b, 0), chosen = shortlist[0];
    for (let i = 0; i < shortlist.length; i++) { roll -= weights[i]; if (roll <= 0) { chosen = shortlist[i]; break; } }
    let shot, result;
    // Reject only non-terminating engine states, not misses or bad damage
    // rolls. Never refine an error back toward the perfect planned aim.
    const triedWeapons = new Set([chosen.shot.weapon]);
    const alternatives = [chosen, ...ranked.filter(p => {
        if (triedWeapons.has(p.shot.weapon)) return false;
        triedWeapons.add(p.shot.weapon); return true;
    }).slice(0, 10)];
    for (const candidate of alternatives) {
        chosen = candidate;
        shot = imperfectShot(chosen.shot, config, snapshot.turnNumber, worm.id);
        result = rehearse(config, chosen.position, shot);
        if (finished(result.sim) && result.fired) break;
    }
    if (!finished(result.sim) || !result.fired) {
        shot = { weapon: 'skip', angle: 0, direction: worm.facing };
        chosen = { shot, position: { snapshot, commands: [] } };
        result = rehearse(config, chosen.position, shot);
    }
    const intent = shot.weapon === 'teleport' ? 'Finding safer ground' : chosen.position.commands.length ? 'Changing position' :
        ['dynamite', 'mine', 'sheep'].includes(shot.weapon) ? 'Setting a trap' :
        ['baseballbat', 'prod', 'dragonball', 'firepunch'].includes(shot.weapon) ? 'Going for a knockout' :
        ['grenade', 'cluster', 'banana', 'holygrenade', 'napalm'].includes(shot.weapon) ? 'Explosive pressure' : 'Picking a target';
    return { commands: result.commands, weapon: shot.weapon, personality: personality.name, intent,
        plannedAim: { angle: chosen.shot.angle, power: chosen.shot.power }, executedAim: { angle: shot.angle, power: shot.power } };
}

export function planComputerTurn(config, snapshot) { return planComputerDecision(config, snapshot).commands; }
