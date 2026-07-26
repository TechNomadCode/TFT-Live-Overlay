// The rank-change moments: detecting that the ladder actually moved, deciding
// how big a deal it was, and holding the card on it for a beat.
//
// A division change and a tier change are different events. A division moves
// several times a session, so it gets a ~1s accent that leaves every number
// legible. A tier change is rare and is the single most clippable moment on a
// ranked stream, so it gets the full takeover.

(function (ns, Tiers) {
  'use strict';

  const TIER_HOLD_MS = 2600;
  // The banner fades over 0.4s, so it starts leaving 400ms before the end.
  const TIER_FADE_MS = 400;
  // The material, crest and apex layout all swap under the flare's bloom.
  // Matches the 16% peak of flareOut in moment.css.
  const TIER_SWAP_MS = 330;
  const DIV_HOLD_MS = 1050;

  let lastTier = null;
  let lastRankScore = null;
  let lastMockMode = null;
  let momentTimeouts = [];

  // Cancels an in-flight moment AND undoes its state. Dropping the timeouts
  // alone would strand the card mid-takeover -- readout pulled back, banner
  // still up -- if a second ladder move landed during the hold.
  function clearMoment() {
    momentTimeouts.forEach(clearTimeout);
    momentTimeouts = [];

    const card = ns.el('card');
    const moment = ns.el('moment');
    const label = ns.el('tierRank');
    if (card) card.classList.remove('flash', 'dark', 'surge', 'fall', 'moment-in', 'div-up', 'div-down');
    if (moment) moment.classList.remove('show');
    if (label) label.classList.remove('pop', 'dip');
  }

  function after(ms, fn) {
    momentTimeouts.push(setTimeout(fn, ms));
  }

  /** The big one: a different tier. Takes over the whole card. */
  function showTierMoment(isUp, tier, rank) {
    const card = ns.el('card');
    const moment = ns.el('moment');
    if (!card || !moment) return;

    const label = rank ? `${tier} ${rank}` : tier;
    // moment-in pulls the readout back so the banner can grow out of the space
    // it leaves, rather than the banner appearing on top of a card that never
    // acknowledged it.
    card.classList.add('flash', 'moment-in', isUp ? 'surge' : 'fall');
    if (!isUp) card.classList.add('dark');

    moment.querySelector('.verb').textContent = isUp ? 'Promoted' : 'Demoted';
    moment.querySelector('.dest').textContent = label;
    moment.className = 'moment ' + (isUp ? 'up' : 'down');

    after(120, () => moment.classList.add('show'));
    // Handing back is the same movement reversed: the banner contracts as the
    // readout comes forward, so the two cross rather than one replacing other.
    after(TIER_HOLD_MS - TIER_FADE_MS, () => {
      moment.classList.remove('show');
      card.classList.remove('moment-in');
    });
    after(TIER_HOLD_MS, () => card.classList.remove('flash', 'dark', 'surge', 'fall'));
  }

  /** The small one: same tier, different division. No takeover. */
  function showDivisionMoment(isUp) {
    const card = ns.el('card');
    const label = ns.el('tierRank');
    if (!card || !label) return;

    card.classList.remove('div-up', 'div-down');
    label.classList.remove('pop', 'dip');
    // Force a reflow so a second change inside the hold window restarts the
    // animation instead of being ignored as an already-applied class.
    void card.offsetWidth;

    card.classList.add(isUp ? 'div-up' : 'div-down');
    label.classList.add(isUp ? 'pop' : 'dip');

    after(DIV_HOLD_MS, () => {
      card.classList.remove('div-up', 'div-down');
      label.classList.remove('pop', 'dip');
    });
  }

  /** Kept for the Practice page, which drives a takeover directly. */
  function showRankMoment(isUp, tier, rank) {
    clearMoment();
    showTierMoment(isUp, tier, rank);
  }

  // Fires only on a genuine ladder move. Deliberately skipped on the first
  // sighting of any rank (otherwise launching the app would announce a
  // promotion to wherever you already are) and on the poll where mock mode
  // flips, since that snaps the rank between simulated and real values.
  function checkRankChange(tier, rank, isMock) {
    const score = Tiers.rankScore(tier, rank);
    const mockFlipped = lastMockMode !== null && lastMockMode !== isMock;
    lastMockMode = isMock;

    if (score === null) { lastRankScore = null; lastTier = null; return; }
    if (lastRankScore === null || mockFlipped) {
      lastRankScore = score;
      lastTier = tier;
      return;
    }
    if (score === lastRankScore) return;

    const isUp = score > lastRankScore;
    const tierChanged = tier !== lastTier;
    lastRankScore = score;
    lastTier = tier;

    clearMoment();
    if (tierChanged) showTierMoment(isUp, tier, rank);
    else showDivisionMoment(isUp);
  }

  // How long the card stays mid-transition, so the caller can delay the swap
  // until the flare is covering it.
  ns.TIER_SWAP_MS = TIER_SWAP_MS;
  ns.showRankMoment = showRankMoment;
  ns.checkRankChange = checkRankChange;
}(window.TFTOverlay = window.TFTOverlay || {}, window.TFT.Tiers));
