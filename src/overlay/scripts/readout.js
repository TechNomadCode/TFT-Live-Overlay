// The three stacked rows and the footer band: everything that is a pure
// function of the latest payload, with no animation state of its own.
//
// There used to be a fourth row (session LP / W-L / average). It was cut: it
// was the least legible thing on the card, it overlapped the Riot ID band, and
// its space is what buys the remaining rows the size they need. The server
// still reports those fields -- the settings window's dashboard uses them.

(function (ns, Tiers, Modes) {
  'use strict';

  // Always renders PLACEMENT_SLOTS chips so the row can't change size as
  // history fills in.
  const PLACEMENT_SLOTS = 5;
  // At or above this length the tier label is set a few points smaller rather
  // than ellipsised -- "GRANDMASTER", "PLATINUM III", "CHALLENGER".
  // Deliberately >=, not >: "CHALLENGER" is exactly ten characters, so the old
  // > test never shrank it. That happened to fit at the previous 17px and
  // ellipsised to "CHALLE..." once the label grew.
  const LONG_RANK_LABEL = 10;

  // The numbers arriving here are already on the mode's own scale -- the server
  // folds Double Up's raw 1..8 participant placement into the 1..4 team
  // placement the game actually shows the player. Only the win/loss split
  // differs per mode (top 4 of 8 vs top 2 of 4), which is what placementClass
  // owns.
  function renderPlacements(list, mode) {
    const row = ns.el('placements');
    if (!row) return;
    let html = '';
    for (let i = 0; i < PLACEMENT_SLOTS; i++) {
      const p = list[i];
      if (typeof p === 'number') {
        html += `<span class="pl ${Modes.placementClass(mode, p)}">${p}</span>`;
      } else {
        html += '<span class="pl empty">-</span>';
      }
    }
    ns.setHtmlIfChanged(row, html);
  }

  // "Nothing to show yet" is not the same as "unranked". Both arrive as
  // tier: 'UNRANKED', so the error field is what separates them: applyUnranked()
  // clears it, while the not-configured and never-succeeded paths set it.
  // Testing the error alone is not enough -- a mid-stream fetch failure also
  // sets it while keeping the last known tier, and dimming a live Diamond card
  // over one dropped poll is exactly the wrong reaction.
  function isPending(data) {
    return !!data.error && data.tier === 'UNRANKED';
  }

  function renderRank(data) {
    // Master/GM/Challenger have no real division -- Riot's league entries
    // carry a fixed rank: "I" for all three anyway, which is meaningless and,
    // appended to the longest tier names, overflows the label.
    const text = isPending(data) ? 'NOT TRACKING'
      : data.tier === 'UNRANKED' ? 'UNRANKED'
        : Tiers.isApexTier(data.tier) ? data.tier
          : `${data.tier} ${data.rank}`.trim();
    ns.setSafeText('tierRank', text);
    ns.el('tierRank').classList.toggle('long', text.length >= LONG_RANK_LABEL);
  }

  function renderGoal(data) {
    const row = ns.el('goalRow');
    // Null above Diamond -- GM/Challenger are population-gated, so there's no
    // LP target to count toward. Hidden via a class that uses `visibility`,
    // so the rows below don't shift.
    if (typeof data.lpToNextTier !== 'number' || !data.nextTierName) {
      row.classList.add('hidden');
      return;
    }
    row.classList.remove('hidden');
    ns.el('goalFill').style.width = (data.tierProgressPct || 0) + '%';
    ns.setSafeText('goalLabel', `${data.lpToNextTier} to ${data.nextTierName}`);
  }

  function renderIdentity(data) {
    ns.setSafeText('gameName', data.gameName || '—');
    ns.setSafeText('tagLine', data.tagLine ? '#' + data.tagLine : '');
    // Most players' tagline IS their region ("Splenk#EUW"), in which case the
    // separate region chip is the same fact twice. Only show it when it adds
    // something.
    const dupRegion = data.region && data.tagLine &&
      data.region.toUpperCase() === data.tagLine.toUpperCase();
    ns.setSafeText('region', data.region || '');
    ns.el('region').style.display = (data.region && !dupRegion) ? '' : 'none';
  }

  /**
   * Footer and error share one slot — only one shows at a time.
   * In the not-tracking state the message moves into the card body instead
   * (see the wait lines): it's the expected state before setup, not a fault,
   * and the 10.5px footer band is the wrong place to explain setup.
   */
  function renderFooterBand(message, pending) {
    const errorEl = ns.el('errorMsg');
    const footerEl = ns.el('footer');

    if (pending) {
      ns.setSafeText('waitReason', message || 'Add your Riot ID and API key in Account');
      errorEl.classList.remove('visible');
      footerEl.classList.remove('hidden');
      return;
    }

    if (message) {
      ns.setSafeText('errorMsg', 'Overlay: ' + message);
      errorEl.classList.add('visible');
      footerEl.classList.add('hidden');
    } else {
      errorEl.classList.remove('visible');
      footerEl.classList.remove('hidden');
    }
  }

  ns.isPending = isPending;
  ns.renderPlacements = renderPlacements;
  ns.renderRank = renderRank;
  ns.renderGoal = renderGoal;
  ns.renderIdentity = renderIdentity;
  ns.renderFooterBand = renderFooterBand;
}(window.TFTOverlay = window.TFTOverlay || {}, window.TFT.Tiers, window.TFT.Modes));
