# AR Kick Enhancement — Shared Context

**Goal:** Enhance the existing penalty kick stickman game with webcam-based AR kick detection using MediaPipe. The player kicks a real (physical) ball on camera, and the leg direction/power maps to the virtual ball's trajectory in the game.

**Existing game:** Already built at `C:\Users\Acer\OneDrive\Documents\GitHub\penalty-kick-game\` — HTML5 Canvas + vanilla JS, no framework, no bundler. 8 source modules: constants, state, audio, keeper, physics, render, input, main.

**New feature — AR Kick Detection:**
- Use **MediaPipe Pose** (or MoveNet via TensorFlow.js) to detect the player's leg from webcam
- Map **leg direction** → aim angle of the virtual ball
- Map **kick motion speed / leg velocity** → power of the shot
- The virtual ball on canvas follows the detected kick in real-time
- Goal: surprise the business and product team with a "wow" factor — this becomes a unique selling point

**Technical constraints:**
- Must still work as a browser game (no install)
- MediaPipe Pose requires loading a WASM model — needs a server or careful CORS handling
- Webcam access requires HTTPS or localhost
- Performance: must not drop below 30fps on a typical laptop
- Graceful fallback: if webcam denied or model fails to load, fall back to the existing mouse/touch input

**Discussion rules (for agents):**
1. Read this file first.
2. Read the existing source files to understand current architecture.
3. Write your notes to `shared-memory/<role>.md` — one file per role.
4. After writing, read the other two role files and reply to points you agree/disagree with.
5. Once all three files exist and each has a Replies section, the discussion is done.

**Roles:**
- `architect-ar.md` — Architect: how to integrate MediaPipe into the existing module structure, what new modules are needed, fallback strategy, performance
- `dev-ar.md` — Dev Lead: implementation plan, MediaPipe Pose API integration, pose→shot mapping, effort estimate
- `qa-ar.md` — QA: testability of AR features, fallback verification, performance benchmarks, risk assessment
