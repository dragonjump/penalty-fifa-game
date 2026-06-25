/* =========================================================================
 * main.js — bootstrap + game loop.
 *
 * Wires together state, input, physics, keeper, render, audio.
 * Owns the rAF loop and the per-shot animation timeline.
 * ========================================================================= */
(function (global) {
  'use strict';

  var C = global.C;
  var SM = global.StateMachine;
  var Physics = global.Physics;
  var Keeper = global.Keeper;
  var Sound = global.Sound;

  // ----- Bootstrap ----------------------------------------------------------
  var canvas = document.getElementById('game');
  var renderer = new global.Renderer(canvas);
  var input = new global.Input(canvas);
  var s = SM.createInitialState();

  // ----- AR modules (may be null if CDN failed) -----------------------------
  var arPose = null;    // ArPose instance (created on demand)
  var arInput = null;   // ArInput instance
  var arActive = false; // true when AR mode is running
  var arDebug = false;  // debug panel toggle (default off)

  // Per-shot animation state (not part of the state machine — transient).
  var anim = {
    launch: null,        // current shot Bezier
    samples: [],         // path samples
    ball: null,          // { x, y } current ball position
    trail: [],           // array of past ball positions
    keeperT: 0,          // 0..1 dive progress
    keeperX: C.KEEPER_X, // keeper horizontal position (lerps to diveX)
    keeperY: C.KEEPER_Y,
    kickerT: 0,          // 0..1 kick animation progress
    suppressAim: false,
    // Virtual ball (AR mode): idle pulse → kick animation → fly → result.
    virtualBall: null,   // { phase, kickT, spin, particles, pulseT }
    virtualBallStartT: 0 // timestamp when virtual ball kick began
  };

  // Endless high score cache.
  s.endlessHighScore = readHighScore();

  // ----- AR input wiring ----------------------------------------------------
  function initArInput() {
    if (arInput) return arInput;
    arInput = new global.ArInput();
    // Load calibration from localStorage
    try {
      var cal = global.localStorage.getItem(C.AR.CALIBRATION_KEY);
      if (cal) arInput.setCalibration(JSON.parse(cal));
    } catch (e) {}
    return arInput;
  }

  function startArMode() {
    s.cameraStatus = 'requesting';
    var ai = initArInput();
    ai.reset();
    ai.onAim = function (angle) {
      if (s.state === SM.STATE.AIMING) s.aimAngle = angle;
    };
    ai.onLost = function () {
      s.cameraStatus = 'lost';
      showToast('Lost tracking — step back into frame');
    };
    ai.onRecovered = function () {
      s.cameraStatus = 'ready';
      showToast('Tracking recovered');
    };
    ai.onLockAim = function () {
      if (s.state === SM.STATE.AIMING) {
        if (SM.transition(s, SM.STATE.POWER)) {
          s.power = C.POWER_DEFAULT;
          s.powerLocked = false;
          s.powerOscillationStart = now();
        }
      }
    };
    ai.onLockPower = function () {
      if (s.state === SM.STATE.POWER) fireShot();
      else if (s.state === SM.STATE.AIMING) ai.onLockAim();
    };

    if (!arPose) {
      arPose = new global.ArPose();
    }
    arPose.init().then(function () {
      s.cameraStatus = 'ready';
      s.inputMode = 'AR';
      input.setMode('AR');
      arActive = true;
      arPose.onResults(function (results) {
        var ev = ai.processResults(results, now());
        if (ev) {
          s.poseConfidence = ev.confidence;
        }
      });
      // Start the match
      if (s.state === SM.STATE.CAMERA_INIT || s.state === SM.STATE.MENU) {
        startMatch();
      }
    }).catch(function (err) {
      s.cameraStatus = 'failed';
      s.inputMode = 'POINTER';
      input.setMode('POINTER');
      arActive = false;
      showToast(err.message || 'AR init failed — using mouse controls');
      if (s.state === SM.STATE.CAMERA_INIT) {
        SM.transition(s, SM.STATE.MENU);
      }
    });
  }

  function stopArMode() {
    if (arPose) arPose.stop();
    arActive = false;
    s.inputMode = 'POINTER';
    s.cameraStatus = 'pending';
    input.setMode('POINTER');
  }

  function toggleArMode() {
    if (arActive) {
      stopArMode();
      showToast('AR disabled');
    } else {
      SM.transition(s, SM.STATE.CAMERA_INIT);
      startArMode();
    }
  }

  // Toast helper
  var _toastTimer = null;
  function showToast(msg) {
    var el = document.getElementById('ar-toast');
    if (!el) return;
    el.textContent = msg;
    el.style.opacity = '1';
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () { el.style.opacity = '0'; }, 2500);
  }

  // ----- Input wiring -------------------------------------------------------
  input.onStart = function () {
    if (s.state === SM.STATE.MENU) startMatch();
  };
  input.onAim = function (angle) {
    if (s.state === SM.STATE.AIMING) {
      s.aimAngle = angle;
    } else if (s.state === SM.STATE.POWER) {
      // Fine-tune aim while power bar oscillates.
      s.aimAngle = angle;
    }
  };
  input.onLockAim = function () {
    if (s.state === SM.STATE.MENU) { startMatch(); return; }
    if (s.state === SM.STATE.AIMING) {
      // Begin power phase.
      if (SM.transition(s, SM.STATE.POWER)) {
        s.power = C.POWER_DEFAULT;
        s.powerLocked = false;
        s.powerOscillationStart = now();
        Sound.aim();
      }
    } else if (s.state === SM.STATE.POWER) {
      // Lock power → shoot.
      fireShot();
    }
  };
  input.onLockPower = function () {
    if (s.state === SM.STATE.MENU) { startMatch(); return; }
    if (s.state === SM.STATE.POWER) fireShot();
    else if (s.state === SM.STATE.AIMING) {
      // Tap from aiming goes straight to power phase.
      input.onLockAim();
    }
  };
  input.onMenu = function () {
    if (s.state === SM.STATE.AIMING || s.state === SM.STATE.POWER) {
      // Abort shot, return to menu.
      if (SM.transition(s, SM.STATE.MENU)) resetTransient();
    } else if (s.state === SM.STATE.GAME_OVER || s.state === SM.STATE.RESULT) {
      if (SM.transition(s, SM.STATE.MENU)) resetTransient();
    }
  };

  // ----- Match / round management -----------------------------------------
  function startMatch() {
    // Default mode is best-of-5; endless toggled via on-screen hint later.
    s.mode = SM.MODE.BEST_OF;
    s.score.player = 0;
    s.score.keeper = 0;
    s.round = 1;
    s.history = [];
    s.endlessScore = 0;
    SM.transition(s, SM.STATE.AIMING);
    resetTransient();
    input.resetAim(C.AIM_DEFAULT_ANGLE);
  }

  function startEndless() {
    s.mode = SM.MODE.ENDLESS;
    s.endlessScore = 0;
    SM.transition(s, SM.STATE.AIMING);
    resetTransient();
    input.resetAim(C.AIM_DEFAULT_ANGLE);
  }

  function resetTransient() {
    anim.launch = null;
    anim.samples = [];
    anim.ball = null;
    anim.trail = [];
    anim.keeperT = 0;
    anim.keeperX = C.KEEPER_X;
    anim.keeperY = C.KEEPER_Y;
    anim.kickerT = 0;
    anim.suppressAim = false;
    // Reset virtual ball to idle pulse when entering AIMING in AR mode.
    // Position it in front of the kicking foot based on current pose.
    if (arActive) {
      var ballX = C.BALL_START_X;
      var ballY = C.BALL_START_Y;

      // If we have landmarks from the previous frame, use them to position
      if (s.lastPoseLandmarks) {
        var lm = s.lastPoseLandmarks;
        var rightFoot = lm[32];
        var leftFoot = lm[31];
        var rightHip = lm[24];
        var leftHip = lm[23];

        if (rightFoot && leftFoot && rightHip && leftHip) {
          var bodyCenterX = (rightHip.x + leftHip.x) / 2;
          var rightDisp = Math.abs(rightFoot.x - bodyCenterX);
          var leftDisp = Math.abs(leftFoot.x - bodyCenterX);
          var kickFoot = rightDisp >= leftDisp ? rightFoot : leftFoot;

          // Convert normalized coords to logical canvas coords
          // Mirror X: image-left = player's right = game right
          ballX = (1 - kickFoot.x) * C.CANVAS_WIDTH;
          ballY = Math.max(400, kickFoot.y * C.CANVAS_HEIGHT - 30);
        }
      }

      anim.virtualBall = { phase: 'idle', pulseT: 0, x: ballX, y: ballY };
    } else {
      anim.virtualBall = null;
    }
    anim.virtualBallStartT = 0;
    s.power = C.POWER_DEFAULT;
    s.powerLocked = false;
    s.result = null;
    s.keeperDecision = null;
    s.message = '';
    s.messageSub = '';
  }

  // ----- Shooting -----------------------------------------------------------
  function fireShot() {
    if (!SM.transition(s, SM.STATE.SHOOTING)) return;
    s.powerLocked = true;
    s.powerLockedAt = now();
    s.shotStartTime = now();
    Sound.kick();

    // Compute launch.
    anim.launch = Physics.computeLaunch(s.aimAngle, s.power);
    anim.samples = Physics.samplePath(anim.launch, 28);
    anim.trail = [];

    // Keeper decides AFTER the shot is fired (with reaction delay).
    s.keeperDecision = Keeper.decide(s.difficulty);
    s.keeperDecision.committedAt = now() + s.keeperDecision.reactionMs;

    // Kicker animation.
    s.kickerKickAt = now();
    anim.kickerT = 0;
    anim.suppressAim = true;

    // Virtual ball (AR): transition from idle to flying toward goal.
    // Position the ball in front of the kicking foot based on current pose.
    if (arActive) {
      // Default to center penalty spot
      var ballX = C.BALL_START_X;
      var ballY = C.BALL_START_Y;

      // If we have landmarks, place the ball in front of the kicking foot
      if (s.lastPoseLandmarks) {
        var lm = s.lastPoseLandmarks;
        var rightFoot = lm[32];
        var leftFoot = lm[31];
        var rightHip = lm[24];
        var leftHip = lm[23];

        if (rightFoot && leftFoot && rightHip && leftHip) {
          var bodyCenterX = (rightHip.x + leftHip.x) / 2;
          // Pick the foot that's more extended (the kicking foot)
          var rightDisp = Math.abs(rightFoot.x - bodyCenterX);
          var leftDisp = Math.abs(leftFoot.x - bodyCenterX);
          var kickFoot = rightDisp >= leftDisp ? rightFoot : leftFoot;

          // Convert normalized coords to logical canvas coords
          // Mirror X: image-left = player's right = game right
          var footCanvasX = (1 - kickFoot.x) * C.CANVAS_WIDTH;
          var footCanvasY = kickFoot.y * C.CANVAS_HEIGHT;

          // Place ball 30px in front of the foot (toward the goal = upward in canvas)
          // and slightly to the foot's side
          ballX = footCanvasX;
          ballY = Math.max(400, footCanvasY - 30); // 30px toward goal from foot, min y=400
        }
      }

      anim.virtualBall = {
        phase: 'kicked',
        kickT: 0,
        spin: 0,
        particles: [],
        x: ballX,
        y: ballY,
        pulseT: anim.virtualBall ? anim.virtualBall.pulseT : 0
      };
      anim.virtualBallStartT = now();

      // Spawn an initial particle burst at the kick point.
      for (var pi = 0; pi < 12; pi++) {
        var ang = (Math.PI * 2 * pi) / 12;
        anim.virtualBall.particles.push({
          x: C.BALL_START_X,
          y: C.BALL_START_Y,
          vx: Math.cos(ang) * (60 + Math.random() * 40),
          vy: Math.sin(ang) * (60 + Math.random() * 40),
          life: 400 + Math.random() * 200,
          maxLife: 600,
          color: 'rgba(255,230,109,ALPHA)',
          size: 2 + Math.random() * 2
        });
      }
    }
  }

  // Resolve the shot at the end of flight.
  function resolveShot() {
    var launch = anim.launch;
    var targetX = launch.targetX;
    var targetY = launch.targetY;

    // Over the bar?
    if (Physics.isOverBar(launch, s.power)) {
      s.result = 'miss';
      Sound.miss();
      finishShot();
      return;
    }

    // Off target (wide of the posts)?
    if (!Physics.isOnTarget(targetX)) {
      s.result = 'miss';
      Sound.miss();
      finishShot();
      return;
    }

    // Keeper reach check.
    var reached = Keeper.reaches(
      s.keeperDecision, targetX, anim.keeperX, anim.keeperY, targetY
    );
    if (reached) {
      s.result = 'saved';
      Sound.saved();
      if (arActive && anim.virtualBall) {
        // For saved: ball fades at the keeper position.
        anim.virtualBall.phase = 'miss';
        anim.virtualBall.x = anim.keeperX;
      }
    } else {
      s.result = 'goal';
      Sound.goal();
      renderer.startRipple(targetX, C.GOAL_BOTTOM_Y - 20);
      if (arActive && anim.virtualBall) {
        anim.virtualBall.phase = 'goal';
        // Spawn a celebratory particle burst at the goal.
        for (var pi = 0; pi < 20; pi++) {
          var ang = (Math.PI * 2 * pi) / 20;
          anim.virtualBall.particles.push({
            x: targetX,
            y: C.GOAL_BOTTOM_Y - 20,
            vx: Math.cos(ang) * (80 + Math.random() * 60),
            vy: Math.sin(ang) * (80 + Math.random() * 60),
            life: 500 + Math.random() * 300,
            maxLife: 800,
            color: 'rgba(120,255,140,ALPHA)',
            size: 2.5 + Math.random() * 2.5
          });
        }
      }
    }
    finishShot();
  }

  function finishShot() {
    // Record history.
    s.history.push(s.result);
    if (s.result === 'goal') {
      if (s.mode === SM.MODE.BEST_OF) s.score.player++;
      s.endlessScore++;
      if (s.endlessScore > (s.endlessHighScore || 0)) {
        s.endlessHighScore = s.endlessScore;
        writeHighScore(s.endlessHighScore);
      }
    } else if (s.result === 'saved' || s.result === 'miss') {
      if (s.mode === SM.MODE.BEST_OF) s.score.keeper++;
    }

    s.resultShownAt = now();
    if (SM.transition(s, SM.STATE.RESULT)) {
      // Subtitle hints.
      if (s.result === 'goal') s.messageSub = 'Nice placement!';
      else if (s.result === 'saved') s.messageSub = 'Keeper read it.';
      else s.messageSub = 'Off target.';
    }
  }

  // ----- Result → next shot / game over ------------------------------------
  function advanceAfterResult() {
    if (s.mode === SM.MODE.BEST_OF) {
      // Match ends when one player has clinched majority.
      var target = Math.ceil(C.BEST_OF / 2);
      if (s.score.player >= target || s.score.keeper >= target) {
        var won = s.score.player > s.score.keeper;
        s.message = won ? 'YOU WIN!' : 'YOU LOSE';
        s.messageSub = won ? 'Match over' : 'Better luck next round';
        Sound.gameOver();
        SM.transition(s, SM.STATE.GAME_OVER);
        return;
      }
      s.round++;
      SM.transition(s, SM.STATE.AIMING);
      resetTransient();
      input.resetAim(C.AIM_DEFAULT_ANGLE);
    } else {
      // Endless: a miss ends the run; goal continues.
      if (s.result !== 'goal') {
        s.message = 'GAME OVER';
        s.messageSub = 'Score ' + s.endlessScore + ' • Tap to retry';
        Sound.gameOver();
        SM.transition(s, SM.STATE.GAME_OVER);
      } else {
        SM.transition(s, SM.STATE.AIMING);
        resetTransient();
        input.resetAim(C.AIM_DEFAULT_ANGLE);
      }
    }
  }

  // ----- High score persistence --------------------------------------------
  function readHighScore() {
    try {
      var v = global.localStorage.getItem(C.ENDLESS_HIGH_SCORE_KEY);
      return v ? parseInt(v, 10) || 0 : 0;
    } catch (e) { return 0; }
  }
  function writeHighScore(v) {
    try { global.localStorage.setItem(C.ENDLESS_HIGH_SCORE_KEY, String(v)); }
    catch (e) {}
  }

  // ----- Timing helpers -----------------------------------------------------
  var _start = performance.now();
  function now() { return performance.now() - _start; }

  // ----- Main loop ----------------------------------------------------------
  var lastT = now();
  function frame() {
    var t = now();
    var dt = Math.min(48, t - lastT);
    lastT = t;

    update(dt, t);
    draw(t);

    global.requestAnimationFrame(frame);
  }

  function update(dt, t) {
    renderer.updateRipple(dt);

    // Kick animation.
    if (s.kickerKickAt > 0) {
      var kt = (t - s.kickerKickAt) / C.KICKER_KICK_DURATION_MS;
      anim.kickerT = Math.min(1, kt);
      if (kt > 1) s.kickerKickAt = 0;
    }

    if (s.state === SM.STATE.POWER) {
      // Oscillate power using a sine wave.
      var phase = (t - s.powerOscillationStart) / C.POWER_OSC_PERIOD_MS;
      var v = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
      s.power = C.POWER_MIN + (C.POWER_MAX - C.POWER_MIN) * v;
    }

    // Virtual ball idle pulse: advance pulseT while in AIMING in AR mode.
    if (arActive && anim.virtualBall && anim.virtualBall.phase === 'idle') {
      anim.virtualBall.pulseT += dt;
    }

    if (s.state === SM.STATE.SHOOTING) {
      var elapsed = t - s.shotStartTime;
      var u = Math.min(1, elapsed / C.BALL_FLIGHT_MS);
      var p = Physics.bezier(anim.launch.start, anim.launch.control, anim.launch.end, u);
      anim.ball = p;
      // Trail.
      anim.trail.push({ x: p.x, y: p.y });
      if (anim.trail.length > C.BALL_TRAIL_LEN) anim.trail.shift();

      // Keeper dive: after reaction delay, lerp toward diveX.
      if (s.keeperDecision && t >= s.keeperDecision.committedAt) {
        var kprog = Math.min(1, (t - s.keeperDecision.committedAt) / C.KEEPER_DIVE_DURATION_MS);
        var ease = kprog * kprog * (3 - 2 * kprog); // smoothstep
        var diveOffset = (s.keeperDecision.diveX - C.KEEPER_X) * ease;
        anim.keeperX = C.KEEPER_X + diveOffset;
        anim.keeperT = ease;
      }

      // Virtual ball (AR): animate from kick point to goal, synced with
      // the real ball but rendered as a glowing orb with spin.
      if (arActive && anim.virtualBall) {
        var vb = anim.virtualBall;
        var vbElapsed = t - anim.virtualBallStartT;
        var vbU = Math.min(1, vbElapsed / C.BALL_FLIGHT_MS);
        var vbP = Physics.bezier(anim.launch.start, anim.launch.control, anim.launch.end, vbU);
        vb.x = vbP.x;
        vb.y = vbP.y;
        vb.kickT = vbU;
        // Spin: full rotation every ~200ms.
        vb.spin = (vbElapsed / 200) * Math.PI * 2;
        // Update particles.
        for (var pi = 0; pi < vb.particles.length; pi++) {
          var pt = vb.particles[pi];
          pt.x += pt.vx * (dt / 1000);
          pt.y += pt.vy * (dt / 1000);
          pt.life -= dt;
        }
        // Remove dead particles.
        vb.particles = vb.particles.filter(function (pt) { return pt.life > 0; });
        // Phase transitions.
        if (vbU >= 1) {
          vb.phase = 'flying'; // will be set to 'goal'/'miss' after resolve
        } else {
          vb.phase = 'flying';
        }
      }

      if (u >= 1) {
        resolveShot();
      }
    }

    if (s.state === SM.STATE.RESULT) {
      if (t - s.resultShownAt >= C.RESULT_DISPLAY_MS) {
        advanceAfterResult();
      }
    }
  }

  function draw(t) {
    var scene = {
      now: t,
      ball: anim.ball,
      trail: anim.trail,
      suppressAim: anim.suppressAim,
      virtualBall: arActive ? anim.virtualBall : null,
      keeper: {
        x: anim.keeperX,
        y: anim.keeperY,
        scale: C.KEEPER_SCALE,
        headR: C.KEEPER_HEAD_RADIUS,
        torso: C.KEEPER_TORSO_LEN,
        limb: C.KEEPER_LIMB_LEN,
        thick: C.KEEPER_THICK,
        role: 'keeper',
        color: COLORS.keeper,
        diveT: anim.keeperT,
        diveX: s.keeperDecision ? s.keeperDecision.diveX : C.KEEPER_X
      },
      kicker: {
        x: C.KICKER_X,
        y: C.KICKER_Y,
        scale: C.KICKER_SCALE,
        headR: C.KICKER_HEAD_RADIUS,
        torso: C.KICKER_TORSO_LEN,
        limb: C.KICKER_LIMB_LEN,
        thick: C.KICKER_THICK,
        role: 'kicker',
        color: COLORS.kicker,
        kickT: anim.kickerT
      }
    };
    renderer.render(s, scene);

    // AR webcam preview (PiP) when active
    if (arActive && arPose && arPose.isActive()) {
      var status = s.cameraStatus === 'ready' ? 'ready' : s.cameraStatus === 'lost' ? 'lost' : 'init';
      // Extract flat landmark array from results (handles both API formats)
      var results = arPose.getLastResults();
      var lm = null;
      if (results) {
        if (results.landmarks && results.landmarks.length > 0) {
          lm = results.landmarks[0]; // new API
        } else if (results.poseLandmarks) {
          lm = results.poseLandmarks; // old API
        }
      }
      // Draw the PiP video with body outline + skeleton overlay
      renderer.drawArPreview(arPose.getVideo(), lm, status);
      // Draw debug panel only when toggled on
      if (arDebug) {
        var dbg = arInput ? arInput._debug : null;
        var currentAim = s.state === SM.STATE.AIMING ? s.aimAngle : 0;
        renderer.drawArDebug(dbg, currentAim, status);
      }
    }

    // CAMERA_INIT overlay
    if (s.state === SM.STATE.CAMERA_INIT) {
      renderer.drawCameraPrompt(s.cameraStatus);
    }
  }

  var COLORS = C.COLORS;

  // ----- Resize handling ----------------------------------------------------
  global.addEventListener('resize', function () { renderer.resize(); });

  // Kick off.
  global.requestAnimationFrame(frame);

  // Expose handles for UI buttons.
  window.__PK = { state: s, anim: anim };
  window.toggleArMode = function () {
    toggleArMode();
  };
  window.toggleArDebug = function () {
    arDebug = !arDebug;
  };
})(typeof window !== 'undefined' ? window : globalThis);
