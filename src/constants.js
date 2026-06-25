/* =========================================================================
 * constants.js — all magic numbers live here.
 * Tweak the "feel" of the game by editing values in this file.
 * ========================================================================= */
(function (global) {
  'use strict';

  var C = {};

  // ---- Logical canvas dimensions (CSS pixels). The render module scales
  //      by devicePixelRatio internally for crisp high-DPI output. -----------
  C.CANVAS_WIDTH = 480;
  C.CANVAS_HEIGHT = 720;

  // ---- Pitch / goal geometry (in logical pixels) -------------------------
  C.PITCH_MARGIN_X = 30;            // left/right grass margin
  C.PITCH_MARGIN_TOP = 40;          // top grass margin (above goal)
  C.GOAL_WIDTH = 300;               // inner goal width (between posts)
  C.GOAL_HEIGHT = 130;              // goal height (ground to crossbar)
  C.GOAL_BOTTOM_Y = 250;            // y of goal line (where ball crosses for a goal)
  C.GOAL_TOP_Y = C.GOAL_BOTTOM_Y - C.GOAL_HEIGHT;
  C.GOAL_CENTER_X = C.CANVAS_WIDTH / 2;
  C.GOAL_LEFT_X = C.GOAL_CENTER_X - C.GOAL_WIDTH / 2;
  C.GOAL_RIGHT_X = C.GOAL_CENTER_X + C.GOAL_WIDTH / 2;
  C.POST_RADIUS = 6;
  C.NET_DEPTH = 28;                 // visual depth of the net behind the line

  // ---- Ball ---------------------------------------------------------------
  C.BALL_RADIUS = 9;                // ball radius in logical px
  C.BALL_START_Y = 560;             // y where the ball is kicked from
  C.BALL_START_X = C.CANVAS_WIDTH / 2;
  C.BALL_FLIGHT_MS = 620;           // fixed flight time (ms) — power affects arc, not duration
  C.BALL_TRAIL_LEN = 14;            // number of trail samples drawn

  // ---- Kick / aim ----------------------------------------------------------
  C.AIM_MIN_ANGLE = -75;             // degrees from straight up (left)
  C.AIM_MAX_ANGLE = 75;              // degrees from straight up (right)
  C.AIM_DEFAULT_ANGLE = 0;           // straight ahead
  C.AIM_LINE_LEN = 110;              // length of aim indicator
  C.AIM_SENSITIVITY = 0.0044;        // radians per pixel of drag (pointer)

  // ---- Power meter ---------------------------------------------------------
  C.POWER_MIN = 0.20;               // minimum launch power
  C.POWER_MAX = 1.00;               // maximum launch power
  C.POWER_DEFAULT = 0.55;
  C.POWER_OSC_PERIOD_MS = 950;      // full oscillation period of the power bar
  C.POWER_LOCK_FLASH_MS = 220;       // flash when power locked

  // ---- Stickman (kicker) ---------------------------------------------------
  C.KICKER_X = C.CANVAS_WIDTH / 2;
  C.KICKER_Y = 540;
  C.KICKER_SCALE = 1.0;             // relative to base pose
  C.KICKER_HEAD_RADIUS = 11;
  C.KICKER_TORSO_LEN = 34;
  C.KICKER_LIMB_LEN = 26;
  C.KICKER_THICK = 3;
  C.KICKER_KICK_DURATION_MS = 360;  // length of kicking animation
  C.KICKER_RESET_MS = 280;

  // ---- Stickman (keeper) ---------------------------------------------------
  C.KEEPER_X = C.GOAL_CENTER_X;
  C.KEEPER_Y = C.GOAL_BOTTOM_Y - 6;
  C.KEEPER_SCALE = 1.0;
  C.KEEPER_HEAD_RADIUS = 10;
  C.KEEPER_TORSO_LEN = 30;
  C.KEEPER_LIMB_LEN = 22;
  C.KEEPER_THICK = 3;
  C.KEEPER_DIVE_DURATION_MS = 480;  // time to reach dive pose
  C.KEEPER_RETURN_MS = 360;

  // ---- Keeper AI zones -----------------------------------------------------
  // Five horizontal zones across the goal width, indexed 0..4.
  C.KEEPER_ZONES = 5;
  C.KEEPER_ZONE_PADDING = 8;        // px inset from post inside each zone

  // ---- Difficulty profiles -------------------------------------------------
  // reactionMs: delay before keeper commits to a chosen dive.
  // spread:    probability weight bias toward center (higher = more center).
  // reach:     extra horizontal reach multiplier (stretches dive).
  C.DIFFICULTY = {
    easy:   { reactionMs: 380, spread: 0.55, reach: 0.85, missChance: 0.18 },
    normal: { reactionMs: 260, spread: 0.85, reach: 1.00, missChance: 0.07 },
    hard:   { reactionMs: 170, spread: 1.20, reach: 1.18, missChance: 0.02 }
  };
  C.DEFAULT_DIFFICULTY = 'normal';

  // ---- Shot resolution -----------------------------------------------------
  C.RESULT_DISPLAY_MS = 1100;       // how long "GOAL!" / "SAVED!" shows
  C.SOFT_RESET_MS = 700;            // pause before next shot in a round

  // ---- Scoring -------------------------------------------------------------
  C.BEST_OF = 10;                   // best-of-N for match mode (10 rounds)
  C.ENDLESS_HIGH_SCORE_KEY = 'pks.highScore.v1';
  C.ENDLESS_ROUNDS_KEY   = 'pks.endlessRound.v1';

  // ---- Colors --------------------------------------------------------------
  C.COLORS = {
    grass1: '#1e7a3a',
    grass2: '#196633',
    line:   'rgba(255,255,255,0.85)',
    net:    'rgba(255,255,255,0.30)',
    netRipple: 'rgba(255,255,255,0.55)',
    ball:   '#fafafa',
    ballShadow: 'rgba(0,0,0,0.28)',
    kicker: '#1a1a1a',
    keeper: '#d83a3a',
    skin:   '#f1c27d',
    aim:    '#ffe66d',
    powerLow: '#7fd17f',
    powerMid: '#f5d142',
    powerHigh: '#e05a3a',
    uiText: '#f5f5f5',
    uiShadow: 'rgba(0,0,0,0.55)'
  };

  // ---- UI layout -----------------------------------------------------------
  C.UI = {
    scoreboardY: 14,
    powerBarW: 200,
    powerBarH: 16,
    powerBarY: 60,
    messageY: 360
  };

  // ---- AR / Webcam pose detection -------------------------------------------
  C.AR = {
    // Camera capture resolution (low-res is fine for pose; keeps latency down)
    CAPTURE_WIDTH: 640,
    CAPTURE_HEIGHT: 480,

    // Pose detection
    POSE_DETECTION_INTERVAL_MS: 33,   // run pose every N ms (30fps)
    MIN_DETECTION_CONFIDENCE: 0.5,    // ignore frames where model is unsure
    SMOOTHING_ALPHA: 0.4,             // EMA factor per keypoint (0=raw, 1=frozen)

    // Kick detection
    KICK_VELOCITY_THRESHOLD: 0.06,    // normalized units/sec — foot/ankle must exceed this (lowered for better detection)
    KICK_MAX_VELOCITY: 2.5,           // normalized units/sec for full power
    KICK_COOLDOWN_MS: 450,            // suppress re-detection after a kick
    ANKLE_BUFFER_SIZE: 8,             // frames for velocity calc (~130ms @ 60fps)
    WINDUP_KNEE_MIN_ANGLE: 0.6,       // rad — knee must lift at least this before kick

    // Aim mapping
    AIM_DEAD_ZONE: 0.04,              // ignore tiny aim displacements
    AIM_SCALE: 1.4,                   // multiplier: leg angle → aim angle
    AIM_SMOOTHING: 0.35,              // lerp factor for aim (higher = smoother)
    FOOT_AIM_SCALE: 6.0,              // multiplier: foot displacement → aim
    BODY_LEAN_AIM_WEIGHT: 0.3,       // how much body lean adds to aim (±0.3 max)

    // Power mapping
    POWER_GAMMA: 0.7,                 // < 1 lifts soft kicks

    // Calibration
    CALIBRATION_DURATION_MS: 1500,    // how long to capture neutral pose
    CALIBRATION_KEY: 'pks.poseCalibration.v1',

    // Fallback
    FPS_SAMPLE_WINDOW: 30,            // frames to average FPS over
    FPS_FALLBACK_THRESHOLD: 20,       // fall back to pointer if FPS drops below this
    TRACKING_LOST_FRAMES: 60,         // frames without landmarks → tracking lost

    // Render
    SKELETON_COLOR: '#00ff88',
    SKELETON_THICKNESS: 3,
    KICK_TRAIL_COLOR: '#ffe66d',
    KICK_TRAIL_LENGTH: 12,
    PIP_CORNER: 'bottom-right',       // webcam preview position
    PIP_WIDTH_PCT: 0.45,              // webcam preview width as fraction of canvas width

    // Mode
    MODE: 'POINTER'                    // 'POINTER' | 'AR'
  };

  global.C = C;
})(typeof window !== 'undefined' ? window : globalThis);
