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
// ranked matches are filtered client-side on queue_id. 1100 = RANKED_TFT;
// 1090 is normal, 1130 Hyper Roll, 1160 Double Up -- those must not pollute
// the placement strip, since the league entry we track is ranked-only.
const RANKED_TFT_QUEUE_ID = 1100;

const PLACEMENT_HISTORY_SIZE = 5;

// Hard ceiling on match lookups per cycle so a long absence (or a burst of
// games between polls) can never spike request count against the key budget.
const MAX_MATCH_LOOKUPS_PER_CYCLE = 5;

const MATCH_ID_MEMORY = 40;

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
  RANKED_TFT_QUEUE_ID,
  PLACEMENT_HISTORY_SIZE,
  MAX_MATCH_LOOKUPS_PER_CYCLE,
  MATCH_ID_MEMORY,
  PLACEMENT_CATCHUP_DELAYS_MS,
};
