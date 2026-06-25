/* =========================================================================
 * test-ar-mapping.js — Node unit tests for ar-mapping.js (pure functions).
 *
 * Run: node test-ar-mapping.js
 * ========================================================================= */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var sandbox = { console: console };
sandbox.window = sandbox;
sandbox.global = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path.join(__dirname, 'src', 'constants.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'src', 'ar-mapping.js'), 'utf8'), sandbox);

var ArMapping = sandbox.ArMapping;
var C = sandbox.global.C;

var passed = 0, failed = 0;

function assertClose(actual, expected, tolerance, msg) {
  if (Math.abs(actual - expected) <= tolerance) {
    passed++;
    console.log('  PASS: ' + msg);
  } else {
    failed++;
    console.log('  FAIL: ' + msg + ' (expected ' + expected.toFixed(4) + ', got ' + actual.toFixed(4) + ')');
  }
}

function assertRange(actual, min, max, msg) {
  if (actual >= min && actual <= max) {
    passed++;
    console.log('  PASS: ' + msg);
  } else {
    failed++;
    console.log('  FAIL: ' + msg + ' (expected [' + min + ', ' + max + '], got ' + actual + ')');
  }
}

function makeLandmarks() {
  var lm = [];
  for (var i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, visibility: 1 });
  return lm;
}

console.log('\n=== AR Mapping Tests ===\n');

// ── computeFootAim ────────────────────────────────────────────────────────
console.log('--- computeFootAim ---');

// Test 1: Neutral feet at hips → aim ≈ 0
console.log('Test 1: Neutral feet at hips');
var lm1 = makeLandmarks();
lm1[24] = { x: 0.4, y: 0.6, visibility: 1 };
lm1[23] = { x: 0.6, y: 0.6, visibility: 1 };
lm1[32] = { x: 0.4, y: 0.3, visibility: 1 };
lm1[31] = { x: 0.6, y: 0.3, visibility: 1 };
var fa1 = ArMapping.computeFootAim(lm1);
assertClose(fa1.aimAngle, 0, 0.05, 'Feet at hips → aim ≈ 0');

// Test 2: Right foot pulled left of hip → aim right (positive)
console.log('Test 2: Right foot pulled left of hip → aim right');
var lm2 = makeLandmarks();
lm2[24] = { x: 0.4, y: 0.6, visibility: 1 };
lm2[23] = { x: 0.6, y: 0.6, visibility: 1 };
lm2[32] = { x: 0.25, y: 0.3, visibility: 1 }; // foot far left of hip
lm2[31] = { x: 0.6, y: 0.3, visibility: 1 };
var fa2 = ArMapping.computeFootAim(lm2);
assertRange(fa2.aimAngle, 0.3, 1.0, 'Foot left of hip → positive aim');
console.log('  footSide:', fa2.footSide, fa2.footSide === 'right' ? '✓' : '✗');

// Test 3: Right foot pushed right of hip → aim left (negative)
console.log('Test 3: Right foot pushed right of hip → aim left');
var lm3 = makeLandmarks();
lm3[24] = { x: 0.4, y: 0.6, visibility: 1 };
lm3[23] = { x: 0.6, y: 0.6, visibility: 1 };
lm3[32] = { x: 0.55, y: 0.3, visibility: 1 }; // foot right of hip
lm3[31] = { x: 0.6, y: 0.3, visibility: 1 };
var fa3 = ArMapping.computeFootAim(lm3);
assertRange(fa3.aimAngle, -1.0, -0.1, 'Foot right of hip → negative aim');

// Test 4: Left foot pushed right of hip → aim right (positive)
console.log('Test 4: Left foot pushed right of hip → aim right');
var lm4 = makeLandmarks();
lm4[24] = { x: 0.4, y: 0.6, visibility: 1 };
lm4[23] = { x: 0.6, y: 0.6, visibility: 1 };
lm4[32] = { x: 0.4, y: 0.3, visibility: 1 };
lm4[31] = { x: 0.75, y: 0.3, visibility: 1 }; // left foot right of hip
var fa4 = ArMapping.computeFootAim(lm4);
assertRange(fa4.aimAngle, 0.3, 1.0, 'Left foot right of hip → positive aim');
console.log('  footSide:', fa4.footSide, fa4.footSide === 'left' ? '✓' : '✗');

// Test 5: Null landmarks → safe defaults
console.log('Test 5: Null landmarks');
var fa5 = ArMapping.computeFootAim(null);
assertClose(fa5.aimAngle, 0, 0.001, 'Null → aim = 0');

// ── computeBodyLean ───────────────────────────────────────────────────────
console.log('\n--- computeBodyLean ---');

// Test 6: Shoulders centered → lean ≈ 0
console.log('Test 6: Shoulders centered over hips');
var lm6 = makeLandmarks();
lm6[24] = { x: 0.4, y: 0.6, visibility: 1 };
lm6[23] = { x: 0.6, y: 0.6, visibility: 1 };
lm6[12] = { x: 0.38, y: 0.35, visibility: 1 };
lm6[11] = { x: 0.62, y: 0.35, visibility: 1 };
var bl6 = ArMapping.computeBodyLean(lm6);
assertClose(bl6.leanX, 0, 0.15, 'Symmetric shoulders → lean ≈ 0');

// Test 7: Shoulders shifted left → lean right (positive)
console.log('Test 7: Shoulders shifted left → lean right');
var lm7 = makeLandmarks();
lm7[24] = { x: 0.4, y: 0.6, visibility: 1 };
lm7[23] = { x: 0.6, y: 0.6, visibility: 1 };
lm7[12] = { x: 0.3, y: 0.35, visibility: 1 };
lm7[11] = { x: 0.55, y: 0.35, visibility: 1 };
var bl7 = ArMapping.computeBodyLean(lm7);
assertRange(bl7.leanX, 0.1, 1.0, 'Shoulders left → positive lean');

// Test 8: Shoulders shifted right → lean left (negative)
console.log('Test 8: Shoulders shifted right → lean left');
var lm8 = makeLandmarks();
lm8[24] = { x: 0.4, y: 0.6, visibility: 1 };
lm8[23] = { x: 0.6, y: 0.6, visibility: 1 };
lm8[12] = { x: 0.48, y: 0.35, visibility: 1 };
lm8[11] = { x: 0.65, y: 0.35, visibility: 1 };
var bl8 = ArMapping.computeBodyLean(lm8);
assertRange(bl8.leanX, -1.0, -0.1, 'Shoulders right → negative lean');

// ── computeCombinedAim ────────────────────────────────────────────────────
console.log('\n--- computeCombinedAim ---');

// Test 9: Foot left + shoulders left → strong right aim
console.log('Test 9: Foot left + shoulders left → strong right aim');
var lm9 = makeLandmarks();
lm9[24] = { x: 0.4, y: 0.6, visibility: 1 };
lm9[23] = { x: 0.6, y: 0.6, visibility: 1 };
lm9[12] = { x: 0.3, y: 0.35, visibility: 1 };
lm9[11] = { x: 0.55, y: 0.35, visibility: 1 };
lm9[32] = { x: 0.25, y: 0.3, visibility: 1 };
lm9[31] = { x: 0.6, y: 0.3, visibility: 1 };
var c9 = ArMapping.computeCombinedAim(lm9);
assertRange(c9.aimAngle, 0.1, 1.0, 'Combined: foot + body both left → positive');

// Test 10: Null landmarks
console.log('Test 10: Null landmarks');
var c10 = ArMapping.computeCombinedAim(null);
assertClose(c10.aimAngle, 0, 0.001, 'Null → aim = 0');

// ── footVelocity ──────────────────────────────────────────────────────────
console.log('\n--- footVelocity ---');

// Test 11: Fast foot movement
console.log('Test 11: Fast foot movement');
var buf11 = [];
for (var i = 0; i < 8; i++) {
  buf11.push({
    rightFoot: { x: 0.4 - i * 0.03, y: 0.3 },
    leftFoot: { x: 0.6, y: 0.3 },
    right: { x: 0.4 - i * 0.02, y: 0.35 },
    left: { x: 0.6, y: 0.35 },
    t: i * 16
  });
}
var fv11 = ArMapping.footVelocity(buf11);
assertRange(fv11, 0.5, 5.0, 'Fast foot velocity is positive');

// Test 12: No movement
console.log('Test 12: No movement');
var buf12 = [
  { rightFoot: { x: 0.4, y: 0.3 }, leftFoot: { x: 0.6, y: 0.3 }, t: 0 },
  { rightFoot: { x: 0.4, y: 0.3 }, leftFoot: { x: 0.6, y: 0.3 }, t: 100 }
];
assertClose(ArMapping.footVelocity(buf12), 0, 0.001, 'No movement → 0');

// ── kneeAngle ─────────────────────────────────────────────────────────────
console.log('\n--- kneeAngle ---');

// Test 13: Straight leg ≈ π
console.log('Test 13: Straight leg');
var ka13 = ArMapping.kneeAngle({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.4 }, { x: 0.5, y: 0.3 });
assertClose(ka13, Math.PI, 0.1, 'Straight leg ≈ π');

// Test 14: 90° bend
console.log('Test 14: 90° bend');
var ka14 = ArMapping.kneeAngle({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.4 }, { x: 0.6, y: 0.4 });
assertClose(ka14, Math.PI / 2, 0.15, '90° bend ≈ π/2');

// ── smooth ────────────────────────────────────────────────────────────────
console.log('\n--- smooth ---');

// Test 15: Basic interpolation
console.log('Test 15: smooth interpolation');
assertClose(ArMapping.smooth(0, 1, 0.3), 0.3, 0.001, 'smooth(0,1,0.3)=0.3');
assertClose(ArMapping.smooth(0.5, 1, 0.5), 0.75, 0.001, 'smooth(0.5,1,0.5)=0.75');

// ── Summary ----------------------------------------------------------------
console.log('\n=== Results ===');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) {
  console.log('\nSOME TESTS FAILED');
  process.exit(1);
} else {
  console.log('\nALL TESTS PASSED');
  process.exit(0);
}
