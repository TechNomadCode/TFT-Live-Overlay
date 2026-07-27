# Regenerating the README imagery — agent notes

Terse handoff for rebuilding `docs/`. Scripts: `capture.js` (Electron → PNG
frames + the gallery), `encode.js` (frames → GIF).

```bash
npx electron docs/_gif-build/capture.js          # everything
npx electron docs/_gif-build/capture.js hero     # hero-NNN.png   + frames-hero.json
npx electron docs/_gif-build/capture.js moment   # moment-NNN.png + frames-moment.json
npx electron docs/_gif-build/capture.js tiers    # ../overlay-tiers.png
node docs/_gif-build/encode.js                   # both GIFs (or pass hero/moment)
```

Run from repo root; `require('../../src/server')` is script-relative. Electron
and sharp are already dependencies.

## Three assets, three jobs

**`docs/overlay-live.gif`** — the hero. A Diamond I card taking a first place:
the placement strip shifts, the LP figure rolls 45 → 83 under a green ▲, the goal
bar closes on Master, then the sheen sweeps and the loop cuts. 50 frames, 2.95s,
812×288 (2x), ~550 KB, shown at `width="406"`.

**`docs/overlay-moment.gif`** — the tier takeover. A promotion into Master and
the demotion back out of it. 106 frames (77 after libvips merges the held
banners), 6.2s, 450×188 (**1x** — see below), ~1.1 MB, shown at `width="450"`.
Wider than the hero because `MOMENT_MARGIN` has to clear the flare.

**`docs/overlay-tiers.png`** — the gallery. All ten tiers side by side, lossless,
2 columns. This is what carries the per-tier materials; neither GIF shows more
than two tiers.

The split is the point. An earlier revision had one asset: an *idle* Grandmaster
card looping its sheen. The blade is visible for ~10% of its cycle and nothing
else on an idle card moves much, so ~90% of the frames were a still image of a
card doing nothing, and the file said nothing about what the app is for. Motion
belongs to the things the app exists to show — a result landing, a tier changing
— and the material range belongs in a still, where it costs one lossless PNG
instead of ten animated ones.

### Why the moment asset is 1x and the hero is 2x

The takeover's flare blooms over the entire card, so every frame is a full
repaint that delta-compresses to nothing, and the bloom is a wide smooth gradient
— the exact thing a 256-entry palette is worst at. Measured on the same frames:

| | size | RMSE |
|---|---|---|
| 2x, 256 colours | 3039 KB | 7.45 |
| 2x, 128 colours | 703 KB | 10.13 |
| **1x (downscaled), 256 colours** | **~1.1 MB** | — |

128 colours is not a trade, it's a cliff: the bloom turns into visible contour
rings, obvious at a glance rather than only in the metric. Dithering doesn't
rescue it (1319 KB, RMSE 10.55). So the palette has to stay at 256 and the
pixels have to go instead.

`encode.js` does the downscale from the 2x capture rather than the capture
running at zoom 1 — averaging a 2x render down is supersampling, so the text and
the 1px frame edges come out better than Chromium draws them natively at 1x. At
`width="450"` the result is displayed 1:1.

### The rank moment loops seamlessly, and only from one starting point

The loop is a promotion immediately followed by the matching demotion, which
returns the card to exactly where it began — no content cut at the wrap at all,
which is why it needs no `endHoldMs`.

That round trip is only exact at **Diamond I / 75 LP**. Riot's demotion
protection drops you into Diamond I at 75 LP regardless of how far under Master
you fall, so 75 is the one starting LP that survives the trip: `+43` promotes to
Master 18, and any subsequent loss lands back on Diamond I 75. Start at 88 and
the card returns to 75, and the wrap visibly jumps. Neither event carries a
placement either — the strip is an append-only array, so a placement would be
the one thing that didn't round-trip.

### Why Diamond I specifically

The goal bar measures LP to the next **tier**, not the next division. From
Diamond III that's ~255 LP away and a 38 LP win moves the bar by a tenth of its
width; from Diamond I the same win is 45% → 83% of the way to Master. Apex tiers
(Master and up) drop the goal row entirely, which is why the hero isn't
Grandmaster despite Grandmaster having the best-looking material.

## Format: GIF, and why the WebP revision was worse

An intermediate revision shipped animated WebP on the theory that its real 8-bit
alpha and better compression made it strictly better than GIF. In practice it
looked worse, and the measurements say why.

Encoded from the same source frames, RMSE against those frames:

| | size | RMSE |
|---|---|---|
| WebP `quality: 82` (what shipped) | 568 KB | 4.88 |
| WebP `quality: 95` | 1119 KB | 4.02 |
| **GIF, 256 colours, no dither** | **1852 KB** | **2.07** |
| WebP near-lossless | 2703 KB | 0.64 |

Lossy WebP at a README-sized bitrate spends its error budget on exactly the
wrong things: block and ringing artifacts around 1px frame lines and small text,
which is most of what this card *is*. GIF's error is palette error, and the card
is a handful of smooth dark gradients that a 256-entry palette covers well. At
256 colours the decoded frames are visually indistinguishable from the source at
1:1.

Two things that follow:

- **Don't dither.** Measured, dithering both increased the file and slightly
  *worsened* RMSE — the banding it exists to break up isn't there, so all it
  adds is noise. Below ~160 colours quality falls off a cliff (RMSE 6.4 at 128),
  and libvips picks its own palette anyway, so 256/192/160 produce byte-identical
  output.
- **The alpha argument was wrong.** Measured on a captured frame, the card is
  159,252 fully opaque pixels and 588 partial ones — its four rounded corners.
  There is no meaningful alpha to preserve, so GIF's 1-bit alpha costs nothing
  once the frames are flattened onto a backdrop.

The backdrop is `#0d1117` (GitHub's dark canvas): invisible on the dark theme,
reads as a screenshot of a dark app on the light one. `capture.js` paints it into
the page so Chromium composites the card's shadow against it; `encode.js` still
flattens as a guard, which is a no-op on an already-opaque frame.

## Smoothness: three separate causes, none of them the frame rate

The first GIF revision read as choppy, and the instinct — raise the frame rate —
would have made the file bigger without fixing any of it.

**1. A flickering drop shadow (the big one).** Diffing consecutive frames showed
~13,400 pixels changing on a strict period of 4, in a ring around the card, long
after all real motion had stopped. Four is `PASSES`. Measured directly, the mean
alpha of the margin was 18.5 on every frame from pass 0 and 17.0 on every frame
from passes 1–3 — the card's `box-shadow` lived in the alpha channel of a
`transparent: true` window, and `capturePage()` did not resolve it identically on
a freshly created window and a reloaded one. Interleaved, that is the whole card
pulsing at a quarter of the frame rate.

Fixed by removing alpha from the pipeline: an opaque window, an opaque
`document.body`, and the shadow composited by Chromium against `BACKDROP`. There
is also a throwaway pose before pass 0 so no pass is ever a window's first paint.
**If any per-pass difference ever creeps back in, it will present as a flicker,
not as a wrong-looking frame** — check for a period-`PASSES` pattern in the
per-frame diff before looking anywhere else.

**2. Uneven delays.** GIF stores delays in centiseconds and players quantise them
again to their own compositor clock, so a run of 4cs/6cs/5cs stutters even though
every frame is correctly labelled. Two changes:

- `sleepUntil()` — Windows' timer granularity is ~15.6ms, so a bare `setTimeout`
  landed anywhere in a 50ms slot. Coarse-sleep to 18ms short of the deadline,
  then close the gap on `setImmediate`. Capture drift is now a near-constant
  ~50ms of `capturePage()` latency with a ~15ms spread, down from ~70ms.
- **Delays are emitted from the uniform target grid, not from each capture's
  achieved offset.** This reverses what this file used to say, and the old rule
  was right at the time: with ±70ms of drift, labelling a frame with its intended
  slot put the pixels a frame or two from where the timeline claimed. At ±7ms the
  residual is invisible, a constant offset merely shifts the whole loop, and
  uniform playback is worth far more on this medium than millisecond-accurate
  labelling. `capturedAt` stays in `frames-<name>.json` so the drift is auditable.

**3. Rates that aren't vsync multiples.** 50ms is exactly 3 frames at 60Hz (and 6
at 120Hz); 100ms is 6 (and 12). 40ms is 2.4 — it plays back as an irregular
33/50/33/50 cadence and reads *worse* than the slower 50ms. Pick rates from
{50, 100, 200}, not from a target fps.

### Frame budget

`RATE_PLAN` is a list of `[fromMs, stepMs]` segments: 50ms while anything is
moving, 100ms once the roll has settled. The constraint is the house sheen, not
the LP roll — the sheen crosses the card at ~0.6px/ms, so at 10fps it moves a
third of its own width between frames and strobes. The roll itself is fine at
20fps; the digits are discrete.

### The end of the loop is where this asset goes wrong

All real motion is over by ~1600ms, and the loop runs to 2400ms. That extra
800ms is the settle beat — time to read "83 LP · 17 TO MASTER" before the wrap —
and **it has to be made of real captured frames.** The mote field is still
drifting through it (~120 changed pixels per frame, versus 0 on a duplicate), so
the card reads as calm rather than as stopped.

Two ways to get this wrong, both of which have already happened:

- **Buying the beat with a long `END_HOLD_MS`.** A 900ms hold on the final frame
  is a literal freeze covering a quarter of the loop, and it reads as a broken
  GIF, not as punctuation. `END_HOLD_MS` is now 150ms — one frame at ~2.5x its
  neighbours, enough to mark the wrap and short enough not to register as a
  pause. If it ever needs to be longer than ~250ms, extend `LOOP_MS` instead.
- **Extending `LOOP_MS` to catch the trend marker's fade at 4.7s.** A previous
  revision did, and paid three seconds of a static card for one small fade.

Check this the same way as everything else: the per-frame diff must stay non-zero
all the way to the last frame. A run of exact zeros at the end is a freeze,
whatever the delays say.

**Zeros in the middle of the rank moment are fine, though**, and are the one
exception. `showTierMoment` holds its banner still for ~1.4s on purpose, so
viewers can read it — those ~20 captures are genuinely identical, libvips merges
them into one page and sums the delays, and the played-back result is correct.
That's why `encode.js` reports frames and pages separately: a gap between them is
wasted capture time, not lost frames.

## Multi-pass capture

`capturePage()` costs ~40–60ms, so a single pass cannot sample every 50ms. The
script replays the whole sequence `PASSES` (4) times, each pass taking every 4th
target offset, then merges by target. Within a pass frames are ≥200ms apart,
comfortably above the capture cost.

This is only valid because the sequence is deterministic: `particles.js` derives
every mote from its element index rather than `Math.random()`, the LP roll is
`performance.now()`-driven, the rank moments are `setTimeout`-driven, and
clearing the inline `animation` restarts every layer from t=0 together. Introduce
anything RNG- or time-of-day-dependent into the card and this scheme silently
produces a jumbled loop.

It also requires every pass to run against an **identically conditioned window**,
which is a stronger requirement than it sounds and is what the shadow flicker
above violated. The passes interleave, so any systematic difference between two
of them lands between adjacent frames of the finished loop. A difference too
small to notice in a single frame is very noticeable at 5Hz.

`capturePage()` rejects with `UnknownVizError` now and then — a transient failure
to reach the GPU process. `capture()` retries once rather than losing a minute of
work. Blocking the main process makes it much more likely, which is why
`sleepUntil()` yields on `setImmediate` instead of spinning on `Date.now()`.

## Gotchas

1. **Anything that overflows the window gets scrollbars, and `capturePage()`
   photographs them.** The tier takeover is the one that does it: `flareOut`
   scales the flare to 1.18 (~33px past the card's edge) and the takeover's
   box-shadow adds a 34px glow, both of which cleared an 18px margin and put
   scrollbars down the side of the finished GIF. Hence `MOMENT_MARGIN`. Every
   sequence declares its own `margin` and `sizeWindow()` resizes to match, and
   `loadCard()` warns when the *resting* layout overflows — it can't see the
   takeover's, so a new animation that grows the card needs this checked by eye.
2. **`setContentSize()` needs a beat before the next capture**, or
   `capturePage()` rejects with "display surface not available".
3. **The placement strip survives `set_rank`.** It's a separate array that mock
   events append to and nothing in the test API clears, so pass 2 opens with
   pass 1's finishes already on the card. `resetMock()` toggles mock off (which
   restores the empty pre-mock snapshot) and back on before every pose.
4. **`animation-delay` is measured from when the animation started**, which was
   on page load. Setting it to `-420ms` to pose Grandmaster's blade lands 420ms
   past wherever the sweep already was. Use the Web Animations API instead —
   `el.getAnimations().forEach(a => { a.currentTime = 420; a.pause(); })`.
5. **`refresh()` clobbers injected identity.** Mock mode never sets
   `gameName`/`tagLine`/`region`, so every refresh wipes them back to blank.
   Injecting the DOM once isn't enough when the capture refreshes mid-sequence —
   `poseIdentity()` stubs `TFTOverlay.renderIdentity` to a no-op first.
6. **Region chip is deduped.** `readout.js` hides `#region` when it equals the
   tagline, so `SPLENK` + `#EUW` + `EUW` shows no chip. The full footer needs a
   tagline that differs from the region.
7. **Stale error banner.** `start()` polls immediately; unconfigured, that writes
   `latestData.error`, and `set_rank` does *not* clear it. Without `reset_error`
   the card renders its **not-tracking** state — dimmed frame, ghost crest,
   "Waiting for Riot API" — because `isPending()` keys off
   `error && tier === 'UNRANKED'`.
8. **Rank-change moments bleed.** `refresh()` re-runs `checkRankChange()`, and a
   rank change between two refreshes fires a takeover. Reloading the page between
   poses makes every tier a first sighting, which `checkRankChange` skips — this
   is what keeps the promotion flare off the gallery.
9. **Keep every partial LP sum inside 0–99.** Go over and `applyLPChange`
   promotes the card mid-pose, and the tile ends up labelled a division away from
   the one it was asked for.
10. **Apex tiers need `newRank: 'I'`**, not `null` — Riot's real league entries
    always carry a rank string even for Master/GM/Challenger. They also need an LP
    anchor: real Grandmaster is several hundred LP, so posing one at 34 is a
    number that never occurs.
11. **The goal bar transitions over 0.9s** and starts on the page's own first
    refresh. Start capturing before it lands and the bar is still creeping.
12. **`zoomFactor` scales content, not the window.** Size the window
    `W*ZOOM × H*ZOOM` with `useContentSize: true`, and call `setZoomFactor(ZOOM)`
    *after* `loadURL` — `webPreferences.zoomFactor` alone isn't reliable.
13. **`show: true` required** — `show: false` returns stale/blank frames.
14. **`capturePage()` lags a frame.** Warm up (capture, sleep, capture, discard
    both) before the real sequence.
15. **Kill the overlay's 2.5s poll** before posing:
    `for (let i = 1; i < 10000; i++) clearInterval(i);`, then drive `refresh()`.
16. **Absolute deadlines, not cumulative sleeps.** `capturePage()` costs enough
    that `sleep(step)` in a loop drifts hundreds of ms across a pass.
17. **`backgroundThrottling: false`** — insurance against Chromium freezing the
    animation in an unfocused window. The failure mode (identical frames) is
    expensive to diagnose.

## Verifying

**Run the per-frame diff before anything else.** Count the pixels that change
between consecutive frames and print it as a bar chart. A healthy hero is one
smooth hump (the sheen), a low plateau (the roll), then near-zero. Anything
periodic in that series is a pass artifact, and the period tells you it's the
capture rig rather than the card:

```js
// pseudo: for each consecutive pair, count |Δ| > 6 on the red channel
//   150 ██████        <- sheen entering
//   700 ██████████████
//  1550 ▏             <- settled; motes only
// A 13k/13k/90/120 pattern repeating every 4 frames is PASSES, not animation.
```

`capture.js` also prints the capture drift spread; if the max-min gap grows past
~20ms, `sleepUntil()` has stopped working and the loop will stutter.

```js
sharp('docs/overlay-live.gif', { animated: true }).metadata()
// -> pages, pageHeight, loop: 0
```

Decode a mid-roll page and stack it against the source frame at 1:1 rather than
trusting a metric — that's what confirmed 256 colours is visually clean:

```js
sharp('docs/overlay-live.gif', { animated: true, pages: 1, page: 20 })
sharp('docs/_gif-build/hero-020.png').flatten({ background: '#0d1117' })
```

The sheen band is `rgba(255,255,255,0.15)` — near-invisible in a raw frame.
`sharp(f).linear(3.5, -260)` to eyeball it. `bladeSweep` is `ease-in-out`, so a
column-wise peak-difference measurement is *expected* to show uneven pixel steps
and is a poor instrument. Build a contact sheet and look at it.

## Constraints

- Output to `docs/`, never `assets/` — `assets/**/*` is in `package.json`
  `build.files` and would ship inside the installer.
- Pose the card via mock events + DOM injection, not by hand-editing
  `src/overlay/` or `src/server/` for a docs shot. But if a capture surfaces a
  real rendering bug (as it did for apex-tier labels overflowing — see the
  `Tiers.isApexTier` check in `readout.js`'s `renderRank`), fix the bug rather
  than working around it in the capture script.
- Keep the GIF under ~1MB (currently ~830 KB at 59 frames).
- **A live HTML preview is not an option.** GitHub's markdown sanitizer strips
  `<script>`, `<style>`, `<iframe>` and CSS from READMEs, so the card cannot be
  embedded as real markup. A raster capture of the real Electron window is also
  the most faithful route available: an SVG would be a hand-port that drifts from
  the app, which is the failure mode this whole pipeline exists to avoid.
- Update the README's `<img src>` and `width` if either filename or the zoom
  factor changes.
