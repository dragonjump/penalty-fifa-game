/* =========================================================================
 * ar-mapping.js — pure functions: pose landmarks → aim angle + power.
 *
 * No browser dependencies. Node-testable.
 *
 * Key landmarks (MediaPipe 33-point, normalized coords, y-down):
 *   11=left shoulder  12=right shoulder
 *   23=left hip      24=right hip
 *   25=left knee     26=right knee
 *   27=left ankle    28=right ankle
 *   31=left foot     32=right foot
 *
 * Coordinate convention: player faces camera. In the mirrored selfie view,
 * the player's right side appears on the LEFT of the image.
 * All "aim" values: +ve = player's right = game right, −ve = player's left.
 * ========================================================================= */
(function (global) {
  'use strict';

  var C = global.C;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ── Aim from foot position ─────────────────────────────────────────────
  // The foot that is more extended from its own hip is the kicking foot.
  // Foot pulled left of its hip → aim right. Foot pushed right → aim left.
  //
  // Returns { aimAngle: -1..1, footSide: 'right'|'left'|null }
  function computeFootAim(landmarks) {
    if (!landmarks) return { aimAngle: 0, footSide: null };

    var rightFoot = landmarks[32] || landmarks[28]; // prefer foot index, fallback ankle
    var leftFoot = landmarks[31] || landmarks[27];
    var rightHip = landmarks[24];
    var leftHip = landmarks[23];

    if (!rightFoot || !leftFoot || !rightHip || !leftHip) {
      return { aimAngle: 0, footSide: null };
    }

    // Displacement of each foot from its own hip (in image space)
    var rightDisp = rightFoot.x - rightHip.x; // +ve = foot right of hip
    var leftDisp = leftFoot.x - leftHip.x;

    // Pick the foot with larger absolute displacement
    var footSide = Math.abs(rightDisp) >= Math.abs(leftDisp) ? 'right' : 'left';
    var displacement = footSide === 'right' ? rightDisp : leftDisp;

    // In mirrored selfie view:
    //   Right foot pulled LEFT (negative disp) → player aims RIGHT (positive)
    //   Left foot pushed RIGHT (positive disp) → player aims RIGHT (positive)
    var aim = footSide === 'right' ? -displacement : displacement;

    // Scale: 10% of frame width from hip = full aim
    aim = aim * C.AR.FOOT_AIM_SCALE;

    // Dead zone: ignore tiny movements (< 3% of frame)
    if (Math.abs(displacement) < 0.03) aim = 0;

    return { aimAngle: clamp(aim, -1, 1), footSide: footSide };
  }

  // ── Aim from body lean ────────────────────────────────────────────────
  // Uses shoulder offset relative to hip center.
  // Shoulders shifted left of hips → player leans right → aim right.
  //
  // Returns { leanX: -1..1, confidence: 0..1 }
  function computeBodyLean(landmarks) {
    if (!landmarks) return { leanX: 0, confidence: 0 };

    var rightHip = landmarks[24];
    var leftHip = landmarks[23];
    var rightShoulder = landmarks[12];
    var leftShoulder = landmarks[11];

    if (!rightHip || !leftHip) return { leanX: 0, confidence: 0 };

    var hipCenterX = (rightHip.x + leftHip.x) / 2;
    var hipWidth = Math.abs(rightHip.x - leftHip.x) || 0.01;

    // If shoulders available, use shoulder-hip offset
    if (rightShoulder && leftShoulder) {
      var shoulderCenterX = (rightShoulder.x + leftShoulder.x) / 2;
      var shoulderOffset = shoulderCenterX - hipCenterX; // +ve = shoulders right of hips

      // In mirrored view: shoulders left (negative) → lean right (positive)
      var lean = -shoulderOffset / hipWidth; // ~[-0.5, 0.5] for normal stance

      // Dead zone: < 5% of hip width = neutral
      if (Math.abs(shoulderOffset) < hipWidth * 0.05) lean = 0;

      return {
        leanX: clamp(lean * 2.0, -1, 1),
        confidence: (rightShoulder.visibility || 0) * (leftShoulder.visibility || 0)
      };
    }

    // Fallback: use hip asymmetry (less reliable)
    var rightOffset = rightHip.x - hipCenterX; // typically -hipWidth/2
    var expectedOffset = -hipWidth / 2;
    var asymmetry = rightOffset - expectedOffset; // +ve = right hip pushed right

    if (Math.abs(asymmetry) < hipWidth * 0.05) return { leanX: 0, confidence: 0.3 };

    return {
      leanX: clamp(-asymmetry / hipWidth * 2.0, -1, 1),
      confidence: (rightHip.visibility || 0) * (leftHip.visibility || 0) * 0.5
    };
  }

  // ── Combined aim: foot direction + body lean ──────────────────────────
  // Foot aim is primary (70%), body lean adds 30%.
  function computeCombinedAim(landmarks) {
    var foot = computeFootAim(landmarks);
    var body = computeBodyLean(landmarks);

    var footWeight = foot.footSide ? 0.7 : 0;
    var bodyWeight = 1 - footWeight;

    var aim = foot.aimAngle * footWeight + body.leanX * C.AR.BODY_LEAN_AIM_WEIGHT * bodyWeight;

    return {
      aimAngle: clamp(aim, -1, 1),
      footSide: foot.footSide,
      footAim: foot.aimAngle,
      bodyLean: body.leanX,
      bodyConfidence: body.confidence
    };
  }

  // ── Power from foot velocity ───────────────────────────────────────────
  // Uses the faster-moving foot (not ankle) for kick detection.
  // buffer = [{ rightFoot, leftFoot, right, left, t }]
  function footVelocity(buffer) {
    if (buffer.length < 2) return 0;
    var old = buffer[0];
    var newest = buffer[buffer.length - 1];
    var dt = (newest.t - old.t) / 1000;
    if (dt <= 0) return 0;

    var dr = 0, dl = 0;
    if (newest.rightFoot && old.rightFoot) {
      dr = Math.sqrt(Math.pow(newest.rightFoot.x - old.rightFoot.x, 2) + Math.pow(newest.rightFoot.y - old.rightFoot.y, 2));
    } else if (newest.right && old.right) {
      dr = Math.sqrt(Math.pow(newest.right.x - old.right.x, 2) + Math.pow(newest.right.y - old.right.y, 2));
    }
    if (newest.leftFoot && old.leftFoot) {
      dl = Math.sqrt(Math.pow(newest.leftFoot.x - old.leftFoot.x, 2) + Math.pow(newest.leftFoot.y - old.leftFoot.y, 2));
    } else if (newest.left && old.left) {
      dl = Math.sqrt(Math.pow(newest.left.x - old.left.x, 2) + Math.pow(newest.left.y - old.left.y, 2));
    }
    return Math.max(dr, dl) / dt;
  }

  // ── Legacy ankle velocity (kept for compatibility) ────────────────────
  function ankleVelocity(buffer) {
    if (buffer.length < 2) return 0;
    var old = buffer[0];
    var newest = buffer[buffer.length - 1];
    var dt = (newest.t - old.t) / 1000;
    if (dt <= 0) return 0;
    var dr = Math.sqrt(Math.pow(newest.right.x - old.right.x, 2) + Math.pow(newest.right.y - old.right.y, 2));
    var dl = Math.sqrt(Math.pow(newest.left.x - old.left.x, 2) + Math.pow(newest.left.y - old.left.y, 2));
    return Math.max(dr, dl) / dt;
  }

  // ── Knee angle (for wind-up detection) ────────────────────────────────
  function kneeAngle(hip, knee, ankle) {
    var thighX = hip.x - knee.x;
    var thighY = hip.y - knee.y;
    var shinX = ankle.x - knee.x;
    var shinY = ankle.y - knee.y;
    var dot = thighX * shinX + thighY * shinY;
    var cross = thighX * shinY - thighY * shinX;
    return Math.abs(Math.atan2(cross, dot));
  }

  // ── Full shot computation ──────────────────────────────────────────────
  function computeShot(landmarks, calibration, buffer) {
    if (!landmarks) return { aimAngle: 0, power: 0, confidence: 0, kneeLift: 0 };

    var rightHip = landmarks[24];
    var leftHip = landmarks[23];
    var rightKnee = landmarks[26];
    var leftKnee = landmarks[25];
    var rightAnkle = landmarks[28];
    var leftAnkle = landmarks[27];

    if (!rightHip || !leftHip) return { aimAngle: 0, power: 0, confidence: 0, kneeLift: 0 };

    // Knee lift: how bent is the knee (for wind-up detection)
    var rightKneeAngle = kneeAngle(rightHip, rightKnee, rightAnkle);
    var leftKneeAngle = kneeAngle(leftHip, leftKnee, leftAnkle);
    var kneeLift = clamp((Math.PI - Math.min(rightKneeAngle, leftKneeAngle)) / Math.PI, 0, 1);

    // Power from foot velocity
    var velocity = footVelocity(buffer);
    var rawPower = clamp(velocity / C.AR.KICK_MAX_VELOCITY, 0, 1);
    var power = Math.pow(rawPower, C.AR.POWER_GAMMA);

    // Confidence from visibility
    var vis = (rightHip.visibility || 0) * (leftHip.visibility || 0);
    var confidence = Math.pow(vis, 0.5);

    return { aimAngle: 0, power: power, confidence: confidence, kneeLift: kneeLift };
  }

  // ── Smoothing ──────────────────────────────────────────────────────────
  function smooth(current, target, alpha) {
    return lerp(current, target, alpha);
  }

  global.ArMapping = {
    computeFootAim: computeFootAim,
    computeBodyLean: computeBodyLean,
    computeCombinedAim: computeCombinedAim,
    footVelocity: footVelocity,
    ankleVelocity: ankleVelocity,
    kneeAngle: kneeAngle,
    computeShot: computeShot,
    smooth: smooth,
    clamp: clamp
  };
})(typeof window !== 'undefined' ? window : globalThis);
