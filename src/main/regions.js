const { DEFAULT_POLL_INTERVAL_MS } = require('../server/constants');
const Modes = require('../shared/modes');

// Region routing. Riot splits TFT across two different route kinds: the
// platform route addresses a specific ladder (euw1, na1, kr...), while the
// regional route addresses the account and match APIs and covers several
// platforms at once. Both are needed, and neither can be derived from the
// other, which is why the map holds both plus the label the overlay shows.

// platform -> [regionRoute, badge, full name]
//
// The badge is what the overlay card shows, where there is room for three or
// four characters and no more. The full name is for the region picker in the
// app, where "LAN" and "LAS" are not something a user should have to already
// know. Both live here so the picker can't drift from the routing table -- the
// markup used to carry its own hardcoded copy of all eleven.
const REGION_MAP = {
  euw1: ['europe', 'EUW', 'Europe West'],
  eun1: ['europe', 'EUNE', 'Europe Nordic & East'],
  tr1: ['europe', 'TR', 'Turkey'],
  ru: ['europe', 'RU', 'Russia'],
  na1: ['americas', 'NA', 'North America'],
  br1: ['americas', 'BR', 'Brazil'],
  la1: ['americas', 'LAN', 'Latin America North'],
  la2: ['americas', 'LAS', 'Latin America South'],
  oc1: ['americas', 'OCE', 'Oceania'],
  kr: ['asia', 'KR', 'Korea'],
  jp1: ['asia', 'JP', 'Japan'],
};

const DEFAULT_PLATFORM = 'euw1';

/**
 * Translates persisted settings into the shape the overlay server expects.
 * This picks named keys, so anything added to settings.json that the server
 * needs has to be added here too or it is silently dropped.
 */
function settingsToServerConfig(settings) {
  const platformRoute = settings.platformRoute || DEFAULT_PLATFORM;
  const [regionRoute, regionLabel] = REGION_MAP[platformRoute] || ['europe', ''];
  return {
    riotApiKey: settings.riotApiKey || '',
    gameName: settings.gameName || '',
    tagLine: settings.tagLine || '',
    platformRoute,
    regionRoute,
    regionLabel,
    pollIntervalMs: settings.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS,
    gameMode: Modes.coerceMode(settings.gameMode),
  };
}

module.exports = { REGION_MAP, DEFAULT_PLATFORM, settingsToServerConfig };
