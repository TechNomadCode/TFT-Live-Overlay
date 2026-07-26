// Encodes the captured frames into docs/overlay-grandmaster-sheen.webp.
// Run with: node docs/_gif-build/encode.js
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const DIR = __dirname;
const OUT = path.join(DIR, '..', 'overlay-grandmaster-sheen.webp');

function main() {
  const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'frames.json'), 'utf8'));

  const frames = meta.map((f) => path.join(DIR, f.file));
  const delays = meta.map((f) => f.delayToNext);

  // WebP carries the card's real 8-bit alpha, unlike GIF's 1-bit alpha -- no
  // flattening onto a backdrop colour, so rounded corners stay antialiased and
  // the card looks right on both GitHub's light and dark themes.
  return Promise.all(frames.map((f) => sharp(f).png().toBuffer()))
    .then((buffers) => sharp(buffers, { join: { animated: true, across: 1 } })
      .webp({ delay: delays, loop: 0, quality: 82, effort: 5 })
      .toBuffer())
    .then((webp) => {
      fs.writeFileSync(OUT, webp);
      return sharp(webp, { animated: true }).metadata().then((outMeta) => {
        console.log(`Wrote ${OUT}`);
        console.log(`  ${outMeta.width}x${outMeta.pageHeight} · ${outMeta.pages} frames · ${(webp.length / 1024).toFixed(0)} KB`);
        console.log(`  loop length: ${delays.reduce((a, b) => a + b, 0)}ms`);
      });
    });
}

main().catch((err) => { console.error(err); process.exit(1); });
