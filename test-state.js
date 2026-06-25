/* Node-runnable state-machine sanity test.
 * Verifies the transition table permits a full best-of-5 shootout and
 * rejects illegal transitions. No deps, no build step:
 *     node test-state.js
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

// Load constants + state into a shared sandbox that mimics `window`.
var sandbox = { console: console, performance: { now: function () { return Date.now(); } } };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.global = sandbox;
var ctx = vm.createContext(sandbox);

function load(file) {
  var code = fs.readFileSync(path.join(__dirname, 'src', file), 'utf8');
  vm.runInContext(code, ctx, { filename: file });
}

load('constants.js');
load('state.js');

var SM = sandbox.StateMachine;
var s = SM.createInitialState();
var assert = require('assert');

// All legal transitions should succeed.
assert.ok(SM.transition(s, SM.STATE.AIMING), 'MENU → AIMING');
assert.ok(SM.transition(s, SM.STATE.POWER),  'AIMING → POWER');
assert.ok(SM.transition(s, SM.STATE.SHOOTING), 'POWER → SHOOTING');
assert.ok(SM.transition(s, SM.STATE.RESULT), 'SHOOTING → RESULT');
assert.ok(SM.transition(s, SM.STATE.AIMING), 'RESULT → AIMING (next shot)');

// Illegal transitions should fail.
var s2 = SM.createInitialState();
assert.ok(!SM.transition(s2, SM.STATE.SHOOTING), 'MENU → SHOOTING is illegal');
assert.ok(!SM.transition(s2, SM.STATE.POWER), 'MENU → POWER is illegal');
assert.ok(!SM.transition(s2, SM.STATE.RESULT), 'MENU → RESULT is illegal');

// Simulate a full best-of-5: player wins 3-0.
// The transition table lets RESULT → AIMING for next round, then the
// match-ending check fires when entering RESULT with a clinched score.
s = SM.createInitialState();
SM.transition(s, SM.STATE.AIMING);
for (var i = 0; i < 3; i++) {
  SM.transition(s, SM.STATE.POWER);
  SM.transition(s, SM.STATE.SHOOTING);
  s.result = 'goal';
  s.score.player++;
  // The state machine itself doesn't enforce score-based endings — that's
  // handled by main.js. Here we just verify the transition table permits
  // RESULT → GAME_OVER for clinched matches.
  assert.ok(SM.canTransition(SM.STATE.RESULT, SM.STATE.GAME_OVER),
            'RESULT → GAME_OVER is a legal transition');
  SM.transition(s, SM.STATE.RESULT);
  if (s.score.player >= 3) {
    SM.transition(s, SM.STATE.GAME_OVER);
    break;
  }
  SM.transition(s, SM.STATE.AIMING);
}
assert.strictEqual(s.state, SM.STATE.GAME_OVER, 'best-of ends at majority');
assert.strictEqual(s.score.player, 3, 'player clinched 3');

console.log('OK — state machine transitions pass.');
