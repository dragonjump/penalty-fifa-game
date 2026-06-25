/* =========================================================================
 * render.js — all Canvas 2D drawing. The only module that touches `ctx`.
 *
 * Draw order (back to front):
 *   1. pitch (grass + stripes + penalty arc)
 *   2. goal frame (posts + crossbar + net)
 *   3. net ripple FX (on goal)
 *   4. keeper stickman
 *   5. ball + trail + shadow
 *   6. kicker stickman
 *   7. UI overlay (scoreboard, power bar, aim line, messages)
 * ========================================================================= */
(function (global) {
  'use strict';

  var C = global.C;
  var COL = C.COLORS;

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.ripple = null; // { x, y, t, maxR }
    this.resize();
  }

  // Scale canvas backing store by devicePixelRatio for crisp rendering.
  Renderer.prototype.resize = function () {
    var dpr = (global.devicePixelRatio || 1);
    this.dpr = dpr;
    var ctx = this.ctx;
    ctx.imageSmoothingEnabled = true;

    var vw = global.innerWidth, vh = global.innerHeight;
    var isPortrait = vh > vw;

    // In portrait mode, extend the canvas height so the camera preview
    // fills the bottom of the screen (no blank space below the game).
    // The game area stays at the top, camera area fills the rest.
    var canvasW = C.CANVAS_WIDTH;
    var canvasH = C.CANVAS_HEIGHT;
    this._cameraAreaH = 0; // pixels reserved for camera (canvas coords)

    if (isPortrait) {
      // Scale canvas width to fit viewport width exactly
      var scale = vw / canvasW;
      // Compute how much height the game area takes in screen pixels
      var gameScreenH = canvasH * scale;
      // Remaining screen height goes to camera area
      var remainingScreenH = vh - gameScreenH;
      if (remainingScreenH > 40) {
          // Convert screen pixels back to canvas coordinates
          this._cameraAreaH = remainingScreenH / scale;
          canvasH = canvasH + this._cameraAreaH;
      }
    }

    this.canvas.width = canvasW * dpr;
    this.canvas.height = canvasH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Style size matches the logical canvas size scaled to fit
    var scaleX = vw / canvasW;
    var scaleY = vh / canvasH;
    var fitScale = Math.min(scaleX, scaleY);
    this.canvas.style.width = (canvasW * fitScale) + 'px';
    this.canvas.style.height = (canvasH * fitScale) + 'px';
  };

  Renderer.prototype.clear = function () {
    var ctx = this.ctx;
    ctx.clearRect(0, 0, C.CANVAS_WIDTH, C.CANVAS_HEIGHT);
  };

  // ---- Pitch --------------------------------------------------------------
  Renderer.prototype.drawPitch = function () {
    var ctx = this.ctx;
    // Grass base.
    ctx.fillStyle = COL.grass1;
    ctx.fillRect(0, 0, C.CANVAS_WIDTH, C.CANVAS_HEIGHT);

    // Alternating stripes.
    var stripeW = 48;
    ctx.fillStyle = COL.grass2;
    for (var x = 0; x < C.CANVAS_WIDTH; x += stripeW * 2) {
      ctx.fillRect(x, 0, stripeW, C.CANVAS_HEIGHT);
    }

    // Pitch boundary.
    ctx.strokeStyle = COL.line;
    ctx.lineWidth = 2;
    ctx.strokeRect(C.PITCH_MARGIN_X, C.PITCH_MARGIN_TOP,
                   C.CANVAS_WIDTH - C.PITCH_MARGIN_X * 2,
                   C.CANVAS_HEIGHT - C.PITCH_MARGIN_TOP - 10);

    // Penalty arc in front of the goal.
    ctx.beginPath();
    ctx.strokeStyle = COL.line;
    ctx.arc(C.GOAL_CENTER_X, C.GOAL_BOTTOM_Y - 120, 90, Math.PI * 0.15, Math.PI - Math.PI * 0.15, true);
    ctx.stroke();

    // 6-yard box.
    ctx.strokeRect(C.GOAL_CENTER_X - 90, C.GOAL_BOTTOM_Y, 180, 36);
    // 18-yard box.
    ctx.strokeRect(C.GOAL_CENTER_X - 150, C.GOAL_BOTTOM_Y, 300, 80);

    // Penalty spot.
    ctx.fillStyle = COL.line;
    ctx.beginPath();
    ctx.arc(C.GOAL_CENTER_X, C.BALL_START_Y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  };

  // ---- Goal frame + net ---------------------------------------------------
  Renderer.prototype.drawGoal = function () {
    var ctx = this.ctx;
    var left = C.GOAL_LEFT_X, right = C.GOAL_RIGHT_X;
    var top = C.GOAL_TOP_Y, bottom = C.GOAL_BOTTOM_Y;

    // Net mesh (drawn behind the goal line).
    ctx.save();
    ctx.strokeStyle = COL.net;
    ctx.lineWidth = 1;
    var depth = C.NET_DEPTH;
    // Diagonal receding lines.
    var nx = 10;
    for (var i = 0; i <= nx; i++) {
      var x = left + (right - left) * (i / nx);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x - depth * 0.25, top + depth);
      ctx.stroke();
    }
    var ny = 5;
    for (var j = 0; j <= ny; j++) {
      var y = top + (bottom - top) * (j / ny);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left - depth * 0.25, y + depth * 0.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(right, y);
      ctx.lineTo(right + depth * 0.25, y + depth * 0.4);
      ctx.stroke();
    }
    ctx.restore();

    // Posts + crossbar.
    ctx.strokeStyle = '#f5f5f5';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    ctx.lineTo(left, top);
    ctx.lineTo(right, top);
    ctx.lineTo(right, bottom);
    ctx.stroke();

    // Net depth side bars.
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, top); ctx.lineTo(left - depth * 0.25, top + depth);
    ctx.moveTo(right, top); ctx.lineTo(right + depth * 0.25, top + depth);
    ctx.stroke();
  };

  // Trigger a net ripple at a goal-space coordinate.
  Renderer.prototype.startRipple = function (x, y) {
    this.ripple = { x: x, y: y, t: 0, maxR: 70, life: 420 };
  };

  Renderer.prototype.updateRipple = function (dt) {
    if (this.ripple) {
      this.ripple.t += dt;
      if (this.ripple.t >= this.ripple.life) this.ripple = null;
    }
  };

  Renderer.prototype.drawRipple = function () {
    if (!this.ripple) return;
    var ctx = this.ctx;
    var r = this.ripple;
    var k = r.t / r.life;
    var radius = r.maxR * k;
    var alpha = (1 - k) * 0.55;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,' + alpha.toFixed(3) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,' + (alpha * 0.6).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(r.x, r.y, radius * 0.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  // ---- Stickman -----------------------------------------------------------
  // opts: { x, y, scale, headR, torso, limb, thick, flip, kickT, diveT,
  //         diveX, color, skinColor }
  Renderer.prototype.drawStickman = function (opts) {
    var ctx = this.ctx;
    var x = opts.x, y = opts.y;
    var s = opts.scale || 1;
    var headR = opts.headR * s;
    var torso = opts.torso * s;
    var limb = opts.limb * s;
    var thick = opts.thick * s;
    var flip = opts.flip || 1; // 1 = faces right, -1 = faces left
    var kickT = opts.kickT || 0; // 0..1 progress of kick animation
    var diveT = opts.diveT || 0; // 0..1 progress of dive (horizontal stretch)
    var diveX = opts.diveX || null;
    var color = opts.color || '#1a1a1a';
    var skin = opts.skinColor || COL.skin;

    // Interpolate limb angles based on pose.
    // Standing: arms down, legs down.
    // Kicker: back leg swings forward during kick.
    // Keeper dive: arms reach toward diveX, body stretches horizontally.
    var torsoTopY = y - torso;
    var headCY = torsoTopY - headR * 1.1;
    var hipY = y;

    // Arm angles (from vertical, in radians).
    var lArm = Math.PI * 0.55;     // left arm outward
    var rArm = Math.PI * 0.55;
    // Leg angles.
    var lLeg = Math.PI * 0.10;
    var rLeg = -Math.PI * 0.10;

    if (opts.role === 'kicker') {
      // Kicking leg swings up during kickT.
      var swing = Math.sin(kickT * Math.PI) * 1.1; // 0..1.1..0
      rLeg = -Math.PI * 0.5 - swing * 0.9;       // forward & up
      lLeg = Math.PI * 0.10;
      // Arms counter-balance.
      lArm = Math.PI * 0.7;
      rArm = Math.PI * 0.4;
      // Torso leans forward slightly.
      torsoTopY -= 2 * s * Math.sin(kickT * Math.PI);
    } else if (opts.role === 'keeper') {
      if (diveT > 0) {
        // Arms reach toward diveX.
        var dx = diveX != null ? (diveX - x) : 60 * flip;
        var reach = Math.max(0, Math.min(1, dx / (limb * 2.2)));
        lArm = Math.PI * 0.5 - reach * 0.9 * flip;
        rArm = Math.PI * 0.5 - reach * 0.9 * flip;
        // Legs split.
        lLeg = Math.PI * 0.25 * flip;
        rLeg = -Math.PI * 0.25 * flip;
        // Body stretches horizontally.
        torso *= (1 + 0.18 * diveT);
      } else {
        // Ready stance — arms slightly out.
        lArm = Math.PI * 0.7;
        rArm = Math.PI * 0.7;
      }
    }

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x, hipY + 2, limb * 0.9, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs.
    ctx.strokeStyle = color;
    ctx.lineWidth = thick;
    var hipX = x;
    this._limb(hipX, hipY, lLeg, limb, s);
    this._limb(hipX, hipY, rLeg, limb, s);

    // Torso.
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(hipX, torsoTopY);
    ctx.stroke();

    // Arms.
    var shoulderY = torsoTopY + torso * 0.18;
    ctx.beginPath();
    this._limb(hipX, shoulderY, lArm, limb, s);
    this._limb(hipX, shoulderY, rArm, limb, s);

    // Head.
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(hipX, headCY, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.stroke();

    // Cap stripe to distinguish keeper vs kicker.
    ctx.strokeStyle = color;
    ctx.lineWidth = thick * 0.6;
    ctx.beginPath();
    ctx.arc(hipX, headCY - headR * 0.2, headR * 0.95, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();

    ctx.restore();
  };

  // Helper: draw a limb from (x,y) at angle (from vertical) for length len.
  Renderer.prototype._limb = function (x, y, angle, len, s) {
    var ctx = this.ctx;
    var dx = Math.sin(angle) * len;
    var dy = Math.cos(angle) * len;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();
  };

  // ---- Ball ---------------------------------------------------------------
  Renderer.prototype.drawBall = function (x, y, radius, trail) {
    var ctx = this.ctx;
    // Shadow.
    ctx.fillStyle = COL.ballShadow;
    ctx.beginPath();
    ctx.ellipse(x, C.BALL_START_Y + 4, radius * 0.9, radius * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    // Trail.
    if (trail && trail.length) {
      for (var i = 0; i < trail.length; i++) {
        var p = trail[i];
        var a = (i / trail.length) * 0.35;
        ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * (0.4 + 0.5 * (i / trail.length)), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Ball body.
    ctx.fillStyle = COL.ball;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Pentagon hint.
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.28, 0, Math.PI * 2);
    ctx.fill();
  };

  // ---- Virtual ball (AR mode) ---------------------------------------------
  // Draws a glowing ball at the penalty spot to invite the kick. Pulses
  // gently when idle; on kick, the ball animates toward the goal with spin
  // and a particle burst.
  //
  // opts: {
  //   phase: 'idle' | 'kicked' | 'flying' | 'goal' | 'miss',
  //   pulseT: ms since AR mode activated (for idle pulse),
  //   kickT:  0..1 progress of kick animation,
  //   ballX, ballY: current ball position (logical px),
  //   spin:   rotation angle (radians) for visual spin,
  //   particles: [{ x, y, vx, vy, life, maxLife, color, size }]
  // }
  Renderer.prototype.drawVirtualBall = function (opts) {
    if (!opts) return;
    var ctx = this.ctx;
    var x = opts.x != null ? opts.x : C.BALL_START_X;
    var y = opts.y != null ? opts.y : C.BALL_START_Y;
    var baseR = C.BALL_RADIUS;
    var t = opts.pulseT || 0;

    if (opts.phase === 'idle') {
      // Pulsing glow to invite the kick.
      var pulse = 1 + 0.12 * Math.sin(t / 220);
      var glowR = baseR * 2.4;
      var glowAlpha = 0.18 + 0.10 * Math.sin(t / 220);
      ctx.save();
      // Outer glow.
      var grad = ctx.createRadialGradient(x, y, baseR * 0.5, x, y, glowR);
      grad.addColorStop(0, 'rgba(255,230,109,' + glowAlpha.toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(255,230,109,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, glowR, 0, Math.PI * 2);
      ctx.fill();
      // Ball (slightly enlarged to feel "inviting").
      var r = baseR * pulse;
      ctx.fillStyle = COL.ball;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,230,109,0.7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Pentagon hint.
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (opts.phase === 'kicked' || opts.phase === 'flying') {
      // Ball spinning and moving toward goal. kickT in 0..1.
      var kickT = opts.kickT || 0;
      // Ball grows slightly then shrinks as it "launches".
      var scale = 1 + 0.15 * Math.sin(kickT * Math.PI);
      var r = baseR * scale;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(opts.spin || 0);
      // Ball body.
      ctx.fillStyle = COL.ball;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Pentagon hint (rotates with ball).
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      // Motion streak.
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-r * 1.2, 0);
      ctx.lineTo(-r * 2.5, 0);
      ctx.stroke();
      ctx.restore();
    } else if (opts.phase === 'goal' || opts.phase === 'miss') {
      // Final state: ball at rest (goal) or faded (miss).
      var alpha = opts.phase === 'miss' ? 0.3 : 1.0;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = COL.ball;
      ctx.beginPath();
      ctx.arc(x, y, baseR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.beginPath();
      ctx.arc(x, y, baseR * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Particle burst (drawn in all non-idle phases).
    if (opts.particles && opts.particles.length) {
      ctx.save();
      for (var i = 0; i < opts.particles.length; i++) {
        var p = opts.particles[i];
        var lifeRatio = p.life / p.maxLife;
        ctx.fillStyle = p.color.replace('ALPHA', (lifeRatio * 0.9).toFixed(3));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * lifeRatio, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  };

  // ---- UI -----------------------------------------------------------------
  Renderer.prototype.drawAimLine = function (angle) {
    var ctx = this.ctx;
    var x = C.BALL_START_X;
    var y = C.BALL_START_Y;
    var len = C.AIM_LINE_LEN;
    // angle: 0 = straight up. Convert to screen coords (y down).
    var dx = Math.sin(angle) * len;
    var dy = -Math.cos(angle) * len;
    ctx.save();
    ctx.strokeStyle = COL.aim;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();
    ctx.setLineDash([]);
    // Arrowhead.
    var ah = 8;
    var ax = x + dx, ay = y + dy;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - ah * Math.cos(angle * 0.4), ay - ah * Math.sin(angle * 0.4));
    ctx.lineTo(ax - ah * Math.sin(angle * 0.4), ay + ah * Math.cos(angle * 0.4));
    ctx.closePath();
    ctx.fillStyle = COL.aim;
    ctx.fill();
    ctx.restore();
  };

  Renderer.prototype.drawPowerBar = function (power, locked, flashT) {
    var ctx = this.ctx;
    var w = C.UI.powerBarW, h = C.UI.powerBarH;
    var x = (C.CANVAS_WIDTH - w) / 2;
    var y = C.UI.powerBarY;
    ctx.save();
    // Frame.
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    // Fill gradient by power.
    var grad = ctx.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, COL.powerLow);
    grad.addColorStop(0.5, COL.powerMid);
    grad.addColorStop(1, COL.powerHigh);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w * power, h);
    // Marker.
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    if (locked) {
      var a = 0.5 + 0.5 * Math.sin((flashT || 0) / 80);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.2 + 0.4 * a).toFixed(2) + ')';
      ctx.fillRect(x, y, w * power, h);
    }
    ctx.fillStyle = COL.uiText;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('POWER', C.CANVAS_WIDTH / 2, y - 4);
    ctx.restore();
  };

  Renderer.prototype.drawScoreboard = function (s) {
    var ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, C.CANVAS_WIDTH, 36);
    ctx.fillStyle = COL.uiText;
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    if (s.mode === 'BEST_OF') {
      ctx.fillText('YOU ' + s.score.player + ' — ' + s.score.keeper + ' KEEPER', C.CANVAS_WIDTH / 2, 22);
      ctx.font = '10px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('Round ' + s.round + ' of ' + C.BEST_OF, C.CANVAS_WIDTH / 2, 33);
    } else {
      ctx.fillText('ENDLESS  •  Score ' + s.endlessScore, C.CANVAS_WIDTH / 2, 22);
      ctx.font = '10px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('Best ' + (s.endlessHighScore || 0), C.CANVAS_WIDTH / 2, 33);
    }
    ctx.restore();
  };

  Renderer.prototype.drawMessage = function (text, sub, big) {
    if (!text) return;
    var ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = COL.uiShadow;
    ctx.font = (big ? 'bold 56px' : 'bold 36px') + ' sans-serif';
    ctx.fillText(text, C.CANVAS_WIDTH / 2 + 2, C.UI.messageY + 2);
    ctx.fillStyle = COL.uiText;
    ctx.fillText(text, C.CANVAS_WIDTH / 2, C.UI.messageY);
    if (sub) {
      ctx.font = '14px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(sub, C.CANVAS_WIDTH / 2, C.UI.messageY + 26);
    }
    ctx.restore();
  };

  // ---- Full-frame -------------------------------------------------------
  Renderer.prototype.render = function (s, scene) {
    this.clear();

    // In portrait mode with extended canvas, clip game rendering to top area
    // so the bottom camera area stays clean for the video preview.
    var isPortrait = global.innerHeight > global.innerWidth;
    if (isPortrait && this._cameraAreaH > 0) {
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.rect(0, 0, C.CANVAS_WIDTH, C.CANVAS_HEIGHT);
      this.ctx.clip();
    }

    this.drawPitch();
    this.drawGoal();
    this.drawRipple();

    // Keeper.
    if (scene.keeper) {
      this.drawStickman(scene.keeper);
    } else {
      this.drawStickman({
        x: C.KEEPER_X, y: C.KEEPER_Y, scale: C.KEEPER_SCALE,
        headR: C.KEEPER_HEAD_RADIUS, torso: C.KEEPER_TORSO_LEN,
        limb: C.KEEPER_LIMB_LEN, thick: C.KEEPER_THICK,
        role: 'keeper', color: COL.keeper
      });
    }

    // Ball.
    if (scene.ball) {
      this.drawBall(scene.ball.x, scene.ball.y, C.BALL_RADIUS, scene.trail);
    } else {
      this.drawBall(C.BALL_START_X, C.BALL_START_Y, C.BALL_RADIUS, null);
    }

    // Virtual ball overlay (AR mode — invites the kick, animates on fire).
    if (scene.virtualBall) {
      this.drawVirtualBall(scene.virtualBall);
    }

    // Kicker.
    if (scene.kicker) {
      this.drawStickman(scene.kicker);
    } else {
      this.drawStickman({
        x: C.KICKER_X, y: C.KICKER_Y, scale: C.KICKER_SCALE,
        headR: C.KICKER_HEAD_RADIUS, torso: C.KICKER_TORSO_LEN,
        limb: C.KICKER_LIMB_LEN, thick: C.KICKER_THICK,
        role: 'kicker', color: COL.kicker
      });
    }

    // Aim line during AIMING / POWER.
    if ((s.state === 'AIMING' || s.state === 'POWER') && !scene.suppressAim) {
      this.drawAimLine(s.aimAngle);
    }
    if (s.state === 'POWER') {
      this.drawPowerBar(s.power, s.powerLocked, scene.now - s.powerLockedAt);
    }

    this.drawScoreboard(s);

    if (s.state === 'RESULT' && s.result) {
      var map = { goal: 'GOAL!', saved: 'SAVED!', miss: 'MISS' };
      this.drawMessage(map[s.result] || '', s.messageSub);
    }
    if (s.state === 'GAME_OVER') {
      this.drawMessage(s.message || 'GAME OVER', s.messageSub, true);
    }
    if (s.state === 'MENU') {
      this.drawMessage('PENALTY KICK', 'Drag to aim • Tap to shoot', true);
    }

    // Remove clip region (portrait mode) so camera preview can draw below
    if (isPortrait && this._cameraAreaH > 0) {
      this.ctx.restore();
    }
  };

  // ---- AR webcam preview (PiP) -------------------------------------------
  // In portrait mode: camera preview spans the bottom of the canvas
  // In landscape: camera preview is a smaller box in the corner
  Renderer.prototype.drawArPreview = function (video, landmarks, status) {
    if (!video) return;
    var ctx = this.ctx;
    var isPortrait = global.innerHeight > global.innerWidth;
    var pw, ph, px, py;

    if (isPortrait && this._cameraAreaH > 0) {
      // Portrait: camera fills the extended bottom area of the canvas
      ph = this._cameraAreaH - 4; // fill the camera area (minus small margin)
      pw = ph * (C.AR.CAPTURE_WIDTH / C.AR.CAPTURE_HEIGHT); // keep aspect ratio
      px = (C.CANVAS_WIDTH - pw) / 2; // centered horizontally
      py = C.CANVAS_HEIGHT + 2; // start at the top of the camera area
    } else if (isPortrait) {
      // Portrait fallback: fixed 30% of original canvas
      ph = C.CANVAS_HEIGHT * 0.3;
      pw = ph * (C.AR.CAPTURE_WIDTH / C.AR.CAPTURE_HEIGHT);
      px = (C.CANVAS_WIDTH - pw) / 2;
      py = C.CANVAS_HEIGHT - ph - 5;
    } else {
      // Landscape: smaller box in corner
      pw = C.CANVAS_WIDTH * (C.AR.PIP_WIDTH_PCT || 0.45);
      ph = pw * (C.AR.CAPTURE_HEIGHT / C.AR.CAPTURE_WIDTH);
      px = C.CANVAS_WIDTH - pw - 10;
      py = C.CANVAS_HEIGHT - ph - 10;
    }

    ctx.save();
    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(px - 4, py - 4, pw + 8, ph + 8);
    // Video frame (mirrored)
    ctx.save();
    ctx.translate(px + pw, py);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, pw, ph);
    ctx.restore();

    // Body outline + skeleton overlay (drawn on top of video)
    if (landmarks) {
      this._drawBodyFull(ctx, landmarks, px, py, pw, ph);
    }

    // Status indicator dot
    var dotColor = status === 'ready' ? '#00ff88' : status === 'lost' ? '#ff4444' : '#ffcc00';
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(px + pw - 8, py + 8, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  };

  // Draw full body outline on the PiP (head, torso, arms, legs).
  // This helps the player see what the system is tracking.
  Renderer.prototype._drawBodyFull = function (ctx, lm, ox, oy, ow, oh) {
    if (!lm) return;

    // Mirror X for selfie view
    function pt(p) { return { x: ox + (1 - p.x) * ow, y: oy + p.y * oh }; }

    // Body part definitions: [startIdx, endIdx, color]
    var parts = [
      // Head (landmarks 0-10)
      [0, 1, '#ffcc00'], [1, 2, '#ffcc00'], [2, 3, '#ffcc00'], [3, 4, '#ffcc00'],
      [4, 5, '#ffcc00'], [5, 6, '#ffcc00'], [6, 7, '#ffcc00'], [7, 8, '#ffcc00'],
      [8, 9, '#ffcc00'], [9, 10, '#ffcc00'],
      // Torso
      [11, 12, '#ff6666'], // shoulders
      [11, 23, '#ff6666'], // left shoulder to left hip
      [12, 24, '#ff6666'], // right shoulder to right hip
      [23, 24, '#ff6666'], // hips
      // Left arm
      [11, 13, '#66aaff'], [13, 15, '#66aaff'],
      // Right arm
      [12, 14, '#66aaff'], [14, 16, '#66aaff'],
      // Left leg
      [23, 25, '#66ff88'], [25, 27, '#66ff88'], [27, 31, '#66ff88'],
      // Right leg
      [24, 26, '#66ff88'], [26, 28, '#66ff88'], [28, 32, '#66ff88']
    ];

    ctx.lineWidth = C.AR.SKELETON_THICKNESS;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (var i = 0; i < parts.length; i++) {
      var a = lm[parts[i][0]];
      var b = lm[parts[i][1]];
      if (!a || !b) continue;
      var pa = pt(a);
      var pb = pt(b);
      ctx.strokeStyle = parts[i][2];
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    // Draw keypoints as small white dots
    var keypoints = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32];
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (var k = 0; k < keypoints.length; k++) {
      var kp = lm[keypoints[k]];
      if (!kp) continue;
      var p = pt(kp);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // ---- AR body outline (full body silhouette) ----------------------------
  // Draws a simplified body outline on the PiP so the player can see what
  // the system is tracking. Includes: head, torso, both arms, both legs.
  Renderer.prototype.drawBodyOutline = function (video, landmarks) {
    if (!video || !landmarks) return;
    var ctx = this.ctx;
    var pw = C.AR.PIP_WIDTH;
    var ph = pw * (C.AR.CAPTURE_HEIGHT / C.AR.CAPTURE_WIDTH);
    var px = C.CANVAS_WIDTH - pw - 10;
    var py = C.CANVAS_HEIGHT - ph - 10;

    // Mirror X for selfie view
    function pt(p) { return { x: px + (1 - p.x) * pw, y: py + p.y * ph }; }

    ctx.save();
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Define body chains (pairs of landmark indices to connect)
    var chains = [
      // Head
      [10, 8], [8, 7], [7, 6], [6, 5], [5, 4], [4, 3], [3, 2], [2, 1], [1, 0],
      // Torso (shoulders to hips)
      [12, 11], [11, 23], [23, 24], [24, 12],
      // Left arm (landmarks 11,13,15)
      [11, 13], [13, 15],
      // Right arm (landmarks 12,14,16)
      [12, 14], [14, 16],
      // Left leg (landmarks 23,25,27,31)
      [23, 25], [25, 27], [27, 31],
      // Right leg (landmarks 24,26,28,32)
      [24, 26], [26, 28], [28, 32]
    ];

    // Draw each chain
    for (var c = 0; c < chains.length; c++) {
      var a = landmarks[chains[c][0]];
      var b = landmarks[chains[c][1]];
      if (!a || !b) continue;
      var pa = pt(a);
      var pb = pt(b);
      // Color by body part: arms=blue, legs=green, torso=red, head=yellow
      var color = C.AR.SKELETON_COLOR;
      if (c < 1) color = '#ffcc00';        // head
      else if (c < 2) color = '#ff6666';   // torso
      else if (c < 4) color = '#66aaff';   // arms
      else color = '#66ff88';             // legs
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    // Draw keypoints as small dots
    var keypoints = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32];
    for (var k = 0; k < keypoints.length; k++) {
      var kp = landmarks[keypoints[k]];
      if (!kp) continue;
      var p = pt(kp);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  };

  // ---- AR debug overlay (shows aim/power/windup/velocity) ----------------
  // Renders a panel on the left side of the canvas with real-time AR data.
  Renderer.prototype.drawArDebug = function (debug, aim, status) {
    if (!debug) return;
    var ctx = this.ctx;
    var x = 10;
    var y = 50;
    var lineH = 16;

    ctx.save();
    // Background panel
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x - 4, y - 14, 185, lineH * 11 + 20);
    ctx.textAlign = 'left';
    ctx.font = '11px monospace';

    function row(label, value, color) {
      ctx.fillStyle = color || '#aaffaa';
      ctx.fillText(label + ': ' + value, x, y);
      y += lineH;
    }

    row('STATUS', status || 'unknown', status === 'ready' ? '#66ff88' : '#ffaa66');
    row('AIM', (aim >= 0 ? '→ ' : '← ') + Math.abs(aim).toFixed(2), Math.abs(aim) > 0.3 ? '#ffff66' : '#888888');
    row('FOOT AIM', (debug.footAim >= 0 ? '→ ' : '← ') + Math.abs(debug.footAim || 0).toFixed(2), '#aaccff');
    row('BODY LEAN', (debug.bodyLean >= 0 ? '→ ' : '← ') + Math.abs(debug.bodyLean || 0).toFixed(2), '#ffccaa');
    row('FOOT VEL', debug.footVel.toFixed(3), debug.footVel > C.AR.KICK_VELOCITY_THRESHOLD ? '#66ff88' : '#ff6666');
    row('KNEE LIFT', debug.kneeLift.toFixed(2), debug.windup ? '#66ff88' : '#666666');
    row('WINDUP', debug.windup ? 'YES ✓' : 'NO', debug.windup ? '#66ff88' : '#666666');
    row('CONFIDENCE', debug.confidence.toFixed(2), debug.confidence > 0.2 ? '#66ff88' : '#ff6666');
    row('COOLDOWN', debug.cooldownOk ? 'OK ✓' : 'WAIT', debug.cooldownOk ? '#66ff88' : '#ff6666');

    // Show kick threshold bar
    var barX = x;
    var barY = y + 2;
    var barW = 170;
    var barH = 8;
    var velRatio = Math.min(1, debug.footVel / (C.AR.KICK_VELOCITY_THRESHOLD * 3));
    ctx.fillStyle = '#333333';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = velRatio > 1 ? '#66ff88' : '#ff6666';
    ctx.fillRect(barX, barY, barW * velRatio, barH);
    // Threshold marker
    var threshX = barX + barW * (C.AR.KICK_VELOCITY_THRESHOLD / (C.AR.KICK_VELOCITY_THRESHOLD * 3));
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(threshX, barY - 2);
    ctx.lineTo(threshX, barY + barH + 2);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '9px monospace';
    ctx.fillText('KICK THRESH', barX, barY + barH + 10);

    if (debug.triggered) {
      ctx.fillStyle = '#ffff00';
      ctx.font = 'bold 12px monospace';
      ctx.fillText('>>> KICK DETECTED! vel=' + (debug.triggerVel || 0).toFixed(3), x, y + 26);
    }

    ctx.restore();
  };

  // ---- AR camera init overlay --------------------------------------------
  Renderer.prototype.drawCameraPrompt = function (status) {
    var ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, C.CANVAS_WIDTH, C.CANVAS_HEIGHT);
    ctx.fillStyle = '#f5f5f5';
    ctx.textAlign = 'center';
    ctx.font = 'bold 28px sans-serif';
    if (status === 'requesting') {
      ctx.fillText('Requesting camera...', C.CANVAS_WIDTH / 2, C.CANVAS_HEIGHT / 2 - 10);
      ctx.font = '14px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('Please allow camera access', C.CANVAS_WIDTH / 2, C.CANVAS_HEIGHT / 2 + 20);
    } else if (status === 'failed') {
      ctx.fillText('Camera unavailable', C.CANVAS_WIDTH / 2, C.CANVAS_HEIGHT / 2 - 10);
      ctx.font = '14px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('Using mouse controls instead', C.CANVAS_WIDTH / 2, C.CANVAS_HEIGHT / 2 + 20);
    }
    ctx.restore();
  };

  global.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
