// Rank crests are proxied and normalised, never hotlinked: the source artwork
// is fetched once per tier, reshaped, and cached in memory for the life of the
// process. See normaliseCrest below for why plain object-fit isn't enough.

const sharp = require('sharp');
const { RIOT_REQUEST_TIMEOUT_MS } = require('../constants');

const CREST_SOURCE_BASE =
  'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-';

// ---- Crest normalisation ----
// Trimming alone isn't enough. Riot's emblem artwork has very different
// proportions per tier once the transparent margin is gone -- roughly 1.16:1
// for Gold and Platinum up to 1.66:1 for Iron and Diamond. Dropped into a
// fixed box with object-fit:contain, the wide ones scale down to fit the
// width and end up visibly smaller: Diamond and Iron rendered about 74% of
// Gold's visual weight, which read as the overlay being inconsistent between
// ranks rather than as a property of the source images.
//
// So every crest is scaled to the same rendered AREA (not the same height --
// equal height would make the wide ones overflow) and padded onto one shared
// canvas. The overlay then draws every tier at identical visual weight, and
// Diamond looks like Gold. Done once per tier, then cached.
const CREST_CANVAS_W = 224;   // 2x the on-card box, for crisp downscaling
const CREST_CANVAS_H = 160;
// Gold's area when contained in the box, which is the look we're matching.
const CREST_TARGET_AREA = 7520 * 4;

// Negative cache: a failed source fetch used to be retried on every single
// request, so an unreachable CDN (or an offline user) meant one outbound
// 8s-timeout request per overlay poll, indefinitely. Remember failures for
// a cooldown window and answer from that instead of re-hitting the source.
const CREST_RETRY_COOLDOWN_MS = 60000;

async function normaliseCrest(sourceBuffer) {
  const trimmed = await sharp(sourceBuffer).trim({ threshold: 10 })
    .toBuffer({ resolveWithObject: true });
  const { width, height } = trimmed.info;

  // Equal-area scale, then clamped so an unusually wide or tall crest still
  // fits the canvas rather than being cropped by it.
  let scale = Math.sqrt(CREST_TARGET_AREA / (width * height));
  scale = Math.min(scale, CREST_CANVAS_W / width, CREST_CANVAS_H / height);

  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  // Centre by padding, NOT by a second `fit: contain` resize -- contain scales
  // up anything smaller than the box, which would push every crest back out
  // to a canvas edge and undo the equal-area sizing above.
  const left = Math.floor((CREST_CANVAS_W - w) / 2);
  const top = Math.floor((CREST_CANVAS_H - h) / 2);

  return sharp(trimmed.data)
    .resize(w, h, { fit: 'fill', kernel: 'lanczos3' })
    .extend({
      left, top,
      right: CREST_CANVAS_W - w - left,
      bottom: CREST_CANVAS_H - h - top,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

/**
 * @param {object} deps
 * @param {function} deps.log
 */
function createCrestService({ log }) {
  const cache = new Map();
  const failures = new Map(); // tier slug -> timestamp we're allowed to retry at

  /**
   * Normalised PNG for a tier slug. Throws if the source is unreachable, and
   * keeps throwing from the negative cache until the cooldown expires.
   * @param {string} slug lowercase tier name, already validated by the caller
   * @returns {Promise<Buffer>}
   */
  async function getCrest(slug) {
    if (cache.has(slug)) return cache.get(slug);

    const retryAt = failures.get(slug);
    if (retryAt && Date.now() < retryAt) throw new Error('Crest unavailable (cooling down)');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), RIOT_REQUEST_TIMEOUT_MS);
      let response;
      try {
        response = await fetch(`${CREST_SOURCE_BASE}${slug}.png`, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(`Source fetch ${response.status}`);

      const normalised = await normaliseCrest(Buffer.from(await response.arrayBuffer()));
      cache.set(slug, normalised);
      failures.delete(slug);
      log('CREST', `Normalised and cached emblem-${slug}.png`);
      return normalised;
    } catch (err) {
      failures.set(slug, Date.now() + CREST_RETRY_COOLDOWN_MS);
      log('ERROR', `Crest fetch/normalise failed for ${slug}: ${err.message} — not retrying for ${CREST_RETRY_COOLDOWN_MS / 1000}s`);
      throw err;
    }
  }

  return { getCrest };
}

module.exports = { createCrestService };
