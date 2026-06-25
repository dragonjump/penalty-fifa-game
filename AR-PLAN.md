# AR Kick Detection Enhancement — Synthesized Plan

> Synthesized from three-role discussion: architect-ar.md, dev-ar.md, qa-ar.md.
> All three agents agreed on the core approach. Disagreements are noted and resolved below.

---

## 1. Feature Summary

Add webcam-based AR kick detection to the existing penalty kick stickman game. The player kicks in front of their webcam; the leg direction maps to aim, and kick speed maps to power. The virtual ball on canvas responds in real-time to the player's physical movement.

**Goal:** Surprise the business and product team with a "wow" factor that makes the game memorable and shareable.

---

## 2. Resolved Decisions

### Tech Stack (unanimous)
**MediaPipe Pose** (legacy `@mediapipe/pose` API, not Tasks Vision):
- 33-point pose model with dedicated leg keypoints (hips, knees, ankles, foot indices)
- ~2.5MB model, ~12-18ms inference per frame on a mid-range laptop
- Loaded via plain `<script>` tags with `locateFile` CDN callback — no bundler, no ES modules
- `runningMode: "VIDEO"` for temporal tracking (cheaper per-frame than IMAGE mode)
- `modelComplexity: 0` (fastest), segmentation disabled

**Why not Tasks Vision:** Requires ES module imports, breaking the existing "classic script tags" pattern. The legacy API is deprecated but fully functional on CDN and is the right choice for a no-bundler project.

### Module Structure (unanimous)
4 new modules + minimal edits to 4 existing files:

| New Module | Responsibility |
|-----------|---------------|
| `camera.js` | Wraps `getUserMedia`, manages hidden `<video>` feed, handles permission errors |
| `pose.js` | Loads MediaPipe `PoseDetector`, runs inference, exposes `detect(videoFrame) → landmarks` |
| `poseMapping.js` | **Pure functions**: landmarks → aim angle + power. Node-testable. |
| `poseInput.js` | Implements same event surface as `input.js` (`onAim`, `onLockAim`, `onLockPower`) |

| Existing Module | Change |
|----------------|--------|
| `constants.js` | Add `C.AR` block with all tuning knobs |
| `state.js` | Add `inputMode`, `cameraStatus`, `poseCalibration`, `lastPoseLandmarks` fields |
| `input.js` | Add `InputMode` enum + `setMode()` method; gate pointer events when AR is active |
| `main.js` | Wire active input module, add AR rendering pass, add `CAMERA_INIT` flow |
| `render.js` | Add `drawWebcamPreview()`, `drawPoseOverlay()`, `drawKickTrail()` |
| `physics.js` | **No change** — pose mapping produces same `(angle, power)` tuple |
| `keeper.js` | **No change** |
| `audio.js` | **No change** |

### Key Design Invariant (unanimous)
**Pose input and pointer input produce the same output contract.** The state machine, physics, keeper, and renderer never know which input mode is active. This is the same pattern `input.js` uses to hide mouse/touch/keyboard behind one event surface.

### Pose → Shot Mapping (unanimous on algorithm)
1. **Aim** = horizontal displacement of ankle from knee (`atan2(ankle.x - knee.x, ankle.y - knee.y)`), calibrated against neutral pose, mirrored for selfie view
2. **Power** = peak ankle velocity during kick swing, normalized with gamma curve (γ=0.7) to lift soft kicks
3. **Kick detection** = ankle velocity exceeds threshold within an 8-frame window (~130ms)
4. **Debounce** = 400ms cooldown between kicks; require wind-up pattern (knee lift → ankle snap)
5. **Single-phase input** for AR (kick swing = lock aim + power simultaneously), vs two-phase for pointer

### Fallback Strategy (unanimous — 5 layers)
| Failure | Response |
|---------|----------|
| Webcam permission denied | Toast + fall back to pointer |
| No camera on device | Toast + fall back to pointer |
| MediaPipe WASM fails to load | Toast + fall back to pointer |
| Tracking lost (>30 frames, no landmarks) | "Step back into frame" hint; re-attempt; fall back if persistent |
| FPS drops below 20 for >2 seconds | Toast + fall back to pointer for session |
| Manual toggle | Button always works to switch modes |

### Calibration Flow (unanimous)
One-time 15-second flow in `CAMERA_INIT`:
1. Neutral pose (2s) → record `legAngleRest`
2. Swing left → record left extreme
3. Swing right → record right extreme
4. Soft kick → record `V_MIN`
5. Hard kick → record `V_MAX`
6. Persist to `localStorage` under `C.POSE_CALIBRATION_KEY`

If skipped: use hardcoded defaults. Re-calibrate button always available.

---

## 3. Resolved Disagreements

| Question | Architect | Dev | QA | Resolution |
|----------|-----------|-----|-----|------------|
| State machine changes | New `CAMERA_INIT` state with transitions | No new states — AR is input source, not game state | Add `inputMode` field for fallback testing | **Architect wins.** `CAMERA_INIT` is cleaner — it's a real game state with async entry conditions (camera + model init). QA's `inputMode` field is added to the state object. |
| Module naming | `camera.js`, `pose.js`, `poseMapping.js`, `poseInput.js` | `ar-pose.js`, `ar-tracker.js`, `ar-render.js` | Split into `pose-math.js` (pure) + `ar-controller.js` (browser) | **Compromise:** `camera.js`, `pose.js`, `poseMapping.js` (pure, Node-testable per QA), `poseInput.js`. `ar-render.js` functions go into existing `render.js` (it's already the only module touching canvas). |
| Automated tests | 30-line `poseMapping.js` unit test | Not specified | Pure-function `pose-math.js` unit test + Playwright fallback tests | **QA wins.** Extract `poseMapping.js` as pure functions, add Node unit test. Playwright tests are manual-only (fake video capture), not CI. |
| Effort estimate | 12-18 hours | 14-20 hours | Not estimated | **Use dev's 14-20 hours** — more conservative and includes QA's recommended testing. |

---

## 4. Implementation Milestones

Thin vertical slices. Each milestone is demonstrable.

| Milestone | Scope | Exit Condition | Effort |
|-----------|-------|----------------|--------|
| **M1 — Camera + skeleton** | Webcam stream → canvas, MediaPipe runs per frame, skeleton overlay drawn. Fallback on permission denial. | Point webcam at yourself, see stickman skeleton tracked in real-time. | 4–6 hrs |
| **M2 — Kick detection algorithm** | `poseMapping.js` pure functions. Detect kick from landmark history. Emit aim + power. Unit-tested with synthetic data. | Replay a recorded kick → `{ aim: 0.4, power: 0.8 }` printed to console. | 3–4 hrs |
| **M3 — Wire AR into game** | `poseInput.js` events feed into existing state machine. Mode toggle button. Two-kick flow (first kick = aim, second = shoot). | Aim by pointing leg, kick by kicking — virtual ball flies where foot aimed. | 3–4 hrs |
| **M4 — Polish + calibration + fallback** | Calibration flow, smoothing, wind-up detection, FPS monitor, 5-layer fallback, edge cases. | Works perfectly with mouse. Camera enables AR. Revoking permission mid-game silently falls back. | 4–6 hrs |
| **Total** | | | **14–20 hrs (~2–3 working days)** |

---

## 5. New File Structure

```
penalty-kick-game/
├── index.html              # + MediaPipe CDN scripts, + AR toggle button, + hidden <video>
├── style.css               # + AR button styles, + camera status indicator
├── src/
│   ├── constants.js        # + C.AR block
│   ├── state.js            # + CAMERA_INIT state, + inputMode/cameraStatus fields
│   ├── audio.js            # (unchanged)
│   ├── keeper.js           # (unchanged)
│   ├── physics.js          # (unchanged)
│   ├── render.js           # + drawWebcamPreview, drawPoseOverlay, drawKickTrail
│   ├── input.js            # + InputMode enum, + setMode(), gate pointer when AR active
│   ├── main.js             # + AR wiring, CAMERA_INIT flow, input mode switching
│   ├── camera.js           # NEW: getUserMedia wrapper, video feed management
│   ├── pose.js             # NEW: MediaPipe Pose loader + inference
│   ├── poseMapping.js      # NEW: pure functions, landmarks → aim + power (Node-testable)
│   └── poseInput.js        # NEW: event surface matching input.js
├── shared-memory/          # Planning docs
├── test-state.js           # (existing)
├── test-pose-mapping.js    # NEW: unit tests for poseMapping.js
├── AR-PLAN.md              # This file
├── PLAN.md                 # Original game plan
├── README.md
└── .gitignore
```

---

## 6. Key Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| **False positive kick detection** (player shifts weight → phantom shot) | Require wind-up pattern (knee lift → ankle snap within 300ms). 400ms cooldown. Start with high velocity threshold, lower based on testing. |
| **Pose → shot mapping feels wrong** (coupled to physical setup) | Build calibration first. Test with 3 real people before finalizing defaults. Generous dead zones. Re-calibrate button. Log calibration data to localStorage. |
| **Performance drops below 30fps on low-end hardware** | `modelComplexity: 0`, 640x480 capture, no segmentation. Adaptive frame skip if inference >20ms. FPS monitor triggers fallback if <20fps for >2s. |
| **Tracking silently degrades** (jittery, inaccurate aim in poor conditions) | Real-time confidence indicator (green/yellow/red dot). Aggressive fallback: confidence <0.6 for >1s → show hint. Test in dim light, loose clothing, 2m distance. |
| **Webcam permission denied** (user clicks "block" by accident) | Toast with clear message. One-click manual toggle to retry. Game fully playable with mouse. |
| **CDN unavailable** (user offline or jsdelivr blocked) | Model load failure → toast + permanent pointer mode for session. Game still playable. |

---

## 7. Test Strategy

| Test Type | What | How |
|-----------|------|-----|
| **Unit (Node)** | `poseMapping.js` pure functions: aim angle from landmarks, power from velocity, clamp logic | `test-pose-mapping.js` — synthetic landmark arrays, assert expected output ±0.05 rad |
| **Unit (Node)** | State machine: `inputMode` transitions, fallback path | Extend `test-state.js` to cover new fields |
| **Manual (browser)** | Full AR pipeline with real webcam | Play 10 shots, verify aim accuracy ≥80%, power accuracy ≥70% |
| **Manual (browser)** | Each of 5 fallback scenarios | Deny camera, abort model fetch, cover lens, unplug camera, toggle mode |
| **Manual (Playwright)** | Headless smoke test with fake video | `--use-file-for-fake-video-capture`, assert game boots and accepts input |
| **Manual (real device)** | Low-end laptop test | 4GB RAM, no dGPU, built-in webcam. Play 10 shots. Verify ≥30fps. |
| **Playtest (5 people)** | "Wow" factor | Zero instructions. Measure time-to-discovery, kick success rate, "would you show this to a friend?" |

---

## 8. Immediate Next Steps

1. Add MediaPipe CDN scripts + AR button + hidden `<video>` to `index.html`
2. Add `C.AR` block to `constants.js`
3. Add `CAMERA_INIT` state + new fields to `state.js`
4. Implement `camera.js` (getUserMedia wrapper)
5. Implement `pose.js` (MediaPipe loader + inference)
6. Implement `poseMapping.js` (pure mapping functions)
7. Write `test-pose-mapping.js` and verify algorithm before wiring into game
8. Implement `poseInput.js` + wire into `main.js`
9. Add `InputMode` + `setMode()` to `input.js`
10. Add AR rendering functions to `render.js`
11. Test with real webcam, tune thresholds
12. Implement 5-layer fallback
13. Playtest with 5 people
