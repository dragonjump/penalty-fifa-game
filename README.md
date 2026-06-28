# Penalty Kick — Stickman Shootout

A mobile-first, browser-based penalty shootout game with programmatic stickman art, an AI keeper, and synthesized sound. No build step, no dependencies — just open `index.html`.

## Article
`https://www.linkedin.com/pulse/loop-engineering-claude-code-build-ar-motion-penalty-sean-lon-xjrpc/`


## Run

```
# Any static server works. Simplest:
python3 -m http.server 8000
# then visit http://localhost:8000
```

Or open `index.html` directly in a browser (classic `<script>` tags, no ES modules, so `file://` works).

**For AR mode (webcam kick detection):** A local server is required — webcam access needs `http://localhost` (not `file://`). Use:
```
python3 -m http.server 8080
```
Then open `http://localhost:8080` in Chrome or Edge.

## Controls

| Action | Mouse / Touch | Keyboard |
|--------|---------------|----------|
| Aim | Drag left/right | ← / → |
| Lock aim / Start power | Release drag | Space / Enter |
| Lock power / Shoot | Tap / Click | Space / Enter |
| Back to menu | — | Esc |

## Modes

- **Best-of-5** (default): first to 3 wins the match.
- **Endless**: score as many goals as you can; a miss ends the run. High score saved in `localStorage`.

## Difficulty

Easy / Normal / Hard — changes keeper reaction time, dive spread, reach, and fumble chance.

## AR Mode (Webcam Kick Detection)

Click the **"AR Mode"** button (top-left corner) to enable webcam-based kick detection. Uses MediaPipe Tasks Vision to track your leg — lift your knee to aim, kick to shoot. The virtual ball follows your real leg direction and speed.

- **Green dot** = tracking active
- **Red dot** = tracking lost (step back into frame)
- Falls back to mouse/touch if camera is unavailable

## Files

```
index.html              # entry point
style.css               # layout + responsive scaling
src/constants.js        # all magic numbers (tweak me for game feel)
src/state.js            # state machine + transition table
src/input.js            # pointer + keyboard, two-phase aim/power
src/physics.js          # Bezier ball trajectory
src/keeper.js           # keeper AI (per-shot randomized dive)
src/render.js           # all Canvas 2D drawing
src/audio.js            # WebAudio synth beeps (lazy, cuttable)
src/main.js             # bootstrap + game loop
src/ar-mapping.js       # pure functions: landmarks → aim + power (Node-testable)
src/ar-input.js         # AR kick detection, wind-up + cooldown
src/ar-pose.js          # MediaPipe Tasks Vision loader + webcam capture
test-state.js           # node test-state.js (state machine sanity)
test-ar-mapping.js      # node test-ar-mapping.js (17 mapping unit tests)
serve.bat               # double-click to start local server for AR mode
```

## Tune

Edit `src/constants.js` to change geometry, flight time, power curve, difficulty profiles, and colors.
