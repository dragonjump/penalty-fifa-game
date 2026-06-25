# QA Report — Penalty Kick Stickman Shootout

**Date:** 2026-06-25
**Reviewer:** OWL (QA Expert)
**Reference:** PLAN.md (v1, in-repo)

## Executive Summary

**Verdict: NO-SHIP**

The game is incomplete and will not execute in a browser. Of the 8 JS source modules called for in `PLAN.md` Section 6, only 5 exist. The three modules that consume user input and draw to the canvas — `input.js`, `render.js`, `main.js` — are entirely absent. `index.html` references these three files with `<script src>` tags but they resolve to 404s. Clicking "Loading…" produces a frozen page forever. No README or `.gitignore` exist either.

That said, the five present modules are internally well-written and match the plan's API contract. Bugs below are flagged against those modules where found, but the overall build cannot be exercised end-to-end until the missing files are written.

---

## 1. Architecture Compliance

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1.1 | File structure from Section 6 followed | **FAIL** | `index.html` (line 17-24) declares 8 scripts; only 5 exist. Missing: `src/render.js`, `src/input.js`, `src/main.js`. Also missing: `README.md`, `.gitignore`. |
| 1.2 | Module boundaries respected | **PASS** (present files) | `state.js` exports `StateMachine` via IIFE; `physics.js` exports `Physics` (pure functions, no DOM); `keeper.js` exports `Keeper`; `audio.js` exports `Sound`. No cross-module DOM access observed. |
| 1.3 | Vanilla JS, no framework/bundler | **PASS** | All 5 files use `(function (global) { … })(window/globalThis)` IIFE pattern. No `import`, no `require`, no `npm`. |
| 1.4 | Classic `<script src>` tags (not ES modules) | **PASS** | `index.html` lines 17-24 use plain `<script src>`. No `type="module"`. |

**Severity:** Critical (missing files = game does not boot).

---

## 2. State Machine (state.js)

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 2.1 | State enum matches plan | **PASS** | `state.js` lines 22-29: `MENU, AIMING, POWER, SHOOTING, RESULT, GAME_OVER` — exact match. |
| 2.2 | Transition table prevents illegal transitions | **PASS** | `state.js` lines 32-39 define `TRANSITIONS`; `transition()` (lines 87-97) calls `canTransition()` and warns on illegal moves. |
| 2.3 | Terminates correctly in best-of-5 | **PASS (logic)** | `createInitialState()` (line 44) initialises `score`, `round`, `history`. Transition table allows `RESULT → GAME_OVER`. Note: actual round-counting logic lives in the missing `main.js`, so this cannot be exercised. |

**Observation:** The transition table allows `RESULT → SHOOTING` (line 37), which is unusual — typically RESULT transitions to AIMING for the next shot. This is likely used for the "soft reset" fast path but could cause bugs if `main.js` doesn't reset per-shot fields. Flag for the implementing dev.

**Severity:** Minor (logic concern, untestable without `main.js`).

---

## 3. Input (input.js)

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 3.1 | Two-phase (aim → power) | **FAIL** | File does not exist. |
| 3.2 | Mouse, keyboard, touch (Pointer Events) | **FAIL** | File does not exist. |
| 3.3 | Dispatches intent objects to state.js | **FAIL** | File does not exist. |

**Severity:** Critical.

---

## 4. Physics (physics.js)

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 4.1 | Parametric Bezier (not physics engine) | **PASS** | `physics.js` lines 58-63: quadratic Bezier. No forces, no integrator. |
| 4.2 | Flight time ~600ms | **PASS** | `constants.js` line 32: `BALL_FLIGHT_MS = 620`. |
| 4.3 | Power affects arc height, not speed | **PASS** | `physics.js` line 40: `lift = 30 + power * 110`. Flight time is fixed; only `lift` scales with power. |
| 4.4 | Goal-check (1D interval overlap at keeper plane) | **PASS** | `physics.js` lines 79-81: `isOnTarget()` checks `targetX` against `GOAL_LEFT_X` / `GOAL_RIGHT_X`. |

**Observation:** `isOverBar()` (lines 66-76) uses `Math.random()` to decide if a shot is over the bar. This introduces non-deterministic behaviour in what should be a geometric check — a shot that is "on target" geometrically can randomly be declared over the bar. This is a design smell; consider a deterministic check based on launch angle vs. bar height.

**Severity:** Minor (game-feel concern, not a crash bug).

---

## 5. Keeper AI (keeper.js)

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 5.1 | Stateless per shot | **PASS** | `decide()` (line 21) takes only `difficulty`; no internal state. |
| 5.2 | Picks one of 5 zones | **PASS** | `constants.js` line 73: `KEEPER_ZONES = 5`. `decide()` loops over `C.KEEPER_ZONES`. |
| 5.3 | Difficulty scales reaction delay + zone distribution | **PASS** | `constants.js` lines 80-84 define `DIFFICULTY` profiles with `reactionMs`, `spread`, `reach`, `missChance`. `decide()` uses all four. |
| 5.4 | Commits on shot release (not on aim) | **PASS (by design)** | `decide()` is called by the consumer (presumably `main.js` on shot release); the module itself has no concept of "aim phase". Enforcement is a contract with the missing `main.js`. |

**Observation:** Zone weighting formula at line 30: `Math.pow(profile.spread, C.KEEPER_ZONES - 1 - d)`. For `easy` mode, `spread = 0.55`, which *down-weights* the center (since 0.55 < 1.0 and center has the highest `d` difference inverted). This is inverted logic — easy mode should bias *toward* center, not away. Verify intent with designer.

**Severity:** Major (easy mode is harder than normal due to inverted weighting).

---

## 6. Renderer (render.js)

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 6.1 | Only module touching Canvas 2D context | **FAIL** | File does not exist. |
| 6.2 | Draw order matches plan | **FAIL** | File does not exist. |
| 6.3 | Stickmen drawn programmatically | **FAIL** | File does not exist. |
| 6.4 | Canvas scaled by devicePixelRatio | **FAIL** | File does not exist. |

**Severity:** Critical.

---

## 7. Game Modes

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 7.1 | Best-of-5 resolves to winner | **FAIL** | Round logic lives in missing `main.js`. |
| 7.2 | Endless mode keeps shooting | **FAIL** | Same as above. |
| 7.3 | High score persists in localStorage | **FAIL** | `constants.js` line 93 defines `ENDLESS_HIGH_SCORE_KEY` but persistence logic is in missing `main.js`. |

**Severity:** Critical.

---

## 8. Audio (audio.js)

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 8.1 | WebAudio synth beeps (no audio files) | **PASS** | `audio.js` lines 35-51: `blip()` uses `OscillatorNode`. `kick()` synthesises noise via `AudioBuffer`. No `<audio>` tags, no file fetches. |
| 8.2 | Degrades gracefully if WebAudio unavailable | **PASS** | `ensure()` (lines 12-25) returns `null` on missing `AudioContext`; `blip()` early-returns if `!c`. |
| 8.3 | Lazy-loaded | **PASS** | Context is created on first `ensure()` / `unlock()` call, not at module load. |

**PASS** — audio module is complete and well-isolated.

---

## 9. Mobile / Responsive

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 9.1 | Canvas scales to viewport | **FAIL** | CSS has `max-width/max-height: 100%` (`style.css` lines 32-33) but no `devicePixelRatio` scaling logic exists (missing `render.js`). |
| 9.2 | Touch input works | **FAIL** | Missing `input.js`. |
| 9.3 | Aim line visible during aim phase | **FAIL** | Missing `render.js`. |

**Severity:** Critical.

---

## 10. Feel / UX

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 10.1 | Restart < 1 second (soft reset) | **FAIL** | Missing `main.js`. |
| 10.2 | Ball arc looks natural | **PASS (on paper)** | `physics.js` uses quadratic Bezier with `lift = 30 + power * 110` and fixed 620ms flight. Looks reasonable; needs playtest. |
| 10.3 | Keeper difficulty scaling feels fair | **FAIL** | Cannot playtest; also see Major bug in §5 (inverted spread weighting). |

---

## Bugs Found

### Critical

| # | Description | Location | Impact |
|---|-------------|----------|--------|
| C1 | `src/render.js` does not exist | `index.html` line 22 | Game cannot render; page frozen on "Loading…" |
| C2 | `src/input.js` does not exist | `index.html` line 23 | No user input possible |
| C3 | `src/main.js` does not exist | `index.html` line 24 | No rAF loop, no bootstrap, no glue logic |
| C4 | `README.md` does not exist | PLAN.md line 109 | Users cannot discover controls or how to run |
| C5 | `.gitignore` does not exist | PLAN.md line 110 | Risk of committing accidental artifacts |

### Major

| # | Description | Location | Impact |
|---|-------------|----------|--------|
| M1 | Keeper zone-weighting formula is inverted — easy mode biases *away* from center, making it harder than normal | `keeper.js` line 30 | Easy difficulty feels harder than normal; frustrates new players |

### Minor

| # | Description | Location | Impact |
|---|-------------|----------|--------|
| m1 | `isOverBar()` uses `Math.random()` for a geometric decision | `physics.js` lines 71, 74 | Non-deterministic; same shot can randomly be "over the bar" on one attempt and not on another |
| m2 | Transition table allows `RESULT → SHOOTING` which skips AIMING | `state.js` line 37 | Could cause per-shot state not to reset if `main.js` doesn't re-initialize aim/power fields |
| m3 | `index.html` hides loading overlay on `window.load` but `main.js` never un-hides it if boot fails | `index.html` lines 26-31 | User sees permanent "Loading…" on any error |

---

## Recommended Fixes (Priority Order)

1. **Write `src/main.js`** — bootstrap, rAF loop, soft-reset logic, round counting, localStorage persistence, wire input → state → keeper → physics → render.
2. **Write `src/render.js`** — Canvas 2D context acquisition, `devicePixelRatio` scaling, layered draw order (pitch → goal → net → keeper → ball → kicker → UI), programmatic stickmen, aim line.
3. **Write `src/input.js`** — Pointer Events for mouse+touch, keyboard fallback, two-phase dispatch (aim → power), intent objects.
4. **Fix keeper zone weighting** at `keeper.js` line 30 — flip the exponent or use `Math.pow(spread, d)` so higher `spread` = more center bias.
5. **Replace random `isOverBar()`** with a deterministic check: compare peak-of-Bezier y vs `GOAL_TOP_Y`.
6. **Add `README.md`** with controls, how-to-run, and file structure.
7. **Add `.gitignore`** (even an empty one satisfies the plan).
8. **Harden loading overlay** — add a timeout that shows an error if `main.js` fails to boot.

---

## Overall Verdict

**NO-SHIP** — the game is architecturally sound in the modules that exist, but 3 of 8 required JS files (`render.js`, `input.js`, `main.js`) are entirely missing. The page loads, shows "Loading…", and stays there forever. No amount of unit-testing the existing modules can compensate for the absence of the input, render, and main-loop layers.

Once the three missing files are written, a re-review is recommended — the keeper weighting bug (M1) and the non-deterministic `isOverBar()` (m1) should be fixed before any public release.
