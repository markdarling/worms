// camera.js — smooth-follow camera for Worms: Armistice.
//
// Contract (ARCHITECTURE.md):
//   new Camera(viewW, viewH, worldW, worldH)
//   follow(x, y)      — smooth pan target
//   shake(strength)   — screen shake, decays
//   nudge(dx, dy)     — manual pan (drag / edge scroll), suspends follow ~10s
//   resumeFollow()    — cancel the suspension early (the action resumed)
//   update(dt)
//   apply(ctx) / worldToScreen(x, y) / screenToWorld(x, y)
//   zoom              — supported, default 1
//
// Notes for the integrator:
//   - viewW/viewH are CSS pixels. Call setViewport(w, h, dpr) on resize
//     (Renderer does this automatically every frame).
//   - apply(ctx) sets the full transform including devicePixelRatio, so draw
//     in world units afterwards. worldToScreen/screenToWorld are in CSS px.
//   - (x, y) is the camera CENTRE in world coordinates.
//   - If the view is larger than the world (at current zoom) the world is
//     centred (letterboxed) on that axis.

const FOLLOW_SUSPEND_SECS = 10;
const SMOOTHING = 5.5;      // higher = snappier follow
const SHAKE_DECAY = 4.2;    // exponential decay rate
const SHAKE_MAX = 26;       // px cap

export class Camera {
  constructor(viewW, viewH, worldW, worldH) {
    this.viewW = viewW;
    this.viewH = viewH;
    this.worldW = worldW;
    this.worldH = worldH;
    this.zoom = 1;
    this.dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;

    this.x = worldW / 2;
    this.y = worldH / 2;
    this.tx = this.x;
    this.ty = this.y;

    this._suspend = 0;      // seconds of follow suspension remaining
    this._shakeMag = 0;
    this._shakeX = 0;
    this._shakeY = 0;

    this._clamp();
  }

  /** Update view size / pixel ratio (call on resize). */
  setViewport(viewW, viewH, dpr) {
    this.viewW = viewW;
    this.viewH = viewH;
    if (dpr) this.dpr = dpr;
    this._clamp();
  }

  /** Set the smooth-pan target (world coords). */
  follow(x, y) {
    this.tx = x;
    this.ty = y;
  }

  /** Add screen shake. Strength in world px of peak displacement. */
  shake(strength) {
    this._shakeMag = Math.min(SHAKE_MAX, this._shakeMag + strength);
  }

  /**
   * Manual pan by (dx, dy) CSS px (drag / edge scroll).
   * Suspends smooth-follow so the player can look around. The suspension
   * ends when the follow subject moves again (renderer calls resumeFollow)
   * or after FOLLOW_SUSPEND_SECS of no panning — whichever comes first.
   */
  nudge(dx, dy) {
    this.x += dx / this.zoom;
    this.y += dy / this.zoom;
    this.tx = this.x;
    this.ty = this.y;
    this._suspend = FOLLOW_SUSPEND_SECS;
    this._clamp();
  }

  /** The action resumed (worm walked, shot fired) — snap back to following. */
  resumeFollow() {
    this._suspend = 0;
  }

  /**
   * Zoom by `factor`, keeping the world point under (sx, sy) CSS px fixed.
   * Clamped between whole-map-visible and 2.5x.
   */
  zoomAt(factor, sx, sy) {
    const before = this.screenToWorld(sx, sy);
    const fit = Math.min(this.viewW / this.worldW, this.viewH / this.worldH);
    this.zoom = Math.max(Math.min(1, fit), Math.min(2.5, this.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.tx = this.x;
    this.ty = this.y;
    this._clamp();
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;

    if (this._suspend > 0) {
      this._suspend -= dt;
    } else {
      // Critically-damped-ish exponential approach to the target.
      const k = 1 - Math.exp(-SMOOTHING * dt);
      this.x += (this.tx - this.x) * k;
      this.y += (this.ty - this.y) * k;
    }

    // Shake: decaying random offset.
    this._shakeMag *= Math.exp(-SHAKE_DECAY * dt);
    if (this._shakeMag < 0.15) {
      this._shakeMag = 0;
      this._shakeX = 0;
      this._shakeY = 0;
    } else {
      this._shakeX = (Math.random() * 2 - 1) * this._shakeMag;
      this._shakeY = (Math.random() * 2 - 1) * this._shakeMag;
    }

    this._clamp();
  }

  /** Sets the ctx transform: world coords -> device pixels (incl. dpr + shake). */
  apply(ctx) {
    const s = this.dpr * this.zoom;
    const cx = this.x + this._shakeX;
    const cy = this.y + this._shakeY;
    ctx.setTransform(
      s, 0, 0, s,
      this.dpr * (this.viewW / 2) - s * cx,
      this.dpr * (this.viewH / 2) - s * cy,
    );
  }

  /** World coords -> CSS-pixel screen coords (matches apply()). */
  worldToScreen(x, y) {
    return {
      x: (x - (this.x + this._shakeX)) * this.zoom + this.viewW / 2,
      y: (y - (this.y + this._shakeY)) * this.zoom + this.viewH / 2,
    };
  }

  /** CSS-pixel screen coords -> world coords (matches apply()). */
  screenToWorld(x, y) {
    return {
      x: (x - this.viewW / 2) / this.zoom + this.x + this._shakeX,
      y: (y - this.viewH / 2) / this.zoom + this.y + this._shakeY,
    };
  }

  /** Visible world rect (ignores shake) — used by the renderer for culling. */
  viewBounds() {
    const hw = this.viewW / (2 * this.zoom);
    const hh = this.viewH / (2 * this.zoom);
    return { x: this.x - hw, y: this.y - hh, w: hw * 2, h: hh * 2 };
  }

  _clamp() {
    const hw = this.viewW / (2 * this.zoom);
    const hh = this.viewH / (2 * this.zoom);

    if (this.worldW <= hw * 2) {
      this.x = this.worldW / 2; // letterbox: centre horizontally
      this.tx = this.x;
    } else {
      this.x = Math.min(Math.max(this.x, hw), this.worldW - hw);
      this.tx = Math.min(Math.max(this.tx, hw), this.worldW - hw);
    }

    if (this.worldH <= hh * 2) {
      this.y = this.worldH / 2;
      this.ty = this.y;
    } else {
      this.y = Math.min(Math.max(this.y, hh), this.worldH - hh);
      this.ty = Math.min(Math.max(this.ty, hh), this.worldH - hh);
    }
  }
}
