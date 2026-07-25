// Owns everything about the last-five-placements strip: which matches we've
// already looked up, which ones the match API hasn't indexed yet, and the
// retry ladder that chases them down.
//
// Placement lags LP. Riot's match index updates after the league entry, so a
// placement that shows up seconds after the LP change is expected behaviour --
// scheduleCatchup below is what turns that lag into a self-resolving wait
// instead of the strip sitting permanently one game behind.

const {
  RANKED_TFT_QUEUE_ID,
  PLACEMENT_HISTORY_SIZE,
  MAX_MATCH_LOOKUPS_PER_CYCLE,
  MATCH_ID_MEMORY,
  PLACEMENT_CATCHUP_DELAYS_MS,
} = require('../constants');

/**
 * @param {object} deps
 * @param {object} deps.riot - riot client
 * @param {function} deps.log
 * @param {function} deps.isMockMode - live state must not be touched under mock
 */
function createPlacementTracker({ riot, log, isMockMode }) {
  // recent is newest-first and drives the overlay strip; session holds only
  // matches observed *after* the session baseline locked, so the session
  // average never counts games from before you started streaming. knownIds
  // dedupes so each match is fetched exactly once.
  let recent = [];
  let session = [];
  let knownIds = new Set();
  let initialized = false;
  // Ranked matches we know finished (the league entry moved) but whose
  // placement the match API hasn't served yet.
  let pending = 0;
  let catchupTimer = null;
  let catchupAttempt = 0;
  let onResolved = null;

  function getRecent() { return [...recent]; }

  function getSessionAverage() {
    if (!session.length) return null;
    const sum = session.reduce((a, b) => a + b, 0);
    return Math.round((sum / session.length) * 10) / 10;
  }

  // One list request, then a detail request only for match IDs we've never
  // seen. In steady state that's zero extra calls; a finished game costs the
  // list plus one detail. Deliberately not called on every poll -- see the
  // new-match hook in rank-tracker.
  async function sync({ countTowardSession }) {
    const puuid = await riot.getPuuid();
    const ids = await riot.getRecentMatchIds(puuid, PLACEMENT_HISTORY_SIZE);
    if (!Array.isArray(ids)) return 0;
    let discovered = 0;

    const unseen = ids.filter((id) => !knownIds.has(id)).slice(0, MAX_MATCH_LOOKUPS_PER_CYCLE);
    // Walk oldest -> newest so unshifting leaves `recent` newest-first.
    for (const id of unseen.slice().reverse()) {
      const match = await riot.getMatch(id);
      knownIds.add(id);
      if (!match || !match.info || match.info.queue_id !== RANKED_TFT_QUEUE_ID) continue;
      const me = (match.info.participants || []).find((p) => p.puuid === puuid);
      if (!me || typeof me.placement !== 'number') continue;
      recent.unshift(me.placement);
      if (countTowardSession) session.push(me.placement);
      discovered++;
    }

    recent = recent.slice(0, PLACEMENT_HISTORY_SIZE);
    if (knownIds.size > MATCH_ID_MEMORY) {
      knownIds = new Set(Array.from(knownIds).slice(-MATCH_ID_MEMORY));
    }
    return discovered;
  }

  function cancelCatchup() {
    if (catchupTimer) clearTimeout(catchupTimer);
    catchupTimer = null;
    catchupAttempt = 0;
  }

  // Only ever runs in the window just after a real game, and stops the moment
  // every known match has a placement -- so steady-state cost stays at zero.
  function scheduleCatchup() {
    if (catchupTimer) return;
    if (catchupAttempt >= PLACEMENT_CATCHUP_DELAYS_MS.length) {
      log('PLACEMENT', `Gave up waiting on ${pending} match(es); will resolve after the next game`);
      cancelCatchup();
      return;
    }
    const delay = PLACEMENT_CATCHUP_DELAYS_MS[catchupAttempt++];
    catchupTimer = setTimeout(async () => {
      catchupTimer = null;
      if (isMockMode() || !riot.getCachedPuuid() || pending <= 0) { cancelCatchup(); return; }
      try {
        const found = await sync({ countTowardSession: true });
        if (found > 0) {
          pending = Math.max(0, pending - found);
          log('PLACEMENT', `Match API caught up: resolved ${found}, ${pending} still pending`);
          if (onResolved) onResolved();
        }
      } catch (err) {
        log('ERROR', `Placement catch-up failed: ${err.message}`);
      }
      if (pending > 0) scheduleCatchup();
      else cancelCatchup();
    }, delay);
    if (catchupTimer.unref) catchupTimer.unref();
  }

  /** Fired when the retry ladder resolves a placement, so the host can re-emit. */
  function onCatchupResolved(cb) { onResolved = cb; }

  /**
   * Backfills the strip once so it isn't empty on launch. These games predate
   * the session, so they must not feed the session average. A failure here is
   * swallowed -- an empty strip is not a reason to fail a rank poll.
   */
  async function backfillOnce() {
    if (initialized) return;
    initialized = true;
    try {
      await sync({ countTowardSession: false });
    } catch (err) {
      log('ERROR', `Placement backfill failed: ${err.message}`);
    }
  }

  /**
   * The league entry says `count` more matches have finished. Look them up now,
   * and start the retry ladder for any the match API can't serve yet. Isolated
   * from the caller's error handling: a placement failure must never take down
   * rank/LP.
   */
  async function handleFinishedMatches(count) {
    pending += count;
    catchupAttempt = 0; // fresh match deserves a fresh backoff
    try {
      const found = await sync({ countTowardSession: true });
      pending = Math.max(0, pending - found);
    } catch (err) {
      log('ERROR', `Placement fetch failed: ${err.message}`);
    }
    if (pending > 0) {
      log('PLACEMENT', `${pending} match(es) not indexed yet, retrying`);
      scheduleCatchup();
    } else {
      cancelCatchup();
    }
  }

  /** Mock mode writes into the same arrays the live path writes. */
  function recordSimulated(placement) {
    recent.unshift(placement);
    recent = recent.slice(0, PLACEMENT_HISTORY_SIZE);
    session.push(placement);
  }

  function clearSession() { session = []; }

  /** Identity change: everything we know is about a different account. */
  function reset() {
    recent = [];
    session = [];
    knownIds = new Set();
    initialized = false;
    pending = 0;
    cancelCatchup();
  }

  function snapshot() {
    return {
      recent: [...recent],
      session: [...session],
      knownIds: new Set(knownIds),
      initialized,
      pending,
    };
  }

  function restore(snap) {
    recent = snap.recent;
    session = snap.session;
    knownIds = snap.knownIds;
    initialized = snap.initialized;
    pending = snap.pending;
    if (pending > 0) scheduleCatchup();
  }

  return {
    getRecent,
    getSessionAverage,
    backfillOnce,
    handleFinishedMatches,
    recordSimulated,
    clearSession,
    reset,
    cancelCatchup,
    onCatchupResolved,
    snapshot,
    restore,
  };
}

module.exports = { createPlacementTracker };
