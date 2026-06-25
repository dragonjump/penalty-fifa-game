# Business / Product User Angle

## 1. Target Audience

**Primary:** Casual mobile-web players, ages 16–35, who already play simple browser/cellphone games during commutes, lunch breaks, or downtime.

**Why this group:**
- Stickman art is universally legible — no language barrier, no cultural friction.
- Penalty shootouts are instantly understood globally (even non-soccer fans know the premise).
- Short sessions (2–3 minutes) fit the "kill time" use case. A single round takes ~20–30 seconds; a best-of-5 takes ~2 minutes.
- The game runs in a browser (or as a lightweight PWA), so no install friction. This is critical for the casual segment — if they have to visit an app store, 80% drop off.

**Not targeting:** Core/football-fan audience. They want real teams, licenses, player stats, career modes. That is explicitly out of scope. We are building a toy, not a simulation.

## 2. Core Engagement Loop

**Loop:** Aim → Shoot → See result → "Play again" (best-of-5 or endless mode).

**What makes someone play 10 rounds instead of 1:**

1. **Best-of-5 scoring with a running tally.** Humans are completionist. "I won 3-2, but can I get a clean sheet (4-1)?" This is the single biggest lever. One round is a throwaway; a best-of-5 creates a mini-narrative.
2. **Keeper difficulty ramps.** Early rounds: keeper guesses. Later rounds: keeper reads your tendencies (if you favor a corner, keeper starts cheating that way). This creates a sense of escalation without adding mechanics.
3. **Endless mode with a high-score counter.** "I scored 12 in a row — can I beat it?" This is the long-tail retention hook.
4. **Instant restart (< 1 second).** No loading screens, no ads between rounds (for v1). The moment the ball hits the net, the next shot is ready. Speed of loop is everything for casual games.

**What does NOT drive engagement here:** Story, progression systems, unlocks. Those are for a different scope. For v1, the hook is purely mechanical satisfaction + score chase.

## 3. Scope Boundaries

### IN Scope (v1)
- Single-player penalty shootout (player vs. AI keeper)
- Stickman + ball + goal — all programmatic (no sprite assets)
- Aim by mouse/touch drag (direction + power)
- Best-of-5 mode + Endless mode
- Simple high-score persistence (localStorage)
- Sound effects (crowd groan/cheer, net thud) — synthesized or short clips, no licensed audio
- Single HTML/JS page or minimal PWA — no build pipeline
- Mobile-first responsive layout (works on phone screens)

### OUT of Scope (v1)
- Multiplayer (local or online) — doubles the complexity (state sync, matchmaking, latency). Save for v2 if the game gets traction.
- Career mode / tournament brackets — too much content for a "simple" game.
- Real teams, player names, kits, licenses — legal cost and scope explosion. Stickman is the point.
- In-app purchases — no content to sell yet.
- Ads (for v1) — see monetization section.
- Leaderboards (server-side) — requires backend. Local high scores only for v1.
- Physics simulation beyond basic ball trajectory — we want a satisfying arc, not a physics engine.
- Commentary, narrative, or story — not the game we are building.

## 4. Monetization

**Decision: None for v1. Premium (single purchase) if it graduates to v2.**

**Reasoning:**
- Ads between rounds would kill the engagement loop. The whole point is the <1-second restart. A 30-second ad after every 5 shots would crater retention.
- In-app purchases require content to sell (skins, teams, power-ups). We have none of that in v1.
- The right v1 strategy is: **get the game good, get it in front of people, measure whether they come back.** Monetization is a problem you solve after you have an audience, not before.
- If v2 happens and there is real traction, a single $1.99 "remove ads + unlock skins" premium tier is the cleanest monetization for this genre. No gacha, no energy timers, no manipulative mechanics. The game is small and honest; the business model should match.

## 5. Success Metric

**Primary metric: Day-1 retention (D1) — % of players who return within 24 hours of first play.**

**Why this number:**
- It captures whether the core loop is satisfying enough to come back to.
- For casual games, D1 is the hardest hurdle. D7 and D30 follow from a strong D1.
- We can measure this with a simple anonymous counter (e.g., localStorage + a lightweight analytics ping, or just a counter in the page itself if we are truly serverless).
- **Target:** > 30% D1 retention. Below that, the loop is not sticky enough and we iterate on difficulty/feel before adding anything else.

**Secondary metric (leading indicator):** Average rounds per session. If people play 8+ rounds on their first visit, D1 will follow.

## 6. Biggest Business Risk

**The game is forgettable.**

This is the real risk — not technical failure, not scope creep, but the risk that someone plays it twice, says "cute," and never returns. The stickman penalty-kick space is not crowded, but it is also not *demanded*. We are not filling a gap; we are testing whether a gap exists.

**Mitigation:**
- The game has to feel *great* to play. The ball arc, the keeper dive animation, the net ripple — these micro-interactions matter more than features. A game that feels good with 3 mechanics beats a game that feels mediocre with 10.
- Distribution: embed it on a free game portal (e.g., a personal site, itch.io, or a "link in bio" style page). We are not relying on app store discovery.
- If D1 retention is below 20% after 500 plays, we kill the project or pivot the core mechanic. Do not add features to fix a game that does not feel good.

---

## Replies

No other role files found yet.
