// Every outbound call to Riot goes through here: auth header, timeout, error
// shaping, and the URL construction for the three endpoints this app uses.
// Nothing above this layer builds a Riot URL or knows what a PUUID is for.

const { RIOT_REQUEST_TIMEOUT_MS } = require('../constants');

// Riot answers a failed request with a JSON body:
//   {"status":{"message":"Forbidden","status_code":401}}
// That body used to be interpolated straight into the thrown Error, and
// state.data.error is rendered by the overlay into a 222px-wide, 10.5px footer
// band -- so an expired key put
//   Overlay: Riot API 401: {"status":{"message":"Forbid…
// on the stream, truncated mid-JSON, in red, in front of viewers. The body is
// worth logging and never worth showing; these are what the card says instead.
// Keep them under ~30 characters: the band fits roughly 40 including the
// "Overlay: " prefix readout.js adds.
const RIOT_ERROR_TEXT = {
  400: 'Riot rejected the request',
  401: 'Riot API key invalid',
  403: 'Riot API key expired',
  404: 'Riot ID not found',
  429: 'Rate limited — retrying',
  500: 'Riot API error — retrying',
  502: 'Riot API unreachable',
  503: 'Riot API unavailable',
  504: 'Riot API timed out',
};

function riotErrorMessage(status) {
  return RIOT_ERROR_TEXT[status] || `Riot API error ${status}`;
}

/**
 * @param {object} deps
 * @param {function} deps.getConfig - returns the live server config (key + routes)
 * @param {function} deps.log
 */
function createRiotClient({ getConfig, log }) {
  // Cached here rather than in a tracker because both the rank poll and the
  // placement lookups need it, and it costs an API call to resolve.
  let puuid = null;

  async function fetchJson(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RIOT_REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'X-Riot-Token': getConfig().riotApiKey },
        signal: controller.signal,
      });
      if (!res.ok) {
        const errorText = await res.text();
        if (res.status === 403) log('ERROR', 'Riot API Key is invalid or expired!');
        // The detail goes to the log, which is what the Help page's report
        // collects. The Error carries only what is safe to paint on a stream.
        log('ERROR', `Riot API ${res.status}: ${errorText}`);
        throw new Error(riotErrorMessage(res.status));
      }
      return res.json();
    } catch (err) {
      if (err.name === 'AbortError') {
        log('ERROR', `Riot API request timed out after ${RIOT_REQUEST_TIMEOUT_MS / 1000}s`);
        throw new Error('Riot API timed out');
      }
      // fetch itself failing means no route to Riot at all -- no internet, DNS,
      // a captive portal. "TypeError: fetch failed" on a stream card says
      // nothing; this at least points at the network.
      if (err instanceof TypeError) {
        log('ERROR', `Network error reaching Riot: ${err.message}`);
        throw new Error('Cannot reach Riot API');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function resolvePuuid() {
    const { gameName, tagLine, regionRoute } = getConfig();
    log('INIT', `Resolving PUUID for Riot ID: ${gameName}#${tagLine}...`);
    const url = `https://${regionRoute}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/`
      + `${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    const data = await fetchJson(url);
    log('SUCCESS', `Resolved PUUID: ${data.puuid.slice(0, 12)}...`);
    return data.puuid;
  }

  /** Resolves once and reuses the result until the tracked identity changes. */
  async function getPuuid() {
    if (!puuid) puuid = await resolvePuuid();
    return puuid;
  }

  /**
   * The already-resolved PUUID, or null. Callers that must not *cause* a
   * resolve -- the placement catch-up timer, which can fire long after the
   * identity was cleared -- use this instead of getPuuid().
   */
  function getCachedPuuid() {
    return puuid;
  }

  /** Called when the tracked Riot ID / region changes. Not on a key rotation. */
  function clearIdentity() {
    puuid = null;
  }

  function getLeagueEntries(id) {
    const { platformRoute } = getConfig();
    return fetchJson(`https://${platformRoute}.api.riotgames.com/tft/league/v1/by-puuid/${id}`);
  }

  function getRecentMatchIds(id, count) {
    const { regionRoute } = getConfig();
    return fetchJson(`https://${regionRoute}.api.riotgames.com/tft/match/v1/matches/by-puuid/${id}/ids?start=0&count=${count}`);
  }

  function getMatch(matchId) {
    const { regionRoute } = getConfig();
    return fetchJson(`https://${regionRoute}.api.riotgames.com/tft/match/v1/matches/${matchId}`);
  }

  return {
    getPuuid,
    getCachedPuuid,
    clearIdentity,
    getLeagueEntries,
    getRecentMatchIds,
    getMatch,
  };
}

module.exports = { createRiotClient };
