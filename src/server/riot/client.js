// Every outbound call to Riot goes through here: auth header, timeout, error
// shaping, and the URL construction for the three endpoints this app uses.
// Nothing above this layer builds a Riot URL or knows what a PUUID is for.

const { RIOT_REQUEST_TIMEOUT_MS } = require('../constants');

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
        throw new Error(`Riot API ${res.status}: ${errorText}`);
      }
      return res.json();
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`Riot API request timed out after ${RIOT_REQUEST_TIMEOUT_MS / 1000}s`);
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
