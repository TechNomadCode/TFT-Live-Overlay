// Persistence for the settings window.
//
// The file lives in app.getPath('userData'), never in the repo -- it holds a
// Riot API key. .gitignore has a `settings.json` rule as a second line of
// defence against a stray copy being committed.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const { DEFAULT_PLATFORM } = require('./regions');
const { DEFAULT_POLL_INTERVAL_MS } = require('../server/constants');

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

function defaultSettings() {
  return {
    gameName: '',
    tagLine: '',
    riotApiKey: '',
    platformRoute: DEFAULT_PLATFORM,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  };
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    return defaultSettings();
  }
}

function saveSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
}

module.exports = { SETTINGS_PATH, defaultSettings, loadSettings, saveSettings };
