// Paths and the one fixed value the whole app is pinned to.

const path = require('path');
const { OVERLAY_PORT } = require('../server/constants');

const SRC_DIR = path.join(__dirname, '..');
const ROOT_DIR = path.join(SRC_DIR, '..');

const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const RENDERER_HTML = path.join(SRC_DIR, 'renderer', 'index.html');
const PRELOAD_SCRIPT = path.join(SRC_DIR, 'preload', 'index.js');

const APP_NAME = 'TFT Live Overlay';

function assetPath(file) {
  return path.join(ASSETS_DIR, file);
}

/** The URL users paste into a Streamlabs/OBS Browser Source. */
function overlayUrl() {
  return `http://localhost:${OVERLAY_PORT}/overlay.html`;
}

module.exports = {
  APP_NAME,
  OVERLAY_PORT,
  ASSETS_DIR,
  RENDERER_HTML,
  PRELOAD_SCRIPT,
  assetPath,
  overlayUrl,
};
