# Regenerating the overlay previews — agent notes

Terse handoff for rebuilding `docs/` imagery. Scripts: `docs/_gif-build/capture.js`
(Electron → PNG frames), `docs/_gif-build/encode.js` (frames → animation).

```bash
npx electron docs/_gif-build/capture.js   # frame-NN.png + frames.json
node docs/_gif-build/encode.js            # ../overlay-grandmaster-sheen.webp
```

Run from repo root; `require('../../src/server')` is script-relative.
Electron is already a devDependency.

**This pipeline shoots one thing: the README's animated hero,
`docs/overlay-grandmaster-sheen.webp`.** It poses Grandmaster, restarts the
house sheen + Grandmaster's blade sweep + every shard in the mote field at
t=0, captures 140 frames (~20fps) across one 7s window — the blade sweep's
own period — and encodes the result as an animated WebP with real alpha.
It is the only `docs/` image the README references; the old static tier
gallery has been removed.

### Frame rate is not negotiable

The blade is only *visible* for ~10% of the cycle: `bladeSweep` ramps opacity
in at 3% and drops it at 10%, so the whole sweep is ~700ms out of 7s, and the
streak crosses the card at ~115px per 50ms. An earlier revision captured 24
frames (3.5fps, ~290ms apart) — two or three frames caught the entire sweep
and it read as a jarring flash, not a sweep. **Below ~15fps this asset looks
broken.** Everything else on the card drifts slowly enough not to care.

## Why Grandmaster, and why it isn't a perfectly seamless loop

The pipeline principle is unchanged and still right: **drive the real
`src/server` and capture a real Electron window.** Don't mock the card up in
standalone HTML; it drifts from the app immediately.

Grandmaster has three things moving at once, on three different periods:
the house sheen (9s), the blade sweep (7s, `materials.css`: `bladeSweep 7s`),
and the shard field (each element is 3.85s or 5.5s, per `--dur` from
`particles.js` scaled by `0.55` in `.t-grandmaster .motes b`). None of those
share a common period with each other, so there is no length of capture where
everything lines up back at its starting phase — the same conclusion
`gif-capture.md` reached about every particle-bearing tier before this
revision. Only Challenger (no particle layer at all, sheen overridden to
match its 7s) loops perfectly clean.

The capture uses **7s — the blade sweep's period** — as the loop length,
since the blade is the headline motion that makes Grandmaster worth
showcasing. The house sheen and the shards land wherever they land at the
7s mark and jump slightly at the loop seam. In practice this is a minor,
easy-to-miss discontinuity in a faint (`rgba(255,255,255,0.15)`) band and a
few small shards — not the dominant visual, which is the blade. If that
seam ever bothers someone enough to fix it, the honest options are: accept
it (current choice), switch the hero to Challenger (the only tier that
actually loops clean), or go static (a single PNG, no seam to have).

## Format: WebP, not GIF

Real alpha is the whole reason. GIF's 1-bit alpha means flattening the
card's ~93%-opaque body onto a fixed backdrop colour, which breaks on
GitHub's light theme and hard-keys the rounded corners. WebP keeps the
card's actual alpha and antialiased corners on either theme, and GitHub
renders animated WebP fine in both markdown and `<img>` tags. Also smaller:
the encode used to produce ~257 KB as a 12-frame GIF; 24 frames as WebP
(twice the frame count) still comes in under 120 KB.

`encode.js` reads `frames.json` for per-frame delays, converts each PNG to a
buffer, and calls:

```js
sharp(frameBuffers, { join: { animated: true, across: 1 } })
  .webp({ delay: [...], loop: 0, quality: 82, effort: 5 })
```

No `.flatten()`, no backdrop colour — that was the GIF-only step.

## Pipeline

1. `createOverlayServer({ log: () => {} })`, `start(3057)` (not 3000 — the user's
   app may be running). No API key needed: unconfigured `fetchRank()` sets an
   error and returns without any network call.
2. `POST /api/test/` → `toggle-mock {enable:true}`, `reset_error`, `set_rank`
   (GRANDMASTER, rank "I" — see gotcha below), `lp_change`×N anchored well
   above 0 so the LP figure looks like a real Grandmaster ladder position.
   **All of it before `loadURL`** (see #5 below).
3. `loadURL(http://localhost:3057/overlay.html)`, kill the poll, `refresh()`,
   inject docs-only DOM, restart the animations, capture on an absolute
   schedule across the 7s window.

### Multi-pass capture

`capturePage()` costs ~40–60ms and jitters up to ~70ms, so a single pass
cannot sample every 50ms. The script instead restarts the animation `PASSES`
(4) times, each pass taking an interleaved subset — pass 0 grabs 0/200/400ms,
pass 1 grabs 50/250/450ms, and so on — then merges them by timestamp. Within
a pass, frames are 200ms apart, comfortably above the capture cost.

This is only valid because the card renders identically at a given offset on
every pass: `particles.js` derives every mote's position/duration/delay from
its element index rather than `Math.random()`, and clearing the inline
`animation` restarts every layer from t=0 together. Introduce anything
time-of-day or RNG dependent into the card and this scheme silently produces
a jumbled loop.

Each frame records the offset it **actually** fired at, not the one it aimed
for, and `encode.js` derives the WebP delays from those. Pinning frames to
their intended slots instead makes the blade travel in visibly uneven jumps,
since the pixels correspond to when the capture really happened. Uneven frame
*spacing* plays back fine; mislabelled frames do not.

## Gotchas

Still current unless noted.

1. **`zoomFactor` scales content, not the window.** A 370×108 window at zoom 2
   captures a 2x crop of the corner. Size it `W*ZOOM × H*ZOOM` with
   `useContentSize: true`, and call `setZoomFactor(ZOOM)` after `loadURL` —
   `webPreferences.zoomFactor` alone wasn't reliable.
2. **Stale error banner.** `start()` polls immediately; unconfigured that writes
   `latestData.error`, and `set_rank` does *not* clear it. Without a
   `reset_error` event the card renders its **not-tracking state** — dimmed
   frame, ghost crest, "Waiting for Riot API" — because `isPending()` keys off
   `error && tier === 'UNRANKED'`. Post `reset_error` right after `toggle-mock`.
3. **`refresh()` clobbers injected DOM.** Setting `#gameName`/`#tagLine` and then
   calling `refresh()` in the same `executeJavaScript` block silently loses them.
   Inject in a *separate* call after `refresh()` resolves, and again after
   *every subsequent* `refresh()` call if the script ever makes more than one —
   mock mode never sets `gameName`/`tagLine`/`region` itself, so each refresh
   wipes them back to blank.
4. **Region chip is deduped.** `readout.js` hides `#region` when it equals the
   tagline, so `SPLENK` + `#EUW` + `EUW` shows no chip. Full footer needs a
   tagline that differs from the region.
5. **Rank-change moments bleed.** `refresh()` re-runs `checkRankChange()`; a rank
   change between two refreshes fires a takeover. Populating mock state *before*
   `loadURL` makes the first refresh a first sighting, which `checkRankChange`
   skips.
6. **`show: true` required** — `show: false` returns stale/blank frames.
7. **`capturePage()` lags a frame.** Warm up: capture, `sleep(200)`, capture,
   keep the second — before the real sequence.
8. **Kill the overlay's 2.5s poll** before posing:
   `for (let i = 1; i < 10000; i++) clearInterval(i);` then drive `refresh()`.
9. **Restart every moving element before frame 0**, not just the sheen, or you
   capture a random phase for the blade and shards:
   ```js
   [sheenI, bladeI, ...motesB].forEach((el) => {
     el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
   });
   ```
   Clearing to `''` (rather than re-specifying a duration by name) lets each
   element fall back to whatever `materials.css` already defines for it —
   simpler than hard-coding per-tier durations in the capture script.
10. **Absolute deadlines, not cumulative sleeps.** `capturePage()` costs ~40–60ms,
    so `sleep(60)` in a loop drifts. Use `restartTime + targetOffset - Date.now()`.
11. **`backgroundThrottling: false`** — insurance against Chromium freezing the
    animation in an unfocused window. Failure mode (identical frames) is
    expensive to diagnose.
12. **Apex tiers need `newRank: 'I'`, not `null`/omitted.** Riot's real league
    entries always carry a rank string, even for Master/GM/Challenger (fixed at
    "I", since apex has no real division) — passing `null` renders literally
    as "GRANDMASTER null" in mock mode, which never happens against live data.
    `readout.js`'s `renderRank` now drops the suffix for apex tiers entirely
    (`Tiers.isApexTier` check), so this mostly matters for not feeding the
    capture unrealistic mock data, not for avoiding a rendering bug anymore.

## Verifying

The sheen band is `rgba(255,255,255,0.15)` — near-invisible in a raw frame.

```js
sharp('frame-05.png').linear(3.5, -260).toFile('frame-05-boost.png')  // eyeball it
```

Confirm delays and alpha survived encoding:
```js
sharp('docs/overlay-grandmaster-sheen.webp', { animated: true }).metadata()
// → pages: 140, loop: 0, hasAlpha: true, channels: 4
```

To check the sweep is continuous rather than stepping, build a contact sheet
of the first ~16 frames and look at it — the streak should cross the card in
even increments. Note `bladeSweep` is `ease-in-out`, so a column-wise
peak-difference measurement is *expected* to show uneven pixel steps and is a
poor instrument here; the peak also jumps between the streak's leading and
trailing edge. Eyeball it.

## sharp

`^0.35.3` writes animated GIF **and** WebP from bundled encoders — no extra
dependency, don't add one.

## Constraints

- Output to `docs/`, never `assets/` — `assets/**/*` is in `package.json`
  `build.files` and would ship inside the installer.
- Pose the card via mock events + DOM injection, not by hand-editing
  `src/overlay/`/`src/server/` for a docs shot — but if a capture surfaces a
  real rendering bug (as it did for apex-tier labels overflowing — see the
  `Tiers.isApexTier` check in `readout.js`'s `renderRank`), fix the bug, don't
  work around it in the capture script.
- Keep the animation well under ~2MB (currently ~570 KB at 140 frames).
- **A live HTML preview is not an option.** GitHub's markdown sanitizer strips
  `<script>`, `<style>`, `<iframe>` and CSS from READMEs, so the card cannot be
  embedded as real markup — a raster capture, an animated SVG, or an off-site
  hosted page are the only routes. A capture of the real Electron window is
  also the most faithful of those: an SVG would be a hand-port that drifts from
  the app, which is the failure mode this whole pipeline exists to avoid.
- Update the README's `<img src>` if the filename changes — it references
  `docs/overlay-grandmaster-sheen.webp` as the hero today.
