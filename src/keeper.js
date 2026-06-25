/* =========================================================================
 * keeper.js — keeper AI.
 *
 * Per-shot: on reset() the keeper decides which of the 5 horizontal zones
 * to dive to and how long to wait before committing (reaction delay).
 * Difficulty scales reaction delay, dive spread (bias toward center),
 * horizontal reach, and a small miss chance.
 *
 * The keeper does NOT read the player's aim — it commits to a random
 * choice, which keeps it beatable and prevents exploitation.
 * ========================================================================= */
(function (global) {
  'use strict';

  var C = global.C;

  // A dive decision.
  //   zone      0..4   index of horizontal zone within goal
  //   diveX     target x (logical px) the keeper's hands reach toward
  //   reactionMs delay before dive begins after shot released
  function decide(difficulty) {
    var profile = C.DIFFICULTY[difficulty] || C.DIFFICULTY[C.DEFAULT_DIFFICULTY];

    // Zone distribution: weighted toward center by `spread`.
    var weights = [];
    var total = 0;
    for (var i = 0; i < C.KEEPER_ZONES; i++) {
      // Distance from center zone (zone 2).
      var d = Math.abs(i - (C.KEEPER_ZONES - 1) / 2);
      // Higher spread = flatter distribution (more center bias).
      // d=0 (center) gets weight 1; outer zones get progressively less.
      var w = Math.pow(profile.spread, d);
      weights.push(w);
      total += w;
    }
    var r = Math.random() * total;
    var zone = 0;
    for (var k = 0; k < weights.length; k++) {
      r -= weights[k];
      if (r <= 0) { zone = k; break; }
    }

    // Compute target x for the chosen zone.
    var usableW = C.GOAL_WIDTH - C.KEEPER_ZONE_PADDING * 2;
    var zoneW = usableW / C.KEEPER_ZONES;
    var zoneCenter = C.GOAL_LEFT_X + C.KEEPER_ZONE_PADDING + zoneW * (zone + 0.5);
    // Small jitter inside the zone so keeper doesn't always center it.
    var jitter = (Math.random() - 0.5) * zoneW * 0.55;
    var diveX = zoneCenter + jitter;

    // Reaction delay with a little randomness.
    var reactionMs = profile.reactionMs + (Math.random() - 0.5) * 60;

    // Reach: keeper can stretch further on easier difficulties it's scaled down.
    var reach = profile.reach;

    return {
      zone: zone,
      diveX: diveX,
      reactionMs: reactionMs,
      reach: reach,
      missChance: profile.missChance
    };
  }

  // Given the dive decision and the ball's eventual target x, did the keeper
  // reach the ball? Returns true if saved. Includes miss chance (a "fumble"
  // where the keeper guesses right but flubs it anyway — keeps it human).
  function reaches(decision, ballTargetX, keeperX, keeperY, ballY) {
    // Horizontal reach from keeper center to hands at full dive.
    var reachX = (C.KEEPER_LIMB_LEN + C.KEEPER_TORSO_LEN * 0.5) * decision.reach;
    var dx = Math.abs(ballTargetX - decision.diveX);
    var savedHorizontally = dx < reachX + C.BALL_RADIUS * 0.5;
    // Vertical: keeper can cover most of the goal but not the very top corner
    // if dive direction is wrong. We approximate by checking ball Y vs keeper Y.
    var dy = ballY - keeperY;
    var savedVertically = dy > -C.KEEPER_TORSO_LEN * 0.85 && dy < C.KEEPER_LIMB_LEN * 0.4;

    var saved = savedHorizontally && savedVertically;
    // Miss chance: even if "saved" by geometry, small fumble probability.
    if (saved && Math.random() < decision.missChance) return false;
    return saved;
  }

  global.Keeper = {
    decide: decide,
    reaches: reaches
  };
})(typeof window !== 'undefined' ? window : globalThis);
