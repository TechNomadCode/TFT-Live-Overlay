// The four stacked rows and the footer band: everything that is a pure
// function of the latest payload, with no animation state of its own.

(function (ns) {
  'use strict';

  // Always renders PLACEMENT_SLOTS chips so the row can't change size as
  // history fills in.
  const PLACEMENT_SLOTS = 5;
  // Above this length the tier label is set a few points smaller rather than
  // ellipsised -- "GRANDMASTER", "PLATINUM III".
  const LONG_RANK_LABEL = 10;

  function renderPlacements(list) {
    const row = ns.el('placements');
    if (!row) return;
    let html = '';
    for (let i = 0; i < PLACEMENT_SLOTS; i++) {
      const p = list[i];
      if (typeof p === 'number') {
        const cls = p === 1 ? 'first' : p <= 4 ? 'top4' : 'bot4';
        html += `<span class="pl ${cls}">${p}</span>`;
      } else {
        html += '<span class="pl empty">-</span>';
      }
    }
    ns.setHtmlIfChanged(row, html);
  }

  function renderRank(data) {
    const text = data.tier === 'UNRANKED' ? 'UNRANKED' : `${data.tier} ${data.rank}`.trim();
    ns.setSafeText('tierRank', text);
    ns.el('tierRank').classList.toggle('long', text.length > LONG_RANK_LABEL);
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

  function renderSession(data) {
    const row = ns.el('sessionRow');
    const lp = data.sessionLP || 0;
    ns.setSafeText('sessionLP', (lp >= 0 ? '+' : '') + lp + ' LP');

    // Average placement only appears once there's a session game to average --
    // "avg 0.0" on a fresh session reads as a real (terrible) statistic.
    const avg = data.sessionAvgPlacement;
    const record = `${data.sessionWins || 0}W-${data.sessionLosses || 0}L`;
    ns.setSafeText('sessionRecord', avg !== null && avg !== undefined ? `${record} · avg ${avg}` : record);

    row.className = 'session-row' + (lp > 0 ? ' positive' : lp < 0 ? ' negative' : '');
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

  /** Footer and error share one slot — only one shows at a time. */
  function renderFooterBand(message) {
    const errorEl = ns.el('errorMsg');
    const footerEl = ns.el('footer');
    if (message) {
      ns.setSafeText('errorMsg', 'Overlay: ' + message);
      errorEl.classList.add('visible');
      footerEl.classList.add('hidden');
    } else {
      errorEl.classList.remove('visible');
      footerEl.classList.remove('hidden');
    }
  }

  ns.renderPlacements = renderPlacements;
  ns.renderRank = renderRank;
  ns.renderGoal = renderGoal;
  ns.renderSession = renderSession;
  ns.renderIdentity = renderIdentity;
  ns.renderFooterBand = renderFooterBand;
}(window.TFTOverlay = window.TFTOverlay || {}));
