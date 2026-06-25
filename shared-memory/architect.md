# Software Architect — Penalty Kick Stickman Game

## 1. Tech Stack Recommendation

**Choice: HTML5 Canvas 2D + vanilla ES6 modules, no framework, no bundler.**

Specifically:
- `index.html` — one page, one `<canvas>`, minimal DOM chrome (scoreboard overlay).
- `style.css` — layout + responsive scaling, nothing else.
- JS split into small single-responsibility files loaded via `<script type="module">`:
  - `main.js` — bootstrap, game loop (`requestAnimationFrame`).
  - `state.js` — state machine + game state.
  - `input.js` — pointer/touch/keyboard handler.
  - `physics.js` — ball trajectory, collision checks.
  - `render.js` — all Canvas draw calls (goal, stickmen, ball, net, UI).
  - `keeper.js` — keeper AI decision logic.
  - `audio.js` — lazy-loaded sound effects.
- Deploy as a zip to itch.io or push to GitHub Pages. No `npm install`, no build step.

**Why this stack and not the obvious alternatives:**

| Alternative | Why rejected |
|---|---|
| React + Vite + Phaser | Phaser is a full game engine with its own scene graph, physics, and asset pipeline — massive overkill for a stickman-and-circle game. React adds a virtual DOM layer that does nothing useful for a 60fps canvas game. Vite adds tooling overhead for zero benefit when there are no npm dependencies. The engineering doc's 30% overhead estimate is conservative — I'd say 50%. |
| Unity WebGL | The build size alone (~10 MB minimum) kills the "open and play instantly" casual use case. The editor is heavy, the C# compile-build-deploy loop is slow, and the WebGL target has quirks with audio and input. This is a sledgehammer for a nail. |
| Godot | Lighter than Unity but still a full editor + scene system. Exporting to HTML5 works but produces a large binary. The learning curve for a tool designed around nodes and scenes is not justified for a game with three entities (ball, kicker, keeper). |
| PixiJS / Three.js | PixiJS is a reasonable middle ground and I'd consider it if the game had more entities or needed sprite atlases. For a stickman drawn with `lineTo` calls, it's unnecessary. Three.js is 3D — wrong tool entirely. |
| Pure DOM (no canvas) | Possible (position divs, CSS transitions) but rotation, arcs, and smooth 60fps animation become hacky. Canvas is the right abstraction for a trajectory-based game. |

**The core argument:** The game has three moving entities, one input vector, and a 2D scene. That is a ~500-line Canvas program. Any framework adds more conceptual weight than it removes. The fastest path to "playable" is "open a file and it runs," which vanilla ES modules deliver natively in every modern browser.

## 2. Project Structure

```
penalty-kick-game/
├── index.html              # Entry point, canvas element, script imports
├── style.css               # Layout, responsive scaling, scoreboard styling
├── src/
│   ├── main.js             # Bootstrap, rAF loop, fixed-timestep accumulator
│   ├── state.js            # State enum, transition table, game state object
│   ├── input.js            # Pointer + keyboard abstraction, aim/power state
│   ├── physics.js          # Ball trajectory, collision detection, goal check
│   ├── render.js           # All draw functions (goal, stickmen, ball, net, FX)
│   ├── keeper.js           # Keeper AI: dive decision, difficulty scaling
│   ├── audio.js            # WebAudio synth beeps + optional sample playback
│   └── constants.js        # All magic numbers (speeds, sizes, timings) in one place
├── shared-memory/          # Planning docs (context, business, engineering, architect)
├── README.md               # How to run, controls, credits
└── .gitignore              # (empty — no node_modules, no build artifacts)
```

**Module boundaries:**
- `render.js` is the only module that touches the Canvas 2D context. Everything else passes plain data.
- `physics.js` is pure functions: given (ball state, time delta), returns (new ball state, collision event). No side effects.
- `state.js` owns the single source of truth. Other modules read from it; only `state.js` mutates it via `transition(action)`.
- `input.js` converts raw DOM events into intent objects (`{ type: 'AIM', angle: 0.7 }` or `{ type: 'SHOOT', power: 0.8 }`). It does not mutate game state directly — it dispatches to `state.js`.
- `keeper.js` is called once per shot with the current difficulty level and returns a dive decision (zone + timing). It is stateless per shot (no hidden state between calls) to keep it testable.

## 3. Core Systems

The game needs exactly five subsystems:

### System 1: State Machine
States: `MENU → AIMING → POWER → SHOOTING → RESULT → GAME_OVER` (and back to `MENU`).

Why a state machine and not boolean flags: the engineering doc flagged this as a real risk. With six states and multiple inputs, ad-hoc `isShooting && !showResult` flags tangle fast. A transition table (`allowedTransitions[state] → [allowed next states]`) makes illegal transitions impossible by construction. Every input handler checks `transition()` before acting.

### System 2: Input Abstraction
Unified pointer (mouse + touch) and keyboard handling. The input flow is two-phase:
1. **Aim phase:** drag to set angle, release to lock. A faint aim line previews trajectory.
2. **Power phase:** an oscillating power bar appears; click to lock power.

This two-phase design (recommended in the engineering doc) avoids the "which axis does what" ambiguity of single-drag input. On mobile, the aim line is always visible during phase 1 since there is no hover.

### System 3: Ball Physics
Not a physics engine — a parametric trajectory. The ball follows a quadratic Bezier from spot to target, with:
- Control point height determines arc (higher = more lob).
- Total flight time is fixed (~600ms) regardless of distance, so power affects arc height, not speed.
- A slight lateral curve (Bezier control point offset) rewards corner shots by making them harder to read but more reliable once placed.

Collision check at the keeper plane: if the ball's lateral position at the keeper line falls within the keeper's current dive reach, it's a save. This is a simple 1D interval overlap test, not a 2D collision mesh.

### System 4: Keeper AI
Per shot, the keeper picks a dive zone (one of 5 zones: top-left, top-right, bottom-left, bottom-right, center) based on:
- **Easy:** uniform random, 200ms reaction delay.
- **Normal:** slight bias toward center (where most players aim), 180ms delay.
- **Hard:** weighted toward the player's last 3 shot zones (simple frequency count), 150ms delay.

The keeper commits to a dive on shot release (not before — to prevent exploitation) and the dive animation plays over 300ms. The keeper cannot change mid-dive. This makes the AI beatable but not trivial, and the difficulty is tunable by adjusting the reaction delay and zone weights.

### System 5: Renderer
All Canvas 2D. Draw order each frame:
1. Background (pitch gradient).
2. Goal frame (posts, net lines).
3. Net ripple FX (if active, decays over 400ms).
4. Keeper stickman (drawn from joints, animated via interpolation between poses).
5. Ball (circle with rotation indicator).
6. Kicker stickman (wind-up pose during SHOOTING, idle otherwise).
7. UI overlay (scoreboard, power bar, aim line).

Stickmen are drawn programmatically: a circle head, line body, two arms, two legs. Poses are defined as joint-angle objects. Animation is linear interpolation between poses over a fixed duration. No sprite sheets, no asset pipeline.

## 4. Key Design Decisions

### Turn-based, not real-time
The game is fundamentally turn-based: player aims, player shoots, ball travels, result resolves, repeat. There is no continuous simulation happening during the aim phase. The only real-time element is the ball flight animation (~600ms) and keeper dive animation (~300ms). This is not a real-time game with a game loop updating physics every frame — it is a turn-based game with animated transitions. The `requestAnimationFrame` loop is only needed for smooth animation during the SHOOTING state; the other states can render once on state change.

### Side view, not top-down
The player sees the goal from behind the kicker, looking toward the goal. The aim line shows a 2D vector on the ground plane (lateral + depth implied by arc height). This is the classic penalty game view and it maps naturally to a 2D canvas: x-axis is lateral aim, y-axis is arc height. A top-down view would require the keeper to be a 2D zone on the ground, which is less visually satisfying and harder to read at a glance.

### Deterministic ball, randomized keeper
The ball trajectory is fully deterministic given (aim angle, power). There is no randomness in where the ball goes — the player's input is the sole determinant. The keeper's dive is randomized (within difficulty constraints). This asymmetry is intentional: the player should feel agency over their shot, and the keeper should feel like an unpredictable opponent. If the ball had random scatter, the player would blame the game instead of their aim.

### Keeper commits on release, not on aim
The keeper does not know where the player is aiming during the aim phase. The keeper picks a dive zone at the moment of shot release (with a reaction delay baked into the animation timing). This prevents the "aim the other way after the keeper commits" exploit while keeping the keeper beatable — the player can still aim to the opposite corner and beat the keeper's guess.

### No persistence beyond localStorage
High score (endless mode streak) and best-of-5 result are stored in `localStorage`. No server, no accounts, no leaderboards. This is a client-only game. If the player clears browser data, scores reset. This is acceptable for a casual game and avoids any backend complexity.

## 5. What to Defer

The architecture should **not** optimize for:

1. **Extensibility / plugin architecture.** This is one game, not a platform. If v2 happens, it will be a rewrite, not an extension. Do not build abstractions for hypothetical future games.

2. **Multiplayer.** The business doc is correct: multiplayer doubles complexity. The state machine, input handler, and physics are all single-player by design. Adding networked multiplayer would require a complete re-architecture (authoritative server, rollback, interpolation). Do not leave "hooks" for this — it creates dead code.

3. **Asset pipeline.** There are no assets. Stickmen are drawn with Canvas paths. Sound is synthesized beeps or short WAVs loaded on demand. Do not set up Webpack asset loaders, texture atlases, or sprite sheet generators.

4. **Accessibility beyond basics.** Keyboard controls (arrow keys for aim, space for shoot/power) should work, and that is sufficient. Screen reader support, colorblind modes, and remappable controls are v2 concerns.

5. **Internationalization.** All UI text is hard-coded English. The game is visually self-explanatory. If v2 targets global distribution, add i18n then.

6. **Performance.** Canvas 2D rendering three entities at 60fps is trivial. Do not optimize draw calls, do not reach for WebGL, do not profile. The bottleneck will be human reaction time, not frame rate.

7. **Test infrastructure beyond sanity checks.** The engineering doc's testing strategy is correct: automated tests for round logic and state machine transitions, manual smoke testing for feel. Do not set up Jest, Playwright, or CI pipelines for this project.

## 6. Biggest Architectural Risk

**The two-phase input design (aim → power) is the hardest decision to reverse.**

Here is why: the entire state machine, input handler, and rendering flow are built around the assumption that the player first locks aim, then locks power. If playtesting reveals that two-phase input feels slow or confusing — that players want a single fluid drag-to-shoot gesture — then the state machine needs a new state removed, the input handler needs reworking, the power bar UI is discarded, and the "feel" of the shot changes fundamentally.

This is the risk because:
- It is baked into the state machine from day one (System 1).
- It affects the input abstraction (System 2), which every other module depends on.
- It affects the render layer (aim line preview, power bar).
- Changing it after Milestone 3 means re-tuning all the "feel" work that was built on top of it.

**Mitigation:** Build Milestone 1 with the two-phase input, but spend 30 minutes in Milestone 1 testing a single-drag variant (drag direction = aim, drag distance = power, release = shoot). If the single-drag feels better, switch immediately before building round flow on top of it. Do not wait until Milestone 3 to discover the input model is wrong.

---

## Replies

### To business.md

**Agree:**
- "Single HTML/JS page, no build pipeline" — fully aligned with my stack choice. I would go further: no ES module imports either if it causes CORS issues on `file://` protocol. Use classic `<script src>` tags in load order so the game works when someone double-clicks `index.html`. ES modules are cleaner but classic scripts are more robust for "just open it" distribution.
- "Mobile-first responsive layout" — the canvas scales to viewport via CSS `width: 100%; height: 100%; object-fit: contain` and the internal resolution is set to `devicePixelRatio * cssWidth` for crisp rendering. Input uses Pointer Events API which unifies mouse and touch. This is covered.
- "Best-of-5 scoring is the single biggest lever" — the state machine I designed supports this natively. The `SHOOTING → RESULT` transition increments the score, and `RESULT` either advances to the next round or resolves to `GAME_OVER`. Best-of-5 is just a configuration: `maxRounds = 5`.
- "Instant restart < 1 second" — the `GAME_OVER → MENU` transition is a soft reset (clears scores, resets entities) not a page reload. This is a one-line state transition.
- "No ads in v1" — agreed. No ad-placement scaffolding. No预留 divs for future ad banners.

**Disagree / push back:**
- "Keeper reads your tendencies in later rounds" — I side with the engineering doc here. This is a v2 feature. For v1, the keeper's difficulty is a static per-level model (reaction delay + dive zone distribution). Adding tendency-reading requires persistent shot history across rounds and a more complex decision layer. It is not worth the complexity for a "simple" game. If the business side insists, it should be a configurable option (`adaptiveKeeper: false` by default) so it can be added without reworking the core AI.
- "Sound effects (crowd groan/cheer, net thud)" — I deprioritized this to Milestone 4 and would cut it if behind schedule. My audio module uses WebAudio synthesized beeps (short sine wave bursts) rather than sample files, which keeps the zero-asset-pipeline constraint. If audio files are needed, they are loaded lazily and the game works without them.
- "D1 retention > 30% as a target" — I agree with the engineering doc that I cannot engineer retention directly. What I can do is instrument a rounds-per-session counter in `localStorage` so the business side has data. I will add this to the state machine as a side-effect-free counter (incremented on each `AIMING` entry, never read by game logic).

### To engineering.md

**Agree:**
- "Milestone 1 — Playable single shot" as the first milestone — this is the right first slice. It exercises all five core systems in minimal form. My project structure directly supports this: `state.js`, `input.js`, `physics.js`, `render.js`, and `keeper.js` are all independently testable after M1.
- "Linear interpolation + small vertical overshoot, not real physics" — fully aligned with my physics system design. The ball trajectory is a parametric Bezier, not a gravity simulation. This avoids the "floaty parabola" problem the engineering doc identified.
- "State machine drift" as a risk — I addressed this as System 1. The transition table pattern makes illegal transitions impossible. I would add a dev-mode assertion: `console.assert(nextState in allowedTransitions[currentState], 'Invalid transition')` that runs in development and is stripped in production (or just left as a no-op since this game has no production build).
- "Two-step input (aim then power)" — I adopted this as my primary design (see Key Design Decisions). The engineering doc convinced me this is less ambiguous than single-drag.
- "Canvas scaling & DPI" — covered in my renderer design. The canvas internal resolution is `cssWidth * devicePixelRatio` and `cssHeight * devicePixelRatio`, with the CSS size set to viewport dimensions. A resize handler updates this on window resize.
- "Static host (itch.io / GitHub Pages)" — agreed. No server, no backend. The game is a folder of static files.
- "The 'feel' of the shot is the biggest engineering risk" — I agree completely and addressed this in my Biggest Architectural Risk section. The mitigation is the same: get M1 playable fast and spend a session tuning before building on top.

**Disagree / push back:**
- "Milestone 3 — Keeper AI: weighted random dive biased by difficulty" — the engineering doc says "biased by difficulty" but does not mention tendency-reading. I want to be explicit: for v1, the keeper's dive distribution is static per difficulty level (Easy = uniform, Normal = center-biased, Hard = corner-biased). No tendency-reading. If the business doc's "keeper reads your tendencies" feature is desired, it is a v2 addition.
- "Milestone 4 — Sound effects loaded lazily" — I would go further and say sound is the first thing to cut, not just deprioritize. The game must be playable without audio (many mobile browsers block autoplay, and silent play is common). My `audio.js` module wraps all sound calls in try/catch and degrades gracefully to no-op if WebAudio is unavailable or blocked.
- "Effort estimates assume vanilla HTML/CSS/JS + Canvas" — I agree with the stack but I think the estimates are slightly optimistic. My estimate for M1 is 8–12 hours (not 6–10) because the two-phase input + state machine interaction is fiddly to get right on the first pass. The rest of the estimates I agree with.
- "No automated E2E tests" — agreed for the game itself, but I would add one automated check: a Node script that imports `state.js` and runs through a full best-of-5 simulation (mocked input) to verify the state machine terminates correctly. This is not E2E testing — it is a 30-line integration test for the state machine, which is the most testable and most critical subsystem. It runs in CI (GitHub Actions) in under 5 seconds and catches regressions if someone modifies the transition table.
