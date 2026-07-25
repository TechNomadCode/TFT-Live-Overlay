# Regenerating docs/overlay-sheen.gif — agent notes

Terse handoff for rebuilding the sheen GIF. Scripts: `docs/_gif-build/capture.js`
(Electron → PNG frames), `docs/_gif-build/encode.js` (frames → GIF).

```bash
npx electron docs/_gif-build/capture.js   # frame-NN.png + frames.json
node docs/_gif-build/encode.js            # ../overlay-sheen.gif
```

Run from repo root; `require('../../src/server')` is script-relative.
Electron is already a devDependency. Current output: 740×216 (370×108 @ 2x),
12 frames, ~257 KB, `loop 0`, 11 sweep frames @ 60ms + 1 idle @ 900ms = 1.56s.

## Pipeline

Drive the real `src/server` and capture a real Electron window — don't
mock up the card in standalone HTML, it drifts from the app immediately.

1. `createOverlayServer({ log: () => {} })`, `start(3057)` (not 3000 — the user's
   app may be running). No API key needed: unconfigured `fetchRank()` sets an
   error and returns without any network call.
2. `POST /api/test/` → `toggle-mock {enable:true}`, `reset_error`, `set_rank`,
   `lp_change`×N. **All of it before `loadURL`** (see #5).
3. `loadURL(http://localhost:3057/overlay.html)`, kill the poll, `refresh()`,
   inject docs-only DOM, restart the animation, capture on an absolute schedule.

## Gotchas

1. **`zoomFactor` scales content, not the window.** A 370×108 window at zoom 2
   captures a 2x crop of the corner. Size it `W*ZOOM × H*ZOOM` with
   `useContentSize: true`, and call `setZoomFactor(ZOOM)` after `loadURL` —
   `webPreferences.zoomFactor` alone wasn't reliable.
2. **Stale error banner.** `start()` polls immediately; unconfigured that writes
   `latestData.error`, and `set_rank` does *not* clear it. Without a
   `reset_error` event you get a red "Overlay: Not configured…" line over the
   footer. Post it right after `toggle-mock`.
3. **`refresh()` clobbers injected DOM.** Setting `#gameName`/`#tagLine` and then
   calling `refresh()` in the same `executeJavaScript` block silently loses them.
   Inject in a *separate* call after `refresh()` resolves. Mock mode never sets
   `gameName`/`tagLine`/`region` — all three are live-path-only.
4. **Region chip is deduped.** `overlay.html` hides `#region` when it equals the
   tagline, so `SPLENK` + `#EUW` + `EUW` shows no chip. Full footer needs a
   tagline that differs from the region; current GIF uses `#1337` + chip `EUW`.
   (Existing tier PNGs show `SPLENK #EUW`, no chip — inconsistent if re-shot.)
5. **Promotion banners bleed.** `refresh()` re-runs `checkRankChange()`; a rank
   change between two refreshes fires a ~2.6s takeover that covers the card.
   Populating mock state *before* `loadURL` makes the first refresh a first
   sighting, which `checkRankChange` skips — no banner. The defensive clearing in
   `capture.js` is a no-op under that ordering; keep it only if you script rank
   jumps mid-capture.
6. **`show: true` required** — `show: false` returns stale/blank frames.
7. **`capturePage()` lags a frame.** Warm up: capture, `sleep(200)`, capture,
   keep the second — before the real sequence.
8. **Kill the overlay's 2.5s poll** before posing:
   `for (let i = 1; i < 10000; i++) clearInterval(i);` then drive `refresh()`.
9. **Restart the animation before frame 0** or you capture a random phase:
   `el.style.animation='none'; void el.offsetWidth; el.style.animation='sheenLoop 9s linear infinite';`
10. **Absolute deadlines, not cumulative sleeps.** `capturePage()` costs ~40–60ms,
    so `sleep(60)` in a loop drifts. Use `restartTime + targetOffset - Date.now()`
    (~±15ms jitter over 18 frames).
11. **`backgroundThrottling: false`** — insurance against Chromium freezing the
    animation in an unfocused window. Failure mode (identical frames) is
    expensive to diagnose.
12. **GIF has 1-bit alpha; the card doesn't** (`#253150ee`, rounded corners).
    Transparent export = jagged corners + hard-keyed body. `encode.js` flattens
    onto `#0d1117` (GitHub dark canvas). The PNGs keep real alpha; only the GIF
    needs this.

## Why the loop is tightened

`sheenLoop 9s linear infinite`: opacity 0→1 at 2%, translateX −150→450px by 10%,
faded by 10.8%, then parked transparent until 100%. Only ~0–970ms of the 9s cycle
is visible — the idle tail is deliberate so the compositor self-throttles. A
literal 9s GIF is ~88% dead frames, so: capture the sweep at 60ms, keep the
on-card frames, replace the idle tail with **one** frame on a long delay.

Measured this build: band enters ~115ms, gone by ~763ms → frames **2..12** sweep,
13..17 idle. `encode.js` hardcodes `SWEEP = [2..12]`, `IDLE_FRAME = 17`.
**Re-measure after any re-capture** — indices shift with jitter.

## Verifying

The band is `rgba(255,255,255,0.15)` — near-invisible in a raw frame.

```js
sharp('frame-05.png').linear(3.5, -260).toFile('frame-05-boost.png')  // eyeball it
```

To locate the band per frame (how the window above was measured): column-wise
mean abs diff against a known-idle frame, report peak-difference column. Expect
`peakCol` to climb monotonically (13 → 724) and total diff to collapse to ~0 on
idle frames. Non-monotonic or all-zero ⇒ animation didn't run (see #9, #11).

Confirm delays survived encoding:
```js
sharp('docs/overlay-sheen.gif', { animated: true }).metadata()
// → pages: 12, delay: [60×11, 900], loop: 0
```

## sharp

`^0.35.3` **can** write animated GIFs (bundled `cgif`) — no extra dependency,
don't add one:
```js
sharp(frameBuffers, { join: { animated: true, across: 1 } }).gif({ delay: [...], loop: 0 })
```

## Constraints

- Output to `docs/`, never `assets/` — `assets/**/*` is in `package.json`
  `build.files` and would ship inside the installer.
- Never modify `src/overlay/` or `src/server/` for a docs shot; pose
  the card via mock events + DOM injection. Keep the GIF well under ~2MB.
