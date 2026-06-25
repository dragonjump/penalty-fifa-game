# AR Kick Game — Design Specification

Design spec for three improvements to the webcam-based penalty kick game:
(1) a virtual target ball the player aims at, (2) foot-based aim that matches
player intuition, and (3) a power model that captures the "whip" of a real kick.

The spec is written to be implemented verbatim. Every equation, landmark index,
coordinate transform, and edge case is spelled out. Coordinate convention is the
same as the existing codebase: MediaPipe normalized coords, `y`-down, `x` in
`[0,1]`. The player faces the camera; their physical right leg appears on the
**left** of the mirrored selfie frame. All "aim" values are in the **game**
frame where `+x` = screen right = player's physical right.

---

## 1. Virtual Target Ball

### 1.1 Purpose
Give the player a clear, animated target on the pitch that reads as "the ball
I am aiming at with my real foot." Currently the ball only exists as a physics
trajectory; the player has no static visual anchor during the AIMING state.

### 1.2 Position & Size
- Center: `(C.BALL_START_X, C.BALL_START_Y)` — the existing penalty spot.
- Radius: `C.TARGET_BALL_RADIUS = 30` px (logical). This is larger than the
  in-flight ball (`C.BALL_RADIUS = 9`) so it reads as a prominent target, not
  the moving ball.
- The existing 2.5 px penalty-spot dot should still render underneath as a
  grounding marker.

### 1.3 Animation States
The target ball is a small state machine driven by `s.state`:

| State | Visual |
|-------|--------|
| `MENU` / `CAMERA_INIT` | Hidden (no target until a match/AR session begins). |
| `AIMING` | Idle animation only (bob + glow pulse). |
| `POWER` | Idle animation continues; a faint aim-pulse ring scales with `s.power` so the player sees power building. |
| `SHOOTING` | Kick-off animation: ball launches along the computed Bezier, spins, emits a particle burst at launch. |
| `RESULT` | Hidden (the result message takes over). |

#### 1.3.1 Idle animation (AIMING + POWER)
Two layered effects, both time-based using `scene.now` (ms):

- **Bob**: vertical sinusoid, small amplitude so it feels alive but not
  distracting.
  ```
  bob = sin(now / 600 * 2π) * 2.5   // px, ±2.5
  drawY = BALL_START_Y + bob
  ```
- **Glow pulse**: an outer radial glow whose alpha breathes.
  ```
  pulse = 0.5 + 0.5 * sin(now / 750 * 2π)   // 0..1
  glowAlpha = 0.15 + 0.25 * pulse
  glowRadius = TARGET_BALL_RADIUS * (1.5 + 0.3 * pulse)
  ```
  Drawn as a radial gradient circle **behind** the ball body (add a
  `drawTargetBallGlow` step before `drawBall`).

#### 1.3.2 "Kick me" prompt (AR only)
When AR mode is active and the player has not yet kicked, render a label above
the ball:

- Text: `"KICK ME"` (or localized). Font: `bold 14px sans-serif`, color
  `COL.uiText`, with a subtle `COL.uiShadow` offset.
- A small downward chevron bobbing beneath the text.
- **Fade logic**: the prompt has full opacity until the first successful kick
  event is emitted by `ArInput`. Store `s.firstKickDone` (bool, init `false`).
  On the first kick event, set `s.firstKickDone = true` and record
  `s.firstKickAt = now()`. The prompt alpha then decays:
  ```
  if (!firstKickDone) alpha = 1
  else alpha = max(0, 1 - (now() - firstKickAt) / 1200)
  ```
  After 1.2 s it is gone. It stays gone for the rest of the session (do not
  re-show on later shots).

#### 1.3.3 Kick-off animation (SHOOTING)
On launch (`fireShot()`), the target ball stops idling and becomes the in-flight
ball. To avoid a double-ball visual, the target ball should **morph** into the
flight rather than have a second ball appear:

- At `u = 0` (launch), the target ball is full size (30 px) at the spot.
- Over the first ~120 ms, shrink it from 30 px → 9 px (the flight ball radius)
  and begin following the Bezier. This hides the seam between the big target
  ball and the small flight ball.
- **Spin**: rotate a pentagon texture by `spinAngle = now() / 120 * 2π` while
  flying, proportional to power (higher power = faster spin).
- **Particle burst**: at launch, spawn `C.TARGET_BALL_PARTICLES = 14`
  particles at the spot. Each particle has:
  - position `(BALL_START_X, BALL_START_Y)`
  - velocity: random angle, speed `40..120` px/s scaled by `power`
  - life: `350..600` ms
  - radius: `1.5..3.5` px, color white with fading alpha
  - gravity: `+220` px/s² (y-down, so positive pulls them down)
  Particles are drawn as small filled circles in `drawParticles`, called after
  the ball. They are purely cosmetic and culled when dead.

### 1.4 Rendering Changes (`render.js`)
- Add `Renderer.prototype.drawTargetBall(x, y, radius, alpha, glowAlpha, glowRadius)`.
- Add `Renderer.prototype.drawParticles(particles)`.
- Add `Renderer.prototype.drawKickMeLabel(x, y, alpha)`.
- In `render()`, draw the target ball **instead of** the default static ball
  when `s.state === 'AIMING' || s.state === 'POWER'`. During `SHOOTING`, the
  target ball is replaced by the flight ball (`scene.ball`), so the default
  `drawBall` path is used. This means: in AIMING/POWER, do **not** draw the
  default static ball at the spot — draw the target ball there instead.
- Update `update()` in `main.js` to advance particle physics and the morph
  timer.

### 1.5 State Additions (`state.js` / `main.js`)
Add to the game state `s`:
- `s.firstKickDone = false`
- `s.firstKickAt = 0`
- `s.targetBallMorph = 0` (0..1, 1 = fully morphed to flight ball)
- `s.particles = []`

Reset `firstKickDone`/`firstKickAt` per **session** (in `startMatch`), but
keep `firstKickDone` persistent across rounds within a session so the label
only shows once. Reset `particles` and `targetBallMorph` per shot (in
`resetTransient`).

---

## 2. Foot-Based Aim Logic

### 2.1 Problem Statement
The current `computeShot` uses `legAngle(hip, knee, ankle)` = shin direction.
This is unintuitive: players think "I aim with my foot," and the shin angle
correlates poorly with intended direction, especially for across-body kicks.
The task asks us to rethink aim from first principles.

### 2.2 Key Landmarks (MediaPipe 33-point)
```
23  left hip     24  right hip
25  left knee    26  right knee
27  left ankle   28  right ankle
31  left foot    32  right foot   (foot index = tip of toe)
```
"Left/right" here is the **subject's** anatomical side. In the mirrored selfie
frame the subject's right leg is on the left of the image.

### 2.3 Recommended Approach: Foot-Travel Direction at Impact
After analyzing the physics described in the task brief, the cleanest and most
intuitive signal is **the direction the foot is traveling at the moment of
impact**:

> Foot moving right → ball goes right. Foot moving left → ball goes left.

This matches intuition for both right- and left-footed kickers and for both
across-body and natural swings, because the foot's velocity vector at contact
is what actually determines ball direction in real life. The "foot on left side
of ball → ball goes right" contact-position model is brittle (it depends on
precisely when in the swing you sample), so velocity direction is the primary
signal. We keep a secondary **stance** term for fine aim while standing still.

### 2.4 Aim Computation

#### 2.4.1 Detect the kicking foot
Use the foot **index** (landmark 32 / 31), not the ankle. The foot index moves
more than the ankle during a kick and is the part that contacts the ball.

```
footVel(side) = displacement of foot index over the buffer / dt
kickFoot     = footVel('right') >= footVel('left') ? 'right' : 'left'
plantFoot    = the other foot
```
Buffer entry shape changes to include foot indices:
```
{ right: {x,y}, left: {x,y}, rightFoot:{x,y}, leftFoot:{x,y}, t }
```
(`ar-input.js` must be updated to store `lm[32]` and `lm[31]`.)

#### 2.4.2 Primary signal: foot velocity direction
Compute the kicking foot's horizontal velocity over the last
`C.AR.AIM_VELOCITY_WINDOW_MS` (default 80 ms) of the buffer:

```
vx = (foot.x - footPrev.x) / dt    // normalized units/sec, game frame
```
Convert to aim. The foot's horizontal travel maps to aim with a gain
`C.AR.AIM_FOOT_VX_GAIN` (default `0.9`). Clamp to `[-1, 1]`:

```
aimFromVel = clamp(vx * AIM_FOOT_VX_GAIN, -1, 1)
```
**Sign / mirror handling.** MediaPipe `x` increases to the **image** right.
The selfie preview is mirrored for display, but the landmark `x` values
themselves are **not** automatically mirrored — they are in raw image space.
The existing code already accounts for this in `legAngle` (it negates). For foot
velocity we must be consistent:

- In raw image space, the player's physical-right foot is on the **image-left**
  (smaller `x`). When the player kicks to their physical right, their right
  foot travels toward image-**left** → `vx` (image) is **negative**.
- We want physical-right = positive aim. So:
  ```
  gameVx = -vxImage     // flip to game frame
  aimFromVel = clamp(gameVx * AIM_FOOT_VX_GAIN, -1, 1)
  ```
  This is the critical sign flip. **Verify empirically** with a debug overlay
  (§5.3) — if the ball goes the wrong way, invert this sign.

#### 2.4.3 Secondary signal: stance offset (for standing aim / fine tune)
When the foot is nearly still (no kick in progress), velocity is noise. Use the
**plant foot position relative to the body center** as a stable aim proxy.
This also lets the player adjust aim by shifting stance before kicking.

```
bodyCenterX = (hipLeft.x + hipRight.x) / 2          // image space
plantX      = plantFoot.x                            // image space
offset      = plantX - bodyCenterX                   // image space
```
The plant foot being to the image-left of body center means the player is
leaning/planting on their physical-right side → aim should go physical-right
(positive). So again flip to game frame:

```
aimFromStance = clamp(-offset * C.AR.AIM_STANCE_GAIN, -1, 1)
```
`C.AR.AIM_STANCE_GAIN = 2.2` (offset is small, ~0.05–0.15, so a higher gain
is needed). Dead-zone the raw offset:
```
if (Math.abs(offset) < C.AR.AIM_STANCE_DEAD_ZONE) aimFromStance = 0
```
`C.AR.AIM_STANCE_DEAD_ZONE = 0.03` (normalized).

#### 2.4.4 Blending the two signals
Use velocity when a kick is in progress (foot is moving), stance otherwise.
Blend on the kicking foot's speed:

```
speed = hypot(vx, vy) of kicking foot (image units/sec)
kickBlend = clamp(speed / C.AR.AIM_KICK_BLEND_SPEED, 0, 1)
// AIM_KICK_BLEND_SPEED = 0.6 (units/sec); above this, fully velocity-driven
aimRaw = lerp(aimFromStance, aimFromVel, kickBlend)
```
Apply the existing dead-zone and scale:
```
if (Math.abs(aimRaw) < C.AR.AIM_DEAD_ZONE) aimRaw = 0
aimAngle = clamp(aimRaw, -1, 1)
```
Note: the old `AIM_SCALE` (applied to leg-angle radians) is replaced by the
per-signal gains above. Keep `AIM_DEAD_ZONE = 0.04`.

#### 2.4.5 Smoothing
Keep EMA smoothing in `ar-input.js`:
```
this._smoothedAim = lerp(this._smoothedAim, aimAngle, 1 - C.AR.AIM_SMOOTHING)
```
`AIM_SMOOTHING = 0.35` (unchanged). Emit `this._smoothedAim` via `onAim`.

### 2.5 Edge Cases
- **Both feet moving** (player jumped / shifted): `pickKickingLeg` already
  picks the faster foot. The blend handles the transition.
- **Foot occluded** (visibility < 0.4): if the kicking foot's visibility is
  low, fall back to the **ankle** velocity (existing `ankleVelocity`) for that
  foot, and reduce `confidence`. If both feet are occluded, keep the last
  smoothed aim and decay confidence to 0.
- **Foot behind the body** (player turned): MediaPipe visibility drops; the
  `confidence` term already gates kick detection (`confidence > 0.4`). Do not
  fire a kick when confidence is low.
- **Left-footed kicker**: handled automatically — `pickKickingLeg` returns the
  left foot, and the same velocity/stance math applies. No special-casing.
- **Aim sign wrong**: this is the most likely bug. Provide a runtime toggle
  (`C.AR.AIM_INVERT = false`) that flips the sign of `gameVx` and
  `aimFromStance` so it can be fixed without a rebuild (§5.3).

### 2.6 Changes to `ar-mapping.js`
- Add `footVelocity(buffer, side)` — displacement of foot index (32/31) / dt.
- Add `pickKickingFoot(landmarks, buffer)` — returns `{ kickSide, plantSide,
  kick:{hip,knee,ankle,foot}, plant:{hip,knee,ankle,foot} }`.
- Add `computeAim(landmarks, buffer)` — implements §2.4. Pure, node-testable.
- Refactor `computeShot` to use `computeAim` for `aimAngle` instead of
  `legAngle`. Keep `kneeLift` and `confidence` computation.

### 2.7 Changes to `ar-input.js`
- Buffer entries store `rightFoot`/`leftFoot` (from `lm[32]`/`lm[31]`).
- Call `computeAim` + `computeShot` with the foot-aware functions.
- On kick event, the emitted `aimAngle` is the foot-based aim.

---

## 3. Power Detection Refinement

### 3.1 Problem Statement
Current power = ankle velocity, normalized and gamma-corrected. This misses the
"whip" — the knee snapping straight — and body lean. The task asks for a
combined power model.

### 3.2 Signals to Combine
Three signals, each normalized to `0..1`:

1. **Foot speed** (primary) — foot index (32/31) velocity magnitude of the
   kicking foot. This is the part that contacts the ball; it moves faster than
   the ankle during a whip.
2. **Knee extension speed** (the "whip") — rate of change of the knee angle.
   A fast-opening knee right at impact is what separates a tap from a rocket.
3. **Body lean** — hip vertical displacement. Leaning back (hips rising in
   image space, i.e. hip `y` **decreasing**) loads power; leaning forward
   (hip `y` increasing) unloads it.

### 3.3 Signal Extraction

#### 3.3.1 Foot speed (0..1)
```
footSpeed = kicking foot index velocity magnitude (units/sec)
footPower = clamp(footSpeed / C.AR.POWER_FOOT_MAX, 0, 1)
```
`C.AR.POWER_FOOT_MAX = 3.0` (foot moves faster than ankle; the old
`KICK_MAX_VELOCITY = 2.5` was for the ankle).

#### 3.3.2 Knee extension speed (0..1)
Use the existing `kneeAngle(hip, knee, ankle)` (radians, ~π = straight). The
**extension speed** is how fast the knee is opening:

```
kAngleNow  = kneeAngle(kick.hip, kick.knee, kick.ankle)
kAnglePrev = kneeAngle from the oldest buffer frame in the power window
kneeExtendRate = (kAngleNow - kAnglePrev) / dt   // rad/sec, +ve = opening
```
Map to power. A strong kick opens the knee at ~8–14 rad/s at the end of the
swing:
```
kneePower = clamp(kneeExtendRate / C.AR.POWER_KNEE_MAX, 0, 1)
C.AR.POWER_KNEE_MAX = 12.0   // rad/sec for full knee-whip credit
```
Only count **opening** (positive rate); a negative (re-bending) rate
contributes 0. This prevents the wind-up (knee bending) from inflating power.

#### 3.3.3 Body lean (0..1)
Track the kicking-side hip `y` over the power window. In image space, `y`
**decreasing** = hip rising = leaning back = loading power.

```
hipNow  = kick.hip.y
hipPrev = hip.y from oldest buffer frame in power window
lean    = (hipPrev - hipNow) / dt   // +ve = leaning back (image y decreasing)
bodyPower = clamp(lean / C.AR.POWER_LEAN_MAX, 0, 1)
C.AR.POWER_LEAN_MAX = 1.2   // units/sec; leaning back fast = full lean credit
```
Clamp negative lean (leaning forward) to 0 — it should not *subtract* power,
only fail to add it. (Subtracting would make the meter feel punishing.)

### 3.4 Combining the Signals
Weighted sum, then gamma-correct (the gamma lifts soft kicks, preserving the
existing feel):

```
rawPower = (C.AR.POWER_W_FOOT * footPower +
            C.AR.POWER_W_KNEE * kneePower +
            C.AR.POWER_W_BODY * bodyPower)
// weights sum to 1
rawPower = clamp(rawPower, 0, 1)
power = pow(rawPower, C.AR.POWER_GAMMA)
```
Default weights:
```
POWER_W_FOOT = 0.60   // foot speed dominates
POWER_W_KNEE = 0.30   // whip is the differentiator
POWER_W_BODY = 0.10   // lean is a subtle bonus
POWER_GAMMA  = 0.7    // unchanged from current
```

### 3.5 Calibration Approach
The current calibration captures `legAngleRest` (neutral shin angle). The new
model needs a **power baseline** so that a "medium" kick from any player maps
to ~0.5 power. Add to the calibration step:

- During `CALIBRATION_DURATION_MS` (1.5 s), the player stands neutrally, then
  performs **one slow, one medium, and one hard** kick (prompted by on-screen
  text: `"Now kick slowly"`, `"Now kick medium"`, `"Now kick hard"`).
- Record the peak `rawPower` of each. Use the medium kick to set
  `cal.powerMidRef` and the hard kick to set `cal.powerMaxRef`.
- At runtime, normalize: `rawPowerNorm = (rawPower - 0) / cal.powerMaxRef`,
  clamped. Fall back to the hardcoded `POWER_FOOT_MAX`/`POWER_KNEE_MAX` if
  calibration is absent.

For v1, ship the hardcoded defaults (§3.4) and make calibration **optional**
— the game must work well without it. Store calibration under the existing
`CALIBRATION_KEY` with a new shape:
```
{ legAngleRest, powerMidRef, powerMaxRef, ts }
```
Backwards-compat: if `powerMaxRef` is missing, use hardcoded normalization.

### 3.6 Changes to `ar-mapping.js`
- Add `kneeExtensionRate(buffer, side)` — returns rad/sec of knee opening.
- Add `bodyLeanRate(buffer, side)` — returns units/sec of hip rise.
- Add `computePower(landmarks, buffer, calibration)` — implements §3.3–3.4.
  Pure, node-testable.
- `computeShot` calls `computePower` instead of `ankleVelocity`-based power.

### 3.7 Changes to `ar-input.js`
- Buffer entries already extended with foot indices (§2.7).
- `computeShot` now returns the combined power. The kick **detection**
  threshold (`KICK_VELOCITY_THRESHOLD`) should switch from ankle velocity to
  **foot speed** of the kicking foot, since that's the relevant "did they
  actually kick" signal:
  ```
  kickDetectSpeed = kicking foot index speed (units/sec)
  if (windupActive && kickDetectSpeed > C.AR.KICK_VELOCITY_THRESHOLD && ...)
  ```
  Keep `KICK_VELOCITY_THRESHOLD = 0.12` but interpret it against foot speed
  (it's a low bar; foot speed will exceed it easily on a real kick).

---

## 4. Constants to Add/Modify

All under `C.AR.*` in `constants.js`. Additions:

```js
// ---- Virtual target ball (Feature 1) ----
TARGET_BALL_RADIUS: 30,            // prominent target ball radius (px)
TARGET_BALL_GLOW_COLOR: 'rgba(120,220,255,0.6)',
TARGET_BALL_PARTICLES: 14,         // launch burst particle count
TARGET_BALL_MORPH_MS: 120,         // shrink 30px -> 9px at launch (ms)
KICK_ME_LABEL: 'KICK ME',          // AR prompt text
KICK_ME_FADE_MS: 1200,             // prompt fade duration after 1st kick

// ---- Foot-based aim (Feature 2) ----
AIM_VELOCITY_WINDOW_MS: 80,        // time window for foot velocity (ms)
AIM_FOOT_VX_GAIN: 0.9,             // foot vx (game frame) -> aim
AIM_STANCE_GAIN: 2.2,              // plant-foot offset -> aim
AIM_STANCE_DEAD_ZONE: 0.03,        // normalized; ignore tiny stance offsets
AIM_KICK_BLEND_SPEED: 0.6,         // foot speed (units/sec) for full vel blend
AIM_INVERT: false,                 // runtime sign flip for aim (debug/fix)

// ---- Power refinement (Feature 3) ----
POWER_FOOT_MAX: 3.0,               // foot speed (units/sec) -> full footPower
POWER_KNEE_MAX: 12.0,              // knee extension rate (rad/sec) -> full kneePower
POWER_LEAN_MAX: 1.2,               // hip rise rate (units/sec) -> full bodyPower
POWER_W_FOOT: 0.60,                // weight for foot speed
POWER_W_KNEE: 0.30,                // weight for knee whip
POWER_W_BODY: 0.10,                // weight for body lean
// POWER_GAMMA: 0.7,               // keep existing
```

### 4.1 Constants to Modify
- `ANKLE_BUFFER_SIZE`: increase from `8` to `12` (~200 ms @ 60 fps) so the
  power/aim windows have enough history. Rename usage contextually; the buffer
  now serves both aim and power.
- `KICK_VELOCITY_THRESHOLD`: keep `0.12` but now compared against **foot
  speed** (§3.7). Add a comment clarifying this.
- `AIM_SCALE`: deprecated by the new per-signal gains. Keep the constant for
  backwards compat but stop using it in `computeAim`. (Remove in a follow-up.)
- `AIM_DEAD_ZONE`: keep `0.04`.
- `AIM_SMOOTHING`: keep `0.35`.

### 4.2 New Colors (`C.COLORS`)
```js
targetBallGlow: 'rgba(120,220,255,0.6)',
targetBall: '#fafafa',             // reuse COL.ball
kickMeLabel: '#f5f5f5',            // reuse COL.uiText
particle: 'rgba(255,255,255,0.9)'
```

---

## 5. Implementation Notes

### 5.1 Files to Change
| File | Change |
|------|--------|
| `src/constants.js` | Add all constants in §4. |
| `src/ar-mapping.js` | Add `footVelocity`, `pickKickingFoot`, `computeAim`, `kneeExtensionRate`, `bodyLeanRate`, `computePower`. Refactor `computeShot`. |
| `src/ar-input.js` | Store foot indices in buffer; use foot speed for kick detection; call new mapping functions. |
| `src/render.js` | Add `drawTargetBall`, `drawTargetBallGlow`, `drawParticles`, `drawKickMeLabel`. Update `render()` to draw target ball in AIMING/POWER and particles in SHOOTING. |
| `src/main.js` | Add state fields (`firstKickDone`, `firstKickAt`, `targetBallMorph`, `particles`); update `resetTransient`, `fireShot`, `update` (particle physics + morph + first-kick flag), `draw` (pass target ball scene). |
| `src/state.js` | Add new fields to `createInitialState()` if state is defined there (check; `main.js` inits some fields inline). |
| `index.html` | No structural changes needed. Optionally add a calibration UI later. |

### 5.2 Render Pipeline (updated draw order in `render()`)
```
1. clear
2. drawPitch
3. drawGoal
4. drawRipple
5. drawTargetBallGlow          [AIMING/POWER only]
6. drawTargetBall              [AIMING/POWER only; replaces static ball]
7. drawKickMeLabel             [AR + AIMING/POWER, first kick not done]
8. drawStickman(keeper)
9. drawBall(flight ball)       [SHOOTING/RESULT only]
10. drawParticles              [SHOOTING only]
11. drawStickman(kicker)
12. drawAimLine / drawPowerBar [AIMING/POWER]
13. drawScoreboard
14. drawMessage
15. drawArPreview              [AR, last]
16. drawCameraPrompt           [CAMERA_INIT]
```
The key change: in AIMING/POWER, draw the **target ball** (steps 5–7) instead
of the default static ball. In SHOOTING, draw the **flight ball** (step 9) and
**particles** (step 10). The target ball's morph (§1.3.3) bridges the two.

### 5.3 Testing Approach
- **Unit tests for pure functions** (`ar-mapping.js`): the existing file is
  node-testable. Add tests for `computeAim` and `computePower` with synthetic
  landmark buffers:
  - Foot moving image-left at known vx → expect positive aim (verifies the
    critical sign flip in §2.4.2).
  - Foot moving image-right → expect negative aim.
  - Plant foot offset left/right of body → expect corresponding stance aim.
  - Knee opening at 12 rad/s → kneePower ≈ 1.
  - Hip rising at 1.2 units/sec → bodyPower ≈ 1.
  - Combined power weights sum correctly.
- **Debug overlay** (temporary, gated by `C.AR.DEBUG_AIM = false`): in the AR
  PiP, draw the kicking foot velocity vector as an arrow and print
  `{aimFromVel, aimFromStance, kickBlend, aimAngle}` as text. Use this to
  verify the aim sign on a real player before shipping. If the ball goes the
  wrong way, flip `AIM_INVERT`.
- **Manual playtest checklist**:
  - Right-footed kick to screen-right → ball goes right.
  - Left-footed kick to screen-right → ball goes right.
  - Soft tap → low power, ball falls short.
  - Hard kick with knee whip → high power, ball reaches goal.
  - Lean back during kick → slightly more power than neutral.
  - "KICK ME" label appears in AR, fades after first kick, never returns.
  - Target ball bobs/pulses in AIMING, morphs + bursts on launch.
- **Performance**: pose runs at 30 fps; the new math is O(1) per frame. Particles
  are capped at 14 and culled quickly. No per-frame allocations in the hot path
  beyond the existing buffer.

### 5.4 Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Aim sign is flipped | `AIM_INVERT` runtime toggle + debug overlay (§5.3). |
| Foot index less visible than ankle | Fall back to ankle when foot visibility < 0.4 (§2.5). |
| Power too twitchy | EMA smoothing on aim; gamma on power; dead-zones on stance. |
| Calibration burden | Ship with good hardcoded defaults; calibration optional (§3.5). |
| Double ball at launch | Morph animation (§1.3.3) + draw-target-ball-only-in-AIMING logic (§5.2). |
| Buffer too short for power window | `ANKLE_BUFFER_SIZE` → 12 (§4.1). |

### 5.5 Out of Scope (for a follow-up)
- Full calibration UI (v1 uses hardcoded defaults).
- Left/right foot auto-detection tutorial.
- Aim assist / magnetism for accessibility.
- Haptic/audio cues tied to power (a "whoosh" pitch by power would be nice).
