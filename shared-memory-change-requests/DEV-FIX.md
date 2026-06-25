# AR Mode Button Fix

## What Was Wrong

The "AR Mode" button was not visible on page load due to two compounding issues in `index.html`:

### Issue 1: `display:none` hidden until MediaPipe checks pass
The `<button id="ar-btn">` had `display:none` inline. The inline `<script>` that boots AR would only reveal it (`btn.style.display = 'block'`) if `typeof vision !== 'undefined' && vision.FilesetResolver`.

### Issue 2: Module-script timing + infinite retry loop
The MediaPipe ES module (`<script type="module">`) is **deferred by the browser** — it runs *after* all classic and inline scripts finish. So when the `tryWireArButton()` function runs at DOMContentLoaded, `window.vision` is always undefined on the first try.

The original code retried with `setTimeout(tryWireArButton, 200)` in a loop. But:
- If the CDN succeeded but was just slow → the loop correctly shows the button (cosmetic issue, but worked)
- If the CDN **failed** (offline, CORS, blocked) → the retry loop runs forever, the button **stays hidden forever**, and the user sees no feedback at all

## What I Fixed

### `index.html`

1. **Removed `display:none`** from the AR button so it is always visible on page load.

2. **Simplified the click-handler wiring**: replaced the retry-loop `tryWireArButton` with an IIFE `wireArButton` that just attaches the click handler. The button is always clickable; if MediaPipe isn't loaded, `toggleArMode` → `startArMode` → `arPose.init()` rejects, and the existing `.catch` handler shows the user a clear toast ("Camera unavailable — using mouse controls"). This gracefully handles the missing-module case without silently hiding the button.

### No changes needed in `src/main.js` or `src/ar-pose.js`

- `window.toggleArMode` is already defined inside the IIFE at the end of `main.js` (classic script, runs before the inline `wireArButton` script), so it is always available when the button is clicked.
- `ar-pose.js` already correctly checks `global.vision` (which is `window.vision`) and rejects with a clear error if it's missing; the `.catch` handler in `startArMode` handles the fallback to mouse controls.

## Expected Behavior After Fix

- **Button visible on load**: the "AR Mode" button shows immediately, no MatterPipe race condition.
- **Click with MediaPipe loaded + camera allowed**: starts AR mode, webcam preview appears in the corner.
- **Click with MediaPipe loaded + camera denied**: shows toast, falls back to mouse controls.
- **Click with MediaPipe not loaded (CDN failure / offline)**: shows toast explaining the issue, falls back to mouse controls.
