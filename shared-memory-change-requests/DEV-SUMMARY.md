# Dev Summary — Penalty Kick Stickman Game

Built a complete, dependency-free HTML5 Canvas penalty shootout game following the plan at `PLAN.md`. Each milestone was implemented in order; the game is playable after every milestone.

## What was built

**M1 — Playable single shot**
- Canvas renders pitch, goal frame + net, stickman kicker + keeper, ball.
- Two-phase input: drag to aim → release → oscillating power bar → tap/click to shoot.
- Ball flies along a quadratic Bezier (~620 ms fixed flight). Power controls arc height, not duration.
- Keeper picks one of 5 horizontal zones per shot with randomized reaction delay; reach check decides goal/saved/miss.
- Keyboard (arrows + space) and pointer (mouse + touch via Pointer Events) both work.

**M2 — Round flow**
- Best-of-5 mode: scoreboard tracks YOU vs KEEPER, first to 3 wins.
- Win/lose screen with "Play again" (soft reset — no page reload).
- Endless mode: goals accumulate until a miss; high score persisted in `localStorage`.

**M3 — Polish pass**
- Three difficulty profiles (Easy/Normal/Hard) scale reaction time, dive spread (center bias), reach, and fumble chance.
- Corner shots with high power can sail over the bar or go wide — rewards aiming for the corners.
- Keeper dive animation (lerp with smoothstep), kicker kick animation, ball trail, net ripple on goal, power bar flash on lock.

**M4 — Juice & menu**
- Start screen with title + control hint.
- WebAudio synth beeps for aim/power/kick/goal/saved/miss/game-over. Lazy-unlocked on first gesture; degrades silently if WebAudio is unavailable.
- Mobile-first responsive canvas scaled by `devicePixelRatio`; aspect-ratio fit on resize.

**M5 — Deploy-ready**
- No build step, no `npm`, no `node_modules`. Classic `<script src>` tags so `file://` works.
- `README.md` documents controls, modes, and tuning.
- `.gitignore` excludes nothing problematic (project has no generated artifacts).

## Files created

```
penalty-kick-game/
├── index.html              (entry point, canvas, ordered script tags)
├── style.css               (responsive layout, pitch background)
├── README.md               (how to run + controls)
├── .gitignore
├── test-state.js           (node test-state.js — state machine sanity)
├── src/
│   ├── constants.js        (all magic numbers)
│   ├── state.js            (state machine + transition table)
│   ├── input.js            (pointer + keyboard, two-phase)
│   ├── physics.js          (Bezier trajectory)
│   ├── keeper.js           (per-shot AI dive)
│   ├── render.js           (all Canvas 2D drawing)
│   ├── audio.js            (WebAudio synth beeps)
│   └── main.js             (bootstrap + rAF loop)
└── shared-memory/         (pre-existing planning docs)
```

## How to run

```
cd penalty-kick-game
python3 -m http.server 8000
# open http://localhost:8000
```

Or just open `index.html` in a browser.

## Architecture notes

- Module boundaries match the plan exactly: `state.js` owns the state machine, `input.js` owns input abstraction, `physics.js` owns trajectory math, `keeper.js` owns AI decisions, `render.js` is the only module touching Canvas, `audio.js` is the only module touching WebAudio.
- State machine uses an explicit transition table; illegal transitions are logged and rejected.
- All magic numbers live in `constants.js` — game feel can be tuned there without touching logic.
- Stickmen are drawn programmatically (circle head, line body, joint-angle poses, lerp animation) — no sprites, no assets.

## Tests

`node test-state.js` verifies the transition table permits a full best-of-5 and rejects illegal transitions. No E2E, no CI — per the plan's compromise.
