// Presentation pauses do not step the simulation or enter the recording.
// This gives the camera and player time to see a selected weapon before firing.
export function createComputerPlayback(commands, now = () => performance.now()) {
    let index = 0;
    let readyAt = 0;
    let introducedWeapon = false;
    const recording = [];
    return {
        recording,
        sample() {
            if (now() < readyAt) return null;
            const cmd = commands[index++] ?? {};
            recording.push(cmd);
            if (cmd.weapon && !introducedWeapon) { readyAt = now() + 650; introducedWeapon = true; }
            return cmd;
        },
    };
}

export class ComputerTurnDisplay {
    constructor(team, worm, personality) {
        this.worm = worm;
        this.root = document.createElement('aside');
        this.root.className = 'computer-turn';
        this.root.setAttribute('aria-label', 'Live computer turn');
        this.root.innerHTML = '<span class="computer-turn__live">LIVE · CPU</span><div><strong></strong><span class="computer-turn__personality"></span><div class="computer-turn__status" role="status"></div></div><progress max="1" value="0" aria-label="Shot power"></progress>';
        this.root.querySelector('strong').textContent = team;
        this.root.querySelector('.computer-turn__personality').textContent = personality ?? '';
        this.status = this.root.querySelector('[role=status]');
        this.power = this.root.querySelector('progress');
        document.body.append(this.root);
        document.body.classList.add('computer-turn-active');
        this.set('thinking', `${worm} is thinking…`);
    }

    set(stage, text) {
        this.root.dataset.stage = stage;
        if (this.status.textContent !== text) this.status.textContent = text;
    }

    setPlan(decision) {
        if (decision?.personality) this.root.querySelector('.computer-turn__personality').textContent = `${decision.personality} · ${decision.intent}`;
    }

    update(state, phase) {
        const worm = state.worms.find(w => w.id === state.activeWormId);
        const moving = worm && this.lastPosition && Math.hypot(worm.x - this.lastPosition.x, worm.y - this.lastPosition.y) > 0.1;
        if (worm) this.lastPosition = { x: worm.x, y: worm.y };
        const weapon = document.querySelector(`.hud-weapon[data-id="${state.selectedWeapon}"]`)?.title ?? state.selectedWeapon;
        this.power.value = state.power || 0;
        if (phase === 'turn-over' || phase === 'game-over') this.set('complete', 'Turn complete');
        else if (state.power > 0) this.set('charging', `${this.worm} is charging ${weapon}`);
        else if (phase === 'move' && moving) this.set('moving', `${this.worm} is changing position`);
        else if (phase === 'retreat' && moving) this.set('retreat', `${this.worm} is retreating`);
        else if (phase === 'move') this.set('aiming', `${this.worm} is aiming ${weapon}`);
        else if (state.pendingShots > 0) this.set('aiming', `${this.worm} is lining up the next shot`);
        else if (state.projectiles?.length) this.set('attack', `${weapon} · Watch the shot`);
        else this.set('resolving', 'Attack resolving…');
    }

    remove() {
        this.root.remove();
        document.body.classList.remove('computer-turn-active');
    }
}
