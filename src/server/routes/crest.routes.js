// GET /api/crest/:tier — normalised rank emblem, proxied from Community Dragon.
// Same-origin by design, so the overlay has no CORS concerns and every tier
// renders at consistent visual weight with plain object-fit: contain.

const express = require('express');
const Tiers = require('../../shared/tiers');

const CREST_CACHE_SECONDS = 86400;

/**
 * @param {object} deps
 * @param {object} deps.crests - crest service
 */
function createCrestRouter({ crests }) {
  const router = express.Router();

  router.get('/:tier', async (req, res) => {
    const slug = req.params.tier.toLowerCase();
    if (!Tiers.isValidSlug(slug)) return res.status(400).send('Unknown tier');

    try {
      const png = await crests.getCrest(slug);
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', `public, max-age=${CREST_CACHE_SECONDS}`);
      res.send(png);
    } catch {
      // The service already logged the real cause (and is holding a cooldown
      // so we don't hammer an unreachable source on every overlay poll).
      res.status(502).send('Crest unavailable');
    }
  });

  return router;
}

module.exports = { createCrestRouter };
