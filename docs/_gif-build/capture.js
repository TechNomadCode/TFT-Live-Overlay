// Capture script for the README imagery. Not part of the app.
//
//   npx electron docs/_gif-build/capture.js          # everything
//   npx electron docs/_gif-build/capture.js hero     # the animated hero
//   npx electron docs/_gif-build/capture.js moment   # the promotion/demotion loop
//   npx electron docs/_gif-build/capture.js tiers    # the tier gallery
//
// Produces:
//   docs/_gif-build/hero-NNN.png   + frames-hero.json    -> encode.js
//   docs/_gif-build/moment-NNN.png + frames-moment.json  -> encode.js
//   docs/overlay-tiers.png                               -> the tier gallery
//
// See gif-capture.md for the why behind the multi-pass scheme and the gotchas.
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');
const sharp = require('sharp');
const { createOverlayServer } = require('../../src/server');
const { TIER_NAMES, isApexTier } = require('../../src/shared/tiers');

const PORT = 3057;
const CARD_W = 370;
const CARD_H = 108;
// Breathing room around the card. The overlay page is edge-to-edge by design
// (OBS composites it over the stream), so a docs shot cropped to the card puts
// its rounded corners hard against the image edge. Padding the body gives the
// card somewhere to cast its drop shadow and keeps the corners inside the frame.
const MARGIN = 18;
// The tier takeover needs a lot more room than a resting card. `flareOut` scales
// the flare to 1.18, which puts it ~33px past the card's edge, and the takeover's
// box-shadow adds a 34px glow on top of that. At MARGIN the page overflowed, so
// Chromium put scrollbars in the window and capturePage() photographed them.
// (The real overlay clips this too -- a 400x130 Browser Source is narrower than
// the bloom -- but a docs shot may as well show the whole effect.)
const MOMENT_MARGIN = 40;
const ZOOM = 2;
const OUT_DIR = __dirname;
const DOCS_DIR = path.join(__dirname, '..');

// Every capture is opaque, painted on GitHub's dark canvas. This is not a
// cosmetic choice, it's the fix for a flicker that made the first version of the
// hero look like a bad video rather than an animation:
//
// with a transparent window, the card's drop shadow lives in the alpha channel
// and `capturePage()` did not resolve it identically on a freshly created window
// and a reloaded one. Pass 0's shadow came out ~9% stronger than passes 1-3's,
// and since the passes interleave, the merged loop pulsed on every 4th frame.
// Compositing the shadow in Chromium against a known colour removes the alpha
// channel from the pipeline entirely, and with it the whole failure mode.
const BACKDROP = '#0d1117';

// The hero is a Diamond card, not Grandmaster: apex tiers drop the goal row
// entirely (no LP target above Diamond), and the bar filling is half of what
// makes a won game read as a won game. Grandmaster's blade and the rest of the
// per-tier materials are covered by the static gallery instead.
// Diamond I specifically, not III: the goal bar measures LP to the next *tier*,
// so from Diamond III that's three divisions and ~255 LP, and a 38 LP win moves
// the bar by a tenth of its width. From Diamond I the same win is 45% -> 83% of
// the way to Master, which is the bar doing the job it exists to do.
const HERO_TIER = 'DIAMOND';
const HERO_RANK = 'I';
// Seeded before the capture so the placement strip is already full: five
// finishes of a plausible session, oldest first, landing the card on 45 LP.
// Every partial sum stays inside 0-99 LP, or applyLPChange promotes the card
// mid-seed and the hero opens on a division it was never asked for.
const HERO_SEED = [
  { lpChange: 29, placement: 2 },
  { lpChange: 18, placement: 4 },
  { lpChange: -14, placement: 6 },
  { lpChange: 21, placement: 3 },
  { lpChange: -9, placement: 5 },
];
// The event the loop exists to show: a first place.
const HERO_EVENT = { lpChange: 38, placement: 1 };

const IDENTITY = { gameName: 'SPLENK', tagLine: '#1337', region: 'EUW' };

// Loop shape: short idle, the win lands, a beat, then the sheen sweeps and the
// loop cuts on the far side of it.
//
// The two events are staged rather than simultaneous. An earlier revision left
// the sheen on its natural phase, which put its sweep across 150-800ms and the
// LP roll starting at 700ms -- they collided, and a card doing two unrelated
// things at once reads as noise rather than as either of them. Separating them
// also gives the loop a shape: something happens, you get to read the result,
// then the material does its thing and that's the cue to wrap.
//
// The sheen is what the loop is cut around. Its sweep is 0-10.9% of a 9s cycle
// (~980ms), so seeking it to `duration - SHEEN_AT_MS` at t=0 puts the sweep
// exactly where we want it, and ending shortly after means the card is
// transparent-sheened at both ends of the loop -- the sweep itself never
// straddles the wrap.
const EVENT_AT_MS = 400;
const SHEEN_AT_MS = 1700;
const LOOP_MS = 2800;

// The mote field is wound forward before frame 0. Each shard has its own
// `animation-delay` (particles.js bakes it from the element index), so restarting
// the field at t=0 means every shard is still sitting in its delay and NOTHING on
// the card moves during the lead-in -- five byte-identical frames, i.e. the same
// freeze at the head of the loop that END_HOLD_MS used to put at the tail.
// Seeding past the longest delay puts the field in flight from the first frame.
const MOTE_SEED_MS = 2000;

// All real motion has to run to the last frame. The mote field is still drifting
// through the quiet stretches (~120 changed pixels per frame, versus 0 on a
// duplicate), so the card reads as calm rather than as stopped. An earlier
// revision bought its settle beat with a 900ms hold on the final frame instead,
// and a literal freeze covering a quarter of the loop does not read as
// punctuation, it reads as a broken GIF. This is only long enough to mark the
// wrap: one frame at ~2.5x its neighbours. If it ever wants to be longer than
// ~250ms, extend LOOP_MS instead.
const END_HOLD_MS = 150;

// Frame budget as [fromMs, stepMs] segments: 50ms over each of the two events,
// 100ms over the idle lead-in and the beat between them. The sheen is the
// constraint on the rate, not the LP roll -- it crosses the card at ~0.6px/ms,
// so at 10fps it moves a third of its own width between frames and strobes
// instead of sweeping. The roll is fine at 20fps; its digits are discrete.
//
// Both rates are exact multiples of a 60Hz frame (16.67ms): 50ms is 3 vsyncs,
// 100ms is 6, and both divide evenly at 120Hz too. This matters more than the
// nominal rate does. Browsers don't honour GIF delays to the millisecond, they
// schedule against the compositor clock -- so 40ms (2.4 vsyncs) plays back as an
// irregular 33/50/33/50 cadence and reads *worse* than the slower 50ms, which
// lands on a vsync every time.
const RATE_PLAN = [
  [0, 100],                  // idle lead-in
  [EVENT_AT_MS - 100, 50],   // the win landing: roll, bar, strip, marker
  [1400, 100],               // the beat in between
  [SHEEN_AT_MS - 100, 50],   // the sheen sweep
  [2700, 100],
];

// capturePage() costs ~40-60ms and jitters, so a single pass cannot sample every
// 40ms. The deterministic sequence is replayed PASSES times, each pass taking
// every PASSES-th target offset, and the passes are merged by offset afterwards.
const PASSES = 4;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Windows' timer granularity is ~15.6ms, so a bare setTimeout lands anywhere in
// a 50ms slot -- which showed up as GIF delays scattered between 4cs and 6cs
// where they should all have been 5cs. Coarse-sleep to just short of the
// deadline, then close the gap on the event loop.
//
// The last stretch yields via setImmediate rather than spinning on Date.now().
// A bare spin blocks the main process, and capturePage() needs it to talk to the
// GPU process -- blocking for 20ms immediately before every capture made
// capturePage() fail intermittently with UnknownVizError.
async function sleepUntil(deadline) {
  const coarse = deadline - Date.now() - 18;
  if (coarse > 0) await sleep(coarse);
  while (Date.now() < deadline) await new Promise(setImmediate);
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

const test = (action, extra) => postJSON(`http://localhost:${PORT}/api/test/event`, { action, ...extra });
const setMock = (enable) => postJSON(`http://localhost:${PORT}/api/test/toggle-mock`, { enable });

// Back to a clean slate. set_rank only rewrites tier/rank/LP -- the placement
// strip is a separate array that mock events append to and nothing in the test
// API clears, so a second pose stacks on top of the first one's finishes.
// Toggling mock off restores the snapshot taken on the way in, which is the
// empty pre-mock state; toggling back on re-snapshots that.
async function resetMock() {
  await setMock(false);
  await setMock(true);
  await test('reset_error');
}

function targetOffsets(ratePlan, loopMs) {
  const offsets = [];
  for (let t = 0; t < loopMs; ) {
    offsets.push(t);
    const seg = ratePlan.filter(([from]) => t >= from).pop();
    t += seg[1];
  }
  return offsets;
}

// Resized per sequence rather than per window, so every pass of a given sequence
// still runs against a window in the same state. Nothing may overflow the content
// box: an overflowing page gets scrollbars, and capturePage() photographs them.
//
// The settle is not optional -- capturePage() rejects with "display surface not
// available" for a beat after a resize.
async function sizeWindow(win, margin) {
  win.setContentSize((CARD_W + margin * 2) * ZOOM, (CARD_H + margin * 2) * ZOOM);
  await sleep(400);
}

function makeWindow() {
  return new BrowserWindow({
    width: (CARD_W + MARGIN * 2) * ZOOM,
    height: (CARD_H + MARGIN * 2) * ZOOM,
    useContentSize: true,
    // Opaque, not transparent -- see BACKDROP. A transparent window puts the
    // card's drop shadow in the alpha channel, and capturePage() resolved that
    // differently on a new window than on a reloaded one.
    transparent: false,
    frame: false,
    // show: false returns stale/blank frames from capturePage().
    show: true,
    backgroundColor: BACKDROP,
    webPreferences: { zoomFactor: ZOOM, backgroundThrottling: false },
  });
}

const exec = (win, src) => win.webContents.executeJavaScript(`(function(){${src}})();`);

// capturePage() rejects transiently -- UnknownVizError when it can't reach the
// GPU process, "display surface not available" for a moment after the window is
// resized. Neither is a problem with the page, and losing a whole pass to one
// costs a minute, so retry a couple of times before giving up.
async function capture(win) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await win.capturePage();
    } catch (err) {
      if (attempt >= 2) throw err;
      await sleep(250);
    }
  }
}

// Mock mode never sets the Riot ID or region (both live only on the real path),
// and every refresh() re-renders identity from the payload -- so injecting the
// DOM once isn't enough, the renderer itself has to be stubbed out. The tagline
// is deliberately not "#EUW": the overlay hides the region chip when the tagline
// already says the same thing, and the full footer is what we want on the shot.
function poseIdentity(win, margin) {
  return exec(win, `
    const T = window.TFTOverlay;
    T.renderIdentity = function () {};
    document.getElementById('gameName').textContent = ${JSON.stringify(IDENTITY.gameName)};
    document.getElementById('tagLine').textContent = ${JSON.stringify(IDENTITY.tagLine)};
    const region = document.getElementById('region');
    region.textContent = ${JSON.stringify(IDENTITY.region)};
    region.style.display = '';
    document.getElementById('footer').classList.remove('hidden');
    document.body.style.padding = '${Number(margin)}px';
    document.body.style.background = '${BACKDROP}';
  `);
}

// Resolves once the card has actually painted its crest -- the emblem is fetched
// over HTTP (proxied through /api/crest), so a fixed sleep either wastes time or
// catches the card mid-load.
function waitForCrest(win) {
  return exec(win, `
    const img = document.getElementById('emblem');
    if (img.complete && img.naturalWidth > 0) return true;
    return new Promise((r) => { img.onload = () => r(true); setTimeout(() => r(false), 4000); });
  `);
}

// Restarts every continuous animation at t=0 together: the house sheen, the
// per-tier ornament (Grandmaster's blade) and every shard in the mote field.
// Clearing the inline override to '' lets each element fall back to whatever
// materials.css defines for it, rather than hard-coding durations here.
//
// The sheen is then wound forward so its next sweep lands at `sheenAt` instead
// of immediately. The offset is derived from the animation's own duration rather
// than from a hard-coded 9s, so changing `sheenLoop`'s timing in card.css moves
// the sweep without silently desynchronising this script from it.
function restartAnimations(win, sheenAt) {
  return exec(win, `
    [document.querySelector('.sheen i'), document.querySelector('.blade i'),
     ...document.querySelectorAll('.motes b')].forEach((el) => {
      if (!el) return;
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
    });
    const sheen = document.querySelector('.sheen i');
    if (sheen && ${Number(sheenAt) > 0}) {
      sheen.getAnimations().forEach((a) => {
        const cycle = a.effect.getTiming().duration;
        a.currentTime = Math.max(0, cycle - ${Number(sheenAt)});
      });
    }
    document.querySelectorAll('.motes b').forEach((el) => {
      el.getAnimations().forEach((a) => { a.currentTime = ${MOTE_SEED_MS}; });
    });
  `);
}

async function loadCard(win, preloadTiers, margin = MARGIN) {
  await win.loadURL(`http://localhost:${PORT}/overlay.html`);
  win.webContents.setZoomFactor(ZOOM);
  await sleep(500);
  // Warm the crests this sequence will swap between. crest.js assigns the new
  // src mid-animation, and an uncached fetch there would paint late -- in pass 0
  // only, which is exactly the kind of per-pass difference that surfaces as a
  // flicker rather than as an obviously wrong frame.
  if (preloadTiers && preloadTiers.length) {
    await exec(win, `
      return Promise.all(${JSON.stringify(preloadTiers)}.map((slug) => new Promise((done) => {
        const img = new Image();
        img.onload = img.onerror = done;
        img.src = '/api/crest/' + slug;
      })));
    `);
  }
  // The page's own 2.5s poll would land mid-capture; refresh() is driven by hand
  // from here on. Reloading the page is also what resets lp-meter's isFirstLoad
  // and rank-moment's lastRankScore, so the pose lands without animating and
  // without firing a promotion takeover.
  await exec(win, 'for (let i = 1; i < 10000; i++) clearInterval(i);');
  await poseIdentity(win, margin);
  await exec(win, 'return window.TFTOverlay.refresh();');
  await waitForCrest(win);

  // An overflowing page gets scrollbars, and capturePage() photographs them --
  // which is how the tier takeover's 1.18x flare ended up putting scrollbars down
  // the side of a docs GIF. This can only catch the resting layout; the takeover
  // grows past it, hence MOMENT_MARGIN. Warn rather than throw, so a capture that
  // is merely a bit tight still finishes and can be looked at.
  const overflow = await exec(win, `
    const d = document.documentElement;
    return { x: d.scrollWidth - d.clientWidth, y: d.scrollHeight - d.clientHeight };
  `);
  if (overflow.x > 0 || overflow.y > 0) {
    console.warn(`  ! page overflows its window by ${overflow.x}x${overflow.y}px -- increase the margin`);
  }
  // The goal bar's width transition is 0.9s and starts on the page's own first
  // refresh -- start capturing before it lands and the bar is still creeping.
  await sleep(1000);
}

async function seedHeroPose() {
  // start() polls immediately and an unconfigured poll writes an error, which
  // set_rank does not clear -- leave it and the card renders its not-tracking
  // state (dimmed frame, "Waiting for Riot API") instead of a live card.
  await resetMock();
  await test('set_rank', { newTier: HERO_TIER, newRank: HERO_RANK });
  for (const s of HERO_SEED) await test('lp_change', s);
}

/**
 * Captures one looping sequence and writes its frames plus a manifest.
 *
 * @param {object} spec
 * @param {string} spec.name             frame prefix and manifest name
 * @param {function} spec.pose           resets mock state to the loop's frame 0
 * @param {Array} spec.steps             [{ at, run }] fired at exact loop offsets
 * @param {Array} spec.ratePlan          [fromMs, stepMs] segments
 * @param {number} spec.loopMs
 * @param {number} spec.endHoldMs
 * @param {number} spec.sheenAt          0 keeps the sheen out of the loop entirely
 * @param {string[]} [spec.preloadTiers] crests to warm before capturing
 */
async function captureSequence(win, spec) {
  const offsets = targetOffsets(spec.ratePlan, spec.loopMs);
  const frames = [];

  await sizeWindow(win, spec.margin);

  // Every pass has to run against an identically-conditioned window, because the
  // passes get interleaved: any difference between them becomes a difference
  // between *adjacent frames* of the loop, i.e. a flicker at a quarter of the
  // frame rate. A throwaway pose before pass 0 means pass 0 is a reload like
  // every other pass rather than a first paint, and warms capturePage(), which
  // otherwise returns the previous frame on its first call.
  await spec.pose();
  await loadCard(win, spec.preloadTiers, spec.margin);
  await capture(win);
  await sleep(200);
  await capture(win);

  for (let pass = 0; pass < PASSES; pass++) {
    await spec.pose();
    await loadCard(win, spec.preloadTiers, spec.margin);

    await restartAnimations(win, spec.sheenAt);
    const t0 = Date.now();
    let next = 0;

    // Runs every step whose moment has passed, so one never gets skipped just
    // because this pass has no frame near it. Mock state is cumulative -- a
    // missed step leaves the following pass posing on top of a half-applied one.
    const runStepsDueBy = async (until) => {
      while (next < spec.steps.length && spec.steps[next].at <= until) {
        const step = spec.steps[next++];
        await sleepUntil(t0 + step.at);
        await step.run();
      }
    };

    for (let i = pass; i < offsets.length; i += PASSES) {
      const target = offsets[i];
      await runStepsDueBy(target);
      // Absolute deadline, not a cumulative sleep: capturePage() costs enough
      // that sleep(step) in a loop drifts several hundred ms across a pass.
      await sleepUntil(t0 + target);
      const image = await capture(win);
      frames.push({ png: image.toPNG(), offset: Date.now() - t0, target });
    }

    await runStepsDueBy(Infinity);
  }

  // By target, not by achieved offset: the targets are the uniform grid the
  // delays are emitted from, and a frame that came back 9ms late is still that
  // grid slot's frame.
  frames.sort((a, b) => a.target - b.target);

  const stale = new RegExp(`^${spec.name}-\\d+\\.png$`);
  fs.readdirSync(OUT_DIR)
    .filter((f) => stale.test(f))
    .forEach((f) => fs.unlinkSync(path.join(OUT_DIR, f)));

  frames.forEach((f, i) => {
    f.file = `${spec.name}-${String(i).padStart(3, '0')}.png`;
    fs.writeFileSync(path.join(OUT_DIR, f.file), f.png);
  });

  // Delays come from the uniform target grid, NOT from the offset each capture
  // actually fired at.
  //
  // The reverse used to be true here, and it was right at the time: capturePage()
  // drifted up to ~70ms, so labelling a frame with its intended slot put the
  // pixels several frames away from where the timeline said they were, and
  // motion travelled in visible jumps. With sleepUntil() the drift is a roughly
  // constant ~50ms of capture latency plus <10ms of jitter -- a constant offset
  // just shifts the whole loop, which nobody can see. What IS visible is uneven
  // delays, because a GIF player quantises them to its own frame clock and turns
  // a 40/50/30ms run into a stutter. Uniform beats accurate on this medium.
  const meta = frames.map((f, i) => ({
    i,
    file: f.file,
    target: f.target,
    capturedAt: f.offset,
    delayToNext: i < frames.length - 1
      ? frames[i + 1].target - f.target
      : Math.max(20, spec.loopMs - f.target) + spec.endHoldMs,
  }));
  fs.writeFileSync(path.join(OUT_DIR, `frames-${spec.name}.json`), JSON.stringify(meta, null, 2));

  // Uneven delays are the failure mode to watch for here. GIF players quantise
  // to 10ms and schedule on their own frame boundaries, so a run of 4cs/6cs/5cs
  // reads as stutter even though every frame is correctly labelled. Report the
  // spread against each frame's intended slot so a regression is visible without
  // having to watch the GIF and squint.
  const drift = frames.map((f) => f.offset - f.target);
  const total = meta.reduce((a, f) => a + f.delayToNext, 0);
  console.log(`${spec.name}: ${frames.length} frames over ${total}ms (${PASSES} passes).`);
  console.log(`  capture drift vs target: ${Math.min(...drift)}ms .. ${Math.max(...drift)}ms`);
}

const refresh = (win) => exec(win, 'return window.TFTOverlay.refresh();');

function captureHero(win) {
  return captureSequence(win, {
    name: 'hero',
    pose: seedHeroPose,
    margin: MARGIN,
    ratePlan: RATE_PLAN,
    loopMs: LOOP_MS,
    endHoldMs: END_HOLD_MS,
    sheenAt: SHEEN_AT_MS,
    steps: [{
      at: EVENT_AT_MS,
      run: async () => { await test('lp_change', HERO_EVENT); await refresh(win); },
    }],
  });
}

// ---- The rank moment -------------------------------------------------------
// A tier change is the one animation the overlay exists for -- it takes the whole
// card over for 2.6s, in the colour of the tier you landed in. It's also the only
// asset here that loops *seamlessly*, because the loop is a promotion followed by
// the matching demotion, which returns the card to exactly where it started.
//
// That round trip is only exact at one starting point. Riot's demotion protection
// drops you into Diamond I at 75 LP regardless of how far under you fall, so
// Diamond I / 75 LP is the single value that survives the trip: +43 promotes to
// Master 18, and any subsequent loss lands back on Diamond I 75. Starting at, say,
// 88 LP returns to 75 and the wrap visibly jumps.
const MOMENT_TIER = 'DIAMOND';
const MOMENT_RANK = 'I';
const MOMENT_LP = 75;
const MOMENT_UP = 43;
const MOMENT_DOWN = -25;
// Neither event carries a placement: the strip is a separate array that only
// grows, so a placement would be the one thing that didn't round-trip.
const PROMOTE_AT_MS = 400;
const DEMOTE_AT_MS = 3300;
const MOMENT_LOOP_MS = 6200;

// showTierMoment holds for 2600ms and hands back over the last 400ms. The busy
// parts are the flare (720ms up / 900ms down) with the banner growing and the
// material, crest and layout all swapping under it, and then the hand-back. The
// stretch in between is a held banner, and only the mote field is moving.
const MOMENT_RATE_PLAN = [
  [0, 100],
  [PROMOTE_AT_MS - 100, 50],
  [PROMOTE_AT_MS + 1300, 100],
  [PROMOTE_AT_MS + 2000, 50],
  [PROMOTE_AT_MS + 2800, 100],
  [DEMOTE_AT_MS - 100, 50],
  [DEMOTE_AT_MS + 1300, 100],
  [DEMOTE_AT_MS + 2000, 50],
  [DEMOTE_AT_MS + 2800, 100],
];

async function seedMomentPose() {
  await resetMock();
  await test('set_rank', { newTier: MOMENT_TIER, newRank: MOMENT_RANK });
  for (const p of MOMENT_STRIP) await test('lp_change', p);
  // Trim back to the exact LP the round trip closes on. The strip seeding above
  // is what leaves it somewhere else.
  await test('set_rank', { newTier: MOMENT_TIER, newRank: MOMENT_RANK });
  await test('lp_change', { lpChange: MOMENT_LP });
}

// Five finishes so the strip is full, then the LP is reset over the top of them.
const MOMENT_STRIP = [
  { lpChange: 12, placement: 3 },
  { lpChange: 9, placement: 1 },
  { lpChange: -7, placement: 6 },
  { lpChange: 11, placement: 2 },
  { lpChange: -6, placement: 5 },
];

function captureMoment(win) {
  return captureSequence(win, {
    name: 'moment',
    pose: seedMomentPose,
    margin: MOMENT_MARGIN,
    ratePlan: MOMENT_RATE_PLAN,
    loopMs: MOMENT_LOOP_MS,
    // The loop closes on itself, so there is nothing to punctuate.
    endHoldMs: 0,
    // Deliberately no sheen: the takeover is already the busiest thing this card
    // ever does, and a sweep across it reads as a second unrelated event.
    sheenAt: 0,
    // Warmed so pass 0 isn't the only pass that pays for fetching the Master
    // crest -- an uncached image would land a frame or two late in pass 0 only,
    // which is precisely the per-pass difference that shows up as a flicker.
    preloadTiers: ['diamond', 'master'],
    steps: [
      { at: PROMOTE_AT_MS, run: async () => { await test('lp_change', { lpChange: MOMENT_UP }); await refresh(win); } },
      { at: DEMOTE_AT_MS, run: async () => { await test('lp_change', { lpChange: MOMENT_DOWN }); await refresh(win); } },
    ],
  });
}

// ---- Static tier gallery ---------------------------------------------------
// One shot per tier, tiled into a single lossless PNG. Ten separate images would
// be ten requests and ten alt texts; the point of the gallery is the comparison
// anyway, which only works when they're side by side.

const GALLERY_COLS = 2;
const GALLERY_GAP = 16;
const GALLERY_PAD = 20;
const GALLERY_BG = { r: 13, g: 17, b: 23, alpha: 1 }; // GitHub's dark canvas

// Enough of a session for the strip and the bar to look lived-in. Five variants
// rather than one, cycled across the ten tiers, so the gallery doesn't read as
// ten copies of a single screenshot with the palette swapped. Every partial sum
// stays inside 0-99 LP: go over and applyLPChange promotes the card mid-pose and
// the tile ends up labelled a division away from the one it was asked for.
const GALLERY_POSES = [
  [[58, 2], [-17, 7], [26, 1], [-9, 5], [14, 3]],
  [[22, 1], [19, 2], [-14, 6], [28, 1], [-21, 8]],
  [[41, 1], [-8, 5], [33, 2], [17, 3], [8, 4]],
  [[15, 3], [-9, 6], [12, 4], [-11, 7], [5, 4]],
  [[36, 2], [24, 1], [-18, 5], [21, 2], [-8, 6]],
];

// Apex tiers have no division to sit in and no LP ceiling -- real Grandmaster is
// several hundred LP, so posing one at 34 LP is a number that never occurs. The
// anchor carries no placement, which keeps it out of the strip.
const APEX_ANCHOR = { MASTER: 180, GRANDMASTER: 480, CHALLENGER: 1120 };

// Two tiers have a signature effect that a still frame misses: Grandmaster's
// blade is only visible for ~10% of its 7s cycle, and Challenger has no particle
// layer at all, so its slow sheen is the only thing that reveals the engraving.
// Freezing those animations mid-sweep is the difference between a gallery that
// shows what the tier looks like and one that shows what it looks like when
// nothing is happening. Selector -> the moment to hold, in ms into the cycle.
const GALLERY_HOLD = {
  GRANDMASTER: { '.blade i': 420 },   // 6% of bladeSweep 7s -- mid-card, full opacity
  CHALLENGER: { '.sheen i': 420 },    // 6% of Challenger's 7s sheen, same reason
};

async function captureTiers(win) {
  const tiles = [];
  await sizeWindow(win, MARGIN);

  for (const [i, tier] of TIER_NAMES.entries()) {
    await resetMock();
    // Apex tiers have no real division, but Riot's league entries still carry a
    // rank string ("I") for them -- passing null renders "MASTER null" here.
    await test('set_rank', { newTier: tier, newRank: isApexTier(tier) ? 'I' : 'II' });
    if (APEX_ANCHOR[tier]) await test('lp_change', { lpChange: APEX_ANCHOR[tier] });
    for (const [lpChange, placement] of GALLERY_POSES[i % GALLERY_POSES.length]) {
      await test('lp_change', { lpChange, placement });
    }

    // Reloading between tiers is what keeps the promotion takeover off the shot:
    // rank-moment skips the first sighting of any rank, and a reload makes every
    // tier a first sighting.
    await loadCard(win);

    // Seek the animation and freeze it, via the Web Animations API rather than a
    // negative animation-delay: the delay is measured from when the animation
    // started, which was on page load a second earlier, so setting it to -420ms
    // lands 420ms past wherever the sweep already was instead of at 420ms.
    const hold = GALLERY_HOLD[tier];
    if (hold) {
      await exec(win, Object.entries(hold).map(([sel, at]) => `
        { const el = document.querySelector(${JSON.stringify(sel)});
          if (el) el.getAnimations().forEach((a) => { a.currentTime = ${at}; a.pause(); }); }
      `).join('\n'));
      await sleep(150);
    }

    const image = await capture(win);
    tiles.push({ tier, png: image.toPNG() });
    console.log(`  posed ${tier}`);
  }

  const tileW = (CARD_W + MARGIN * 2) * ZOOM;
  const tileH = (CARD_H + MARGIN * 2) * ZOOM;
  const rows = Math.ceil(tiles.length / GALLERY_COLS);
  const width = GALLERY_PAD * 2 + GALLERY_COLS * tileW + (GALLERY_COLS - 1) * GALLERY_GAP;
  const height = GALLERY_PAD * 2 + rows * tileH + (rows - 1) * GALLERY_GAP;

  const composite = tiles.map((t, i) => ({
    input: t.png,
    left: GALLERY_PAD + (i % GALLERY_COLS) * (tileW + GALLERY_GAP),
    top: GALLERY_PAD + Math.floor(i / GALLERY_COLS) * (tileH + GALLERY_GAP),
  }));

  const out = path.join(DOCS_DIR, 'overlay-tiers.png');
  const buf = await sharp({ create: { width, height, channels: 4, background: GALLERY_BG } })
    .composite(composite)
    .png({ compressionLevel: 9, palette: true, quality: 100, effort: 10 })
    .toBuffer();
  fs.writeFileSync(out, buf);
  console.log(`Gallery: ${out} -- ${width}x${height}, ${(buf.length / 1024).toFixed(0)} KB`);
}

async function main() {
  const what = process.argv[2] || 'all';
  await app.whenReady();

  const server = createOverlayServer({ log: () => {} });
  await server.start(PORT);

  const win = makeWindow();

  if (what === 'all' || what === 'tiers') await captureTiers(win);
  if (what === 'all' || what === 'hero') await captureHero(win);
  if (what === 'all' || what === 'moment') await captureMoment(win);

  await server.stop();
  win.destroy();
  app.quit();
}

main().catch((err) => {
  console.error(err);
  app.exit(1);
});
