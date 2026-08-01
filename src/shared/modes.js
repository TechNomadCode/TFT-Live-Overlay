// Game-mode identity -- the one place that knows which ladders exist, what Riot
// calls them, and how a finish on each one is scored.
//
// All four surfaces need a slice of this: the server picks the league entry and
// routes matches by queue id, the overlay colours the placement strip, and the
// settings window builds both the mode switch and the Test buttons. One
// copy is what stops them drifting apart, the same reason tiers.js exists.
//
// UMD for the same reason as tiers.js and lp-math.js: no bundler, so this has to
// load via require() in the server and via a <script> tag in both browsers.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TFT = root.TFT || {};
    root.TFT.Modes = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RANKED = 'ranked';
  const DOUBLE_UP = 'doubleup';

  // Order matters: this drives the mode switch, and ranked is the default.
  const MODES = [RANKED, DOUBLE_UP];

  // Both ladders are the same metallic Iron..Challenger ladder with four
  // divisions and 100 LP promotions -- Double Up only used Hyper Roll's colour
  // tiers during the Set 6 beta, and moved to metal in patch 12.11. That is why
  // tiers.js and lp-math.js need no mode awareness at all.
  //
  // Hyper Roll (RANKED_TFT_TURBO, queue 1130) is deliberately absent: it is the
  // one queue that really does report ratedTier/ratedRating instead of
  // tier/rank/leaguePoints, so none of this app's rank rendering applies to it.
  const MODE_META = {
    [RANKED]: {
      label: 'Ranked',
      queueType: 'RANKED_TFT',
      queueId: 1100,
      // Eight players, each finishing somewhere in 1..8.
      finishes: 8,
      // Top four is the half that gains LP, and what the strip renders warm.
      winThreshold: 4,
    },
    [DOUBLE_UP]: {
      label: 'Double Up',
      queueType: 'RANKED_TFT_DOUBLE_UP',
      queueId: 1160,
      // Four pairs, so a finish is 1..4 once the raw placement is folded into a
      // team placement -- see teamPlacement below for why that fold is needed.
      finishes: 4,
      // Riot's own wording: you win when "your pair places 1st or 2nd".
      winThreshold: 2,
    },
  };

  function isValidMode(mode) { return MODES.indexOf(mode) !== -1; }

  /** Falls back to ranked so a corrupt setting can never blank the card. */
  function coerceMode(mode) { return isValidMode(mode) ? mode : RANKED; }

  function metaFor(mode) { return MODE_META[coerceMode(mode)]; }

  function queueIdToMode(queueId) {
    for (let i = 0; i < MODES.length; i++) {
      if (MODE_META[MODES[i]].queueId === queueId) return MODES[i];
    }
    return null;
  }

  /**
   * Folds a Double Up match's raw participant placement into a team placement.
   *
   * Riot reports Double Up on the 1..8 scale of the eight players, not the 1..4
   * the client shows -- verified against a live match, where the pairs landed on
   * (1,2), (3,4), (5,6), (7,8) and partner_group_id agreed. So the winning
   * player's partner reads as "2", and putting that raw number on the strip
   * would tell a stream someone came second when they actually won.
   *
   * Derived by ranking the partner groups on their best placement rather than by
   * halving, because adjacency is observed behaviour and not something Riot
   * documents. Halving is only the fallback for a match whose participants carry
   * no partner_group_id -- the field is real but absent from Riot's own
   * ParticipantDto table, so it cannot be relied on blindly.
   */
  function teamPlacement(mode, participant, participants) {
    const raw = participant && participant.placement;
    if (typeof raw !== 'number') return null;
    if (coerceMode(mode) !== DOUBLE_UP) return raw;

    const mine = participant.partner_group_id;
    if (mine === undefined || mine === null || !Array.isArray(participants)) {
      return Math.ceil(raw / 2);
    }

    // Best (lowest) placement per partner group, then this group's rank among
    // them. Groups are keyed on a Map so a non-numeric id still works.
    const best = new Map();
    for (let i = 0; i < participants.length; i++) {
      const p = participants[i];
      const g = p.partner_group_id;
      if (g === undefined || g === null || typeof p.placement !== 'number') continue;
      if (!best.has(g) || p.placement < best.get(g)) best.set(g, p.placement);
    }
    if (!best.has(mine)) return Math.ceil(raw / 2);

    const minePlacement = best.get(mine);
    let ahead = 0;
    best.forEach(function (placement) {
      if (placement < minePlacement) ahead++;
    });
    return ahead + 1;
  }

  /**
   * The strip's tonal class for a finish. Same three buckets in both modes --
   * outright win, the rest of the LP-positive half, then the losing half -- so
   * the card reads identically whichever ladder it is showing.
   */
  function placementClass(mode, placement) {
    if (placement === 1) return 'first';
    return placement <= metaFor(mode).winThreshold ? 'top4' : 'bot4';
  }

  function isValidPlacement(mode, placement) {
    return Number.isInteger(placement) && placement >= 1 && placement <= metaFor(mode).finishes;
  }

  return {
    RANKED,
    DOUBLE_UP,
    MODES,
    MODE_META,
    isValidMode,
    coerceMode,
    metaFor,
    queueIdToMode,
    teamPlacement,
    placementClass,
    isValidPlacement,
  };
}));
