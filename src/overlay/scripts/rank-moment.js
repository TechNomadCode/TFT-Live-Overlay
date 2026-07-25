// The promotion / demotion takeover: detecting that the ladder actually moved,
// and holding the card on the announcement for a beat.

(function (ns, Tiers) {
  'use strict';

  const MOMENT_HOLD_MS = 2600;

  let lastRankScore = null;
  let lastMockMode = null;
  let momentTimeout = null;

  function showRankMoment(isUp, tier, rank) {
    const card = ns.el('card');
    const moment = ns.el('moment');
    if (!card || !moment) return;

    moment.querySelector('.verb').textContent = isUp ? 'Promoted' : 'Demoted';
    moment.querySelector('.dest').textContent = rank ? `${tier} ${rank}` : tier;
    moment.className = 'moment show ' + (isUp ? 'up' : 'down');
    card.classList.add(isUp ? 'promoted' : 'demoted');

    clearTimeout(momentTimeout);
    momentTimeout = setTimeout(() => {
      moment.className = 'moment ' + (isUp ? 'up' : 'down');
      card.classList.remove('promoted', 'demoted');
    }, MOMENT_HOLD_MS);
  }

  // Fires only on a genuine ladder move. Deliberately skipped on the first
  // sighting of any rank (otherwise launching the app would announce a
  // promotion to wherever you already are) and on the poll where mock mode
  // flips, since that snaps the rank between simulated and real values.
  function checkRankChange(tier, rank, isMock) {
    const score = Tiers.rankScore(tier, rank);
    const mockFlipped = lastMockMode !== null && lastMockMode !== isMock;
    lastMockMode = isMock;

    if (score === null) { lastRankScore = null; return; }
    if (lastRankScore === null || mockFlipped) { lastRankScore = score; return; }
    if (score === lastRankScore) return;

    const isUp = score > lastRankScore;
    lastRankScore = score;
    showRankMoment(isUp, tier, rank);
  }

  ns.showRankMoment = showRankMoment;
  ns.checkRankChange = checkRankChange;
}(window.TFTOverlay = window.TFTOverlay || {}, window.TFT.Tiers));
