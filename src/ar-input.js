/* =========================================================================
 * ar-input.js — AR kick input. Produces the same event surface as input.js.
 *
 * Consumes raw landmarks from ar-pose.js, feeds them through ar-mapping.js,
 * and emits: onAim(angle), onLockAim(), onLockPower(), onMenu(), onStart().
 *
 * Kick detection logic:
 *   - Track ankle velocity in a rolling buffer.
 *   - A "kick" = ankle velocity exceeds threshold AFTER a knee-lift wind-up.
 *   - On kick: set aim from leg angle, set power from kick velocity, then
 *     emit onLockAim() + onLockPower() (single-phase input for AR).
 *   - Cooldown prevents double-firing.
 *
 * This module is input-source-agnostic to the game state machine — main.js
 * just swaps the active input object and the rest of the game runs.
 * ========================================================================= */
(function (global) {
  'use strict';

  var C = global.C;

  function ArInput() {
    this._buffer = [];          // [{ right: {x,y}, left: {x,y}, t }]
    this._lastKickTime = -9999;
    this._smoothedAim = 0;
    this._calibration = null;   // { legAngleRest }
    this._windupActive = false; // true when knee is lifted (waiting for kick)
    this._lostFrames = 0;       // consecutive frames with no landmarks
    this._onLost = null;        // callback() when tracking lost for >N frames
    this._onRecovered = null;   // callback() when tracking recovers after loss
    this._debug = null;         // debug info for UI overlay

    // Event hooks (assigned by main.js).
    this.onAim = null;
    this.onLockAim = null;
    this.onLockPower = null;
    this.onMenu = null;
    this.onStart = null;
  }

  // Set calibration data (from localStorage or calibration flow).
  ArInput.prototype.setCalibration = function (cal) {
    this._calibration = cal || { legAngleRest: 0 };
  };

  // Process a new pose result. Called from ar-pose.js onResults callback.
  //   results = MediaPipe results object
  //     - New API (tasks-vision): { landmarks: [ [{x,y,z,visibility}, ...] ] }
  //     - Old API (legacy): { poseLandmarks: [{x,y,visibility}, ...] }
  //   timestamp = ms
  // Returns a KickEvent if a kick was detected this frame, else null.
  ArInput.prototype.processResults = function (results, timestamp) {
    if (!results) return null;

    // Normalize: extract flat 33-point landmark array from either API format.
    var lm = null;
    if (results.landmarks && results.landmarks.length > 0) {
      // New API: landmarks is array of poses, each pose is 33-point array
      lm = results.landmarks[0];
    } else if (results.poseLandmarks) {
      // Old API: flat 33-point array
      lm = results.poseLandmarks;
    }
    if (!lm) {
      // No landmarks this frame — increment lost counter
      this._lostFrames++;
      if (this._lostFrames === C.AR.TRACKING_LOST_FRAMES && this._onLost) {
        this._onLost();
      }
      return null;
    }

    // Landmarks present — reset lost counter
    if (this._lostFrames >= C.AR.TRACKING_LOST_FRAMES && this._onRecovered) {
      this._onRecovered();
    }
    this._lostFrames = 0;

    var rightAnkle = lm[28]; // right ankle
    var leftAnkle = lm[27];  // left ankle
    var rightKnee = lm[26];
    var leftKnee = lm[25];
    var rightFoot = lm[32];  // right foot index
    var leftFoot = lm[31];   // left foot index

    // Push to buffer (ankles for velocity + feet for direction)
    this._buffer.push({
      right: { x: rightAnkle ? rightAnkle.x : 0, y: rightAnkle ? rightAnkle.y : 0 },
      left: { x: leftAnkle ? leftAnkle.x : 0, y: leftAnkle ? leftAnkle.y : 0 },
      rightFoot: { x: rightFoot ? rightFoot.x : (rightAnkle ? rightAnkle.x : 0), y: rightFoot ? rightFoot.y : (rightAnkle ? rightAnkle.y : 0) },
      leftFoot: { x: leftFoot ? leftFoot.x : (leftAnkle ? leftAnkle.x : 0), y: leftFoot ? leftFoot.y : (leftAnkle ? leftAnkle.y : 0) },
      t: timestamp
    });
    // Keep buffer small
    while (this._buffer.length > C.AR.ANKLE_BUFFER_SIZE) {
      this._buffer.shift();
    }

    // Compute current shot params (power, knee lift, confidence)
    var shot = ArMapping.computeShot(lm, this._calibration, this._buffer);

    // Combined aim: foot direction (70%) + body lean (30%)
    var combinedAim = ArMapping.computeCombinedAim(lm, this._calibration);

    // Smooth the aim for less jittery feel
    this._smoothedAim = ArMapping.smooth(this._smoothedAim, combinedAim.aimAngle, 1 - C.AR.AIM_SMOOTHING);

    // Emit aim update (live preview during AIMING)
    if (this.onAim) {
      this.onAim(this._smoothedAim);
    }

    // Wind-up detection: knee lifted above threshold
    if (shot.kneeLift > C.AR.WINDUP_KNEE_MIN_ANGLE) {
      this._windupActive = true;
    }

    // Kick detection: FOOT velocity exceeds threshold after wind-up
    // Use foot velocity (faster, more reliable) instead of ankle velocity
    var footVel = ArMapping.footVelocity(this._buffer);
    var ankleVel = ArMapping.ankleVelocity(this._buffer);
    var velocity = Math.max(footVel, ankleVel); // use whichever is higher
    var cooldownOk = (timestamp - this._lastKickTime) > C.AR.KICK_COOLDOWN_MS;

    // Store debug info for the UI overlay
    this._debug = {
      footVel: footVel,
      ankleVel: ankleVel,
      kneeLift: shot.kneeLift,
      windup: this._windupActive,
      confidence: shot.confidence,
      cooldownOk: cooldownOk,
      aim: this._smoothedAim,
      bodyLean: combinedAim.bodyLean,
      footAim: combinedAim.footAim,
      triggered: false
    };

    if (this._windupActive && velocity > C.AR.KICK_VELOCITY_THRESHOLD && cooldownOk && shot.confidence > 0.2) {
      this._lastKickTime = timestamp;
      this._windupActive = false;
      this._buffer = [];

      var kickEvent = {
        aimAngle: this._smoothedAim,
        power: shot.power,
        confidence: shot.confidence
      };

      // Store debug trigger state
      this._debug.triggered = true;
      this._debug.triggerVel = velocity;

      // Emit lock aim + lock power (single-phase for AR)
      if (this.onLockAim) this.onLockAim();
      if (this.onLockPower) this.onLockPower();

      return kickEvent;
    }

    // Reset wind-up if knee drops without a kick
    if (shot.kneeLift < 0.15) {
      this._windupActive = false;
    }

    return null;
  };

  // Reset per-shot state.
  ArInput.prototype.reset = function () {
    this._buffer = [];
    this._windupActive = false;
    this._smoothedAim = 0;
    this._lostFrames = 0;
  };

  // Callbacks for tracking lost/recovered events.
  ArInput.prototype.onLost = function (cb) { this._onLost = cb; };
  ArInput.prototype.onRecovered = function (cb) { this._onRecovered = cb; };

  global.ArInput = ArInput;
})(typeof window !== 'undefined' ? window : globalThis);
