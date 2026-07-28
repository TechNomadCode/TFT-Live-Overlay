// Auto-update, wrapped so the rest of the app never touches electron-updater
// directly and never has to care which platform it's on.
//
// electron-builder already publishes to GitHub releases (see `publish` in
// package.json); nothing consumed that feed until now, so every user stayed on
// whatever build they first downloaded.

const { app } = require('electron');

const RELEASES_URL = 'https://github.com/TechNomadCode/TFT-Live-Overlay/releases/latest';

// Long enough that the check never competes with binding the overlay port --
// OBS may already be asking for the card while this runs.
const FIRST_CHECK_DELAY_MS = 10000;
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * @param {object} deps
 * @param {function} deps.onStatus - called with the status object on every change
 * @param {function} [deps.log]
 */
function createUpdater({ onStatus, log = () => {} }) {
  // Squirrel.Mac refuses to install an update over an unsigned app, and these
  // builds are unsigned on purpose -- a Developer account is not something a
  // free overlay app justifies (the README says as much). So macOS gets the
  // notification and a link, and never the download it can't apply.
  const canSelfInstall = process.platform !== 'darwin';

  let status = {
    state: app.isPackaged ? 'idle' : 'dev',
    version: null,
    percent: null,
    message: null,
    currentVersion: app.getVersion(),
    releasesUrl: RELEASES_URL,
  };

  let timer = null;
  let autoUpdater = null;

  function emit(next) {
    status = { ...status, ...next };
    if (onStatus) onStatus(status);
  }

  function getStatus() { return status; }

  // Required outside the isPackaged guard because electron-updater resolves the
  // app-update.yml that electron-builder only ships inside a packaged app, and
  // throws on construction without it.
  function loadAutoUpdater() {
    if (autoUpdater) return autoUpdater;
    autoUpdater = require('electron-updater').autoUpdater;

    autoUpdater.autoDownload = canSelfInstall;
    // Deliberately off, and it would be off even if the shutdown path allowed
    // it: applying an update is the user's call. An app that relaunches itself
    // is bad everywhere and catastrophic here -- this one is on screen in front
    // of a live audience.
    //
    // It could not work anyway. electron-updater hangs this on app's `quit`
    // event, and gracefulShutdown() in index.js ends with process.exit(0), so
    // `quit` never fires. Leaving the flag true would just be a lie in the
    // code. The explicit button below is the only install path.
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = null;

    autoUpdater.on('checking-for-update', () => emit({ state: 'checking', message: null }));

    autoUpdater.on('update-available', (info) => {
      log('UPDATE', `Version ${info.version} available (running ${app.getVersion()})`);
      emit({
        state: canSelfInstall ? 'available' : 'manual',
        version: info.version,
        percent: null,
        message: null,
      });
    });

    autoUpdater.on('update-not-available', () => emit({ state: 'none', version: null, message: null }));

    autoUpdater.on('download-progress', (progress) => {
      emit({ state: 'downloading', percent: Math.round(progress.percent) });
    });

    autoUpdater.on('update-downloaded', (info) => {
      log('UPDATE', `Version ${info.version} downloaded; installs on restart`);
      emit({ state: 'ready', version: info.version, percent: 100 });
    });

    // A failed check is usually just no internet, so it gets a plain sentence
    // rather than the raw error -- this renders next to a donate button, not in
    // a devtools console. The detail goes to overlay.log, which is what users
    // actually send when they report something.
    autoUpdater.on('error', (err) => {
      log('ERROR', `Update check failed: ${err && err.stack ? err.stack : err}`);
      emit({ state: 'error', percent: null, message: "Couldn't check for updates" });
    });

    return autoUpdater;
  }

  async function check() {
    if (!app.isPackaged) return status;
    try {
      loadAutoUpdater().checkForUpdates();
    } catch (err) {
      log('ERROR', `Update check failed: ${err && err.stack ? err.stack : err}`);
      emit({ state: 'error', percent: null, message: "Couldn't check for updates" });
    }
    return status;
  }

  function start() {
    if (!app.isPackaged) {
      log('UPDATE', 'Development build: auto-update disabled');
      return;
    }
    const first = setTimeout(check, FIRST_CHECK_DELAY_MS);
    if (first.unref) first.unref();
    timer = setInterval(check, RECHECK_INTERVAL_MS);
    if (timer.unref) timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  /**
   * Only ever reached from an explicit click. Returns false rather than throwing
   * so the caller can leave the button alone if there is nothing to install.
   */
  function install() {
    if (status.state !== 'ready' || !canSelfInstall) return false;
    stop();
    // Safe against gracefulShutdown's process.exit(0): electron-updater spawns
    // the installer detached *before* it asks the app to quit, so the hard exit
    // that follows kills only us, and the installer is already on its own.
    // isSilent false so the user sees it work; forceRunAfter so they land back
    // in the app they were already using.
    autoUpdater.quitAndInstall(false, true);
    return true;
  }

  return { start, stop, check, install, getStatus };
}

module.exports = { createUpdater };
