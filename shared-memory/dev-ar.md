# Dev Lead — AR Kick Detection Implementation Plan

## 1. Implementation Sequencing

Build in thin vertical slices. Each milestone produces a demonstrable, working state — not a horizontal layer.

### Milestone 1 — Camera feed + pose skeleton overlay (no game integration)
**Goal:** Webcam stream renders to a canvas, MediaPipe runs per frame, a stickman skeleton is drawn on top of the video. No game state changes yet.

**Deliverables:**
- `index.html` has a second `<canvas>` (or the existing one is used in "camera preview" mode).
- `src/ar-pose.js` loads the model and exposes `ArPose.detect(videoEl) → landmarks`.
- `src/ar-render.js` draws the video frame + skeleton overlay.
- A "Start Camera" button triggers `navigator.mediaDevices.getUserMedia`.
- If the model fails to load or webcam is denied, an error message is shown and the game falls back to mouse input.

**Exit condition:** I can point a webcam at myself, see my own stickman skeleton tracked in real time.

### Milestone 2 — Kick detection algorithm (isolated, no canvas)
**Goal:** A pure function that takes a time-series of landmarks and emits a "kick event" with aim + power. Tested with pre-recorded landmark sequences.

**Deliverables:**
- `src/ar-tracker.js` exports `ArTracker.process(landmarks, timestamp) → null | KickEvent`.
- Unit-testable: feed in a synthetic "kick" landmark series, verify the event fires with expected aim/power.
- Pseudocode for the algorithm is documented in section 3 below.

**Exit condition:** I can replay a recorded kick and see `{ aim: 0.4, power: 0.8, foot: 'right' }` printed to console.

### Milestone 3 — Wire AR input into the game state machine
**Goal:** Replace (or supplement) the mouse-drag input with AR kick detection. The existing state machine, physics, keeper, and render are unchanged — only the input source differs.

**Deliverables:**
- `src/input.js` gets a new `InputMode` enum (`POINTER` | `AR`). Default is `POINTER`.
- When `InputMode === AR`, `onAim` and `onLockPower` are driven by `ArTracker` output instead of pointer events.
- A toggle button in the UI switches modes.
- The existing pointer/keyboard path still works when AR is off or after fallback.

**Exit condition:** I can aim by pointing my leg, kick by kicking, and the virtual ball flies where my foot aimed.

### Milestone 4 — Polish, calibration, and fallback hardening
**Goal:** Tune the feel, handle edge cases, and make the fallback seamless.

**Deliverables:**
- Calibration step on first AR activation (player stands in neutral pose for 1 second to establish baseline).
- Smoothing / debouncing on kick detection so false positives (walking, shifting weight) don't fire shots.
- Explicit fallback triggers: webcam denied, model load failure, FPS drops below 20 for >2 seconds, player steps out of frame.
- `constants.js` gets an `C.AR` block with all tuning knobs.

**Exit condition:** The game works perfectly with mouse. Turning on camera enables AR. Revoking camera permission mid-game silently falls back to mouse with no broken state.

---

## 2. MediaPipe Pose API Integration

### Choice of API: Legacy `@mediapipe/pose` (NOT tasks-vision)

**Why:** The legacy API loads via plain `<script>` tags with a `locateFile` callback pointing to the CDN. No ES modules, no bundler, no `npm install`. The new `@mediapipe/tasks-vision` requires ES module imports (`<script type="module">`), which breaks the existing "classic script tags in load order" pattern in `index.html`. The legacy API is deprecated by Google but still fully functional on the CDN and is the right choice for a no-bundler project.

### Loading pattern

Add to `index.html` after the existing script tags:

```html
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js" crossorigin="anonymous"></script>
```

The `ar-pose.js` module wraps the global `Pose` object injected by the script tag.

### Initialization

```javascript
// ar-pose.js (simplified shape)
function initPose() {
  return new Promise((resolve, reject) => {
    if (typeof Pose === 'undefined') {
      reject(new Error('MediaPipe Pose failed to load from CDN'));
      return;
    }
    const pose = new Pose({
      locateFile: (file) => {
        // Redirect all WASM/model fetches to the CDN
        return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
      }
    });
    pose.setOptions({
      modelComplexity: 0,   // 0 = fastest, 1 = default, 2 = heavy. Use 0 for speed.
      smoothLandmarks: true,
      enableSegmentation: false,  // we don't need the mask; saves ~10% inference time
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
    pose.onResults((results) => {
      if (global.__AR_POSE_CALLBACK__) global.__AR_POSE_CALLBACK__(results);
    });
    resolve(pose);
  });
}
```

### Running inference per frame

Use the `Camera` helper from `@mediapipe/camera_utils` — it wires up a `requestAnimationFrame` loop that feeds video frames to `pose.send()`:

```javascript
const camera = new Camera(videoEl, {
  onFrame: async () => {
    if (videoEl.readyState >= 2) {
      await pose.send({ image: videoEl });
    }
  },
  width: 640,   // low-res is fine for pose detection; keeps latency down
  height: 480
});
camera.start();
```

**Why 640x480:** MediaPipe Pose internally resizes input to 256x256 for the model. Capturing at 640x480 instead of 1280x720 reduces the `send()` overhead (fewer bytes to copy) with no quality loss for the pose task.

### Extracting leg keypoints

The 33-point landmark model uses these indices for the lower body:

| Index | Landmark        | Used for          |
|-------|-----------------|-------------------|
| 23    | Left hip        | Hip reference     |
| 24    | Right hip       | Hip reference     |
| 25    | Left knee       | Knee angle        |
| 26    | Right knee      | Knee angle        |
| 27    | Left ankle      | Ankle velocity    |
| 28    | Right ankle     | Ankle velocity    |
| 31    | Left foot index | Kick direction    |
| 32    | Right foot index | Kick direction    |

All coordinates are **normalized (0..1)** with `(0,0)` at the top-left of the frame. Y increases downward (screen convention, not math convention).

### Coordinate system note

Because the player faces the webcam, **left/right in the landmark model are from the subject's perspective**, not the viewer's. Landmark 23 (left hip) is on the right side of the rendered video frame (because the video is mirrored for selfie view). The tracker must account for this — see section 3.

---

## 3. Pose → Shot Mapping Algorithm

### 3.1 Leg angle calculation

For a given leg (e.g., right leg = landmarks 24, 26, 28):

```
hip    = landmarks[24]    // right hip   (x, y normalized)
knee   = landmarks[26]    // right knee
ankle  = landmarks[28]    // right ankle

// Vector from knee to hip (the "thigh" direction, pointing up)
thigh_vec = (hip.x - knee.x, hip.y - knee.y)

// Vector from knee to ankle (the "shin" direction)
shin_vec  = (ankle.x - knee.x, ankle.y - knee.y)

// Knee angle: angle between thigh and shin
// 1.0 rad = leg straight, ~1.57 rad = 90° bend, ~2.0 rad = fully bent
knee_angle = atan2(
  thigh_vec.x * shin_vec.y - thigh_vec.y * shin_vec.x,
  thigh_vec.x * shin_vec.x + thigh_vec.y * shin_vec.y
)
// Take absolute value; sign doesn't matter for kick detection.
```

### 3.2 Kick detection (sudden ankle velocity)

A kick is detected when the ankle moves faster than a threshold within a short time window.

```
// Maintain a rolling buffer of the last N ankle positions with timestamps
// N = 8 frames ≈ 130ms at 60fps
buffer.push({ x: ankle.x, y: ankle.y, t: timestamp_ms })

if (buffer.length >= N):
  oldest = buffer[buffer.length - N]
  newest = buffer[buffer.length - 1]
  dt = (newest.t - oldest.t) / 1000   // seconds
  dx = newest.x - oldest.x
  dy = newest.y - oldest.y
  distance = sqrt(dx*dx + dy*y)        // in normalized units (0..1)
  velocity = distance / dt              // normalized units per second

  // Threshold: a real kick moves the ankle at least 15% of frame height
  // per 100ms. Tuned via C.AR.KICK_VELOCITY_THRESHOLD.
  if (velocity > C.AR.KICK_VELOCITY_THRESHOLD):
    emitKickEvent(buffer)
```

**Why ankle velocity and not knee angle velocity:** A slow leg lift followed by a fast extension produces a high knee-angle velocity but the ball isn't struck until the ankle snaps forward. Ankle velocity is the single best proxy for "the foot just hit something."

**Debouncing:** After a kick event is emitted, suppress further events for `C.AR.KICK_COOLDOWN_MS` (400ms). This prevents a single kick from being detected multiple times as the leg oscillates.

### 3.3 Aim mapping

Aim is the horizontal direction the foot is traveling at the moment of the kick.

```
// Use the ankle displacement vector over the detection window
aim_x = newest.x - oldest.x   // -1..1, left..right in subject's frame

// Mirror the X axis because the video is shown as a selfie mirror
// (the player raises their RIGHT leg, which appears on the LEFT of the
// mirrored video, but they INTEND to kick to their right = screen right)
aim_x = -aim_x

// Clamp to ±1 (the existing aim range)
aim_x = clamp(aim_x, -1, 1)

// Map directly to the game's aim angle (radians)
// C.AIM_MIN_ANGLE and C.AIM_MAX_ANGLE are in degrees; convert.
aim_angle = interpolate(aim_x, -1, 1, C.AIM_MIN_ANGLE, C.AIM_MAX_ANGLE) * (PI / 180)
```

**Why mirror:** The existing game uses a side view where positive angle = right. The webcam preview is mirrored (standard for selfie cams). Without mirroring, the player kicks to their right but the aim line goes left — disorienting.

### 3.4 Power mapping

Power is the total speed of the kick, normalized to `[C.POWER_MIN, C.POWER_MAX]`.

```
// velocity is computed in 3.2 (normalized units/second)
// A gentle leg raise ≈ 0.5, a full kick ≈ 3.0 (empirically tuned)
raw_power = velocity / C.AR.KICK_MAX_VELOCITY   // normalize to 0..1
raw_power = clamp(raw_power, 0, 1)

// Apply a curve so that soft kicks still register (avoid "dead zone")
raw_power = pow(raw_power, 0.7)   // gamma < 1 lifts lower values

// Map to game power range
power = C.POWER_MIN + (C.POWER_MAX - C.POWER_MIN) * raw_power
```

### 3.5 Full pseudocode

```
function processFrame(landmarks, timestamp):
  if !landmarks: return null

  // Pick the "kicking leg" — the one with higher ankle Y (closer to ground
  // in a neutral pose) is the plant leg; the other is the kicker.
  // Simpler heuristic: use whichever ankle moved more in the last 5 frames.
  rightAnkle = landmarks[28]
  leftAnkle  = landmarks[27]

  buffer.push({ ra: rightAnkle, la: leftAnkle, t: timestamp })
  if buffer.length > 8: buffer.shift()

  if buffer.length < 8: return null

  velRight = ankleVelocity(buffer, 'ra')   // right ankle velocity
  velLeft  = ankleVelocity(buffer, 'la')   // left ankle velocity

  if max(velRight, velLeft) < C.AR.KICK_VELOCITY_THRESHOLD:
    return null

  if timestamp - lastKickTime < C.AR.KICK_COOLDOWN_MS:
    return null

  kickingFoot = velRight > velLeft ? 'right' : 'left'
  velocity    = max(velRight, velLeft)

  // Aim from horizontal displacement of the kicking ankle
  oldest = buffer[0]
  newest = buffer[buffer.length - 1]
  if kickingFoot == 'right':
    aimX = newest.ra.x - oldest.ra.x
  else:
    aimX = newest.la.x - oldest.la.x
  aimX = -aimX   // mirror for selfie view

  // Power from velocity
  rawPower = clamp(velocity / C.AR.KICK_MAX_VELOCITY, 0, 1)
  rawPower = pow(rawPower, 0.7)
  power = C.POWER_MIN + (C.POWER_MAX - C.POWER_MIN) * rawPower

  // Convert aim to game angle
  aimAngle = interpolate(aimX, -1, 1, C.AIM_MIN_ANGLE, C.AIM_MAX_ANGLE)
  aimAngle = aimAngle * PI / 180

  lastKickTime = timestamp

  return {
    aimAngle: clamp(aimAngle, -1, 1),   // clamp to game's ±1 rad range
    power:    power,
    foot:     kickingFoot,
    confidence: min(1, velocity / C.AR.KICK_MAX_VELOCITY)
  }
```

---

## 4. New Modules to Create

### `src/ar-pose.js`
**Responsibility:** Load MediaPipe Pose, manage the camera stream, run inference.

**Exports:**
```javascript
global.ArPose = {
  // Initialize the pose model. Returns a Promise that resolves on success,
  // rejects if the CDN fails or the WASM cannot initialize.
  init: function() → Promise<void>,

  // Start the webcam and begin sending frames to the model.
  // Returns a Promise that resolves with the <video> element.
  startCamera: function() → Promise<HTMLVideoElement>,

  // Stop the camera and halt inference.
  stopCamera: function() → void,

  // Register the callback invoked on each inference result.
  // Callback signature: (results) → void where results comes from MediaPipe.
  onResults: function(callback) → void,

  // Synchronous inference on a single video frame (for the rAF loop).
  // Called internally by Camera, but exposed for testing.
  detect: function(videoEl) → void,

  // True once init() has resolved and the model is ready.
  isReady: function() → boolean,

  // True while the camera is streaming.
  isActive: function() → boolean
};
```

### `src/ar-tracker.js`
**Responsibility:** Consume landmark results, detect kicks, emit shot events.

**Exports:**
```javascript
global.ArTracker = {
  // Create a new tracker instance.
  //   config = { velocityThreshold, cooldownMs, maxVelocity }
  create: function(config) → TrackerInstance
};

// A TrackerInstance:
//   process(landmarks, timestampMs) → null | KickEvent
//   reset() → void
//   getState() → { lastKickTime, bufferLength, isCalibrated }
//
// KickEvent = {
//   aimAngle: number,   // radians, game convention (0 = up, + = right)
//   power:    number,   // C.POWER_MIN..C.POWER_MAX
//   foot:     string,   // 'left' | 'right'
//   confidence: number  // 0..1, how "kick-like" the motion was
// }
```

### `src/ar-render.js`
**Responsibility:** Draw the camera video feed and the pose skeleton overlay on the canvas.

**Exports:**
```javascript
global.ArRender = {
  // Draw the video frame (mirrored for selfie view).
  drawVideo: function(ctx, videoEl) → void,

  // Draw the pose skeleton on top of the video.
  //   landmarks: the normalized landmark array from MediaPipe
  //   ctx: canvas 2D context
  drawSkeleton: function(ctx, landmarks) → void,

  // Draw a "kick indicator" — a colored trail showing the kicking leg's
  // recent path. Uses the tracker's buffer.
  drawKickTrail: function(ctx, trackerState) → void,

  // Draw a calibration overlay (e.g., "Stand still...").
  drawCalibration: function(ctx, progress) → void
};
```

---

## 5. Modifications to Existing Files

### `index.html`
- Add the two MediaPipe CDN script tags (camera_utils, pose) after the existing script tags.
- Add a "Start AR" button and an "AR Mode: On/Off" toggle button (hidden by default, shown after camera init).
- Add a second `<video id="ar-video" autoplay playsinline muted>` element, hidden by CSS (the video is drawn to canvas, not shown directly).
- Add a `<div id="ar-status">` for status messages ("Loading model...", "Point camera at yourself", "AR active").

### `src/constants.js`
Add a new `C.AR` block:

```javascript
C.AR = {
  // Camera capture resolution (low-res is fine for pose)
  CAPTURE_WIDTH: 640,
  CAPTURE_HEIGHT: 480,

  // Kick detection
  KICK_VELOCITY_THRESHOLD: 0.15,   // normalized units per second
  KICK_MAX_VELOCITY: 3.0,          // normalized units/sec for full power
  KICK_COOLDOWN_MS: 400,           // suppress re-detection after a kick
  ANKLE_BUFFER_SIZE: 8,            // frames for velocity calc (~130ms @ 60fps)

  // Input gating
  MIN_DETECTION_CONFIDENCE: 0.5,   // ignore frames where model is unsure
  CALIBRATION_DURATION_MS: 1000,   // how long to calibrate on first activation
  FPS_SAMPLE_WINDOW: 30,           // frames to average FPS over
  FPS_FALLBACK_THRESHOLD: 20,      // fall back to mouse if FPS drops below this

  // Aim
  AIM_DEAD_ZONE: 0.05,            // ignore tiny aim displacements
  AIM_SMOOTHING: 0.3,              // lerp factor for aim smoothing (0 = raw, 1 = frozen)

  // Power
  POWER_GAMMA: 0.7,                // < 1 lifts soft kicks

  // Render
  SKELETON_COLOR: '#00ff88',
  SKELETON_THICKNESS: 3,
  KICK_TRAIL_COLOR: '#ffe66d',
  KICK_TRAIL_LENGTH: 12,

  // State
  MODE: 'POINTER'  // 'POINTER' | 'AR'
};
```

### `src/state.js`
Minimal change — add one field to the initial state:

```javascript
// In createInitialState(), add:
arMode: false,        // true when AR input is active
arConfidence: 0       // running average of kick confidence (0..1)
```

No new states or transitions are needed. AR is an **input source**, not a game state. The state machine (MENU → AIMING → POWER → SHOOTING → RESULT → GAME_OVER) is unchanged.

### `src/input.js`
Add an `InputMode` enum and a method to switch modes:

```javascript
// At top of file:
var INPUT_MODE = { POINTER: 'POINTER', AR: 'AR' };

// In Input constructor:
this.mode = INPUT_MODE.POINTER;
this.arActive = false;

// New method:
Input.prototype.setMode = function (mode) {
  this.mode = mode;
  // When switching to AR, suppress pointer events.
  // When switching to POINTER, re-enable them.
  this.arActive = (mode === INPUT_MODE.AR);
};

// In _bind(), gate the pointer handlers:
cv.addEventListener('pointerdown', function (e) {
  if (self.arActive) return;   // AR owns input
  // ... existing code ...
});

cv.addEventListener('pointermove', function (e) {
  if (self.arActive) return;   // AR owns input
  // ... existing code ...
});
```

The keyboard handlers remain active in both modes (Space to shoot works as a fallback even in AR mode).

### `src/main.js`
Add AR wiring alongside the existing input wiring:

```javascript
// After `var input = new global.Input(canvas);`:
var arPose = global.ArPose;
var arTracker = global.ArTracker.create(C.AR);
var arRender = global.ArRender;

// AR input events (mirror the pointer event surface)
arTracker.onKick = function (event) {
  if (s.state === SM.STATE.AIMING) {
    s.aimAngle = event.aimAngle;
    // Auto-advance to POWER phase on kick detection
    if (SM.transition(s, SM.STATE.POWER)) {
      s.power = event.power;
      s.powerLocked = false;
      s.powerOscillationStart = now();
      Sound.aim();
    }
  } else if (s.state === SM.STATE.POWER) {
    // Second kick (or a tap) locks power and fires.
    fireShot();
  }
};

// In the draw() function, add AR rendering when active:
if (input.arActive && arPose.isActive()) {
  arRender.drawVideo(renderer.ctx, arVideoEl);
  var lm = arTracker.getLastLandmarks();
  if (lm) arRender.drawSkeleton(renderer.ctx, lm);
}
```

The key insight: **AR kick detection replaces the two-phase pointer flow with a two-kick flow.** First kick = aim + start power. Second kick (or Space) = lock power and shoot. This maps naturally to the existing state machine.

### `src/render.js`
No changes needed. The renderer is given a `scene` object by `main.js` and draws it. AR rendering is a separate pass that happens before the game scene is composited (or as a background layer — implementation detail in `ar-render.js`).

### `src/physics.js`
No changes. The physics module takes `(angle, power)` and returns a trajectory. AR produces the same `(angle, power)` tuple that mouse input produces.

### `src/keeper.js`
No changes. The keeper AI is input-source-agnostic.

### `src/audio.js`
No changes. The existing `Sound.kick()`, `Sound.goal()`, etc. are called from `fireShot()` and `resolveShot()`, which are triggered the same way regardless of input source.

---

## 6. Fallback Implementation

The fallback strategy is **defense in depth** — multiple layers, any one of which can trigger a switch back to mouse input.

### Layer 1: Model load failure
If `arPose.init()` rejects (CDN timeout, WASM init error), the "Start AR" button shows "AR unavailable — using mouse" and the game runs in pointer mode permanently for that session.

### Layer 2: Webcam denied
If `navigator.mediaDevices.getUserMedia()` throws `NotAllowedError` or `NotFoundError`, same treatment as Layer 1.

### Layer 3: Low FPS at runtime
Every `C.AR.FPS_SAMPLE_WINDOW` frames, compute the rolling average FPS. If it drops below `C.AR.FPS_FALLBACK_THRESHOLD` for two consecutive samples, emit a `performance-warning` event. `main.js` listens for this and:
- Shows a toast: "Slowing down — switching to mouse input"
- Calls `input.setMode(INPUT_MODE.POINTER)`
- Calls `arPose.stopCamera()`
- The game continues with mouse input for the rest of the session

### Layer 4: Loss of tracking
If `processFrame()` receives `landmarks = null` (no person detected) for more than 2 seconds, the tracker emits a `tracking-lost` event. `main.js` pauses the game (stops the power oscillation) and shows "Step back into frame". When tracking resumes, the game continues from where it paused.

### Layer 5: Manual toggle
The "AR Mode: On/Off" button always works. Clicking it while AR is active cleanly shuts down the camera and returns to mouse input.

### Fallback state cleanup
When falling back, the following must happen atomically:
1. `arPose.stopCamera()` — stops the camera and the rAF loop.
2. `input.setMode(INPUT_MODE.POINTER)` — re-enables pointer handlers.
3. `s.state` is preserved — if the player was mid-shot, the shot completes with whatever aim/power was last set.
4. The AR UI elements (video, skeleton, trail) are hidden.
5. The aim line and power bar reappear (they were suppressed during AR mode).

---

## 7. Effort Estimates

Assuming one developer familiar with MediaPipe Pose (has built at least one project with it before). Estimates include building, manual testing in browser, and committing.

| Milestone | Effort (hours) | Notes |
|-----------|----------------|-------|
| M1 — Camera + skeleton overlay | 4–6 hrs | CDN wiring, getUserMedia permissions, canvas drawing. The MediaPipe API is straightforward; most of the time is spent on the canvas compositing (mirroring, sizing the video behind the game scene). |
| M2 — Kick detection algorithm | 3–4 hrs | Pure logic, no DOM. Can be developed and tested with synthetic landmark data. The algorithm itself is ~60 lines; the rest is tuning thresholds. |
| M3 — Wire AR into game | 3–4 hrs | Wiring `arTracker.onKick` into `main.js`, handling the two-kick → two-phase mapping, adding the mode toggle button. The existing state machine is untouched; this is glue code. |
| M4 — Polish + fallback | 4–6 hrs | Calibration flow, FPS monitoring, graceful degradation, edge cases (multiple people in frame, partial occlusion, background movement). This is where the most time goes — edge cases are hard to predict. |
| **Total** | **14–20 hrs** | **~2–3 working days** |

These estimates assume the existing game is stable and the developer has a working webcam-equipped laptop for testing. Add 2–4 hours if this is the developer's first time using MediaPipe Pose (reading docs, fighting CDN issues).

---

## 8. Biggest Engineering Risk

**False positive kick detection — the player shifts their weight and the game fires an unintended shot.**

This is the risk because:
- The game is turn-based with discrete shots. An accidental input is not a minor glitch — it wastes a shot in a best-of-5, or ends an endless run. The player did not consent to the shot.
- Pose detection is noisy. A player shifting their weight, adjusting their stance, or walking into frame can produce ankle velocities that look like a kick to a simple velocity threshold.
- Unlike a mouse click (which is an explicit intent signal), a webcam frame is continuous and ambiguous. There is no "I meant to do that" signal in pose data.
- If this happens even 1 in 20 frames, the game is unplayable in AR mode.

**Mitigation:**
1. **Require a "wind-up" pattern.** A real kick has a distinctive signature: the knee lifts first (increasing knee angle), then the ankle snaps forward. Require both phases within a 300ms window. A weight shift has no knee lift.
2. **Require the kick to be "committed"** — the ankle must travel at least 10% of frame width in the kick direction. Small oscillations don't qualify.
3. **Add a confirmation gesture.** After the first kick (which sets aim), require a second kick within 1–2 seconds to actually shoot. If no second kick, the aim resets. This is the same two-phase pattern as mouse input (aim → power), just expressed as two kicks.
4. **Tune `KICK_VELOCITY_THRESHOLD` aggressively.** Start high (only full kicks register) and lower it based on testing. Better to miss soft kicks than fire phantom ones.

The second risk is **performance on lower-end hardware**. MediaPipe Pose at modelComplexity=0 runs at ~30fps on a 2020 laptop, but on a 2015 laptop or a cheap Chromebook it may drop to 10–15fps. The FPS monitor (Layer 3 of fallback) catches this, but the player experience in those 2 seconds of lag is bad. Mitigation: set `modelComplexity: 0` from the start, capture at 640x480, and disable segmentation. If that's not enough, offer a "low quality" mode that runs inference every other frame (15fps detection is still usable if the render interpolates).

---

## Replies

No `architect-ar.md` or `qa-ar.md` found yet — this is the first AR role file written. The existing `architect.md`, `business.md`, and `engineering.md` are from the original game planning and do not address the AR feature specifically.

### Notes on existing role files

The existing `architect.md` makes a strong case for classic `<script src>` tags over ES modules. I agree with this choice and my MediaPipe integration plan follows it — using the legacy `@mediapipe/pose` API loaded via `<script>` tags with a `locateFile` callback, not the newer `@mediapipe/tasks-vision` which requires ES modules.

The existing `engineering.md` identifies "feel of the shot" as the biggest risk. For the AR feature specifically, I rephrase this as "false positive kick detection" — the AR equivalent of "feel." A game that fires phantom shots feels worse than a game with a slightly-off ball arc.

The existing `business.md` does not mention AR at all (it was written before the AR enhancement was proposed). The AR feature is a direct implementation of the business doc's "wow factor" goal — it makes the game memorable and shareable, which is the best defense against the business risk of being "forgettable."

---

Sources:
- [MediaPipe Pose Documentation](https://developers.google.com/mediapipe/solutions/vision/pose_landmarker)
- [MediaPipe Pose GitHub](https://github.com/google/mediapipe/blob/master/docs/solutions/pose.md)
- [MediaPipe Pose Model Card](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task)
