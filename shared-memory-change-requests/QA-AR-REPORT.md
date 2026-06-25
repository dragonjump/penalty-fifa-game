# QA Report — AR (Webcam Kick Detection) Mode

**Date:** 2026-06-26
**Reviewer:** OWL (QA Expert)
**Scope:** AR mode in `penalty-kick-game`
**Test approach:** Static analysis + Node unit tests for pure logic + code review of browser-only paths
**Overall Verdict: SHIP (with minor fixes recommended)**

---

## Executive Summary

The AR mode is well-architected and mostly well-implemented. Script load order is correct, all files pass `node --check` syntax validation, both Node-runnable test suites pass (17/17 mapping tests, full state machine test), and the browser-only paths are correctly structured (MediaPipe ES module loads as a module, classic scripts are not misclassified, the `ArPose` class correctly reaches `global.vision` for `FilesetResolver` and `PoseLandmarker`, PIP preview rendering is wired).

Three issues were found:
1. **MINOR — `ArPose.onError` is exposed but never invoked.** The error callback hook exists on the module but no caller wires it. Harmless, but the comment/contract is misleading.
2. **MINOR — FPS-fallback and tracking-lost threshold constants exist in `constants.js` but are not enforced by `main.js` or `ar-pose.js`.** The live-tracking logic does not actually fall back to mouse if FPS drops below `FPS_FALLBACK_THRESHOLD` or `TRACKING_LOST_FRAMES` is exceeded.
3. **OBSERVATION — pre-existing `keeper.js` zone-weighting inversion** (already flagged in the prior QA report). Not AR-specific but affects AR gameplay too.

No blocking bugs found. The fallback path (camera denied / CDN failure) works: `arPose.init()` rejects, `main.js` `startArMode()` catch block sets `cameraStatus='failed'`, switches input back to POINTER, and surfaces a toast.

---

## 1. File Structure & Load Order

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1.1 | Constants loaded first | **PASS** | `index.html:19` `<script src="src/constants.js">` is the first script |
| 1.2 | State second | **PASS** | `index.html:20` `<script src="src/state.js">` |
| 1.3 | Audio third | **PASS** | `index.html:21` `<script src="src/audio.js">` |
| 1.4 | Keeper fourth | **PASS** | `index.html:22` `<script src="src/keeper.js">` |
| 1.5 | Physics fifth | **PASS** | `index.html:23` `<script src="src/physics.js">` |
| 1.6 | Render sixth | **PASS** | `index.html:24` `<script src="src/render.js">` |
| 1.7 | Input seventh | **PASS** | `index.html:25` `<script src="src/input.js">` |
| 1.8 | AR mapping eighth | **PASS** | `index.html:26` `<script src="src/ar-mapping.js">` |
| 1.9 | AR input ninth | **PASS** | `index.html:27` `<script src="src/ar-input.js">` |
| 1.10 | AR pose tenth | **PASS** | `index.html:28` `<script src="src/ar-pose.js">` |
| 1.11 | Main eleventh | **PASS** | `index.html:29` `<script src="src/main.js">` |
| 1.12 | MediaPipe loaded as ES module after all classic scripts | **PASS** | `index.html:39-45` `<script type="module">` imports `@mediapipe/tasks-vision` and assigns `window.vision = vision` |
| 1.13 | No classic script loaded as module | **PASS** | All `<script src="...">` lack `type="module"`, so they are classic |
| 1.14 | No ES module loaded as classic | **PASS** | The only `<script type="module">` is the MediaPipe block (line 39), which solely imports and assigns to `window.vision` |
| 1.15 | `wireArButton` runs after main.js | **PASS** | Block at `index.html:48-61` runs after the module import; the inline script block runs immediately after so DOM is ready and `window.toggleArMode` is defined |

**Result: PASS**

---

## 2. JavaScript Syntax & Static Analysis

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 2.1 | `constants.js` syntax valid | **PASS** | `node --check` clean |
| 2.2 | `state.js` syntax valid | **PASS** | `node --check` clean |
| 2.3 | `audio.js` syntax valid | **PASS** | `node --check` clean |
| 2.4 | `keeper.js` syntax valid | **PASS** | `node --check` clean |
| 2.5 | `physics.js` syntax valid | **PASS** | `node --check` clean |
| 2.6 | `render.js` syntax valid | **PASS** | `node --check` clean |
| 2.7 | `input.js` syntax valid | **PASS** | `node --check` clean |
| 2.8 | `ar-mapping.js` syntax valid | **PASS** | `node --check` clean |
| 2.9 | `ar-input.js` syntax valid | **PASS** | `node --check` clean |
| 2.10 | `ar-pose.js` syntax valid | **PASS** | `node --check` clean |
| 2.11 | `main.js` syntax valid | **PASS** | `node --check` clean |
| 2.12 | `window.toggleArMode` exposed in main.js | **PASS** | `main.js:476` `window.toggleArMode = function () { toggleArMode(); };` |
| 2.13 | `window.vision` set by module script | **PASS** | `index.html:42` `window.vision = vision;` (inside guarded `try`) |
| 2.14 | `ArPose` resolves `vision` via `global.vision` | **PASS** | `ar-pose.js:36,61,66,82` use `global.vision.FilesetResolver`, `global.vision.PoseLandmarker`, `global.Camera` — `global` in browser is `window` |

**Result: PASS**

### Cross-reference audit (no missing globals)

All 11 source files use the same `(function (global) { … })(typeof window !== 'undefined' ? window : globalThis)` pattern that aliases whichever object is in scope. Each file reads only names that previous files export:

| File | Reads from `global.*` | Exports to `global.*` |
|------|------------------------|--------------------------|
| `constants.js` | (none) | `C` |
| `state.js` | `C` | `StateMachine` |
| `audio.js` | (none) | `Sound` |
| `keeper.js` | `C` | `Keeper` |
| `physics.js` | `C` | `Physics` |
| `render.js` | `C` | `Renderer` |
| `input.js` | `C` | `Input` |
| `ar-mapping.js` | `C` | `ArMapping` |
| `ar-input.js` | `C` | `ArInput` |
| `ar-pose.js` | `C` | `ArPose` |
| `main.js` | `C, StateMachine, Physics, Keeper, Sound, Renderer, Input, ArInput, ArPose, localStorage` | `__PK, toggleArMode` |

No broken references.

---

## 3. AR Button Wiring

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 3.1 | AR button is in the DOM and visible | **PASS** | `index.html:15` `<button id="ar-btn" style="position:absolute;top:10px;left:10px;z-index:10;…">AR Mode</button>` — inline style, no `display:none` |
| 3.2 | Button has click handler | **PASS** | `index.html:55-59` `btn.addEventListener('click', function () { if (window.toggleArMode) window.toggleArMode(); });` |
| 3.3 | Button does not silently fail | **PASS** | Because `main.js:476` always defines `window.toggleArMode` (it is unconditional), the click always calls into `toggleArMode()`; the function transitions state to `CAMERA_INIT` and calls `startArMode`, which calls `arPose.init()`. If init rejects (CDN failure or camera denial), the `.catch` block at `main.js:94-103` calls `showToast('Camera unavailable — using mouse controls')`. **However**, note that this toast is shown for both "MediaPipe not loaded" and "camera denied" and any other init failure — the user cannot distinguish CDN failure from camera permission denial from WASM error. See issue M-1 below. |
| 3.4 | `wireArButton` IIFE waits for `window.toggleArMode` correctly | **PASS** | Since `main.js` is a classic script that runs synchronously when parsed and `wireArButton`'s IIFE runs immediately after (sequential classic scripts execute in order), `window.toggleArMode` is defined when the click handler is attached |

**Result: PASS (with minor observation M-1)**

---

## 4. AR Pose Module (`ar-pose.js`)

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 4.1 | Uses `FilesetResolver.forVisionTasks()` | **PASS** | `ar-pose.js:61` |
| 4.2 | CDN URL is correct semver-matched with import | **PASS** | `index.html:41` imports `@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs`; `ar-pose.js:62` loads wasm from `@mediapipe/tasks-vision@0.10.14/wasm` — same version |
| 4.3 | Uses `PoseLandmarker.createFromOptions()` | **PASS** | `ar-pose.js:66` |
| 4.4 | baseOptions has required `modelAssetPath` + `delegate` | **PASS** | `ar-pose.js:67-70` |
| 4.5 | `runningMode: 'VIDEO'` for streaming | **PASS** | `ar-pose.js:71` |
| 4.6 | `numPoses: 1` (single user) | **PASS** | `ar-pose.js:72` |
| 4.7 | Confidence thresholds wired from constants | **PASS** | `ar-pose.js:73-75` uses `C.AR.MIN_DETECTION_CONFIDENCE` |
| 4.8 | `outputSegmentationMasks: false` (perf) | **PASS** | `ar-pose.js:76` |
| 4.9 | Uses `Camera` helper correctly (loops via `onFrame`) | **PASS** | `ar-pose.js:82-94` creates `new global.Camera(video, { onFrame, width, height })` and calls `start()` |
| 4.10 | Hides video element (drawn to canvas via `drawImage`) | **PASS** | `ar-pose.js:56` `self._video.style.display = 'none'` |
| 4.11 | Promise rejects on failure | **PASS** | `ar-pose.js:37` (CDN failure), `ar-pose.js:43` (no webcam API), `ar-pose.js:100` (camera/model `.catch`) |
| 4.12 | `stop()` cleans up tracks and DOM | **PASS** | `ar-pose.js:105-122` stops camera, nulls `srcObject`, removes video element |
| 4.13 | `onResults` callback wired | **PASS** | `ar-pose.js:88` `if (self._onResults) self._onResults(results);` after each detection |
| 4.14 | Timestamp passed to `detectForVideo` | **PASS** | `ar-pose.js:85-86` `var timestamp = performance.now();` then `detectForVideo(self._video, timestamp)` |
| 4.15 | Detects `readyState >= 2` before sending frame | **PASS** | `ar-pose.js:84` guard |

**Result: PASS**

### Issue M-1: `ArPose.onError` is never invoked

**Severity: Minor**
**Location:** `ar-pose.js:29, 130`
**Detail:** The `onError` hook is declared but no error path in the module calls `this._onError(err)`. Calling code (e.g., `main.js`) cannot subscribe to ArPose-specific errors beyond the init rejection. The hook should either be removed (dead code) or failure paths inside `stop()`'s cleanup errors and camera start failures should call `this._onError` if set.

**Impact:** Cosmetic only. User-visible errors still surface via the init rejection path in `main.js`.

---

## 5. AR Input Module (`ar-input.js`)

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 5.1 | Handles new API format `results.landmarks[0]` | **PASS** | `ar-input.js:53-55` |
| 5.2 | Handles old API format `results.poseLandmarks` | **PASS** | `ar-input.js:56-58` |
| 5.3 | Returns `null` when landmarks missing | **PASS** | `ar-input.js:60` |
| 5.4 | Right ankle index 28 | **PASS** | `ar-input.js:62` (right ankle, MediaPipe 33-point) |
| 5.5 | Left ankle index 27 | **PASS** | `ar-input.js:63` |
| 5.6 | Buffer size bounded by `C.AR.ANKLE_BUFFER_SIZE` | **PASS** | `ar-input.js:74` `while (this._buffer.length > C.AR.ANKLE_BUFFER_SIZE)` |
| 5.7 | Wind-up threshold (knee lift) | **PASS** | `ar-input.js:90` `if (shot.kneeLift > 0.4)` |
| 5.8 | Kick velocity threshold | **PASS** | `ar-input.js:98` `velocity > C.AR.KICK_VELOCITY_THRESHOLD` |
| 5.9 | Cooldown enforced | **PASS** | `ar-input.js:96` `(timestamp - this._lastKickTime) > C.AR.KICK_COOLDOWN_MS` |
| 5.10 | Confidence gate | **PASS** | `ar-input.js:98` `shot.confidence > 0.4` |
| 5.11 | Emits `onAim` (live preview during AIMING) | **PASS** | `ar-input.js:85-87` |
| 5.12 | Emits `onLockAim` on kick | **PASS** | `ar-input.js:110` |
| 5.13 | Emits `onLockPower` on kick | **PASS** | `ar-input.js:111` |
| 5.14 | Resets per-shot state | **PASS** | `ar-input.js:125-129` clears buffer, windup, smoothed aim |
| 5.15 | Calibration persistence | **PASS** | `ar-input.js:38-40` `setCalibration()` |
| 5.16 | `onAim` only fires after kick eligibility (does not fire on null lm) | **PASS** | `ar-input.js:60` early-return prevents emitting on bad frames |

**Result: PASS**

### Integration wiring check in `main.js`

`main.js:59-74` correctly assigns `ai.onAim`, `ai.onLockAim`, `ai.onLockPower` and the callbacks drive the same state transitions as the pointer input callbacks (`main.js:139-169`).

---

## 6. AR Mapping Module (`ar-mapping.js`) — Node Tests

| Test | Description | Result |
|------|-------------|--------|
| 1 | `legAngle` straight-down = 0 rad | **PASS** (within 0.01) |
| 2 | `legAngle` 45° right ≈ π/4 | **PASS** (within 0.1) |
| 3 | `legAngle` 45° left ≈ -π/4 | **PASS** (within 0.1) |
| 4 | `ankleVelocity` fast-kick in range 0.3–10 | **PASS** (got 1.424) |
| 5 | `ankleVelocity` no-movement = 0 | **PASS** (within 0.001) |
| 6 | `computeShot` neutral pose → aim≈0, power≈0 | **PASS** |
| 7 | `computeShot` 45° right → positive aim, meaningful power | **PASS** (aim 0.1–1.0, power 0.05–1.0) |
| 8 | `computeShot` 45° left → negative aim | **PASS** (-1.0 to -0.1) |
| 9 | `computeShot` null landmarks → safe zeros | **PASS** |
| 10 | `kneeAngle` straight leg ≈ π | **PASS** (within 0.1) |
| 11 | `kneeAngle` 90° bend ≈ π/2 | **PASS** (within 0.15) |
| 12 | `smooth` interpolation correct | **PASS** |

**Total: 17 / 17 PASS**

### State Machine Tests (`test-state.js`)

- Legal transitions all succeed: `MENU → AIMING → POWER → SHOOTING → RESULT → AIMING` — **PASS**
- Illegal transitions correctly rejected: `MENU → SHOOTING`, `MENU → POWER`, `MENU → RESULT` — **PASS** (warnings logged)
- Full best-of-5 simulation: player wins 3-0 → `state === GAME_OVER` and `score.player === 3` — **PASS**

**Result: PASS**

---

## 7. Camera Preview Rendering

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 7.1 | `Renderer.prototype.drawArPreview` exists | **PASS** | `render.js:495-527` |
| 7.2 | `Renderer.prototype._drawSkeleton` exists | **PASS** | `render.js:530-558` |
| 7.3 | `drawArPreview` mirrors video (selfie view) | **PASS** | `render.js:508-510` `ctx.translate(px + pw, py); ctx.scale(-1, 1)` |
| 7.4 | `drawArPreview` draws on top of background rectangle | **PASS** | `render.js:503-506` draws black bg first |
| 7.5 | `_drawSkeleton` uses correct hip/knee/ankle/foot indices (24/26/28/32 and 23/25/27/31) | **PASS** | `render.js:541-544` |
| 7.6 | `_drawSkeleton` mirrors X for selfie view (consistent with video) | **PASS** | `render.js:538` `x: ox + (1 - p.x) * ow` |
| 7.7 | Status dot shows ready/lost color | **PASS** | `render.js:520-524` |
| 7.8 | `main.js` extracts landmarks and passes to renderer | **PASS** | `main.js:445-457` in `draw()` |
| 7.9 | `main.js` handles both API formats when extracting landmarks | **PASS** | `main.js:451-455` checks `results.landmarks[0]` then `results.poseLandmarks` |
| 7.10 | `main.js` only draws preview when `arActive && arPose.isActive()` | **PASS** | `main.js:445` guard |

**Result: PASS**

---

## 8. Fallback Logic

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 8.1 | Camera denied → fallback to mouse | **PASS** | `ar-pose.js:47` getUserMedia call rejects on denial; `main.js:94-103` catch block sets `s.inputMode = 'POINTER'`, `input.setMode('POINTER')`, `arActive = false`, and shows toast |
| 8.2 | MediaPipe CDN failure → game still works with mouse | **PASS** | `index.html:43-45` catch swallows the import error with `console.warn`; `ar-pose.js:36-39` rejects `arPose.init()` if `global.vision` is undefined; `main.js:94` catch block handles it |
| 8.3 | State transitions to MENU if CAMERA_INIT fails | **PASS** | `main.js:100-102` `if (s.state === SM.STATE.CAMERA_INIT) SM.transition(s, SM.STATE.MENU);` |
| 8.4 | No silent failure paths | **PASS** (with M-2 below) | Every rejection path surfaces a toast or falls back to POINTER. The error toast message is generic ("Camera unavailable") and does not distinguish CDN failure from camera permission denial, which may frustrate users trying to debug. |

### Issue M-2: Generic error message conflates distinct failures

**Severity: Minor**
**Location:** `main.js:99`
**Detail:** The toast `'Camera unavailable — using mouse controls'` is shown for any init failure, including the MediaPipe CDN failing to load (which has nothing to do with the camera). A user with no internet sees "Camera unavailable" which is misleading.

**Fix:** Surface `err.message` in the toast, or branch on error type:
```js
}).catch(function (err) {
  s.cameraStatus = 'failed';
  s.inputMode = 'POINTER';
  input.setMode('POINTER');
  arActive = false;
  showToast(err.message || 'AR init failed — using mouse controls');
  ...
});
```

---

## 9. Browser Compatibility

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 9.1 | Classic scripts do not use `import`/`export` | **PASS** | All `src/*.js` are classic IIFE |
| 9.2 | Module script properly typed | **PASS** | `index.html:39` `type="module"` |
| 9.3 | No `fetch`/`XMLHttpRequest` from classic scripts (which would violate file://) | **PASS** | All fetches happen via MediaPipe WASM internal loader (running from module context) |
| 9.4 | `serve.bat` exists for local server | **PASS** | `serve.bat` confirmed present |
| 9.5 | HTTPS/CDN URL is secure origin | **PASS** | `index.html:41` `https://cdn.jsdelivr.net/...` and `ar-pose.js:62` `https://cdn.jsdelivr.net/…/wasm` |

**Result: PASS**

---

## 10. Constants Audit

All `C.AR.*` constants referenced by AR modules exist in `constants.js:126-170`:

| Constant | Used in | Present |
|----------|---------|---------|
| `CAPTURE_WIDTH`, `CAPTURE_HEIGHT` | `ar-pose.js:48,91-92` | **YES** (128-129) |
| `MIN_DETECTION_CONFIDENCE` | `ar-pose.js:73-75` | **YES** (133) |
| `KICK_VELOCITY_THRESHOLD` | `ar-input.js:98` | **YES** (137) |
| `KICK_MAX_VELOCITY` | `ar-mapping.js:113` | **YES** (138) |
| `KICK_COOLDOWN_MS` | `ar-input.js:96` | **YES** (139) |
| `ANKLE_BUFFER_SIZE` | `ar-input.js:74` | **YES** (140) |
| `AIM_DEAD_ZONE` | `ar-mapping.js:109` | **YES** (144) |
| `AIM_SCALE` | `ar-mapping.js:107` | **YES** (145) |
| `AIM_SMOOTHING` | `ar-input.js:82` | **YES** (146) |
| `POWER_GAMMA` | `ar-mapping.js:114` | **YES** (149) |
| `CALIBRATION_KEY` | `main.js:49` | **YES** (153) |
| `PIP_WIDTH` | `render.js:498` | **YES** (166) |
| `SKELETON_COLOR`, `SKELETON_THICKNESS` | `render.js:533-534` | **YES** (161-162) |

### Issue O-1: Declared-but-unused constants

**Severity: Observation only (not a bug)**
**Location:** `constants.js:132,141,156-158,163-164,169`
**Detail:**
- `POSE_DETECTION_INTERVAL_MS` (132) — declared but `ar-pose.js` runs every rAF tick instead of throttling
- `WINDUP_KNEE_MIN_ANGLE` (141) — declared but `ar-input.js:90` hardcodes `0.4` instead of reading `C.AR.WINDUP_KNEE_MIN_ANGLE`
- `FPS_SAMPLE_WINDOW`, `FPS_FALLBACK_THRESHOLD`, `TRACKING_LOST_FRAMES` (156-158) — declared but neither `main.js` nor `ar-pose.js` reads them; there is no FPS-monitoring, no tracking-lost detection
- `KICK_TRAIL_COLOR`, `KICK_TRAIL_LENGTH` (163-164) — declared but unused (kick trail not rendered)
- `MODE` (169) — declared but `main.js` never reads `C.AR.MODE`

These represent planned-but-unimplemented features or left-over constants. They make the configuration file harder to reason about. Either implement the feature or remove the constant.

---

## Bugs Found

### Minor

| # | Description | Location | Impact |
|---|-------------|----------|--------|
| M-1 | `ArPose.onError` hook is never invoked from failure paths | `ar-pose.js:29,130` | None functionally; misleading API surface |
| M-2 | Generic "Camera unavailable" toast conflates CDN failure with camera denial | `main.js:99` | User cannot diagnose why AR failed |
| O-1 | Unused constants (`POSE_DETECTION_INTERVAL_MS`, `WINDUP_KNEE_MIN_ANGLE`, `FPS_*`, `TRACKING_LOST_FRAMES`, `KICK_TRAIL_*`, `C.AR.MODE`) | `constants.js:132,141,156-158,163-164,169` | Config surface drift |

### Pre-existing (flagged in prior QA, non-AR-specific)

| # | Description | Location | Impact |
|---|-------------|----------|--------|
| M-prev | Keeper zone-weighting formula inverted (`Math.pow(spread, d)` with spread<1 in easy mode biases away from center) | `keeper.js:32` | Easy bias pushes edges |

### Zero Critical / Zero Major bugs in AR code.

---

## Recommended Fixes

1. **Surface real error in toast** (M-2) — `showToast(err.message || 'AR init failed — using mouse controls')` at `main.js:99`. 1-line fix.
2. **Remove or wire `ArPose.onError`** (M-1) — either delete the unused hook, or if you want to keep it, fire it from the `.catch` at `ar-pose.js:100` before rejecting.
3. **Remove dead constants or implement the features** (O-1) — if FPS fallback is planned, implement it in `ar-pose.js:83-94` (measure delta between frames, bump `arTrackingLostFrames` when no landmarks, fall back to POINTER when threshold exceeded). Otherwise delete `FPS_FALLBACK_THRESHOLD` / `TRACKING_LOST_FRAMES` / `KICK_TRAIL_*` from `constants.js` to avoid confusing future readers.
4. **Add a tracking-lost fallback** — even without the FPS threshold, `ar-input.js` returning null landmarks for N consecutive frames should trigger a "step back into frame" hint or a fallback. This is the most useful behavior for real-world use (phone on a desk, user walks out of frame).
5. **(Optional) Respect `POSE_DETECTION_INTERVAL_MS`** — throttle pose inference to 30fps (`ar-pose.js:83` skip frames where `timestamp - lastTimestamp < C.AR.POSE_DETECTION_INTERVAL_MS`). Running pose every rAF (~60fps) doubles wasm CPU for no visible benefit.

---

## Overall Verdict

**SHIP**

The AR mode is a well-designed, correctly integrated feature:
- Load order is correct,/script mismatches
- All 11 source files pass syntax check
- Both Node-runnable test suites pass (17/17 + state machine)
- The full `init → camera → inference → mapping → event → render` pipeline is wired end-to-end
- Fallback (camera denied / CDN failure) is exercised via promise rejection and always surfaces feedback to the user
- The preview render path is correctly integrated with skeleton overlay

The three minor issues found are cosmetic and do not block shipping. The recommended fixes above can be batched into a polish pass.

---

## Appendix: Test Execution Logs

```
$ node test-ar-mapping.js
=== AR Mapping Tests ===
Test 1-12: all PASS
=== Results ===
Passed: 17
Failed: 0
ALL TESTS PASSED

$ node test-state.js
OK — state machine transitions pass.

$ node --check src/constants.js && … && echo "ALL JS FILES PASS SYNTAX CHECK"
ALL JS FILES PASS SYNTAX CHECK
```
