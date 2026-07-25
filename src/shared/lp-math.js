// Ladder arithmetic: absolute LP, progress toward the next tier, and the
// simulated LP changes that drive mock mode. Pure functions only -- no Express,
// no Electron, no DOM -- so it can be reasoned about (and eventually tested)
// without standing anything up.
//
// UMD for the same reason as tiers.js: no bundler. Note the dependency order --
// a browser surface that loads this must load tiers.js first.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./tiers'));
  } else {
    root.TFT = root.TFT || {};
    root.TFT.LpMath = factory(root.TFT.Tiers);
  }
}(typeof self !== 'undefined' ? self : this, function (Tiers) {
  'use strict';

  const TIER_ORDER = Tiers.DIVISION_TIERS;  // IRON..DIAMOND
  const RANK_ORDER = Tiers.DIVISIONS;       // IV..I

  // Tiers below Master run 4 divisions x 100 LP = 400 LP per tier.
  // 7 tiers below Master (Iron..Diamond) x 400 = 2800, which lines up
  // exactly with Master's base. Master/Grandmaster/Challenger share that
  // same base because they're NOT separate LP bands -- Grandmaster and
  // Challenger are population-capped labels applied to the same continuous
  // Master LP pool (Riot requires 200+ LP for GM, 500+ LP for Challenger,
  // on top of a top-N-players cutoff -- not an LP offset). Verified against
  // Set 17 (2026) ranked docs.
  const TIER_BASE = {
    IRON: 0, BRONZE: 400, SILVER: 800, GOLD: 1200,
    PLATINUM: 1600, EMERALD: 2000, DIAMOND: 2400,
    MASTER: 2800, GRANDMASTER: 2800, CHALLENGER: 2800,
  };
  const RANK_BASE = { IV: 0, III: 100, II: 200, I: 300 };

  // Riot does not carry negative LP across a demotion boundary -- dropping
  // below 0 LP places you in the division below at a fixed LP value. So a
  // single loss can only ever cost you one division, no matter how large.
  const DEMOTION_LANDING_LP = 75;

  function getAbsoluteLP(tier, rank, lp) {
    if (!tier || tier === 'UNRANKED') return 0;
    const baseTier = TIER_BASE[tier] || 0;
    const baseRank = Tiers.isApexTier(tier) ? 0 : (RANK_BASE[rank] || 0);
    return baseTier + baseRank + (lp || 0);
  }

  // Applies an LP delta the way a real match result would: rolling a
  // division on +/-100 LP, rolling a tier once a division rolls past
  // IV/I, and handling the two special boundaries -- Diamond I promotes
  // into Master with no division at all, and Master demotes back to
  // Diamond I on dropping below 0 LP.
  //
  // Demotion crosses tiers, matching Riot: Gold IV at 0 LP losing LP drops to
  // Silver I, it does NOT floor at Gold IV. Only Iron IV floors, because there
  // is nothing below it. This function is mock-mode only (the live path reads
  // real tier/rank straight from Riot), so its whole job is fidelity -- and
  // without cross-tier demotion the overlay's derank rendering could never be
  // exercised before it happened live on stream.
  //
  // NOT modelled: demotion shield, the few games of protection you get right
  // after promoting into a new tier. That depends on games-played-since-
  // promotion, which mock mode doesn't track, so mock deranks slightly more
  // eagerly than live will.
  //
  // Grandmaster/Challenger aren't auto-promoted/demoted here since that's
  // gated by server population, not LP alone -- those stay a manual choice
  // via "Simulate Rank".
  function applyLPChange(tier, rank, lp, delta) {
    if (!tier || tier === 'UNRANKED') {
      tier = 'IRON';
      rank = 'IV';
      lp = 0;
    }

    if (Tiers.isApexTier(tier)) {
      const newLp = lp + delta;
      if (newLp < 0) {
        // Only Master itself demotes to Diamond I on Riot's actual rules;
        // GM/Challenger dropping below their population cutoff demotes to
        // Master, not Diamond -- but we can't simulate population cutoffs
        // in mock mode, so treat all three the same way here.
        return { tier: 'DIAMOND', rank: 'I', lp: DEMOTION_LANDING_LP };
      }
      return { tier, rank, lp: newLp };
    }

    let tierIdx = TIER_ORDER.indexOf(tier);
    let rankIdx = RANK_ORDER.indexOf(rank);
    if (tierIdx === -1) tierIdx = 0;
    if (rankIdx === -1) rankIdx = 0;
    let newLp = lp + delta;

    while (newLp >= 100) {
      newLp -= 100;
      if (rankIdx < 3) {
        rankIdx += 1;
      } else if (tierIdx < TIER_ORDER.length - 1) {
        tierIdx += 1;
        rankIdx = 0;
      } else {
        return { tier: 'MASTER', rank: '', lp: newLp }; // Diamond I -> Master
      }
    }
    // Single step, not a loop: the landing LP is fixed, so one result can only
    // ever drop you one division.
    if (newLp < 0) {
      if (rankIdx > 0) {
        rankIdx -= 1;                     // Gold II -> Gold III
        newLp = DEMOTION_LANDING_LP;
      } else if (tierIdx > 0) {
        tierIdx -= 1;                     // Gold IV -> Silver I
        rankIdx = RANK_ORDER.length - 1;
        newLp = DEMOTION_LANDING_LP;
      } else {
        newLp = 0;                        // Iron IV -- nothing below it
      }
    }

    return { tier: TIER_ORDER[tierIdx], rank: RANK_ORDER[rankIdx], lp: newLp };
  }

  // Progress toward the next TIER, for the overlay's goal bar. Deliberately
  // per-tier and not per-division: "153 LP to PLATINUM" is a milestone a viewer
  // can follow across a whole stream, where "53 to Gold I" resets every other
  // game and reads as noise.
  //
  // Null at Master and above. GM and Challenger are population-gated, not LP
  // thresholds, so there is no fixed number to count down to -- see TIER_BASE.
  function getTierProgress(tier, rank, lp) {
    const idx = TIER_ORDER.indexOf(tier);
    if (idx === -1) return { lpToNextTier: null, nextTierName: null, tierProgressPct: null };

    const abs = getAbsoluteLP(tier, rank, lp);
    const currentBase = TIER_BASE[tier];
    // TIER_ORDER stops at Diamond, so the tier above the last entry is Master.
    const nextTierName = idx < TIER_ORDER.length - 1 ? TIER_ORDER[idx + 1] : 'MASTER';
    const span = TIER_BASE[nextTierName] - currentBase;

    return {
      lpToNextTier: Math.max(0, TIER_BASE[nextTierName] - abs),
      nextTierName,
      tierProgressPct: Math.max(0, Math.min(100, ((abs - currentBase) / span) * 100)),
    };
  }

  return {
    TIER_BASE,
    RANK_BASE,
    DEMOTION_LANDING_LP,
    getAbsoluteLP,
    applyLPChange,
    getTierProgress,
  };
}));
