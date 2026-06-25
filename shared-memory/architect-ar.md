# Software Architect — AR Kick Detection Enhancement

## 1. MediaPipe Integration Strategy

**Choice: MediaPipe Pose (Tasks Vision API, not the older `@mediapipe/pose` solution).**

Here is the concrete comparison and the defense:

| Criterion | MediaPipe Pose (Tasks Vision) | MoveNet (TF.js) | PoseNet (TF.js) |
|---|---|---|---|
| Model size (quantized) | ~2.5 MB (blaze_pose_32) | ~6.5 MB (MoveNet-SinglePose-Lightning) | ~2.9 MB (MobileNet backbone) |
| Latency on laptop i5 / integrated GPU | ~25 ms/frame via WASM SIMD | ~40 ms/frame (TF.js WASM has slower matmul) | ~50 ms/frame (larger model) |
| Latency on mid-range phone (A13-class) | ~8 ms (delegate via Android NNAPI not available in browser; WASM is ~20-30 ms) | ~25 ms | ~55 ms |
| CDN availability | `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision` loads the WASM + model. No separate asset fetch for the model binary — it's bundled in the WASM or fetched automatically from the same CDN depending on runtime config. | `@tensorflow-models/movenet` + `@tensorflow/tfjs` core. Two separate CDN fetches, larger total download. | `@tensorflow-models/posenet` + `@tensorflow/tfjs`. Similar to MoveNet. |
| Accuracy for leg (hip-knee-ankle) keypoints | 33-point pose model. Keypoints 23-32 cover hips/knees/toes with trained anatomical constraints. The 33-point model is specifically tuned for fitness/pose — leg keypoints are its strength. | 17-point COCO model. Has hips/knees/ankles but trained on general-body COCO — accuracy on leg-only frames (camera pointing at lower body at close range) is worse because COCO is full-body-with-context. | 17-point COCO model. Same limitation as MoveNet. |
| Bundle complexity | Single WASM file + JS wrapper. One CORS-friendly CDN fetch. | TF.js core + WASM backend + model JSON. A browser app that ships TF.js is shipping a ~1 MB runtime. Heavier than it looks. | Same as MoveNet + an even larger model. |
| Maintenance / API stability | Official `Tasks Vision` successor — actively maintained, unified with the rest of the Google ML Kit story. The older `@mediapipe/pose` is deprecated. | `@tensorflow-models/movenet` is in maintenance mode; recommended path is now to use TF Lite models instead. PoseNet repo archived in 2022. | Archived — not an option. |

**Why MediaPipe Wins for This Feature**

The input to our game is the player's kicking leg. Whether the player is standing to one side of the ball and swinging is dominated by the **angular velocity of the ankle-calf-knee chain**. MediaPipe's 33-point model returns `left_hip`, `left_knee`, `left_ankle`, `left_foot_index`, `right_hip`, `right_knee`, `right_ankle`, `right_foot_index` per frame — twelve leg-space keypoints per frame to work with. The other two return 6 (`right_hip`, `right_knee`, `right_ankle` only, no foot) — enough, but less margin for occlusion and tracking jitter when the leg sweeps across the frame.

The practical difference: when the kicking leg is partially occluded by the standing leg (a common real-world pose), the 33-point model has anatomical priors that keep the ankle sane; the COCO models hallucinate. For a "wow" demo we cannot tolerate a kicked shot randomly mapping to the far corner because a single ankle keypoint glitched for one frame.

**Pitfall: re-initialization latency on the WASM module.** The first call to `PoseDetector.createFromOptions()` loads the WASM and initializes the graph — 400ms-800ms cold start on a mid-range laptop. This must happen inside our `CAMERA_INIT` state and not stall the rAF loop. We pre-warm it at construction time; the state machine only transitions out of `CAMERA_INIT` once the detector's `setOptions({ runningMode: "VIDEO" })` resolves.

**Sub-decision: Image vs Video mode.** Always `runningMode: "VIDEO"` (not `"IMAGE"`). Video mode uses temporal tracking between frames — it is materially cheaper per frame because it only does full detection on keyframes and tracking in between. At 30 fps input we get full detection of every 3rd-4th frame and cheap tracking in between. That keeps our per-frame latency budget sane.

---

## 2. Module Structure

### Current Architecture Summary

```
constants.js  ← single source of for all magic numbers
state.js      ← state machine (STATE, TRANSITIONS, transition(), createInitialState)
audio.js      ← WebAudio synth, guaranteed-failsafe wrapper
keeper.js     ← stateless keeper decision (decide → dive)
physics.js    ← Bezier trajectory (computeLaunch → samples → target)
render.js     ← ONLY ctx user draw order
input.js      ← pointer + keyboard abstraction, event hooks (onAim, onLockAim, onLockPower, onMenu, onStart)
main.js       ← bootstrap, rAF loop, orchestrates all modules
```

### New Modules (4 new files)

| File | Responsibility |
|---|---|
| `camera.js` | Wraps `navigator.mediaDevices.getUserMedia`, manipulates the hidden `<video>` feed, emits frames to the pose module. Handles permission-denied, no-camera-browser, and enumeration of devices. |
| `pose.js` | Loads the MediaPipe `PoseDetector` (lazy, pre-warmed in `CAMERA_INIT`). Exposes `detect(videoFrame) → { landmarks, worldLandmarks } | null`. Owns the keypoint smoothing (EMA / Savitzky-Golay). |
| `poseMapping.js` | Pure functions: given a smoothed landmarks frame, compute `aimAngle` (radians) and `power` (0..1). This is the only module that knows about the mapping math. |
| `poseInput.js` | Implements the same event surface as `input.js` (`onAim`, `onLockAim`, `onLockPower`, `onMenu`, `onStart`). `main.js` wires whichever input module is active. |

### Modifications to Existing Modules

| Module | Change |
|---|---|
| `constants.js` | Add `C.AR` block: `POSE_SMOOTHING_ALPHA`, `MIN_KNEE_ANGLE_FOR_KICK`, `MAX_LEG_VELOCITY`, `VELOCITY_SMOOTHING_WINDOW`, `POSE_DETECTION_INTERVAL_MS`, `WEBCAM_PREVIEW_WIDTH`, `WEBCAM_PREVIEW_HEIGHT`, `INPUT_MODE` enum (`'POINTER'`, `'POSE'`). |
| `state.js` | Add `CAMERA_INIT` state. Add `inputMode` field to the state object. Add `C.AR` constants. |
| `input.js` | No change. It remains the fallback. |
| `main.js` | Add `inputMode` branching: construct both `input` and `poseInput`, wire the active one. Add `CAMERA_INIT` handling in `update()`. Add webcam preview compositing into `draw()` (a small PiP in the corner). |
| `render.js` | Add `drawWebcamPreview(video, x, y, w, h)` and `drawPoseOverlay(landmarks, x, y, w, h)` for the debug/preview layer. |
| `physics.js` | No change. The pose-mapped aimAngle and power feed into the existing `computeLaunch(angle, power)` exactly as pointer input does. |
| `keeper.js` | No change. |
| `audio.js` | No change. |

### Why This Does Not Break the Existing Architecture

The key design invariant: **pose input and pointer input produce the same output contract** (`onAim(angle)`, `onLockAim()`, `onLockPower()`, `onMenu()`, `onStart()`). The `main.js` wiring is:

```js
var activeInput = (s.inputMode === 'POSE') ? poseInput : input;
activeInput.onAim = function (angle) { ... };
activeInput.onLockAim = function () { ... };
// etc.
```

The rest of the game (state machine, physics, keeper, render) never knows which input mode is active. This is the same strategy the existing `input.js` uses to hide mouse/touch/keyboard behind one event surface — we are extending the pattern, not breaking it.

---

## 3. Pose → Shot Mapping Design

### Keypoint Extraction

From each frame we extract the **kicking leg** — the leg on the same side as the webcam's view of the player. For a camera placed on the ground in front of the player (the common setup), the **right leg** in image space is the kicking leg. We use:

- `right_hip` (landmark 24): (x, y) in normalized image coords
- `right_knee` (landmark 26): (x, y)
- `right_ankle` (landmark 28): (x, y)
- `right_foot_index` (landmark 32): (x, y)

We also track the **previous frame's** ankle position for velocity computation.

### Aim Direction from Leg Angle

The aim angle maps to the **horizontal sweep of the lower leg** from the knee:

```
knee → ankle vector: v = (ankle.x - knee.x, ankle.y - knee.y)
legAngle = atan2(v.x, v.y)   // 0 = pointing straight down, +ve = swinging right
```

We calibrate once at `CAMERA_INIT` — the player stands in a neutral pose and we record `legAngle_rest`. Then:

```
deltaAngle = legAngle - legAngle_rest
aimAngle = clamp(deltaAngle * AIM_SCALE + AIM_OFFSET, -1, 1)
```

`AIM_SCALE` and `AIM_OFFSET` are determined by a one-time calibration step: the player is asked to swing their leg to the leftmost and rightmost comfortable extent, we record the `legAngle` at each extreme, and map linearly to `[-1, 1]`. This calibration runs in `CAMERA_INIT` and takes ~3 seconds. The values are stored in `localStorage` so the player only calibrates once.

### Power from Kick Velocity

Power is the **peak angular velocity of the ankle during the swing phase**:

1. Track `ankle` position across frames. Compute instantaneous ankle speed in pixels/second.
2. Apply an EMA smoothing with `VELOCITY_SMOOTHING_WINDOW` (5 frames at 30fps ≈ 166ms window).
3. Detect the kick event: when ankle velocity exceeds `KICK_VELOCITY_THRESHOLD` (e.g., 800 px/s), mark the start of the swing.
4. Track the **peak velocity** during the swing.
5. Map peak velocity to power: `power = clamp((peakVelocity - V_MIN) / (V_MAX - V_MIN), 0, 1)`.

`V_MIN` and `V_MAX` are also calibrated during the `CAMERA_INIT` step — the player is asked to do a soft kick and a hard kick, we record the peak velocities, and use those as the 0% and 100% power references.

### Shot Lock Trigger

The existing game has a two-phase input: aim → lock aim → power → lock power. For pose input we collapse this:

- The player **aims by positioning their leg** (live preview of aim line on the canvas).
- The player **executes the kick** (the swing itself).
- The moment the ankle velocity drops back below threshold after a peak, we call `onLockAim()` followed immediately by `onLockPower()` — the kick motion itself is the "lock" trigger.

This is a **single-phase input** for AR mode, distinct from the two-phase pointer input. The state machine handles this by adding a `POSE_KICK` sub-state inside `AIMING` (see section 4).

### Smoothing

Raw pose keypoints at 30fps have visible jitter. We apply:

- **Spatial**: EMA on each keypoint coordinate with `alpha = 0.4` (tuned for responsiveness vs smoothness).
- **Temporal**: Savitzky-Golay filter (window=5, order=2) on the ankle trajectory for velocity computation. This preserves the shape of the swing peak better than EMA, which would flatten it.

Both are implemented in `poseMapping.js` as pure functions so they are testable.

---

## 4. State Machine Changes

### New State: `CAMERA_INIT`

Added to `STATE`:

```js
STATE = {
  CAMERA_INIT: 'CAMERA_INIT',  // new
  MENU: 'MENU',
  AIMING: 'AIMING',
  POWER: 'POWER',
  SHOOTING: 'SHOOTING',
  RESULT: 'RESULT',
  GAME_OVER: 'GAME_OVER'
}
```

### New Transition Table Entry

```js
TRANSITIONS = {
  CAMERA_INIT: ['MENU', 'AIMING'],   // camera ready → skip to AIMING; fallback → MENU
  MENU: ['AIMING', 'GAME_OVER'],     // unchanged
  AIMING: ['POWER', 'MENU'],         // unchanged
  POWER: ['SHOOTING', 'AIMING'],     // unchanged
  SHOOTING: ['RESULT'],              // unchanged
  RESULT: ['AIMING', 'GAME_OVER', 'MENU'],  // unchanged
  GAME_OVER: ['MENU', 'AIMING']      // unchanged
}
```

### State Flow

```
CAMERA_INIT
  ├─ camera ready, pose detector initialized, calibration done
  │   → transition to AIMING (with inputMode = 'POSE')
  ├─ camera denied or model failed
  │   → transition to MENU (with inputMode = 'POINTER')
  └─ camera permission pending
      → stay in CAMERA_INIT, render a prompt
```

### New Field in State Object

```js
createInitialState() returns {
  ...existing fields,
  inputMode: 'POINTER',          // 'POINTER' | 'POSE'
  cameraStatus: 'pending',       // 'pending' | 'requesting' | 'ready' | 'denied' | 'failed'
  poseCalibration: null,         // { legAngleRest, vMin, vMax } once calibrated
  lastPoseLandmarks: null,       // last detected landmarks (for preview overlay)
  kickDetected: false,           // true on the frame where a kick swing completes
  poseAimAngle: 0,               // current aim from pose (smoothed)
  posePower: 0,                  // current power from pose (peak during swing)
}
```

### How the Existing States Are Affected

- `AIMING`: When `inputMode === 'POSE'`, the `POWER` sub-phase is bypassed. The kick swing itself triggers `fireShot()` directly. The `aimAngle` is continuously updated from `poseAimAngle` during AIMING.
- `POWER`: Only reachable when `inputMode === 'POINTER'`. No change to the power bar logic.
- `SHOOTING`, `RESULT`, `GAME_OVER`: No change. They read `s.aimAngle` and `s.power` which are set identically by either input path.

### Calibration Flow Inside CAMERA_INIT

```
CAMERA_INIT entered
  → Show "Stand in front of camera" prompt
  → getUserMedia (async)
    → success: initialize PoseDetector
    → failure: transition to MENU with inputMode='POINTER'
  → PoseDetector ready
  → "Hold still — calibrating neutral pose" (2 seconds, capture legAngleRest)
  → "Swing leg left" (capture left extreme)
  → "Swing leg right" (capture right extreme)
  → "Soft kick" (capture V_MIN)
  → "Hard kick" (capture V_MAX)
  → Store in localStorage under C.POSE_CALIBRATION_KEY
  → transition to AIMING
```

If calibration fails (e.g., player doesn't follow prompts), we fall back to hardcoded defaults and log a warning. The game is still playable with defaults.

---

## 5. Fallback Strategy

### Failure Modes and Responses

| Failure | Detection | Response |
|---|---|---|
| Webcam permission denied | `getUserMedia()` rejects with `NotAllowedError` | `cameraStatus = 'denied'`, transition to `MENU` with `inputMode = 'POINTER'`. Show a toast: "Camera unavailable — using mouse controls". |
| No camera on device | `navigator.mediaDevices` undefined, or `getUserMedia()` rejects with `NotFoundError` | Same as above. |
| MediaPipe WASM fails to load | `PoseDetector.createFromOptions()` rejects | Same as above. |
| Pose detection returns null for > 30 consecutive frames | Counter in `pose.js` | `cameraStatus = 'lost'`, switch `inputMode` back to `'POINTER'` for the current shot, show toast: "Lost tracking — using mouse for this shot". Re-attempt pose detection; if it recovers before the shot is taken, switch back to `'POSE'`. |
| Frame rate drops below 20fps for > 2 seconds | FPS counter in `camera.js` | Same as lost tracking — graceful switch to pointer for the duration of the low-fps period. |
| Calibration step skipped or fails | Player clicks "skip calibration" or timeout | Use hardcoded defaults: `legAngleRest = 0`, `AIM_SCALE = 1.5`, `V_MIN = 500`, `V_MAX = 3000`. Game is playable but less accurate. |

### Seamless Fallback Architecture

The fallback is **architectural, not conditional**. Because `poseInput.js` and `input.js` expose the identical event surface, `main.js` does not branch on input mode in the hot path. It just calls `activeInput.onAim(angle)` and the rest of the game runs. Switching input modes is a one-line reassignment:

```js
function setInputMode(mode) {
  s.inputMode = mode;
  activeInput = (mode === 'POSE') ? poseInput : input;
  // re-wire event handlers
  activeInput.onAim = ...;
  activeInput.onLockAim = ...;
  // etc.
}
```

This can happen mid-shot (e.g., if pose tracking is lost during AIMING, the player can grab the mouse to finish aiming). The state machine does not care which input path called `fireShot()`.

### Fallback UX

- A small camera icon in the corner of the canvas indicates the current input mode (green = pose active, gray = pointer, red = camera error).
- When falling back, a non-blocking toast appears for 2 seconds then fades.
- The webcam preview (when active) is shown as a small PiP in the corner of the canvas, so the player can see what the camera sees and adjust their position.

---

## 6. Performance Architecture

### The Budget

At 30fps, each frame has a **33.3ms budget**. The breakdown:

| Component | Budget (ms) | Notes |
|---|---|---|
| Canvas 2D render (render.js) | ~2-4 | Three entities, simple paths. Trivial. |
| Physics update (physics.js) | ~0.5 | One Bezier evaluation per frame during SHOOTING. |
| Pose detection (pose.js) | ~12-18 | MediaPipe at 30fps on a laptop. |
| Pose mapping (poseMapping.js) | ~0.2 | A few atan2 and EMA calls. |
| Camera frame copy | ~1-2 | `video` → offscreen canvas for pose input. |
| **Total** | **~16-25** | Fits within 33.3ms with 8-17ms headroom. |

### Coordination Strategy

The existing game runs a single `requestAnimationFrame` loop in `main.js`. We keep this. We do **not** add a second rAF loop for pose detection. Instead:

1. **Pose detection runs synchronously inside the rAF loop**, after `update()` and before `draw()`. This is the simplest approach and works because MediaPipe's `detectForVideo()` at 30fps on a laptop takes ~12-18ms — within budget.

2. **Frame skipping for pose**: We only run pose detection every `POSE_DETECTION_INTERVAL_MS` (default = 33ms = every frame at 30fps). If the measured frame time exceeds 30ms, we automatically reduce to every other frame (pose at 15fps) and rely on the smoothing in `poseMapping.js` to interpolate. This is adaptive and transparent to the game logic.

3. **No Web Workers.** Moving pose detection to a Worker would avoid blocking the rAF loop, but the overhead of `postMessage` + `Transferable` video frames is ~2-4ms per frame, and the complexity of Worker lifecycle management is not worth it for a 12-18ms task. The rAF loop is not blocked long enough to drop below 30fps on target hardware.

4. **No OffscreenCanvas.** The webcam preview (if shown) is drawn via `ctx.drawImage(video, x, y, w, h)` which is GPU-accelerated in all modern browsers. No need for a second canvas.

### Adaptive Quality

```js
var poseFrameInterval = 1;  // process every Nth frame
var poseFrameCounter = 0;

function update(dt, t) {
  // ... existing update logic ...

  if (s.inputMode === 'POSE' && s.cameraStatus === 'ready') {
    poseFrameCounter++;
    if (poseFrameCounter >= poseFrameInterval) {
      poseFrameCounter = 0;
      var start = performance.now();
      var landmarks = pose.detect(videoFrame);
      var detectMs = performance.now() - start;

      // Adapt: if detection took > 20ms, skip next frame
      poseFrameInterval = (detectMs > 20) ? 2 : 1;

      if (landmarks) {
        s.poseAimAngle = poseMapping.computeAim(landmarks, s.poseCalibration);
        s.posePower = poseMapping.computePower(landmarks);
        s.lastPoseLandmarks = landmarks;
      }
    }
  }
}
```

### Memory

- MediaPipe WASM: ~8MB heap.
- Video frame buffer: 640x480 RGBA = ~1.2MB.
- Pose landmarks per frame: 33 * 4 floats = 528 bytes. Negligible.
- Total additional memory: ~10MB. Acceptable for a browser game.

---

## 7. Biggest Architectural Risk

**The pose → shot mapping is the hardest decision to reverse.**

Here is why:

1. **It is the entire feature.** The AR kick detection is not a modular add-on — it redefines the input layer of the game. If the mapping from leg angle to aim angle feels wrong (too sensitive, too insensitive, inverted, laggy), the entire "wow" value of the feature is gone. And the mapping is not something you can tune by tweaking a constant — it requires real-world testing with real players in real kicking positions.

2. **It is coupled to the physical setup.** The mapping assumes the camera is placed in front of the player at ground level. If the camera is placed to the side, the leg angle no longer maps linearly to aim direction. If the player is sitting (common for casual webcam use), the leg geometry is completely different. If the player is too close or too far from the camera, the pixel-space velocity calibration is wrong. All of these are **deployment-context assumptions** baked into the mapping math, and they are invisible in testing.

3. **It is coupled to the calibration flow.** The calibration step (neutral pose, left/right extremes, soft/hard kick) is a 15-second onboarding flow that every first-time player must complete. If players skip it, the defaults may not work for their body proportions or camera setup. If they complete it but the calibration is noisy (e.g., they didn't actually hold still during the neutral pose step), the mapping is permanently wrong for that session.

4. **It cannot be A/B tested easily.** Unlike a UI change where you can serve variant A to half of users, the pose mapping is a per-player, per-session, per-device calibration. There is no global "best" mapping. This means the mapping quality is determined by the quality of the calibration flow, which is determined by how well players follow the on-screen instructions — and players do not read instructions.

**Mitigation:**

1. **Build the calibration flow first, before the mapping math.** Spend 2 hours testing the calibration prompts with 3 people who have never seen the app. If players cannot reliably complete the calibration, the mapping will never work well regardless of how good the math is.

2. **Default to generous dead zones.** The mapping should ignore small leg movements (deltaAngle < 0.1 rad) to avoid jitter from players who are just shifting their weight. This makes the mapping feel less responsive but more reliable.

3. **Provide a "re-calibrate" button accessible from the MENU.** Players who change their camera position or body posture need to re-calibrate. This is a 1-line addition to `main.js` but a critical UX affordance.

4. **Log calibration data to localStorage.** When debugging "the mapping feels wrong" reports, the first thing we need is the calibration values the player generated. Store `{ legAngleRest, leftExtreme, rightExtreme, vMin, vMax, timestamp }` and provide a way to export it (even if just `copy(JSON.stringify(localStorage))`).

---

## Replies

### To business.md

**Agree:**
- "Single HTML/JS page, no build pipeline" — fully aligned. The MediaPipe WASM is loaded from CDN; no bundler needed. The game still works by opening `index.html` (with a local server for webcam — see below).
- "Mobile-first responsive layout" — the webcam preview PiP scales with the canvas. The pose mapping works identically on mobile browsers (Safari on iOS 16+ supports `getUserMedia` and MediaPipe's WASM runs on ARM64).
- "Best-of-5 scoring is the single biggest lever" — the AR feature does not change the scoring. The "wow" factor is in the input method, not the game logic. A goal is still a goal whether it was aimed by mouse or by leg.
- "Instant restart < 1 second" — the pose detection runs continuously; there is no per-shot initialization cost. After a shot resolves, the next AIMING state starts with pose detection already running.
- "No ads in v1" — agreed. The AR feature does not change the monetization surface.

**Disagree / push back:**
- "Sound effects (crowd groan/cheer, net thud)" — I side with the existing architect.md: synthesized WebAudio is sufficient. The AR feature does not change the audio requirements. If anything, the audio feedback becomes more important in AR mode because the player is looking at the camera, not the screen — they need audio cues to know the shot was registered.
- "D1 retention > 30% as a target" — I agree with the existing architect.md that I cannot engineer retention directly. What I can do is instrument a `poseShotsTaken` counter in `localStorage` so the business side has data on whether the AR feature is actually used or whether players switch back to mouse input. I will add this to the state machine as a side-effect-free counter.

### To engineering.md

**Agree:**
- "Milestone 1 — Playable single shot" as the first milestone — this is the right first slice. For the AR feature specifically, M1 should be: "Player kicks a real ball (or mimes a kick) in front of the webcam, and the virtual ball launches in the corresponding direction." This exercises the full pose → shot pipeline in minimal form.
- "Linear interpolation + small vertical overshoot, not real physics" — the pose mapping produces `aimAngle` and `power` which feed into the existing Bezier trajectory. No physics changes needed.
- "State machine drift" as a risk — I addressed this by adding `CAMERA_INIT` as a proper state with explicit transitions, not a side-effect flag.
- "Two-step input (aim then power)" — for pointer input, yes. For pose input, I am using a single-phase input (the kick swing itself is the "lock" trigger). This is a deliberate divergence from the pointer input model, justified by the different affordances of the input modality.
- "Canvas scaling & DPI" — covered. The webcam preview is drawn at the camera's native resolution and scaled to fit the PiP region.
- "Static host (itch.io / GitHub Pages)" — agreed. The game is still a folder of static files plus a CDN-loaded WASM module. The only new deployment requirement is HTTPS (for `getUserMedia`), which GitHub Pages provides natively.

**Disagree / push back:**
- "Milestone 3 — Keeper AI: weighted random dive biased by difficulty" — the existing architect.md and I agree: no tendency-reading in v1. The keeper's dive distribution is static per difficulty level. The AR feature does not change this.
- "Milestone 4 — Sound effects loaded lazily" — I would go further and say sound is the first thing to cut, not just deprioritize. The AR feature does not change this recommendation.
- "Effort estimates assume vanilla HTML/CSS/JS + Canvas" — I agree with the stack but the AR feature adds significant effort not captured in the original estimates. My estimate for the AR feature specifically is 12-18 hours: `camera.js` (2h), `pose.js` (3h), `poseMapping.js` (4h), `poseInput.js` (2h), state machine changes (2h), calibration flow (3h), integration + fallback (2h), testing with real webcams (2h). This is on top of the original M1-M5 estimates.
- "No automated E2E tests" — agreed for the game itself, but I would add one automated check: a Node script that imports `poseMapping.js` and verifies that given synthetic landmarks, the computed aim angle and power are within expected bounds. This is not E2E testing — it is a 30-line unit test for the mapping math, which is the most testable and most critical new subsystem. It runs in CI (GitHub Actions) in under 5 seconds and catches regressions if someone modifies the mapping constants.

### To architect.md (existing)

**Agree:**
- "The two-phase input design is the hardest decision to reverse" — I agree, and I would extend this: the pose input is a separate, single-phase input path that coexists with the two-phase pointer input. The state machine must support both paths simultaneously. My design does this by keeping the state machine agnostic to input mode — `fireShot()` is called identically by either path.
- "No ES modules, classic `<script src>` tags" — agreed. The MediaPipe WASM is loaded from CDN via a `<script>` tag in `index.html`. No bundler needed.
- "localStorage for high-score persistence" — extended to store pose calibration data under `C.POSE_CALIBRATION_KEY`.
- "The game has to feel *great* to play" — the AR feature is a "wow" feature, not a "feel" feature. The feel of the shot (ball arc, keeper dive, net ripple) is unchanged. The AR feature adds a novelty layer on top. If the feel is broken, the AR feature will not save it.

**Disagree / push back:**
- "Do not optimize draw calls, do not profile" — I agree for the Canvas 2D rendering, but the pose detection is a new hot path that must be profiled. I added adaptive frame skipping (section 6) specifically to handle the case where pose detection exceeds the frame budget. This is not premature optimization — it is a measured response to a known-cost new subsystem.
- "No automated tests beyond sanity checks" — I would add the `poseMapping.js` unit test described above. It is a 30-line test for the most critical new subsystem. The existing architect's "no automated tests" stance is correct for the game logic (state machine, physics) but too relaxed for the mapping math, which is pure functions and trivially testable.
