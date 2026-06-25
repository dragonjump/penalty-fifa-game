# Engineering Lead — Penalty Kick Stickman Game

## 1. Implementation Sequencing

Build in thin vertical slices so something playable exists as early as possible. Each milestone is a working, demonstrable state — not a horizontal layer.

**Milestone 1 — Playable single shot (canvas + input + one shot + save)**
- HTML5 Canvas renders goal frame, ball, keeper stickman, kicker stickman.
- Player picks aim direction (mouse drag or arrow keys) and a power meter.
- Ball travels along a 2D top-down or side-view arc; keeper dives to a zone.
- Goal / miss resolved, result shown.
- No menu, no score tracking, no round flow — just reset and shoot again.
- *Exit condition:* you can take a shot and see if it went in.

**Milestone 2 — Round flow & win condition**
- Best-of-5 penalty shootout logic (alternate kick, track score).
- Simple scoreboard UI (Player vs Keeper, round counter).
- Win/lose screen with "Play again" button.
- *Exit condition:* a full shootout resolves to a winner.

**Milestone 3 — Polish pass**
- Keeper AI: weighted random dive biased by difficulty, with a reaction delay so it feels fair.
- Ball curve / bend (slight lateral movement) to reward corner shots.
- Power meter tuning: too hard = overpower, too soft = saved.
- Hit feedback: net ripple, keeper dive animation, ball trail.
- *Exit condition:* game feels responsive and repeatable.

**Milestone 4 — Juice & menu**
- Start screen, basic instructions.
- Sound effects (crowd groan/cheer, kick thud) — optional, loaded lazily.
- Simple difficulty selector (Easy / Normal / Hard — adjusts keeper reach and reaction).
- Mobile touch input support (tap to aim, hold for power).
- *Exit condition:* a stranger can pick it up and play without explanation.

**Milestone 5 — Deploy**
- Static host itch.io or GitHub Pages build.
- Final tuning pass based on one other person playing it.
- *Exit condition:* live URL works.

## 2. Effort Estimates

Assuming one developer, working in focused bursts (not full-time 40hr weeks). Estimates include building, testing, and committing — not just typing.

| Milestone | Effort (hours) | Effort (working days) |
|-----------|----------------|----------------------|
| M1 — Playable single shot | 6–10 hrs | 1.5–2 days |
| M2 — Round flow | 3–5 hrs | 0.5–1 day |
| M3 — Polish pass | 6–10 hrs | 1.5–2 days |
| M4 — Juice & menu | 4–6 hrs | 1 day |
| M5 — Deploy | 1–2 hrs | 0.25 day |
| **Total** | **20–33 hrs** | **~4–6.5 days** |

These assume the architect's stack choice is vanilla HTML/CSS/JS + Canvas — no build step, no framework churn. If the architect picks React + Vite + a game library, add 30% overhead for tooling and re-learning.

## 3. Technical Risks

1. **Ball physics feel wrong.** A 2D parabola with constant gravity looks floaty. The ball needs a snappy launch, fast travel, and a slight arc — not a slow lob. This will need tuning and is the single most likely thing to make the game feel bad. Mitigation: start with linear interpolation + a small vertical overshoot, not real physics.

2. **Keeper dive timing.** If the keeper commits before the player shoots, it's trivially exploitable (aim the other way). If it commits after, it feels laggy. The keeper must commit on shot release with a fixed reaction window (150–250ms depending on difficulty). Getting this window right is fiddly.

3. **Input ambiguity.** Mouse drag for both aim and power is the classic penalty game pattern, but on a single drag it's hard to communicate which axis does what. Mitigation: use a two-step input — click-drag to aim, release to lock aim, then a power meter bar that oscillates and the player clicks again to lock power. This is more testable and less ambiguous.

4. **Canvas scaling & DPI.** High-DPI screens will render blurry if `canvas.width/height` aren't scaled by `devicePixelRatio`. Easy to forget, looks amateurish when it happens. Mitigation: set up a resize handler on day one.

5. **State machine drift.** With multiple screens (menu, aiming, shooting, result, win/lose), ad-hoc boolean flags (`isShooting`, `isAnimating`, `showResult`) will tangle. Mitigation: a small explicit state enum (`MENU | AIMING | POWER | SHOOTING | RESULT | GAME_OVER`) and a single transition function.

6. **Mobile touch.** Tap-to-shoot is fine for desktop mouse, but on mobile there's no hover preview. Mitigation: show a faint aim line during the aim phase so the player knows where the ball will go.

## 4. Testing Strategy

**What to test (automated):**
- Round logic: given a sequence of shot outcomes, does the scoreboard update correctly? Does the game end at the right time (5 shots, or sudden death if tied)?
- State machine: every transition from every state. No invalid transitions (e.g., can't shoot from MENU).
- Keeper AI: distribution of dive zones over 1000 runs should roughly match the configured bias. Not a unit test for exact behavior, but a sanity check that the RNG isn't broken.

**What to test (manual, in-browser):**
- Aim + power input feels responsive on first try.
- Ball trajectory looks natural (not too fast, not too slow, slight arc).
- Keeper difficulty scaling: Easy should feel forgiving, Hard should be challenging but fair.
- Win/lose screen resets cleanly (no stale state from previous round).
- Resize the window — canvas should re-scale without distortion.
- Test on a phone viewport (Chrome DevTools device mode is fine).

**What to skip:**
- Cross-browser testing beyond Chromium + Firefox (this is a casual game, not enterprise software).
- Performance profiling (Canvas 2D at 60fps for a few sprites is trivial).
- Automated E2E tests (Playwright/Puppeteer) — overkill for a stickman game. Manual smoke testing is faster.

**How to verify the game "feels right":**
- Hand it to one person who hasn't seen it before. Watch them play without giving instructions. If they hesitate for more than 3 seconds at any point, that spot needs work.
- The "feel" lives in the launch snappiness and the keeper reaction delay. Tune those two variables first.

## 5. Build & Deploy

**Recommended: single-file or minimal-file static build.**

- One `index.html` + one `game.js` + one `style.css`. No bundler, no npm install, no build step.
- Optionally split `game.js` into a few modules (`state.js`, `render.js`, `input.js`, `physics.js`) loaded via `<script src>` tags — still no bundler needed.
- Deploy options ranked:
  1. **itch.io** — best audience fit for a casual game. Zip the folder, upload, done. Supports HTML5 games natively.
  2. **GitHub Pages** — free, instant, versioned. Push to `gh-pages` branch or configure from `main`. Good for a portfolio piece.
  3. **Netlify / Cloudflare Pages** — drag-and-drop folder, get a URL. Overkill but trivial.
  4. **Local HTML file** — just open `index.html` in a browser. Zero deploy. Good for early sharing.

**No server needed.** The game is pure client-side Canvas. No WebSocket, no backend, no database. Score is ephemeral (resets on reload) — which is fine for a casual penalty game.

If the business role wants leaderboards or persistent scores later, that's a v2 feature requiring a backend. Don't build it now.

## 6. Biggest Engineering Risk

**The "feel" of the shot.**

Not the physics simulation — the *perception* of the shot. The time between player input and ball contact, the arc of the ball, the keeper's dive timing, the net ripple on a goal — all of these combine to make the game feel satisfying or hollow.

This is the risk because:
- It's subjective and hard to spec in advance.
- It requires iterative tuning with real players, which takes wall-clock time (you can't rush "let me try this value, nope, back to the old one").
- If it's wrong, the game is wrong — everything else (menus, scoreboard, juice) is wasted on a core loop that doesn't feel good.

Mitigation: get Milestone 1 playable as fast as possible and spend a full session just tuning the shot feel before moving to round flow. Don't defer the feel.

---

## Replies

### To business.md

**Agree:**
- "Single HTML/JS page, no build pipeline" — fully aligned with my Milestone 5 and my effort estimates. Adding a bundler or framework would blow the schedule for no gain.
- "Mobile-first responsive layout" — I covered this under Milestone 4 (mobile touch input) and under Technical Risk #6 (mobile viewport testing). The game is useless if it doesn't work on phones given the audience.
- "No ads in v1" — correct. I would not build any ad-placement scaffolding into v1. If v2 needs ads, that's a separate architecture discussion.
- "Endless mode with high-score counter" — I under-scoped this. My Milestone 2 only covers best-of-5. I need to add endless mode (or at least a "keep shooting after the shootout ends" mode) as part of Milestone 3 or 4. localStorage for high-score persistence is trivial and I should have included it.
- "Instant restart < 1 second" — this is a direct engineering requirement. My state machine design (Technical Risk #5) needs to support instant reset without reloading the page. I'll make sure the `GAME_OVER → MENU` transition is a soft reset, not a hard reload.

**Disagree / push back:**
- "Keeper reads your tendencies in later rounds" — this is more complex than it sounds. Tracking player shot history and biasing the keeper's dive distribution based on it requires persistent state across rounds and a non-trivial AI decision layer. For v1, I'd rather keep the keeper's difficulty as a static per-difficulty reaction-time + reach model. Tendency-reading can be a v2 differentiator. If the business side insists, it adds ~3–4 hours to Milestone 3.
- "D1 retention > 30% as a target" — I can't engineer retention directly, but I agree the proxy is "average rounds per session." From an engineering standpoint, I can instrument a counter (rounds played per session, stored in localStorage) for free. I'll add that to Milestone 4 so the business side has data to measure.
- "Synthesized or short audio clips" — I deprioritized sound to Milestone 4 (juice pass). Sound is the first thing I'd cut if we're behind schedule. It does not affect whether the game is playable or fun; it only affects polish. The business doc agrees the *feel* matters more than features — sound is a feature.

**Note:** No `architect.md` found yet — no reply to add for that role.
