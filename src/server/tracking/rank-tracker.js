// The live path: poll Riot's league entry, work out what changed, and write it
// into the shared tracker state. This is the only module that talks to the
// league endpoint, and the only one that owns the poll timer.

const { getAbsoluteLP } = require('../../shared/lp-math');

/**
 * @param {object} deps
 * @param {object} deps.riot
 * @param {object} deps.state - tracker state
 * @param {object} deps.placements
 * @param {function} deps.getConfig
 * @param {function} deps.isMockMode
 * @param {function} deps.emit - push the current status to the host process
 * @param {function} deps.log
 */
function createRankTracker({ riot, state, placements, getConfig, isMockMode, emit, log }) {
  let consecutiveFailures = 0;
  let pollTimer = null;

  async function poll() {
    // Mock mode owns the state while it's on; a live poll landing underneath it
    // would overwrite the simulated values mid-preview.
    if (isMockMode()) return;

    const config = getConfig();
    if (!config.riotApiKey || !config.gameName || !config.tagLine) {
      state.data = {
        ...state.data,
        error: 'Not configured — set your Riot ID and API key in Settings',
        updatedAt: new Date().toISOString(),
      };
      emit();
      return;
    }

    try {
      const puuid = await riot.getPuuid();
      const entries = await riot.getLeagueEntries(puuid);
      // Ranked-only, deliberately. A player who's only played Hyper Roll or
      // Double Up this set still HAS league entries -- RANKED_TFT_TURBO /
      // RANKED_TFT_DOUBLE_UP -- but those carry ratedTier/ratedRating instead
      // of tier/rank/leaguePoints. Falling back to entries[0] put a literal
      // "undefined undefined" on the overlay. No ranked entry means unranked,
      // which the branch below already handles correctly.
      const entry = Array.isArray(entries)
        ? entries.find((e) => e.queueType === 'RANKED_TFT')
        : null;

      if (!entry) {
        applyUnranked();
      } else {
        await applyEntry(entry);
      }
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures++;
      if (consecutiveFailures <= 3 || consecutiveFailures % 12 === 0) {
        log('ERROR', `Fetch failed (${consecutiveFailures} in a row): ${err.message}`);
      }
      state.data = { ...state.data, error: err.message, updatedAt: new Date().toISOString() };
    }
    emit();
  }

  // No ranked entry means the tracked ladder position no longer exists --
  // fresh account, or a set rollover that wiped everyone's rank. The delta
  // trackers have to drop too, otherwise previousMatchesPlayed stays at the old
  // set's game count and the `matchesPlayed > previous` test in applyEntry
  // can't fire again until the new set passes it.
  function applyUnranked() {
    state.previousAbsLP = null;
    state.previousMatchesPlayed = null;
    state.baseline = null;
    state.data = {
      ...state.data,
      tier: 'UNRANKED', rank: '', leaguePoints: 0, wins: 0, losses: 0,
      sessionLP: 0, sessionWins: 0, sessionLosses: 0, lastDelta: 0,
      lpToNextTier: null, nextTierName: null, tierProgressPct: null,
      recentPlacements: placements.getRecent(),
      sessionAvgPlacement: placements.getSessionAverage(),
      updatedAt: new Date().toISOString(), error: null,
    };
  }

  async function applyEntry(entry) {
    const config = getConfig();
    const currentAbsLP = getAbsoluteLP(entry.tier, entry.rank, entry.leaguePoints);

    if (!state.baseline) {
      state.baseline = { absLP: currentAbsLP, wins: entry.wins, losses: entry.losses };
      log('SESSION', `Baseline locked: ${entry.tier} ${entry.rank} (${entry.leaguePoints} LP)`);
    }

    await placements.backfillOnce();

    const matchesPlayed = entry.wins + entry.losses;
    let lastDelta = 0;
    if (state.previousMatchesPlayed !== null && matchesPlayed > state.previousMatchesPlayed) {
      // A new match (or matches, if more than one finished between polls)
      // completed since the last check -- the true LP swing is the absolute-LP
      // difference, which stays correctly signed even across a
      // promotion/demotion.
      lastDelta = currentAbsLP - state.previousAbsLP;
      state.nextDeltaSeq(); // marks this as a fresh event, not a repeat poll
      // The only place we spend match-API calls.
      await placements.handleFinishedMatches(matchesPlayed - state.previousMatchesPlayed);
    }
    state.previousAbsLP = currentAbsLP;
    state.previousMatchesPlayed = matchesPlayed;

    state.data = {
      ...state.data,
      gameName: config.gameName, tagLine: config.tagLine,
      tier: entry.tier, rank: entry.rank, leaguePoints: entry.leaguePoints,
      wins: entry.wins, losses: entry.losses,
      lastDelta, deltaSeq: state.deltaSeq,
      error: null,
    };
    state.syncSessionTotals();
    state.syncTierProgress();
    state.syncPlacements();
    state.touch();
  }

  function start() {
    if (pollTimer) clearInterval(pollTimer);
    poll();
    pollTimer = setInterval(poll, getConfig().pollIntervalMs);
    emit();
  }

  function stop() {
    placements.cancelCatchup();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    emit();
  }

  function isPolling() { return !!pollTimer; }

  /** A different Riot ID / region is being tracked now. */
  function resetIdentity() {
    riot.clearIdentity();
    state.resetIdentity();
    placements.reset();
    consecutiveFailures = 0;
  }

  return { poll, start, stop, isPolling, resetIdentity };
}

module.exports = { createRankTracker };
