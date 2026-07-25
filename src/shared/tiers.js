// Tier identity -- the one place that knows what the ladder's tiers are called,
// what order they sit in, and what colour each one is.
//
// All three surfaces need a slice of this: the server validates
// /api/crest/:tier against the slug list, the overlay derives its entire accent
// ramp from the colours, and the settings window resolves the same crest URLs
// for its preview card. One copy is what stops them drifting apart the next
// time Riot inserts a tier the way it inserted Emerald in 2023.
//
// UMD rather than plain CommonJS: this project has no bundler, so anything
// shared has to load both via require() in the main/server processes and via a
// plain <script> tag in the two browser surfaces.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TFT = root.TFT || {};
    root.TFT.Tiers = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Ladder order, lowest first.
  const TIER_NAMES = [
    'IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD',
    'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER',
  ];

  // Divisions run IV (lowest) to I (highest), and only exist below Master.
  const DIVISIONS = ['IV', 'III', 'II', 'I'];

  // Master and above carry no division and share a single LP pool -- see
  // TIER_BASE in lp-math.js for why that is not an oversight.
  const APEX_TIERS = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];

  // Iron..Diamond: the tiers that actually have divisions. Derived rather than
  // written out again so adding a tier to TIER_NAMES is a one-line change.
  const DIVISION_TIERS = TIER_NAMES.filter(function (t) {
    return APEX_TIERS.indexOf(t) === -1;
  });

  // Riot's emblem artwork is filed under the lowercase tier name.
  const TIER_SLUGS = TIER_NAMES.map(function (t) { return t.toLowerCase(); });

  // Null for UNRANKED and for anything unrecognised, so callers can use the
  // result directly as a "do we have a crest for this" test.
  function slugFor(tier) {
    return TIER_NAMES.indexOf(tier) === -1 ? null : tier.toLowerCase();
  }

  function isApexTier(tier) { return APEX_TIERS.indexOf(tier) !== -1; }

  function isValidSlug(slug) { return TIER_SLUGS.indexOf(slug) !== -1; }

  // Tier identity colours, roughly matched to Riot's own emblem artwork so a
  // card's accent reads as the same metal as the crest sitting next to it.
  const TIER_COLORS = {
    IRON: [107, 107, 111],
    BRONZE: [164, 107, 60],
    SILVER: [159, 174, 184],
    GOLD: [224, 176, 74],
    PLATINUM: [76, 169, 165],
    EMERALD: [47, 176, 102],
    DIAMOND: [110, 138, 224],
    MASTER: [169, 80, 214],
    GRANDMASTER: [214, 69, 69],
    CHALLENGER: [240, 201, 107],
  };

  // A single comparable number for "is this rank above that one". Master+ have
  // no division so they score at their tier floor -- fine, because the only
  // thing this feeds is a comparison, never a displayed value.
  function rankScore(tier, rank) {
    const t = TIER_NAMES.indexOf(tier);
    if (t === -1) return null;
    const d = DIVISIONS.indexOf(rank);
    return t * 4 + (d === -1 ? 0 : d);
  }

  return {
    TIER_NAMES,
    DIVISIONS,
    APEX_TIERS,
    DIVISION_TIERS,
    TIER_SLUGS,
    TIER_COLORS,
    slugFor,
    isApexTier,
    isValidSlug,
    rankScore,
  };
}));
