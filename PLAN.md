# Penalty Kick Stickman Game — Synthesized Plan

> Synthesized from three-role discussion: business.md, architect.md, engineering.md.
> All three agents agreed on the core approach. Disagreements are noted and resolved below.

---

## 1. Game Summary

A casual, mobile-first, browser-based penalty shootout game. The player aims and shoots a ball past an AI keeper. Stickman art style drawn programmatically on HTML5 Canvas. No build step, no dependencies, no backend. Opens and plays instantly.

---

## 2. Resolved Decisions

### Stack (unanimous)
**HTML5 Canvas 2D + vanilla ES6 modules, no framework, no bundler.**

- One `index.html`, one `style.css`, JS split into single-responsibility files under `src/`.
- Loaded via classic `<script src>` tags in order (avoids `file://` CORS issues with ES modules).
- Deploy as a zip to **itch.io** (primary) or push to **GitHub Pages** (fallback).
- No `npm install`, no build artifacts, no node_modules.

### Architecture (unanimous)
Five core systems, each in its own module:

| Module | Responsibility |
|--------|---------------|
| `state.js` | State machine: `MENU → AIMING → POWER → SHOOTING → RESULT → GAME_OVER`. Transition table makes illegal transitions impossible. |
| `input.js` | Pointer + keyboard abstraction. Two-phase input: drag to aim → release to lock → oscillating power bar → click to lock power. |
| `physics.js` | Parametric Bezier ball trajectory (not a physics engine). Fixed ~600ms flight time. Power affects arc height, not speed. |
| `keeper.js` | Per-shot randomized dive to one of 5 zones. Difficulty scales reaction delay and zone distribution. Stateless per shot. |
| `render.js` | Only module touching Canvas 2D context. Layered draw order: pitch → goal → net FX → keeper → ball → kicker → UI. |

Plus `audio.js` (WebAudio synth beeps, lazy-loaded, degrades gracefully) and `constants.js` (all magic numbers in one place).

### Scope (unanimous)
**In v1:** Single-player, best-of-5 + endless mode, programmatic stickmen, localStorage high score, keyboard + touch input, synthesized sound.
**Out v1:** Multiplayer, career mode, licenses, ads, IAP, leaderboards, backend, i18n, accessibility beyond basics.

### Monetization (unanimous)
None in v1. Premium single-purchase ($1.99) if v2 happens. Ads would kill the instant-restart engagement loop.

### Engagement Loop (unanimous)
Aim → Shoot → See result → "Play again." Best-of-5 creates a mini-narrative. Endless mode + high score is the long-tail retention hook. Restart must be < 1 second (soft state reset, no page reload).

### Success Metric (unanimous)
**Primary:** Day-1 retention > 30%.
**Leading indicator:** Average rounds per session (instrumented in localStorage).

---

## 3. Resolved Disagreements

| Question | Business | Architect | Engineering | Resolution |
|----------|----------|-----------|-------------|------------|
| Keeper reads player tendencies? | Yes, in later rounds | No — v2 feature | No — too complex for v1 | **Defer to v1.** Static per-difficulty model for v1. If v2 happens, add as a configurable option. |
| Sound in v1? | Yes, synthesized | Deprioritized to M4, first to cut | Deprioritized to M4, first to cut | **Include but cuttable.** WebAudio synth beeps only (no audio files). If behind schedule, drop without affecting playability. |
| ES module imports vs classic scripts | Not specified | ES modules | Classic scripts (avoids file:// CORS) | **Classic scripts.** Robustness wins over cleanliness for "just open it" distribution. |
| Automated tests | Not specified | 30-line state machine integration test | No automated tests | **Compromise:** one Node script that runs a full best-of-5 simulation through `state.js` to verify the transition table terminates. No E2E, no CI pipeline. |

---

## 4. Implementation Milestones

Thin vertical slices. Each milestone is a working, demonstrable state.

| Milestone | Scope | Exit Condition | Effort |
|-----------|-------|----------------|--------|
| **M1 — Playable single shot** | Canvas renders goal, ball, stickmen. Two-phase input. Ball travels along Bezier. Keeper dives. Goal/miss resolved. | You can take a shot and see if it went in. | 8–12 hrs |
| **M2 — Round flow** | Best-of-5 logic. Scoreboard UI. Win/lose screen with "Play again." Soft reset (no reload). | A full shootout resolves to a winner. | 3–5 hrs |
| **M3 — Polish pass** | Keeper AI with difficulty scaling (Easy/Normal/Hard). Ball curve for corner shots. Power meter tuning. Net ripple + dive animation + ball trail. | Game feels responsive and repeatable. | 6–10 hrs |
| **M4 — Juice & menu** | Start screen, instructions. Difficulty selector. Mobile touch input. Endless mode + localStorage high score. Synth audio (cuttable). | A stranger can pick it up and play without explanation. | 4–6 hrs |
| **M5 — Deploy** | Zip → itch.io. Final tuning pass with one other person playing. | Live URL works. | 1–2 hrs |
| **Total** | | | **22–35 hrs (~4–7 working days)** |

---

## 5. Key Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| **Shot feel is wrong** (subjective, hard to spec) | Get M1 playable fast. Spend a full session tuning launch snappiness + keeper reaction delay before building round flow. |
| **Two-phase input feels slow or confusing** | During M1, spend 30 min testing a single-drag variant (drag direction = aim, distance = power, release = shoot). Switch immediately if it feels better — before building on top. |
| **Keeper dive timing feels unfair** | Keeper commits on shot release (not on aim) with fixed reaction window (150–250ms by difficulty). Prevents exploitation, keeps keeper beatable. |
| **Canvas blurry on high-DPI screens** | Set `canvas.width/height` to `cssWidth * devicePixelRatio` on day one. Resize handler updates on window resize. |
| **State machine drift** | Explicit state enum + transition table. Dev-mode assertion logs invalid transitions. |
| **Mobile touch has no hover preview** | Faint aim line always visible during aim phase. Pointer Events API unifies mouse + touch. |
| **Game is forgettable** (business risk) | Invest in micro-interactions (ball arc, keeper dive, net ripple) over features. Kill criterion: D1 < 20% after 500 plays → iterate or pivot. |

---

## 6. File Structure

```
penalty-kick-game/
├── index.html              # Entry point, canvas, script tags
├── style.css               # Layout, responsive scaling, scoreboard
├── src/
│   ├── main.js             # Bootstrap, rAF loop
│   ├── state.js            # State machine + game state
│   ├── input.js            # Pointer + keyboard, two-phase aim/power
│   ├── physics.js          # Bezier trajectory, goal check
│   ├── render.js           # All Canvas draw calls
│   ├── keeper.js           # Keeper AI: dive decision, difficulty scaling
│   ├── audio.js            # WebAudio synth beeps (lazy, cuttable)
│   └── constants.js        # All magic numbers
├── shared-memory/          # Planning docs (context, business, architect, engineering)
├── README.md               # How to run, controls
└── .gitignore              # Empty — no node_modules, no build artifacts
```

---

## 7. Immediate Next Steps

1. Create the folder structure above.
2. Write `index.html` + `style.css` + `src/constants.js` (the three are independent).
3. Implement `state.js` — the state machine is the backbone everything else depends on.
4. Implement `input.js` + `render.js` — get something drawable and controllable on screen.
5. Implement `physics.js` + `keeper.js` — complete M1.
6. **Tune the shot feel** before moving to M2. This is the highest-leverage work.
