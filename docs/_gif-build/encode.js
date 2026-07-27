// Encodes captured frames into the README's animated assets.
//
//   node docs/_gif-build/encode.js           # both
//   node docs/_gif-build/encode.js hero      # docs/overlay-live.gif
//   node docs/_gif-build/encode.js moment    # docs/overlay-moment.gif
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const DIR = __dirname;

// `scale` is applied to the 2x capture; omitted means keep it. Expressed as a
// factor rather than a pixel width so it survives a margin change.
//
// The rank moment is the one asset that can't afford 2x. Its flare blooms across
// the entire card, so every frame is a full repaint that delta-compresses to
// nothing, and the bloom is a wide smooth gradient -- the exact thing a 256-entry
// palette struggles with. Measured on the same frames: 2x/256 colours is 3.0 MB,
// and dropping to 128 colours to claw that back turns the bloom into visible
// contour rings (RMSE 7.4 -> 10.1, and unmistakable at a glance). Downscaling to
// 1x keeps all 256 colours and lands at ~1.1 MB.
//
// Downscaling *here* rather than capturing at zoom 1 is deliberate: averaging a
// 2x render down is supersampling, so the text and the 1px frame edges come out
// better than Chromium renders them natively at 1x.
const SEQUENCES = {
  hero: { out: 'overlay-live.gif' },
  moment: { out: 'overlay-moment.gif', scale: 0.5 },
};

// The overlay page is transparent because OBS composites it over the stream.
// A docs image has to pick a backdrop, and GitHub's dark canvas is the one that
// disappears on the dark theme and reads as a screenshot of a dark app on the
// light one. Flattening also makes GIF's 1-bit alpha a non-issue -- the only
// partial alpha on the card is its four rounded corners and its drop shadow,
// which is exactly what 1-bit alpha destroys and a flatten preserves. capture.js
// already paints this colour into the page, so this is a guard, not a transform.
const BACKDROP = '#0d1117';

// 256 colours, no dithering. Measured against the source frames, dithering both
// increased the file and slightly *worsened* RMSE: the card is a small number of
// smooth dark gradients, which a 256-entry palette already covers, so the error
// dither is there to break up isn't present and the noise it adds is.
const GIF_OPTS = { colours: 256, dither: 0, effort: 10, loop: 0 };

// GIF stores delays in centiseconds. libvips rounds for us, but rounding here
// first keeps the reported loop length honest.
const toCentisecondMs = (ms) => Math.max(20, Math.round(ms / 10) * 10);

async function encode(name) {
  const manifest = path.join(DIR, `frames-${name}.json`);
  if (!fs.existsSync(manifest)) {
    throw new Error(`No ${path.basename(manifest)} -- run "npx electron docs/_gif-build/capture.js ${name}" first.`);
  }

  const spec = SEQUENCES[name];
  const meta = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const delay = meta.map((f) => toCentisecondMs(f.delayToNext));
  const source = await sharp(path.join(DIR, meta[0].file)).metadata();
  const outWidth = Math.round(source.width * (spec.scale || 1));
  const buffers = await Promise.all(meta.map((f) => {
    let img = sharp(path.join(DIR, f.file)).flatten({ background: BACKDROP });
    if (spec.scale) img = img.resize({ width: outWidth, kernel: 'lanczos3' });
    return img.png({ compressionLevel: 0 }).toBuffer();
  }));

  const gif = await sharp(buffers, { join: { animated: true, across: 1 } })
    .gif({ delay, ...GIF_OPTS })
    .toBuffer();

  const out = path.join(DIR, '..', spec.out);
  fs.writeFileSync(out, gif);

  // `pages` is usually lower than the frame count, and that's correct: libvips
  // merges runs of identical frames and sums their delays. The rank moment holds
  // its banner still for ~1.4s by design, which is ~20 captures collapsing into
  // one. A big gap here means frames were wasted, not that any were lost.
  const info = await sharp(gif, { animated: true }).metadata();
  // The captures are 2x, so the width to show them at is always half the source.
  const width = source.width / 2;
  console.log(`Wrote ${out}`);
  console.log(`  ${info.width}x${info.pageHeight} · ${meta.length} frames (${info.pages} after merging identical) · ${(gif.length / 1024).toFixed(0)} KB`);
  console.log(`  loop ${(delay.reduce((a, b) => a + b, 0) / 1000).toFixed(2)}s · README width ${Math.round(width)}`);
}

async function main() {
  const which = process.argv[2];
  const names = which ? [which] : Object.keys(SEQUENCES);
  for (const name of names) {
    if (!SEQUENCES[name]) throw new Error(`Unknown sequence "${name}" -- one of: ${Object.keys(SEQUENCES).join(', ')}`);
    await encode(name);
  }
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
