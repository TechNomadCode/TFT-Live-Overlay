// Region routing. Riot splits TFT across two different route kinds: the
// platform route addresses a specific ladder (euw1, na1, kr...), while the
// regional route addresses the account and match APIs and covers several
// platforms at once. Both are needed, and neither can be derived from the
// other, which is why the map holds both plus the label the overlay shows.

const REGION_MAP = {
  // platform -> [regionRoute, display label]
  euw1: ['europe', 'EUW'], eun1: ['europe', 'EUNE'], tr1: ['europe', 'TR'], ru: ['europe', 'RU'],
  na1: ['americas', 'NA'], br1: ['americas', 'BR'], la1: ['americas', 'LAN'], la2: ['americas', 'LAS'], oc1: ['americas', 'OCE'],
  kr: ['asia', 'KR'], jp1: ['asia', 'JP'],
};

const DEFAULT_PLATFORM = 'euw1';

/** Translates persisted settings into the shape the overlay server expects. */
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
    pollIntervalMs: settings.pollIntervalMs || 5000,
  };
}

module.exports = { REGION_MAP, DEFAULT_PLATFORM, settingsToServerConfig };
