// turncard.js — end-of-turn summary card + WA-style commentary.
//
// Usage (main.js / replay-ui.js):
//   const before = captureHp(sim);        // right AFTER beginTurn
//   ...turn plays out...
//   const stats = diffTurn(before, sim, actingTeam);
//   showTurnCard({ teamName, color, stats, firstBlood });
//
// Capturing after beginTurn matters: sudden-death decay and drowning happen
// in beginTurn and must not be credited to the acting team.
//
// All randomness here is presentation-only — Math.random is fine.

let cssInjected = false;
function injectCss() {
    if (cssInjected) return;
    cssInjected = true;
    const s = document.createElement('style');
    s.textContent = `
.turn-card {
    position: fixed; left: 50%; bottom: 150px; transform: translateX(-50%) translateY(12px);
    z-index: 59; pointer-events: none; opacity: 0;
    background: rgba(10, 14, 22, 0.9); border: 2px solid var(--tc-color, rgba(255,255,255,0.25));
    border-radius: 13px; padding: 10px 20px; max-width: 520px; text-align: center;
    font-family: 'Arial Rounded MT Bold', 'Verdana', sans-serif; color: #fff;
    box-shadow: 0 6px 18px rgba(0,0,0,0.45);
    transition: opacity 0.25s, transform 0.25s;
}
.turn-card.is-in { opacity: 1; transform: translateX(-50%) translateY(0); }
.turn-card .tc-line { font-size: 15px; font-weight: bold; letter-spacing: 0.02em; }
.turn-card .tc-detail { font-size: 12px; opacity: 0.85; margin-top: 3px; }
.turn-card .tc-team { color: var(--tc-color, #fff); }
`;
    document.head.appendChild(s);
}

/** Per-worm hp/alive snapshot — call right after sim.beginTurn(). */
export function captureHp(sim) {
    return sim.worms.map((w) => ({
        id: w.id, name: w.name, team: w.teamIndex, hp: w.hp, alive: w.alive,
    }));
}

/** Diff the turn's outcome against a captureHp() snapshot. */
export function diffTurn(before, sim, actingTeam) {
    const byId = new Map(before.map((b) => [b.id, b]));
    let dealt = 0;
    let self = 0;
    let healed = 0;
    const deaths = [];
    for (const w of sim.worms) {
        const b = byId.get(w.id);
        if (!b) continue;
        const d = b.hp - w.hp;
        if (d > 0) {
            if (w.teamIndex === actingTeam) self += d;
            else dealt += d;
        } else if (d < 0) {
            healed += -d;
        }
        if (b.alive && !w.alive) {
            deaths.push({ name: w.name, team: w.teamIndex, own: w.teamIndex === actingTeam });
        }
    }
    return { dealt, self, healed, deaths };
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** One commentator line for the turn's outcome. */
export function commentaryFor(stats, firstBlood) {
    const ownDeaths = stats.deaths.filter((d) => d.own);
    const enemyDeaths = stats.deaths.filter((d) => !d.own);
    if (ownDeaths.length && !enemyDeaths.length && stats.dealt === 0) {
        return pick([
            'A tactical masterstroke — against their own team.',
            'The enemy didn’t even have to lift a finger.',
            'Somewhere, a tiny coffin-maker smiles.',
        ]);
    }
    if (enemyDeaths.length >= 2) {
        return pick(['CARNAGE!', 'A massacre most horrid!', 'Multiple worms have left the building.']);
    }
    if (enemyDeaths.length === 1) {
        if (firstBlood) return 'FIRST BLOOD!';
        return pick([
            `${enemyDeaths[0].name} has perished. Tragic. Hilarious, but tragic.`,
            'Another one bites the dirt.',
            'A moment of silence. …That’ll do.',
        ]);
    }
    if (stats.dealt >= 60) return pick(['BRUTAL!', 'Oh, that’s going to leave a mark.', 'Devastating!']);
    if (stats.dealt >= 30) return pick(['A solid hit!', 'That one connected.', 'Ouch. Right in the segments.']);
    if (stats.self > 0 && stats.dealt === 0) {
        return pick([
            'Friendly fire — the friendliest kind.',
            'Impressive damage. Wrong team.',
            'They appear to be attacking themselves. Bold.',
        ]);
    }
    if (stats.dealt === 0 && stats.healed > 0) return 'An apple a day keeps the bazooka away.';
    if (stats.dealt > 0) return pick(['A scratch! Barely.', 'Mild peril inflicted.', 'Somebody felt that. Slightly.']);
    return pick([
        'A complete waste of ammunition.',
        'The terrain took the worst of it.',
        'A bold repositioning manoeuvre. Probably.',
        'The wind claims another victim.',
    ]);
}

let cardEl = null;
let cardTimer = 0;

/**
 * Show the end-of-turn card: commentary headline + damage detail.
 * opts: { teamName, color, stats, firstBlood }
 */
export function showTurnCard({ teamName, color, stats, firstBlood = false }) {
    injectCss();
    if (!cardEl) {
        cardEl = document.createElement('div');
        cardEl.className = 'turn-card';
        cardEl.innerHTML = '<div class="tc-line"></div><div class="tc-detail"></div>';
        document.body.appendChild(cardEl);
    }
    const parts = [];
    if (stats.dealt > 0) parts.push(`${stats.dealt} dmg dealt`);
    if (stats.self > 0) parts.push(`${stats.self} self-inflicted`);
    if (stats.healed > 0) parts.push(`+${stats.healed} healed`);
    for (const d of stats.deaths) parts.push(`☠ ${d.name}`);
    if (!parts.length) parts.push('no damage done');

    cardEl.style.setProperty('--tc-color', color || 'rgba(255,255,255,0.25)');
    cardEl.querySelector('.tc-line').textContent = commentaryFor(stats, firstBlood);
    cardEl.querySelector('.tc-detail').innerHTML = '';
    const detail = cardEl.querySelector('.tc-detail');
    const team = document.createElement('span');
    team.className = 'tc-team';
    team.textContent = teamName;
    detail.appendChild(team);
    detail.appendChild(document.createTextNode(` — ${parts.join(' · ')}`));

    cardEl.classList.add('is-in');
    clearTimeout(cardTimer);
    cardTimer = setTimeout(() => cardEl.classList.remove('is-in'), 4200);
}

// ---------------------------------------------------------------------------
// Taunt bubble — the one-liner a player attached to their turn, shown while
// their replay plays.
// ---------------------------------------------------------------------------

let tauntEl = null;
let tauntTimer = 0;

export function showTaunt(teamName, color, text) {
    if (!text) return;
    injectCss();
    if (!tauntEl) {
        tauntEl = document.createElement('div');
        tauntEl.className = 'turn-card turn-taunt';
        tauntEl.style.bottom = 'auto';
        tauntEl.style.top = '158px'; // clear of the REPLAY badge
        tauntEl.innerHTML = '<div class="tc-line"></div><div class="tc-detail"></div>';
        document.body.appendChild(tauntEl);
    }
    tauntEl.style.setProperty('--tc-color', color || 'rgba(255,255,255,0.25)');
    tauntEl.querySelector('.tc-line').textContent = `“${text}”`;
    const detail = tauntEl.querySelector('.tc-detail');
    detail.innerHTML = '';
    const team = document.createElement('span');
    team.className = 'tc-team';
    team.textContent = `— ${teamName}`;
    detail.appendChild(team);
    tauntEl.classList.add('is-in');
    clearTimeout(tauntTimer);
    tauntTimer = setTimeout(() => tauntEl.classList.remove('is-in'), 6000);
}
