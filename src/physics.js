/* =========================================================================
 * physics.js — parametric Bezier trajectory for the ball.
 *
 * The flight has a fixed duration (C.BALL_FLIGHT_MS). Power controls the
 * height of the arc (larger power = higher peak) but NOT the duration,
 * which keeps timing predictable for the keeper and the player.
 *
 * The trajectory is a quadratic Bezier defined by:
 *   P0 = start position (at the kicker's foot)
 *   P1 = control point — offset from the straight line by `lift`
 *   P2 = end position  (aimed target, optionally inside goal)
 *
 * A horizontal curve is added so corner shots can bend slightly, giving
 * visual flair without a real physics integrator.
 * ========================================================================= */
(function (global) {
  'use strict';

  var C = global.C;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // Compute launch parameters for a shot.
  //   angle: radians, 0 = straight up, + = right, - = left
  //   power: 0..1 normalized
  // Returns { start, control, end, targetX, targetY }.
  function computeLaunch(angle, power) {
    var startX = C.BALL_START_X;
    var startY = C.BALL_START_Y;

    // Target on the goal line, at full aim range when power is mid.
    var aimRange = (C.GOAL_WIDTH * 0.5) * 0.98; // a hair inside the posts
    var targetX = C.GOAL_CENTER_X + Math.sin(angle) * aimRange;
    // Power pushes the target deeper (toward goal line) but also can overshoot
    // the goal line when power is very high — we map it onto the goal plane.
    var targetY = C.GOAL_BOTTOM_Y - 2; // on the goal line

    // If power is low, ball falls short (short of goal line).
    // If power is very high, ball sails over the bar.
    var lift = 30 + power * 110;       // arc peak height above straight line
    var midX = (startX + targetX) / 2;
    var midY = Math.min(startY, targetY) - lift;

    // Control point: pull the arc toward the aim direction for curve feel.
    var controlX = midX + Math.sin(angle) * 18;
    var controlY = midY;

    return {
      start: { x: startX, y: startY },
      control: { x: controlX, y: controlY },
      end: { x: targetX, y: targetY },
      targetX: clamp(targetX, C.GOAL_LEFT_X - 8, C.GOAL_RIGHT_X + 8),
      targetY: targetY
    };
  }

  // Evaluate a quadratic Bezier at t.
  function bezier(p0, p1, p2, t) {
    var u = 1 - t;
    var x = u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x;
    var y = u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y;
    return { x: x, y: y };
  }

  // Given power, does the shot sail over the bar? Deterministic: compare the
  // Bezier peak (control point y) against the goal top edge. High power lifts
  // the control point; if it clears the bar by a margin, the shot is over.
  function isOverBar(launch, power) {
    // Peak of the quadratic Bezier is approximately at the control point.
    var peakY = launch.control.y;
    var barY = C.GOAL_TOP_Y;
    // Margin: a little overshoot still counts as a goal; only clear over-the-bar
    // counts as a miss. The threshold scales slightly with power because high
    // power balls travel higher overall.
    var margin = 12 + power * 8;
    return peakY < barY - margin;
  }

  // Is the target inside the posts (horizontal only)?
  function isOnTarget(targetX) {
    return targetX > C.GOAL_LEFT_X + 2 && targetX < C.GOAL_RIGHT_X - 2;
  }

  // Build a path sample array for the renderer's trail & future collision.
  function samplePath(launch, steps) {
    steps = steps || 24;
    var arr = [];
    for (var i = 0; i <= steps; i++) {
      arr.push(bezier(launch.start, launch.control, launch.end, i / steps));
    }
    return arr;
  }

  global.Physics = {
    computeLaunch: computeLaunch,
    bezier: bezier,
    isOverBar: isOverBar,
    isOnTarget: isOnTarget,
    samplePath: samplePath
  };
})(typeof window !== 'undefined' ? window : globalThis);
