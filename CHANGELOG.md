# Changelog — PenaltyKick AR Game

## [Unreleased] — Major Update

### Game Changes

**Match format**
- Changed from best-of-5 to **best-of-10** (first to 5 wins)

**App renamed**
- Title: `PenaltyKick — AR Webcam Shootout`

---

### AR Mode — Complete Overhaul

**1. Simplified aim mapping** (`src/ar-mapping.js`)
- Rewrote from scratch — removed complex `legAngle`, `pickKickingLeg`, `ankleVelocity` functions
- New simple approach:
  - `computeFootAim()` — foot displacement from own hip × scale = aim direction
  - `computeBodyLean()` — shoulder offset from hip center = body orientation
  - `computeCombinedAim()` — blends foot (70%) + body lean (30%)
- Foot pulled left of hip → aim right (positive)
- Foot pushed right of hip → aim left (negative)
- Dead zones prevent drift in neutral stance

**2. Body lean detection**
- Uses shoulder offset relative to hip center (more reliable than hip asymmetry)
- If shoulders shift left of hips → player leans right → aim goes right
- Falls back to hip asymmetry when shoulders not visible

**3. Kick detection** (`src/ar-input.js`)
- Now uses `max(footVelocity, ankleVelocity)` — foot moves faster than ankle during kick
- Buffer stores foot positions (`rightFoot`/`leftFoot`) for velocity calculation
- Lowered threshold: `0.06` (was `0.12`)
- Lowered confidence gate: `0.2` (was `0.3`)
- Wind-up reset at `kneeLift < 0.15` (stays active longer)

**4. Full body outline** (`src/render.js`)
- New `_drawBodyFull()` draws complete skeleton on camera preview:
  - Yellow = head
  - Red = torso
  - Blue = arms
  - Green = legs
  - White dots = keypoints
- Integrated into PiP (picture-in-picture) camera preview

**5. Debug overlay panel** (`src/render.js`)
- Toggle button (default OFF) appears when AR mode activated
- Shows real-time metrics:
  - STATUS, AIM, FOOT AIM, BODY LEAN, FOOT VEL, KNEE LIFT, WINDUP, CONFIDENCE, COOLDOWN
  - Visual threshold bar for kick detection
  - ">>> KICK DETECTED!" flash on successful kick

**6. Virtual ball positioning** (`src/main.js`)
- Ball now positions in front of kicking foot (not at center penalty spot)
- Uses foot landmark to compute ball position relative to player

---

### Portrait Mode Layout

**Canvas sizing** (`src/render.js`, `style.css`)
- Portrait: canvas takes top ~65% of screen height
- Landscape: canvas fills viewport (as before)

**Camera preview** (`src/render.js`)
- Portrait: wide bar at bottom of canvas (~30% height), centered horizontally
- Landscape: smaller box in corner (45% width)

**CSS layout** (`style.css`)
- Portrait: `flex-direction: column`, game at top (`justify-content: flex-start`)
- Landscape: centered (as before)

---

### UI Changes

**Buttons** (`index.html`)
- AR Mode button: always visible (polls for MediaPipe to load), toggles AR on/off
- Debug button: small toggle, default hidden, appears when AR activated
- Debug button visual state: green = ON, gray = OFF

**Toast notifications** (`src/main.js`)
- Shows actual error message on AR init failure
- "AR disabled" / "Tracking lost" / "Tracking recovered" feedback

**7. Portrait mode — camera fills blank space** (`src/render.js`)
- Problem: in portrait mode, canvas was fixed at 720px height, leaving blank space below the game on tall screens
- Solution: canvas logical height is now **extended** to fill the full screen
  - Game area (pitch, goal, ball) is clipped to the top 720px (original game area)
  - Camera preview fills the remaining bottom area
  - No blank space — camera takes all available height
- `resize()` computes `_cameraAreaH` (extra height in canvas coordinates)
- `render()` clips game drawing to `y < CANVAS_HEIGHT` so game doesn't bleed into camera area
- `drawArPreview()` uses `_cameraAreaH` to size the camera preview in portrait mode

---

### New Constants (`src/constants.js`)
- `BEST_OF: 10` (was 5)
- `PIP_WIDTH_PCT: 0.45` (replaces fixed `PIP_WIDTH: 120`)
- `BODY_LEAN_AIM_WEIGHT: 0.3` (how much body lean adds to aim)
- `FOOT_AIM_SCALE: 6.0` (foot displacement → aim multiplier)
- `KICK_VELOCITY_THRESHOLD: 0.06` (was 0.12)
- `WINDUP_KNEE_MIN_ANGLE: 0.6` (now actually used in code)

---

### Test Results
- `test-ar-mapping.js`: **16/16 passed** (rewritten for new API)
- `test-state.js`: all passed (no changes to state machine)
- All 11 JS files pass `node --check`

### Architecture Notes
- All code follows existing IIFE module pattern with no bundler
- `ar-mapping.js` is pure (no browser dependencies, Node-testable)
- `render.js` is the only module touching `ctx`
- `main.js` owns transient animation state and wires everything together
