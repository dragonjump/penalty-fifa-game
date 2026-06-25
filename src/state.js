/* =========================================================================
 * state.js — state machine + game state.
 *
 * States:
 *   MENU       → waiting on start screen
 *   AIMING     → player is dragging to set aim angle
 *   POWER      → aim locked; oscillating power bar; click to lock power
 *   SHOOTING   → ball in flight, keeper resolving
 *   RESULT     → brief "GOAL!" / "SAVED!" / "MISS" banner
 *   GAME_OVER  → match or endless run ended
 *
 * Transitions are declared in TRANSITIONS. Any transition not listed is
 * rejected (logged in dev, otherwise ignored). This keeps illegal states
 * (e.g. MENU → SHOOTING) impossible.
 * ========================================================================= */
(function (global) {
  'use strict';

  var C = global.C;

  // ----- State enum --------------------------------------------------------
  var STATE = {
    CAMERA_INIT: 'CAMERA_INIT',   // new: async camera + model init
    MENU: 'MENU',
    AIMING: 'AIMING',
    POWER: 'POWER',
    SHOOTING: 'SHOOTING',
    RESULT: 'RESULT',
    GAME_OVER: 'GAME_OVER'
  };

  // ----- Transition table --------------------------------------------------
  var TRANSITIONS = {
    CAMERA_INIT: ['MENU', 'AIMING'],   // camera ready → AIMING; fallback → MENU
    MENU:       ['AIMING', 'GAME_OVER', 'CAMERA_INIT'],
    AIMING:     ['POWER', 'MENU'],
    POWER:      ['SHOOTING', 'AIMING'],
    SHOOTING:   ['RESULT'],
    RESULT:     ['AIMING', 'GAME_OVER', 'MENU'],
    GAME_OVER:  ['MENU', 'AIMING']
  };

  // ----- Game modes --------------------------------------------------------
  var MODE = { BEST_OF: 'BEST_OF', ENDLESS: 'ENDLESS' };

  function createInitialState() {
    return {
      state: STATE.MENU,
      mode: MODE.BEST_OF,
      difficulty: C.DEFAULT_DIFFICULTY,

      // Match state (best-of)
      score: { player: 0, keeper: 0 },
      round: 1,                      // 1-based round index
      history: [],                   // array of 'goal' | 'saved' | 'miss'

      // Endless state
      endlessScore: 0,

      // Per-shot phase data
      aimAngle: C.AIM_DEFAULT_ANGLE, // radians, 0 = straight up
      power: C.POWER_DEFAULT,
      powerLocked: false,
      powerOscillationStart: 0,
      shotStartTime: 0,

      // Per-shot resolution
      result: null,                  // 'goal' | 'saved' | 'miss'
      resultShownAt: 0,

      // Keeper decision for the current shot
      keeperDecision: null,          // { zone, diveX, committedAt }

      // Kicker animation
      kickerKickAt: 0,

      // Misc
      message: '',
      messageSub: '',

      // AR state
      inputMode: 'POINTER',          // 'POINTER' | 'AR'
      cameraStatus: 'pending',       // 'pending' | 'requesting' | 'ready' | 'denied' | 'failed'
      poseCalibration: null,         // { legAngleRest, aimMin, aimMax } once calibrated
      lastPoseLandmarks: null,       // last detected landmarks (for preview overlay)
      poseAimAngle: 0,               // current aim from pose (smoothed)
      poseConfidence: 0,             // running average of pose confidence (0..1)
      arFps: 60,                     // running fps estimate for AR mode
      arTrackingLostFrames: 0        // consecutive frames with no landmarks
    };
  }

  function canTransition(from, to) {
    var allowed = TRANSITIONS[from];
    if (!allowed) return false;
    return allowed.indexOf(to) !== -1;
  }

  function transition(s, to) {
    if (s.state === to) return true;
    if (!canTransition(s.state, to)) {
      if (typeof console !== 'undefined') {
        console.warn('[state] illegal transition ' + s.state + ' → ' + to);
      }
      return false;
    }
    s.state = to;
    return true;
 }

  global.StateMachine = {
    STATE: STATE,
    MODE: MODE,
    TRANSITIONS: TRANSITIONS,
    createInitialState: createInitialState,
    canTransition: canTransition,
    transition: transition
  };
})(typeof window !== 'undefined' ? window : globalThis);
