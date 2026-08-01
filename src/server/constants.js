// Tuning values for the Riot-facing side of the server. Each one is sized
// against the 100 requests / 2 minutes budget of a personal API key, so they
// are not arbitrary -- read the comments before raising any of them.

// Port is fixed, deliberately, so an existing Streamlabs/OBS Browser Source
// pointed at http://localhost:3000/overlay.html keeps working across updates.
const OVERLAY_PORT = 3000;

const DEFAULT_POLL_INTERVAL_MS = 5000;

// A wedged socket must never stall the poll loop behind it.
const RIOT_REQUEST_TIMEOUT_MS = 8000;

// tft-match-v1's ids endpoint has no queue filter (unlike LoL's match-v5), so
// matches are routed client-side on queue_id -- see src/shared/modes.js, which
// owns the 1100/1160 mapping. 1090 (normal) and 1130 (Hyper Roll) match no mode
// and are discarded, since neither has a league entry this app can render.

// How many placements the strip shows, per mode.
const PLACEMENT_HISTORY_SIZE = 5;

// How far back the match-ids request reaches. Deliberately much larger than the
// strip: the ids come back interleaved across every queue, so a player who
// mostly queues one mode needs a wide window before the other mode's strip has
// anything in it at all. Costs nothing extra -- count is a query parameter on a
// single request, and only *unseen* ids are ever looked up.
const MATCH_ID_LOOKBACK = 20;

// Hard ceiling on match lookups per cycle so a long absence (or a burst of
// games between polls) can never spike request count against the key budget.
const MAX_MATCH_LOOKUPS_PER_CYCLE = 5;

// The one-time backfill is allowed the whole lookback, because the alternative
// is an empty strip on launch that only fills a game at a time. It is a single
// burst at startup, not a recurring cost.
const MAX_BACKFILL_LOOKUPS = MATCH_ID_LOOKBACK;

// Must stay above MATCH_ID_LOOKBACK, or ids would age out of the dedupe set
// while still inside the window and be re-fetched every cycle.
const MATCH_ID_MEMORY = 60;

// The league entry (LP/rank) updates almost immediately after a game, but the
// match document is indexed by a separate system that lags behind it. So the
// moment we detect a finished match, its placement often isn't queryable yet.
// Without a retry the placement is only picked up when the NEXT game ends,
// leaving the strip permanently one match behind. These are the retry delays.
const PLACEMENT_CATCHUP_DELAYS_MS = [5000, 15000, 30000, 60000, 120000, 240000];

module.exports = {
  OVERLAY_PORT,
  DEFAULT_POLL_INTERVAL_MS,
  RIOT_REQUEST_TIMEOUT_MS,
  PLACEMENT_HISTORY_SIZE,
  MATCH_ID_LOOKBACK,
  MAX_MATCH_LOOKUPS_PER_CYCLE,
  MAX_BACKFILL_LOOKUPS,
  MATCH_ID_MEMORY,
  PLACEMENT_CATCHUP_DELAYS_MS,
};
