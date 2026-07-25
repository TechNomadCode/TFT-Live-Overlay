// Overlay entry point: the poll loop, and the order the render modules run in.
//
// This interval is NOT the server's Riot poll interval. The server → Riot rate
// is user-configured (default 5s, sized against the personal-key limit); this
// is overlay → local server and is fixed, because it costs nothing and keeps
// the card responsive the instant new data lands.

(function (ns) {
  'use strict';

  const POLL_INTERVAL_MS = 2500;
  const MAX_SCALE = 4;

  let lastSeenDeltaSeq = null;

  // ?scale=1.5 renders the whole card larger. This is not the same as resizing
  // the Browser Source in OBS: that stretches an already-rendered 370x108
  // texture and goes soft, where this re-renders the page at the larger size.
  // Set the source to the scaled dimensions to match.
  function applyScaleFromQuery() {
    const scale = parseFloat(new URLSearchParams(location.search).get('scale'));
    if (scale > 0 && scale <= MAX_SCALE) ns.el('card').style.zoom = scale;
  }

  function render(data) {
    ns.renderIdentity(data);

    // Before checkRankChange, so a promotion banner is already wearing the
    // colour of the tier it's announcing.
    ns.applyTierPalette(data.tier);

    ns.renderRank(data);
    ns.renderPlacements(data.recentPlacements || []);
    ns.renderGoal(data);
    ns.renderSession(data);
    ns.renderFooterBand(data.error);

    // The number always rolls the same way whether it's a normal gain/loss or
    // a promotion; only the trend marker (which uses the server's
    // absolute-LP-based delta) needs the promotion-aware math, since it has to
    // stay correctly signed.
    if (data.tier !== 'UNRANKED') {
      const isNewDelta = data.deltaSeq !== undefined && data.deltaSeq !== lastSeenDeltaSeq;
      ns.animateLP(data.leaguePoints || 0, data.lastDelta || 0, isNewDelta);
      lastSeenDeltaSeq = data.deltaSeq;
    }

    ns.checkRankChange(data.tier, data.rank, !!data.isMockMode);
    ns.updateCrest(data.tier);
  }

  async function refresh() {
    try {
      const res = await fetch('/api/rank', { cache: 'no-store' });
      render(await res.json());
    } catch {
      ns.renderFooterBand('cannot reach local server');
    }
  }

  // Exposed so a one-off capture can stop the interval and step the card by
  // hand -- see docs/_gif-build/capture.js. Nothing in the app calls it.
  ns.refresh = refresh;

  applyScaleFromQuery();
  refresh();
  setInterval(refresh, POLL_INTERVAL_MS);
}(window.TFTOverlay = window.TFTOverlay || {}));
