/* =========================================================================
 * input.js — pointer + keyboard abstraction.
 *
 * Two-phase input:
 *   Phase 1 — AIMING: pointer drag adjusts aim angle. Horizontal drag
 *             maps to angle. Releasing ends phase 1 and locks aim.
 *   Phase 2 — POWER: an oscillating power bar begins. A second pointer
 *             tap (or keyboard Space) locks the power and fires the shot.
 *
 * Keyboard:
 *   Left/Right arrows  — nudge aim angle (also during POWER for fine-tune)
 *   Space / Enter      — advance: start aiming → lock aim → lock power
 *   Esc                — back to menu (when not mid-shot)
 *
 * The Input object exposes a small event surface the main loop reads:
 *   onAim(angle)       called when aim angle changes during AIMING
 *   onLockAim()        called when aim is locked (end of phase 1)
 *   onLockPower()      called when power is locked (shot released)
 *   onMenu()           called on Esc / back
 *   onStart()          called on first interaction from MENU
 * ========================================================================= */
(function (global) {
  'use strict';

  var C = global.C;

  function Input(canvas) {
    this.canvas = canvas;
    this.pointerDown = false;
    this.dragStart = null;     // { x, y, angle } at drag start
    this.lastAimAngle = C.AIM_DEFAULT_ANGLE;
    this.mode = 'POINTER';     // 'POINTER' | 'AR' — when AR, pointer events are suppressed

    // Event hooks (assigned by main.js).
    this.onAim = null;
    this.onLockAim = null;
    this.onLockPower = null;
    this.onMenu = null;
    this.onStart = null;

    this._bind();
  }

  // Translate a pointer event to logical canvas coordinates.
  Input.prototype._toLogical = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    var x = (e.clientX - rect.left) * (C.CANVAS_WIDTH / rect.width);
    var y = (e.clientY - rect.top) * (C.CANVAS_HEIGHT / rect.height);
    return { x: x, y: y };
  };

  Input.prototype._bind = function () {
    var self = this;
    var cv = this.canvas;

    // Pointer Events unify mouse + touch + pen.
    cv.addEventListener('pointerdown', function (e) {
      if (self.mode === 'AR') return;   // AR owns input
      e.preventDefault();
      global.Sound && global.Sound.unlock();
      var p = self._toLogical(e);
      self.pointerDown = true;
      self.dragStart = { x: p.x, y: p.y, angle: self.lastAimAngle };
      // If we're in MENU, main handles start; we just record.
    });

    cv.addEventListener('pointermove', function (e) {
      if (self.mode === 'AR') return;   // AR owns input
      if (!self.pointerDown || !self.dragStart) return;
      var p = self._toLogical(e);
      var dx = p.x - self.dragStart.x;
      var angle = self.dragStart.angle + dx * C.AIM_SENSITIVITY;
      angle = Math.max(-1, Math.min(1, angle)); // clamp to ±1 rad ≈ ±57°
      self.lastAimAngle = angle;
      if (self.onAim) self.onAim(angle);
    });

    function endDrag(e) {
      if (!self.pointerDown) return;
      self.pointerDown = false;
      // A short click with little movement still counts as "lock aim".
      self.dragStart = null;
      if (self.onLockAim) self.onLockAim();
    }
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);

    // Keyboard.
    global.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowLeft') {
        self.lastAimAngle = Math.max(-1, self.lastAimAngle - 0.04);
        if (self.onAim) self.onAim(self.lastAimAngle);
        e.preventDefault();
      } else if (k === 'ArrowRight') {
        self.lastAimAngle = Math.min(1, self.lastAimAngle + 0.04);
        if (self.onAim) self.onAim(self.lastAimAngle);
        e.preventDefault();
      } else if (k === ' ' || k === 'Enter') {
        if (self.onLockPower) self.onLockPower();
        e.preventDefault();
      } else if (k === 'Escape') {
        if (self.onMenu) self.onMenu();
        e.preventDefault();
      }
    });
  };

  // Called by main when entering AIMING to reset drag anchor.
  Input.prototype.resetAim = function (angle) {
    this.lastAimAngle = angle;
    this.dragStart = null;
    this.pointerDown = false;
  };

  // Switch input mode. When switching to AR, suppress pointer. When switching
  // to POINTER, re-enable pointer (camera may still run in background).
  Input.prototype.setMode = function (mode) {
    this.mode = mode;
    if (mode === 'AR') {
      this.pointerDown = false;
      this.dragStart = null;
    }
  };

  global.Input = Input;
})(typeof window !== 'undefined' ? window : globalThis);
