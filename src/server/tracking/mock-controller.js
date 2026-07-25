// Mock mode: drive the overlay from simulated results so UI work doesn't have
// to wait on real matches or burn API quota.
//
// Mock events write into the very same state the live path uses, and live state
// is only refreshed when a NEW match is detected -- so on returning to live
// there was nothing to trigger a correction and simulated results stuck around.
// Hence the snapshot on the way in and the restore on the way out. Costs no
// extra API calls.
//
// The snapshot has to cover the session baseline as well as the placement
// arrays: mock "Reset Session" nulls the baseline, and the next simulated LP
// change re-locks it against FABRICATED LP. Returning to live then computed
// sessionLP as (real absolute LP - mock absolute LP), which can be thousands of
// LP off on stream.

const { getAbsoluteLP, applyLPChange } = require('../../shared/lp-math');

const TFT_LOBBY_SIZE = 8;

function isValidPlacement(p) {
  return typeof p === 'number' && p >= 1 && p <= TFT_LOBBY_SIZE;
}

/**
 * @param {object} deps
 * @param {object} deps.state - tracker state
 * @param {object} deps.placements
 * @param {function} deps.log
 */
function createMockController({ state, placements, log }) {
  let enabled = false;
  let preMockState = null;

  function isEnabled() { return enabled; }

  function setEnabled(next) {
    if (next && !enabled) {
      preMockState = {
        tracker: state.snapshot(),
        placements: placements.snapshot(),
      };
      placements.cancelCatchup();
    } else if (!next && enabled && preMockState) {
      // Restoring the displayed values too means the overlay snaps straight
      // back to real rank on toggle-off, instead of showing simulated rank
      // until the next poll lands.
      state.restore(preMockState.tracker);
      placements.restore(preMockState.placements);
      preMockState = null;
      state.syncPlacements();
    }
    enabled = next;
  }

  /**
   * Applies one Test-tab event. Turns mock mode on as a side effect -- a
   * simulated result must never be allowed to land on live state.
   * @param {object} event - the /api/test/event body
   */
  function applyEvent(event) {
    const { action, lpChange, newTier, newRank, errorMsg, placement } = event;
    setEnabled(true);

    if (!state.baseline) {
      const { tier, rank, leaguePoints, wins, losses } = state.data;
      state.baseline = { absLP: getAbsoluteLP(tier, rank, leaguePoints), wins, losses };
    }

    if (action === 'lp_change') {
      applyLpChangeEvent(lpChange, placement);
    } else if (action === 'set_rank') {
      applySetRankEvent(newTier, newRank);
    } else if (action === 'error') {
      state.data.error = errorMsg || 'Simulated Test Error!';
    } else if (action === 'reset_error') {
      state.data.error = null;
    } else if (action === 'reset_session') {
      state.baseline = null;
      placements.clearSession();
      state.data.sessionLP = 0;
      state.data.sessionWins = 0;
      state.data.sessionLosses = 0;
    }

    state.syncSessionTotals();
    state.syncPlacements();
    state.syncTierProgress();
    state.touch();
  }

  function applyLpChangeEvent(lpChange, placement) {
    const { tier, rank, leaguePoints } = state.data;
    const beforeAbsLP = getAbsoluteLP(tier, rank, leaguePoints);
    const result = applyLPChange(tier, rank, leaguePoints, lpChange);
    state.data.tier = result.tier;
    state.data.rank = result.rank;
    state.data.leaguePoints = result.lp;

    // Compute the delta the exact same way the live path does (actual
    // absolute-LP difference), not the raw requested lpChange -- those two only
    // diverge at a tier's floor, where a big loss gets clamped at Division IV /
    // 0 LP. Using the true post-clamp change keeps mock mode's numbers
    // consistent with what live data would actually show in the same situation.
    state.data.lastDelta = getAbsoluteLP(result.tier, result.rank, result.lp) - beforeAbsLP;
    state.data.deltaSeq = state.nextDeltaSeq();

    // Riot's wins/losses on a TFT league entry mean top-4 / bottom-4, not LP
    // sign -- at high MMR a 4th can still be slightly negative. So when the
    // simulated event carries a placement, that decides it, and the LP sign is
    // only the fallback for a bare LP nudge with no placement.
    if (isValidPlacement(placement)) {
      if (placement <= 4) state.data.wins += 1;
      else state.data.losses += 1;
      // Mock must land in the same arrays the live path writes, so the strip
      // and the session average behave identically under test.
      placements.recordSimulated(placement);
    } else if (lpChange > 0) {
      state.data.wins += 1;
    } else if (lpChange < 0) {
      state.data.losses += 1;
    }
  }

  function applySetRankEvent(newTier, newRank) {
    state.data.tier = newTier;
    state.data.rank = newRank;
    state.data.lastDelta = 0; // a manual rank pick isn't a "match result"
    state.data.leaguePoints = 0;
    // ...and for the same reason it must not land in the session total. Move
    // the baseline with it, otherwise jumping Unranked -> Gold IV reads as a
    // +1247 LP session before a single simulated game has been played.
    if (state.baseline) {
      state.baseline.absLP = getAbsoluteLP(newTier, newRank, 0);
    }
  }

  function toggle(next) {
    setEnabled(!!next);
    log('TEST', `Mock mode: ${enabled ? 'ON' : 'OFF'}`);
  }

  return { isEnabled, setEnabled, toggle, applyEvent };
}

module.exports = { createMockController };
