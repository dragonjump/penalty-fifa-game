# Penalty Kick Stickman Game — Shared Context

**Goal:** Design a simple football (soccer) stickman goal-kicking game for penalty shootouts.

**Constraints:**
- "Simple" — small scope, fast to build, easy to pick up
- Stickman art style (minimal, programmatic, no asset pipeline)
- Penalty context: ball placed on spot, goalkeeper defends, kicker aims/shoots
- Single-session discussion: agents in planning mode should read this file, add their notes, and read each other's notes before a final plan is synthesized.

**Discussion rules (for agents):**
1. Read this file first.
2. Write your notes to `shared-memory/<role>.md` — one file per role.
3. After writing, read the other two role files and reply to any points you agree/disagree with in your own file (append a "Replies" section).
4. Once all three files exist and each has a Replies section, the discussion is done and we synthesize a plan.

**Roles:**
- `business.md` — Business / product user angle (audience, monetization, engagement, scope)
- `architect.md` — Software architect angle (tech stack, structure, platform, design patterns)
- `engineering.md` — Engineering lead angle (implementation plan, risks, effort, sequencing)
