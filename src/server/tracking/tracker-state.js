// The mutable state behind /api/rank, in one place.
//
// It lives in its own module because two things write to it: the live poll
// (rank-tracker) and the Practice page (mock-controller). Giving them a shared,
// named owner is what makes "mock writes into the very same state the live
// path uses" an explicit design decision rather than an accident waiting to
// diverge -- and it's what lets mock snapshot/restore it wholesale.

const { getAbsoluteLP, getTierProgress } = require('../../shared/lp-math');

function emptyData() {
  return {
    gameName: '', tagLine: '', tier: 'UNRANKED', rank: '',
    leaguePoints: 0, wins: 0, losses: 0,
    sessionLP: 0, sessionWins: 0, sessionLosses: 0,
    lastDelta: 0, deltaSeq: 0,
    lpToNextTier: null, nextTierName: null, tierProgressPct: null,
    recentPlacements: [], sessionAvgPlacement: null,
    updatedAt: null, error: null,
  };
}

/**
 * @param {object} deps
 * @param {object} deps.placements - placement tracker, read for the derived fields
 */
function createTrackerState({ placements }) {
  const state = {
    /** The object served verbatim by /api/rank. */
    data: emptyData(),

    /** Session baseline: absolute LP + W/L at the moment tracking started. */
    baseline: null,

    // Previous poll's absolute LP + match count, so we can compute "how much
    // did this match actually change" using absolute LP rather than the raw
    // displayed within-division LP. That distinction matters because a
    // promotion resets the displayed LP to a low number (e.g. Diamond IV 90 ->
    // Diamond III 28) even on a WIN -- diffing the raw display value alone
    // would show that as a misleading LP loss.
    previousAbsLP: null,
    previousMatchesPlayed: null,

    // Increments only on a genuine new delta event, so the overlay can tell a
    // fresh result from the same result being re-served on the next poll.
    deltaSeq: 0,
  };

  state.nextDeltaSeq = function nextDeltaSeq() {
    state.deltaSeq += 1;
    return state.deltaSeq;
  };

  /** Copies the placement tracker's current view onto the served payload. */
  state.syncPlacements = function syncPlacements() {
    state.data.recentPlacements = placements.getRecent();
    state.data.sessionAvgPlacement = placements.getSessionAverage();
  };

  /** Recomputes session totals against the baseline, if one is locked. */
  state.syncSessionTotals = function syncSessionTotals() {
    if (!state.baseline) return;
    const { tier, rank, leaguePoints, wins, losses } = state.data;
    state.data.sessionLP = getAbsoluteLP(tier, rank, leaguePoints) - state.baseline.absLP;
    state.data.sessionWins = wins - state.baseline.wins;
    state.data.sessionLosses = losses - state.baseline.losses;
  };

  state.syncTierProgress = function syncTierProgress() {
    const { tier, rank, leaguePoints } = state.data;
    Object.assign(state.data, getTierProgress(tier, rank, leaguePoints));
  };

  state.touch = function touch() {
    state.data.updatedAt = new Date().toISOString();
  };

  /**
   * A different account is being tracked now. Note that previousAbsLP and
   * previousMatchesPlayed are the delta high-water mark -- leaving them
   * pointing at the previous account is what produced a phantom four-figure LP
   * swing on switching to an account with more games played, and, in the other
   * direction, silently wedged delta detection until the new account passed
   * the old one's game count.
   */
  state.resetIdentity = function resetIdentity() {
    state.baseline = null;
    state.previousAbsLP = null;
    state.previousMatchesPlayed = null;
    state.data.lastDelta = 0;
  };

  /**
   * Snapshot/restore is mock mode's undo. deltaSeq is deliberately NOT part of
   * it: the counter must keep moving forward across a mock session, otherwise
   * the first real delta after switching back could reuse a sequence number
   * the overlay has already seen and be ignored as a repeat.
   */
  state.snapshot = function snapshot() {
    return {
      data: { ...state.data },
      baseline: state.baseline ? { ...state.baseline } : null,
    };
  };

  state.restore = function restore(snap) {
    state.data = snap.data;
    state.baseline = snap.baseline;
  };

  return state;
}

module.exports = { createTrackerState };
