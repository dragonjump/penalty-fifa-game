# QA Plan — AR Webcam Kick-Detection Feature

## Scope

This QA plan covers the AR enhancement to the existing penalty kick stickman game: webcam-based kick detection using MediaPipe Pose, mapping leg direction to virtual ball aim and kick motion speed to power, with graceful fallback to mouse/touch when the camera or model is unavailable.

The existing game has one automated test (`test-state.js`) that verifies state-machine transitions in Node by loading `constants.js` and `state.js` into a `vm` sandbox. The AR feature will not have that luxury — it runs in a browser, depends on a camera, and loads a WASM model. Most of the testability strategy below is about recovering from that constraint.

---

## 1. Testability of AR Features

**The core problem:** MediaPipe Pose needs a real camera, a loaded WASM model, and a browser. None of those exist in CI. The existing `test-state.js` pattern (load JS files into a Node `vm` sandbox and assert) cannot work for the AR module because the AR module will call `navigator.mediaDevices.getUserMedia`, `fetch` to load the model, and browser-only globals.

### Mock strategies

**a) Dependency-injected camera access.** The AR module must not call `getUserMedia` directly. Instead it receives a "camera" object with a `getFrame()` method returning a video frame (or a synthetic image). In production the camera object wraps a `<video>` element fed by `getUserMedia`. In tests it returns a pre-recorded frame or a synthetic stickman rendered to an offscreen canvas.

**b) Synthetic pose data.** MediaPipe Pose returns a normalized 33-landmark array. The AR module must accept pose data through a function interface, not by calling MediaPipe directly. In tests, feed it hand-crafted landmark arrays:
```js
// Synthetic: leg pointing 45° right, hip at (0.5, 0.7) normalized
const pose = zeroedLandmarks();
pose[23] = { x: 0.5, y: 0.7, visibility: 1 };  // left hip
pose[25] = { x: 0.55, y:0.55, visibility: 1 }; // left knee — 45° out
pose[27] = { x: 0.58, y:0.40, visibility: 1 }; // left ankle — extended
```

**c) Headless browser smoke tests.** Use Playwright (Chromium only, since Firefox and Safari have no real webcam pipeline) with `--use-file-for-fake-video-capture` to feed a pre-recorded webcam stream. This is the only test that exercises the full pipeline end-to-end and should be run manually before release, not in CI.

**d) Node-runnable unit tests for pure functions.** The pose→angle math, the velocity estimator, and the aim/power clamp logic are all pure functions. Extract them into a `pose-math.js` module with no browser dependencies and test them in Node the same way `test-state.js` tests the state machine.

### What to extract for testability

The AR feature should be split into at least two modules:
- `pose-math.js` — pure functions: `landmarksToLegAngle(pose)`, `kickVelocity(poseHistory)`, `clampShotParams(angle, power)`. No browser deps. Node-testable.
- `ar-controller.js` — browser-only: camera access, MediaPipe WASM loader, frame loop. Thin wrapper that calls `pose-math.js`.

This split mirrors the existing architecture's pattern: `physics.js` is pure and could be Node-tested; `render.js` is browser-only and is not tested. Apply the same split.

---

## 2. Pose → Shot Mapping Verification

The mapping from leg pose to shot parameters is the heart of the feature. It must be verified with deterministic test vectors.

### Test vectors for `landmarksToLegAngle`

MediaPipe landmarks use normalized coordinates (0–1, y-down). The kicker faces the camera (their right leg is on the left of the frame). Test vectors:

| Scenario | Landmarks (hip, knee, ankle) | Expected aimAngle | Notes |
|---|---|---|---|
| Straight kick (0°) | hip (0.5, 0.7), knee (0.5, 0.55), ankle (0.5, 0.40) | ≈ 0.0 rad | Leg points straight up in image = straight ahead in game |
| 45° right kick | hip (0.5, 0.7), knee (0.58, 0.55), ankle (0.66, 0.40) | ≈ +0.7 rad | Knee and ankle displaced right in image |
| 45° left kick | hip (0.5, 0.7), knee (0.42, 0.55), ankle (0.34, 0.40) | ≈ −0.7 rad | Mirror of above |
| Kick at −75° (max left) | hip (0.5, 0.7), knee (0.20, 0.55), ankle (0.05, 0.45) | ≈ −1.3 rad | Near `AIM_MIN_ANGLE` boundary |
| Kick at +75° (max right) | hip (0.5, 0.7), knee (0.80, 0.55), ankle (0.95, 0.45) | ≈ +1.3 rad | Near `AIM_MAX_ANGLE` boundary |

Tolerance: ±0.05 rad on angle (≈ 3°). This is tight enough to catch sign-flip bugs (a common MediaPipe gotcha — the pose is mirrored for the subject).

### Test vectors for power mapping

Power is derived from the peak angular velocity of the kicking leg during the kick window. Test with synthetic pose histories (arrays of poses at known timestamps):

| Scenario | Pose sequence | Expected power | Notes |
|---|---|---|---|
| Fast kick | Leg swings from rest to full extension in 120ms | ≈ 0.8–1.0 | High angular velocity |
| Slow kick | Leg swings from rest to full extension in 400ms | ≈ 0.2–0.4 | Low angular velocity |
| No kick (idle) | Static standing poses for 500ms | 0 (no shot fired) | Guard: do not fire without motion threshold |
| Half kick (decoy) | Leg extends then retracts | 0 (no shot fired) | Guard: do not fire on retraction |

### End-to-end mapping test

Feed a synthetic pose history into the full `ar-controller` (with camera and MediaPipe mocked) and assert the resulting `s.aimAngle` and `s.power` match expected values. This is the integration test that catches bugs where the angle is correct but the sign is flipped, or power is correct but applied to the wrong shot.

---

## 3. Fallback Verification

The game must fall back to mouse/touch input when:
1. User denies camera permission (`NotAllowedError`)
2. No camera found (`NotFoundError`)
3. MediaPipe WASM model fails to load (network error)
4. Model loads but produces no poses for >2 seconds (tracking lost)
5. Browser does not support `getUserMedia` at all

### How to test each

**1–2 (permission denied / no camera):** In Playwright, use `page.grantPermissions([], { origin: '...' })` to deny camera, or use a device descriptor with no camera. Assert:
- The game state transitions to AIMING (not stuck on a loading spinner)
- Mouse drag on the canvas adjusts aim angle (the existing `input.js` path works)
- No console errors from the AR module

**3 (model load failure):** Intercept the model fetch with `page.route('**/pose_model/**', route => route.abort())`. Assert:
- A user-visible message appears ("Camera unavailable — using mouse") within 3 seconds
- The game is fully playable via mouse

**4 (tracking lost):** Feed a Playwright video stream with 3 seconds of no-person footage mid-game. Assert:
- The game does not crash
- After 2 seconds of no poses, a "show your leg" hint appears
- When the person reappears, tracking resumes

**5 (no browser support):** Test on a browser/device that lacks `getUserMedia` (older Safari, embedded webviews). Assert the game loads and is playable with touch.

### State-machine fallback test

Add a new state or flag to the state machine: `inputMode: 'camera' | 'mouse'`. When the AR module fails, it sets `inputMode = 'mouse'` and the existing `input.js` takes over. Test this transition in Node:
```js
assert.strictEqual(s.inputMode, 'camera', 'starts in camera mode');
arController.simulateFailure();
assert.strictEqual(s.inputMode, 'mouse', 'falls back to mouse');
assert.ok(SM.canTransition(s, SM.STATE.AIMING), 'can still aim after fallback');
```

---

## 4. Performance Testing

### Target metrics

| Metric | Minimum acceptable | Ideal |
|---|---|---|
| Frame rate (canvas render) | 30 fps | 60 fps |
| Pose inference latency | < 33 ms per frame (so it does not block 30 fps) | < 16 ms |
| End-to-end kick-to-shot latency | < 200 ms from leg extension to virtual ball launch | < 100 ms |
| Memory usage | < 500 MB (MediaPipe WASM can balloon) | < 300 MB |
| First-shot readiness | < 5 seconds from page load to first playable shot | < 3 seconds |

### How to collect metrics

- **Frame rate:** Use `performance.now()` timestamps in the rAF loop (the existing `frame()` function already tracks `dt`). Log average fps over a 5-second window to `window.__PK.fps`.
- **Pose latency:** Wrap the MediaPipe callback and measure `performance.now()` delta between frame submission and result.
- **End-to-end latency:** Instrument the frame where the kick is detected vs. the frame where `fireShot()` is called. Log to console in dev mode.
- **Memory:** `performance.memory` (Chrome only) or manual sampling via DevTools. Not automatable in CI; manual check before release.

### Headless performance test

Run the game in Playwright with a synthetic video stream for 30 seconds and collect `window.__PK.fps`. Assert average ≥ 30. This can run in CI.

### Real-device performance test

Run on a representative low-end laptop (4GB RAM, no dedicated GPU) with the built-in webcam. Play 10 shots. Verify no visible lag between leg movement and virtual ball response. This is a manual test.

---

## 5. User Experience Testing

### The "wow" factor playtest

The goal is to surprise the business and product team. A playtest protocol:

1. **Recruit 5 people** who have never seen the game. Ideally a mix of soccer fans and non-fans, ages 16–40.
2. **Zero instructions.** Do not explain the AR feature. Just say "play the game." Observe:
   - Do they discover the webcam on their own? (The game should prompt for camera permission on first interaction.)
   - Do they understand that their real leg controls the virtual ball? (Measure time-to-discovery.)
   - Do they smile, laugh, or say something positive? (Subjective, but the business doc is right that this matters.)
3. **After 5 shots, ask:**
   - "Did you feel like your kick controlled the ball?" (Agency)
   - "Was the ball going where you expected?" (Mapping accuracy)
   - "Did you notice any lag?" (Latency perception)
   - "Would you show this to a friend?" (The real "wow" test)

### Quantitative UX metrics

- **Time to first kick:** From "Tap to start" to the first virtual ball launch. Target: < 10 seconds.
- **Kick success rate:** Of 10 intentional kicks, how many produce a virtual shot? Target: ≥ 9/10.
- **Direction accuracy:** When the player aims at the left corner, does the ball go within the left third of the goal? Target: ≥ 80%.
- **Power accuracy:** When the player kicks softly, does the ball land in the goal (not fall short)? When they kick hard, does it sail over? Target: ≥ 70% (power is harder to control than direction).

### What a playtest does NOT reveal

- Long-term retention. Playtests are single-session. The D1 retention metric from the business doc requires instrumentation and days of data, not a playtest.

---

## 6. Cross-Browser / Device Testing

### Matrix

| Browser | Camera | MediaPipe WASM | Priority |
|---|---|---|---|
| Chrome 120+ (desktop) | Yes | Yes | P0 — primary target |
| Edge 120+ (desktop) | Yes | Yes | P0 — same engine as Chrome |
| Firefox 120+ (desktop) | Yes | Yes | P1 — getUserMedia works, WASM should work |
| Safari 17+ (macOS) | Yes | Yes | P1 — stricter autoplay, test audio |
| Chrome (Android) | Yes | Yes | P0 — primary mobile target |
| Safari (iOS 17+) | Yes | Yes | P0 — getUserMedia requires HTTPS, no file:// |

### Known cross-browser risks

- **Safari iOS:** `getUserMedia` requires HTTPS. The game will be hosted on itch.io or GitHub Pages (both HTTPS), so this is fine for release but breaks during local development. Test on a tunneling service (ngrok, Cloudflare Tunnel) or use `localhost` which Safari treats as secure.
- **Safari macOS:** Stricter on autoplay. The existing `audio.js` already handles this with `unlock()` on first gesture. The AR feature should reuse that pattern.
- **Firefox:** MediaPipe Pose uses WASM SIMD, which is enabled by default in Firefox since v118. Test on the oldest Firefox version you can install.
- **Mobile Chrome (Android):** Camera permission prompt is persistent — if denied once, the user has to go to site settings. The fallback path must be clearly communicated.
- **Low-end Android devices:** MediaPipe Pose may run at 10–15 fps on a cheap phone. The game should drop to 15 fps pose inference and interpolate, not block the render loop.

### How to test without a device lab

- Use Playwright with `--use-file-for-fake-video-capture` for Chromium-based browsers (Chrome, Edge, mobile Chrome emulation).
- Use BrowserStack or a similar service for real Safari and real iOS if budget allows. Otherwise, borrow a Mac and an iPhone for one day.
- For Android, use Chrome DevTools device emulation + a real Android phone connected via ADB with `adb forward` for camera.

---

## 7. Edge Cases to Test

### Multiple people in frame
- Two people visible, one kicks. The AR module should track the largest/closest person (highest confidence or largest bounding box). Test: feed a frame with two stickmen, assert the kicker is tracked and the bystander is ignored.
- Both people kick simultaneously. Test: assert only one shot is fired (debounce).

### Poor lighting
- Dark room (under 50 lux). MediaPipe confidence drops. Test: feed low-brightness synthetic frames, assert the module reports low confidence and either retries or falls back.
- Backlit subject (window behind the person). Test: feed high-contrast frames, assert tracking does not lock onto the background.

### Partial occlusion
- Person from waist up only (sitting). MediaPipe can still detect upper body but not legs. Test: assert the module detects "no leg visible" and falls back to mouse.
- Leg occluded by furniture. Test: same as above.

### Fast kicks
- Leg extension in < 80 ms (a real "blast"). Test: assert the velocity estimator does not overflow or produce NaN. Power should clamp to 1.0, not exceed it.

### Slow kicks
- Leg extension in > 500 ms (a slow push). Test: assert the kick detector does not fire (it should require a minimum velocity threshold, not just leg extension).

### No kick detected
- Person stands still for 10 seconds. Test: assert no shot is fired, no error thrown, the game remains in a ready state.
- Person waves their arms (no leg movement). Test: assert the arm motion does not trigger a shot.

### Model load race condition
- User clicks "Play" before the MediaPipe model finishes loading. Test: assert the game shows a loading indicator and does not crash. When the model loads, the game transitions to the camera prompt.

### Camera disconnect mid-game
- User unplugs the webcam during a shot. Test: assert the game falls back to mouse input and displays a "camera disconnected" message.

### Tab backgrounded during play
- User switches tabs, then returns. Test: assert the rAF loop pauses (it does, the browser does this) and resumes without a large dt spike. The existing `dt = Math.min(48, t - lastT)` already handles this.

---

## 8. Biggest QA Risk

**Pose tracking silently degrades without the user knowing.**

This is the risk most likely to be missed because:
- It does not manifest as a crash or an error in the console.
- The game still "works" — the user can still kick — but the tracking is jittery, the aim is off by 20°, and the power is inconsistent.
- The user blames themselves ("I'm doing it wrong") rather than the game.
- It only happens in specific conditions: low light, certain clothing (loose pants that obscure the knee), sitting too far from the camera.

**Why it is missed:** The developer tests in a well-lit room with good contrast and a clear view of their leg. The fallback threshold (e.g., "if confidence < 0.5 for 2 seconds, show a hint") is set based on the developer's environment and looks fine in testing.

**Mitigation:**
- Add a real-time confidence indicator to the AR overlay (e.g., a green/yellow/red dot showing tracking quality). This is a UX feature and a QA tool.
- Log confidence values during playtests. If average confidence is below 0.7, the tracking is marginal and the user experience will be bad.
- Set the fallback threshold aggressively: if confidence is below 0.6 for more than 1 second, show a "step closer to the camera" or "ensure your leg is visible" hint. Better to fall back to mouse than to deliver a bad AR experience.
- Test in a dimly lit room, with the subject wearing loose clothing, and sitting 2 meters from the camera. If the game is not playable in those conditions, the fallback must trigger.

---

## Replies

No `architect-ar.md` or `dev-ar.md` found yet. Once those files are written, I will append replies. Anticipated points of agreement/disagreement based on the existing `ar-enhancement-context.md`:

- Will agree with the architect (when appointed) that the AR module must be a separate file loaded after `main.js`, not inlined into an existing module. The existing module boundaries (pure functions in `physics.js`, browser-only in `render.js`) support this.
- Will agree with the dev lead (when appointed) that the pose→shot mapping must be tunable at runtime (not hard-coded constants) so the feel can be adjusted without a redeploy. Suggest adding a `tuning` object to `constants.js` with `angleScale`, `velocityScale`, `minKickVelocity`, and `confidenceThreshold`.
- Will push back if either role suggests testing the AR feature only in CI with a fake camera. The fake-camera test catches integration bugs but not tracking-quality bugs. A manual playtest with a real camera is non-negotiable for this feature.
