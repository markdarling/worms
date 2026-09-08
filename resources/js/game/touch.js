// Pointer capture lets a thumb slide off a button without leaving it held.
export function mountTouchControls(input, camera) {
    const root = document.createElement('nav');
    root.className = 'touch-controls';
    root.setAttribute('aria-label', 'Battle controls');
    root.innerHTML = `
        <div class="touch-camera"><button data-action="out" aria-label="Zoom out">−</button><button data-action="follow">Follow</button><button data-action="in" aria-label="Zoom in">+</button></div>
        <div class="touch-status" role="status"></div>
        <div class="touch-play">
          <div class="touch-group"><button data-held="left" aria-label="Move left">◀</button><button data-held="right" aria-label="Move right">▶</button><button data-shot="jump">Jump</button><button data-shot="backflip">Flip</button></div>
          <div class="touch-group"><button data-held="aimUp" aria-label="Aim up">Aim ↑</button><button data-held="aimDown" aria-label="Aim down">Aim ↓</button><button data-held="charge" class="touch-fire">Hold / fire</button></div>
        </div>`;
    document.body.append(root);
    let lastStatus = '';
    input.onStatus = (state, phase) => {
        const weapon = document.querySelector(`.hud-weapon[data-id="${state.selectedWeapon}"]`)?.title ?? state.selectedWeapon;
        const tip = phase === 'retreat' ? 'Move to safety' : input.targetMode ? 'Tap the battlefield to target' : 'Aim • hold fire • release';
        const status = `${weapon} · ${tip}`;
        if (status !== lastStatus) { root.querySelector('.touch-status').textContent = status; lastStatus = status; }
    };
    const pointers = new Map();
    for (const button of root.querySelectorAll('button')) {
        button.addEventListener('contextmenu', e => e.preventDefault());
        button.addEventListener('pointerdown', e => {
            e.preventDefault();
            if (button.dataset.action) return;
            if (!input.enabled) return;
            camera.resumeFollow();
            button.setPointerCapture(e.pointerId);
            pointers.set(e.pointerId, button);
            button.classList.add('is-held');
            if (button.dataset.held) input.held[button.dataset.held] = true;
            if (button.dataset.shot) input.oneShot[button.dataset.shot] = true;
        });
        const release = (e) => {
            if (!pointers.has(e.pointerId)) return;
            pointers.delete(e.pointerId);
            button.classList.remove('is-held');
            const key = button.dataset.held;
            if (key && ![...pointers.values()].some(b => b.dataset.held === key)) {
                input.held[key] = false;
                if (key === 'charge' && e.type === 'pointerup' && input.enabled) input.oneShot.fire = true;
            }
        };
        for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, release);
        button.addEventListener('click', () => {
            const action = button.dataset.action;
            if (action === 'follow') camera.resumeFollow();
            if (action === 'in' || action === 'out') camera.zoomAt(action === 'in' ? 1.25 : 0.8, camera.viewW / 2, camera.viewH / 2);
        });
    }
    const reset = () => {
        pointers.clear();
        input.held = {};
        input.oneShot = {};
        root.querySelectorAll('.is-held').forEach(b => b.classList.remove('is-held'));
    };
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
}
