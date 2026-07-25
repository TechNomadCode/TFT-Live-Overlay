// Encodes the captured sweep frames into docs/overlay-sheen.gif.
// Run with: node docs/_gif-build/encode.js
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const DIR = __dirname;
const OUT = path.join(DIR, '..', 'overlay-sheen.gif');

// The sheen band enters the card around frame 02 and has left it by frame 12
// (measured by diffing each frame against an idle one). Everything outside that
// window is the ~8s transparent idle stretch of the 9s CSS cycle, so the GIF
// keeps the sweep and replaces the idle with a single held frame.
const SWEEP = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const IDLE_FRAME = 17;
const SWEEP_DELAY_MS = 60;  // matches the real capture spacing (~60ms)
const HOLD_DELAY_MS = 900;  // stands in for the idle remainder of the 9s cycle

// GIF has 1-bit alpha, so the card's ~93%-opaque background and rounded corners
// have to be flattened onto something. GitHub's dark canvas colour keeps it
// seamless in dark mode and reads as a deliberate panel in light mode.
const BACKDROP = { r: 13, g: 17, b: 23 };

async function main() {
  const order = [...SWEEP, IDLE_FRAME];
  const delays = [...SWEEP.map(() => SWEEP_DELAY_MS), HOLD_DELAY_MS];

  const frames = [];
  for (const i of order) {
    const file = path.join(DIR, `frame-${String(i).padStart(2, '0')}.png`);
    frames.push(await sharp(file).flatten({ background: BACKDROP }).png().toBuffer());
  }

  const gif = await sharp(frames, { join: { animated: true, across: 1 } })
    .gif({ delay: delays, loop: 0 })
    .toBuffer();

  fs.writeFileSync(OUT, gif);

  const meta = await sharp(gif, { animated: true }).metadata();
  console.log(`Wrote ${OUT}`);
  console.log(`  ${meta.width}x${meta.pageHeight} · ${meta.pages} frames · ${(gif.length / 1024).toFixed(0)} KB`);
  console.log(`  loop length: ${delays.reduce((a, b) => a + b, 0)}ms`);
}

main().catch((err) => { console.error(err); process.exit(1); });
