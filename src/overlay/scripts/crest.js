// The rank emblem, and the cross-fade when it changes.
//
// Served by our own server (see src/server/routes/crest.routes.js), which
// fetches the source PNG and normalises it once, then caches it. Same-origin,
// so no CORS concerns, and every tier renders at a consistent visual size with
// plain object-fit: contain.

(function (ns, Tiers) {
  'use strict';

  const CREST_BASE = '/api/crest/';
  // Matches the .emblem img opacity transition in card.css -- the new source is
  // assigned while the element is fully transparent.
  const SWAP_FADE_MS = 450;

  let lastCrestSlug = null;

  function updateCrest(tier) {
    // Never assign an empty string to img.src: browsers treat that as "reload
    // the current page as an image", which is the broken-icon bug from before.
    // If the tier is unranked/unrecognised, just leave whatever was showing.
    const slug = Tiers.slugFor(tier);
    const img = ns.el('emblem');
    if (!slug) {
      img.style.visibility = 'hidden';
      return;
    }

    // Compare the *slug*, not the src. img.src reads back as a resolved
    // absolute URL ("http://localhost:3000/api/crest/diamond") while
    // CREST_BASE + slug is relative ("/api/crest/diamond"), so comparing them
    // was always unequal and reassigned src on every single poll forever --
    // which re-requested the crest every 2.5s (and, whenever the source CDN was
    // unreachable, turned into an unbounded retry storm since failures weren't
    // cached).
    if (slug !== lastCrestSlug) {
      // Cross-fade rather than a hard cut, so a tier change reads as a
      // transition instead of the image popping.
      const swap = () => {
        img.src = CREST_BASE + slug;
        img.classList.remove('swapping');
      };
      if (lastCrestSlug === null) {
        swap();
      } else {
        img.classList.add('swapping');
        setTimeout(swap, SWAP_FADE_MS);
      }
      lastCrestSlug = slug;
    }
    img.style.visibility = 'visible';
  }

  ns.updateCrest = updateCrest;
}(window.TFTOverlay = window.TFTOverlay || {}, window.TFT.Tiers));
