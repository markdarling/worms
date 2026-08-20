// Keyboard/mouse -> per-tick command objects, recorded for deterministic replay.
//
// Held keys map to continuous booleans; weapon/fuse/target/fire are one-shot
// values that appear in exactly one sampled tick then clear. Every tick that
// the sim steps during a live turn must come from sample() so the recording
// replays tick-perfect.

const HELD_KEYS = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'aimUp',
    ArrowDown: 'aimDown',
    Space: 'charge',
};

export class InputRecorder {
    constructor(canvas, camera) {
        this.canvas = canvas;
        this.camera = camera;
        this.held = {};
        this.oneShot = {};       // merged into the next sampled tick
        this.recording = [];
        this.enabled = false;    // ignore input during replays / resolution
        this.targetMode = false; // click-to-target weapons (teleport/airstrike)
        this.onTogglePanel = null; // set by main.js (HUD concern, not a sim command)
        this.onPan = null;         // set by main.js -> camera nudge
        this.onHoverWorld = null;  // set by main.js -> ghost previews (girder)

        this._dragging = false;
        this._dragLast = null;
        this._bound = [];
    }

    attach() {
        const on = (target, ev, fn, opts) => {
            target.addEventListener(ev, fn, opts);
            this._bound.push([target, ev, fn, opts]);
        };

        on(window, 'keydown', (e) => this._keydown(e));
        on(window, 'keyup', (e) => this._keyup(e));
        on(window, 'blur', () => { this.held = {}; });
        on(this.canvas, 'contextmenu', (e) => {
            e.preventDefault();
            this.onTogglePanel?.();
        });
        on(this.canvas, 'mousedown', (e) => {
            if (e.button !== 0) return;
            this._dragging = true;
            this._dragMoved = false;
            this._dragLast = { x: e.clientX, y: e.clientY };
        });
        on(this.canvas, 'wheel', (e) => {
            e.preventDefault();
            const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY; // lines -> px
            this.camera.zoomAt(Math.exp(-dy * 0.0012), e.clientX, e.clientY);
        }, { passive: false });
        on(window, 'mousemove', (e) => {
            // Ghost previews (girder placement) track the cursor in world space.
            if (this.enabled && this.targetMode && this.onHoverWorld) {
                const world = this.camera.screenToWorld(e.clientX, e.clientY);
                this.onHoverWorld(world.x, world.y);
            }
            if (!this._dragging) return;
            const dx = e.clientX - this._dragLast.x;
            const dy = e.clientY - this._dragLast.y;
            if (Math.abs(dx) + Math.abs(dy) > 2) this._dragMoved = true;
            if (this._dragMoved) this.onPan?.(-dx, -dy);
            this._dragLast = { x: e.clientX, y: e.clientY };
        });
        on(window, 'mouseup', (e) => {
            if (!this._dragging) return;
            this._dragging = false;
            // A click (not a drag) places a target for click-aimed weapons.
            // targetFires=false (homing): the click only marks the target —
            // the shot itself is aimed and charged afterwards.
            if (!this._dragMoved && this.enabled && this.targetMode) {
                const world = this.camera.screenToWorld(e.clientX, e.clientY);
                this.oneShot.target = { x: Math.round(world.x), y: Math.round(world.y) };
                if (this.targetFires !== false) this.oneShot.fire = true;
            }
        });
    }

    detach() {
        for (const [t, ev, fn, opts] of this._bound) t.removeEventListener(ev, fn, opts);
        this._bound = [];
    }

    _keydown(e) {
        // Typing in a text field (taunt box) must never drive the worm.
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        if (e.repeat) return;
        if (e.code === 'Tab') {
            e.preventDefault();
            this.onTogglePanel?.();
            return;
        }
        if (!this.enabled) return;

        // Any game control ends a manual camera pan — snap back to the worm.
        this.camera.resumeFollow?.();

        if (HELD_KEYS[e.code]) {
            e.preventDefault();
            this.held[HELD_KEYS[e.code]] = true;
        } else if (e.code === 'Enter') {
            e.preventDefault();
            this.oneShot.jump = true;
        } else if (e.code === 'Backspace') {
            e.preventDefault();
            this.oneShot.backflip = true;
        } else if (/^Digit[1-8]$/.test(e.code)) {
            // 1-5: grenade-family fuse · 1-8: girder angle (engine interprets).
            this.oneShot.fuse = Number(e.code.slice(5));
        }
    }

    _keyup(e) {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        if (HELD_KEYS[e.code]) {
            e.preventDefault();
            this.held[HELD_KEYS[e.code]] = false;
            // Releasing a charge fires the shot (classic power-charge behaviour).
            if (e.code === 'Space' && this.enabled) this.oneShot.fire = true;
        }
    }

    // HUD callbacks
    selectWeapon(id) { if (this.enabled) this.oneShot.weapon = id; }
    selectFuse(n) { if (this.enabled) this.oneShot.fuse = n; }
    requestSkip() {
        if (!this.enabled) return;
        this.oneShot.weapon = 'skip';
        this.oneShot.fire = true;
    }

    beginTurn() {
        this.recording = [];
        this.held = {};
        this.oneShot = {};
    }

    // Build this tick's command, record it, and clear one-shots.
    sample() {
        const cmd = {
            left: !!this.held.left,
            right: !!this.held.right,
            jump: !!this.oneShot.jump,
            backflip: !!this.oneShot.backflip,
            aimUp: !!this.held.aimUp,
            aimDown: !!this.held.aimDown,
            charge: !!this.held.charge,
            fire: !!this.oneShot.fire,
            weapon: this.oneShot.weapon ?? null,
            fuse: this.oneShot.fuse ?? null,
            target: this.oneShot.target ?? null,
        };
        this.oneShot = {};
        this.recording.push(cmd);
        return cmd;
    }
}
