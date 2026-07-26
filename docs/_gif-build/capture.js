// Capture script for the README's animated hero: docs/overlay-grandmaster-sheen.webp.
// Not part of the app. Run with: npx electron docs/_gif-build/capture.js
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');
const { createOverlayServer } = require('../../src/server');

const PORT = 3057;
const CARD_W = 370;
const CARD_H = 108;
const ZOOM = 2;
const OUT_DIR = __dirname;

// Grandmaster's blade sweep runs on a 7s cycle (materials.css: `bladeSweep 7s`)
// -- that's the loop length we capture, not the house sheen's 9s. The house
// sheen and the shard field (3.85s/5.5s, per-element) don't share that period,
// so they won't be back at their exact starting phase when the loop restarts.
// Per gif-capture.md, no particle-bearing tier has one common period; this
// accepts a small seam in the faint sheen/shards rather than skipping an
// animated hero for Grandmaster entirely.
const LOOP_MS = 7000;

// 20fps. The blade is only *visible* for ~10% of the cycle (`bladeSweep` holds
// opacity 0 from 10% onward), i.e. ~700ms -- at the 3.5fps this script used to
// run at, two or three frames caught the whole sweep and it read as a flash
// rather than a sweep. Anything below ~15fps looks broken for that reason.
const TARGET_FPS = 20;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
const FRAME_COUNT = Math.round(LOOP_MS / FRAME_INTERVAL_MS);

// `capturePage()` costs ~40-60ms, so a single pass physically cannot sample
// every 50ms. Instead the deterministic animation is restarted PASSES times,
// each pass grabbing an interleaved subset (pass 0 takes 0ms, 200ms, 400ms...;
// pass 1 takes 50ms, 250ms, ...), then the passes are merged by offset. Within
// a pass the frames are 200ms apart, comfortably above the capture cost.
//
// This only works because the card renders identically at a given offset on
// every pass: particles.js bakes its values from the element index rather than
// Math.random(), and clearing the inline `animation` restarts every layer from
// t=0 together. Nothing here is time-of-day or RNG dependent.
const PASSES = 4;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

async function main() {
  await app.whenReady();

  const server = createOverlayServer({ log: () => {} });
  await server.start(PORT);

  await postJSON(`http://localhost:${PORT}/api/test/toggle-mock`, { enable: true });
  await postJSON(`http://localhost:${PORT}/api/test/event`, { action: 'reset_error' });
  // Riot's league entries carry a fixed rank: "I" for apex tiers even though
  // there's no real division -- readout.js's isApexTier check drops it from
  // the label, so this doesn't overflow "GRANDMASTER I" the way it used to.
  await postJSON(`http://localhost:${PORT}/api/test/event`, { action: 'set_rank', newTier: 'GRANDMASTER', newRank: 'I' });
  // Anchor LP in a realistic Grandmaster range (Riot's actual cutoff is 200+)
  // rather than the low double digits a couple of small deltas alone would give.
  await postJSON(`http://localhost:${PORT}/api/test/event`, { action: 'lp_change', lpChange: 640, placement: 1 });
  await postJSON(`http://localhost:${PORT}/api/test/event`, { action: 'lp_change', lpChange: 22, placement: 1 });
  await postJSON(`http://localhost:${PORT}/api/test/event`, { action: 'lp_change', lpChange: 10, placement: 2 });
  await postJSON(`http://localhost:${PORT}/api/test/event`, { action: 'lp_change', lpChange: -14, placement: 6 });
  await postJSON(`http://localhost:${PORT}/api/test/event`, { action: 'lp_change', lpChange: 18, placement: 1 });

  const win = new BrowserWindow({
    width: CARD_W * ZOOM,
    height: CARD_H * ZOOM,
    useContentSize: true,
    transparent: true,
    frame: false,
    show: true,
    backgroundColor: '#00000000',
    webPreferences: { zoomFactor: ZOOM, backgroundThrottling: false },
  });

  await win.loadURL(`http://localhost:${PORT}/overlay.html`);
  win.webContents.setZoomFactor(ZOOM);

  await sleep(400);

  // Stop the overlay's own 2.5s poll loop -- we drive refresh() by hand so the
  // rank/LP state (and the animation restart below) aren't disturbed mid-capture.
  await win.webContents.executeJavaScript(`
    (function () {
      for (let i = 1; i < 10000; i++) clearInterval(i);
      return window.TFTOverlay.refresh();
    })();
  `);

  await sleep(200);

  // Mock mode leaves the Riot ID and region blank (both are only set on the live
  // path) -- inject them for the docs capture, after refresh() has already run so
  // it isn't clobbered. The tagline is deliberately NOT "#EUW": the overlay hides
  // the region chip when the tagline already says the same thing, so a distinct
  // tagline is what makes the full footer (Riot ID + region chip) render.
  await win.webContents.executeJavaScript(`
    (function () {
      document.getElementById('gameName').textContent = 'SPLENK';
      document.getElementById('tagLine').textContent = '#1337';
      const region = document.getElementById('region');
      region.textContent = 'EUW';
      region.style.display = '';
      document.getElementById('footer').classList.remove('hidden');
    })();
  `);

  // Defensive: a scripted rank jump can fire a promotion/demotion banner that
  // would bleed into the capture. Clear it in case one is showing.
  await win.webContents.executeJavaScript(`
    (function () {
      const card = document.getElementById('card');
      const moment = document.getElementById('moment');
      card.classList.remove('flash', 'dark', 'surge', 'fall', 'moment-in', 'div-up', 'div-down');
      moment.className = 'moment';
    })();
  `);

  // Warm-up capture: capturePage() can lag a frame behind the real DOM state.
  await win.capturePage();
  await sleep(200);
  await win.capturePage();

  // Restart every continuous animation on the card at t=0: the house sheen,
  // Grandmaster's blade sweep, and every shard in the mote field. Clearing the
  // inline override (rather than re-specifying each animation by name) lets
  // each element fall back to whatever materials.css already defines for it.
  async function restartAnimations() {
    await win.webContents.executeJavaScript(`
      (function () {
        const els = [
          document.querySelector('.sheen i'),
          document.querySelector('.blade i'),
          ...document.querySelectorAll('.motes b'),
        ];
        els.forEach((el) => {
          if (!el) return;
          el.style.animation = 'none';
          void el.offsetWidth;
          el.style.animation = '';
        });
      })();
    `);
    return Date.now();
  }

  const frames = [];
  for (let pass = 0; pass < PASSES; pass++) {
    const restartTime = await restartAnimations();
    for (let i = pass; i < FRAME_COUNT; i += PASSES) {
      const targetOffset = Math.round(i * FRAME_INTERVAL_MS);
      const wait = restartTime + targetOffset - Date.now();
      if (wait > 0) await sleep(wait);
      const image = await win.capturePage();
      // Store the ACHIEVED offset, not the intended one. The pixels correspond
      // to when the capture actually fired, so pinning them to the intended
      // slot is what makes the blade travel in uneven jumps -- it moves ~115px
      // per 50ms, and `capturePage()` jitters by up to ~70ms. Recording real
      // time and deriving the delays from it keeps content and timing in sync;
      // slightly uneven frame *spacing* plays back correctly, mislabelled
      // frames do not.
      frames.push({ png: image.toPNG(), offset: Date.now() - restartTime, drift: Date.now() - restartTime - targetOffset });
    }
  }

  frames.sort((a, b) => a.offset - b.offset);

  // Interleaved passes can land two captures within a few ms of each other.
  // Sub-25ms frames carry no visible information and some WebP players clamp
  // very short delays anyway, so drop them rather than emit unplayable gaps.
  const MIN_GAP_MS = 25;
  for (let i = frames.length - 1; i > 0; i--) {
    if (frames[i].offset - frames[i - 1].offset < MIN_GAP_MS) frames.splice(i, 1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  frames.forEach((f, i) => {
    f.file = `frame-${String(i).padStart(3, '0')}.png`;
    fs.writeFileSync(path.join(OUT_DIR, f.file), f.png);
  });

  const meta = frames.map((f, i) => ({
    i,
    file: f.file,
    offset: f.offset,
    // Last frame wraps back to frame 0 -- its delay closes out the loop period
    // rather than repeating the inter-frame spacing.
    delayToNext: i < frames.length - 1 ? frames[i + 1].offset - f.offset : Math.max(20, LOOP_MS - f.offset),
  }));
  fs.writeFileSync(path.join(OUT_DIR, 'frames.json'), JSON.stringify(meta, null, 2));

  const maxDrift = Math.max(...frames.map((f) => Math.abs(f.drift)));
  console.log(`Captured ${frames.length} frames over ${LOOP_MS}ms (~${TARGET_FPS}fps, ${PASSES} passes).`);
  console.log(`  max within-pass drift: ${maxDrift}ms`);

  await server.stop();
  win.destroy();
  app.quit();
}

main().catch((err) => {
  console.error(err);
  app.exit(1);
});
