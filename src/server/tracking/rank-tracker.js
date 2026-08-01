// The live path: poll Riot's league entries, work out what changed on each
// ladder, and write it into the shared tracker state. This is the only module
// that talks to the league endpoint, and the only one that owns the poll timer.
//
// One poll feeds every mode. /tft/league/v1/by-puuid returns the player's entry
// for *all* queues in a single response, so tracking Double Up alongside ranked
// costs no extra request -- which is why both are tracked continuously rather
// than the mode switch re-pointing one tracker. Switching modes then needs no
// refetch at all, and neither ladder's session baseline is disturbed by it.

const { getAbsoluteLP } = require('../../shared/lp-math');
const Modes = require('../../shared/modes');

/**
 * @param {object} deps
 * @param {object} deps.riot
 * @param {object} deps.ladders - tracker state per mode, keyed by mode name
 * @param {object} deps.placements - shared placement tracker
 * @param {function} deps.getConfig
 * @param {function} deps.isMockMode
 * @param {function} deps.emit - push the current status to the host process
 * @param {function} deps.log
 */
function createRankTracker({ riot, ladders, placements, getConfig, isMockMode, emit, log }) {
  let consecutiveFailures = 0;
  let pollTimer = null;

  // Bumped by resetIdentity(). A poll is several awaited round-trips to Riot,
  // and saving a new Riot ID mid-flight used to let the old identity's response
  // -- typically a 404 for the name you just replaced -- land *after* the reset
  // and overwrite the fresh state with a stale error. It corrected itself on the
  // next tick, but on a card that is on screen the whole time. Each poll
  // captures the epoch it started in and drops its result if it no longer
  // matches.
  let identityEpoch = 0;

  const eachLadder = (fn) => Modes.MODES.forEach((mode) => fn(ladders[mode], mode));

  /** Both ladders share one fetch, so a failure is a failure for both. */
  function setErrorOnAll(message) {
    eachLadder((state) => {
      state.data = { ...state.data, error: message, updatedAt: new Date().toISOString() };
    });
  }

  async function poll() {
    // Mock mode owns the state while it's on; a live poll landing underneath it
    // would overwrite the simulated values mid-preview.
    if (isMockMode()) return;

    const epoch = identityEpoch;
    const config = getConfig();
    if (!config.riotApiKey || !config.gameName || !config.tagLine) {
      // Name the missing half rather than both. This lands on the overlay's
      // footer band as well as the app's banner, and "Riot ID not set" tells
      // you which field to go and fill in; the old combined sentence named a
      // "Settings" page that no longer exists and truncated on the card.
      setErrorOnAll(config.riotApiKey ? 'Riot ID not set' : 'Riot API key not set');
      emit();
      return;
    }

    try {
      const puuid = await riot.getPuuid();
      const entries = await riot.getLeagueEntries(puuid);
      // Re-check after the round-trips, before anything is written.
      if (epoch !== identityEpoch || isMockMode()) return;

      const list = Array.isArray(entries) ? entries : [];
      // A queue the player has never finished placements in is simply absent
      // from the array rather than present with null fields, so "no entry"
      // is the unranked signal -- confirmed against a live account that has
      // played Double Up but not yet completed its placements.
      const found = {};
      for (const mode of Modes.MODES) {
        found[mode] = list.find((e) => e.queueType === Modes.MODE_META[mode].queueType) || null;
      }

      // Backfill once for both strips, before either ladder is applied, so the
      // shared match fetch fills the Double Up strip even on a poll where only
      // ranked has an entry. Skipped entirely for an account with no rank at
      // all, where there is nothing to backfill against.
      if (Modes.MODES.some((mode) => found[mode])) {
        await placements.backfillOnce();
        if (epoch !== identityEpoch || isMockMode()) return;
      }

      for (const mode of Modes.MODES) {
        if (!found[mode]) {
          applyUnranked(ladders[mode]);
        } else {
          await applyEntry(ladders[mode], found[mode]);
          // applyEntry awaits the match API. Same guard, same reason.
          if (epoch !== identityEpoch || isMockMode()) return;
        }
      }
      consecutiveFailures = 0;
    } catch (err) {
      if (epoch !== identityEpoch || isMockMode()) return;
      consecutiveFailures++;
      if (consecutiveFailures <= 3 || consecutiveFailures % 12 === 0) {
        log('ERROR', `Fetch failed (${consecutiveFailures} in a row): ${err.message}`);
      }
      setErrorOnAll(err.message);
    }
    emit();
  }

  // No entry for this queue means the tracked ladder position no longer exists
  // -- fresh account, placements not finished, or a set rollover that wiped
  // everyone's rank. The delta trackers have to drop too, otherwise
  // previousMatchesPlayed stays at the old set's game count and the
  // `matchesPlayed > previous` test in applyEntry can't fire again until the
  // new set passes it.
  function applyUnranked(state) {
    const config = getConfig();
    state.previousAbsLP = null;
    state.previousMatchesPlayed = null;
    state.baseline = null;
    state.data = {
      ...state.data,
      // Identity is known whether or not this ladder has a rank on it, and
      // being unranked on one mode is now an ordinary state rather than an
      // edge case -- most players queue one ladder far more than the other.
      // Without this the footer fell back to "—" the moment you switched.
      gameName: config.gameName, tagLine: config.tagLine,
      tier: 'UNRANKED', rank: '', leaguePoints: 0, wins: 0, losses: 0,
      sessionLP: 0, sessionWins: 0, sessionLosses: 0, lastDelta: 0,
      lpToNextTier: null, nextTierName: null, tierProgressPct: null,
      recentPlacements: placements.getRecent(state.mode),
      sessionAvgPlacement: placements.getSessionAverage(state.mode),
      updatedAt: new Date().toISOString(), error: null,
    };
  }

  async function applyEntry(state, entry) {
    const config = getConfig();
    // Both ladders report tier/rank/leaguePoints identically -- Double Up has
    // used the same metallic ladder since patch 12.11, so this arithmetic is
    // mode-agnostic. (Hyper Roll is the queue that reports ratedTier/
    // ratedRating instead, and it is deliberately not a mode this app tracks.)
    const currentAbsLP = getAbsoluteLP(entry.tier, entry.rank, entry.leaguePoints);

    if (!state.baseline) {
      state.baseline = { absLP: currentAbsLP, wins: entry.wins, losses: entry.losses };
      log('SESSION', `Baseline locked (${Modes.MODE_META[state.mode].label}): `
        + `${entry.tier} ${entry.rank} (${entry.leaguePoints} LP)`);
    }

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

  /**
   * A different Riot ID / region is being tracked now. Note what is NOT an
   * identity change: the game mode. Both ladders are polled continuously, so
   * switching which one the card shows changes nothing about what is tracked --
   * and resetting here would throw away the other ladder's session for no
   * reason.
   */
  function resetIdentity() {
    identityEpoch++;
    riot.clearIdentity();
    eachLadder((state) => state.resetIdentity());
    placements.reset();
    consecutiveFailures = 0;
  }

  return { poll, start, stop, isPolling, resetIdentity };
}

module.exports = { createRankTracker };
