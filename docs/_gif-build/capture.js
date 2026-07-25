// One-off capture script for docs/overlay-sheen.gif. Not part of the app.
// Run with: npx electron docs/_gif-build/capture.js
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');
const { createOverlayServer } = require('../../src/server');

const PORT = 3057;
const CARD_W = 370;
const CARD_H = 108;
const ZOOM = 2;
const OUT_DIR = __dirname;

const SWEEP_OFFSETS_MS = [0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 660, 720, 780, 840, 900, 960, 1020];
const HOLD_DELAY_MS = 500; // extra dwell on the final (transparent) frame before the loop restarts

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
  await postJSON(`http://localhost:${PORT}/api/test/event`, { action: 'set_rank', newTier: 'DIAMOND', newRank: 'II' });
  await postJSON(`http://localhost:${PORT}/api/test/event`, { action: 'lp_change', lpChange: 22, placement: 1 });
  await postJSON(`http://localhost:${PORT}/api/test/event`, { action: 'lp_change', lpChange: 8, placement: 4 });
  await postJSON(`http://localhost:${PORT}/api/test/event`, { action: 'lp_change', lpChange: -14, placement: 7 });

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
      card.classList.remove('promoted', 'demoted');
      moment.className = 'moment';
    })();
  `);

  // Warm-up capture: capturePage() can lag a frame behind the real DOM state.
  await win.capturePage();
  await sleep(200);
  await win.capturePage();

  // Restart the sheen animation cleanly at t=0 of its cycle.
  await win.webContents.executeJavaScript(`
    (function () {
      const el = document.querySelector('.sheen i');
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = 'sheenLoop 9s linear infinite';
    })();
  `);
  const restartTime = Date.now();

  const frames = [];
  for (const targetOffset of SWEEP_OFFSETS_MS) {
    const wait = restartTime + targetOffset - Date.now();
    if (wait > 0) await sleep(wait);
    const image = await win.capturePage();
    frames.push({ png: image.toPNG(), actualOffset: Date.now() - restartTime });
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  frames.forEach((f, i) => {
    fs.writeFileSync(path.join(OUT_DIR, `frame-${String(i).padStart(2, '0')}.png`), f.png);
  });

  const meta = frames.map((f, i) => ({
    i,
    actualOffset: f.actualOffset,
    delayToNext: i < frames.length - 1 ? frames[i + 1].actualOffset - f.actualOffset : HOLD_DELAY_MS,
  }));
  fs.writeFileSync(path.join(OUT_DIR, 'frames.json'), JSON.stringify(meta, null, 2));

  console.log('Captured', frames.length, 'frames. Offsets:', frames.map((f) => f.actualOffset).join(','));

  await server.stop();
  win.destroy();
  app.quit();
}

main().catch((err) => {
  console.error(err);
  app.exit(1);
});
