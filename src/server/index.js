// Composition root for the overlay server: wires the Riot client, the two
// trackers, mock mode, the crest proxy and the routes together, and exposes the
// small API the Electron main process drives it through.
//
// Exported as a module (rather than being a standalone binary configured by env
// vars) so the GUI can change settings live, with no restart.

const express = require('express');
const path = require('path');

const { defaultLog } = require('./logger');
const { createDiagLog } = require('./diag-log');
const { DEFAULT_POLL_INTERVAL_MS } = require('./constants');
const { createRiotClient } = require('./riot/client');
const { createCrestService } = require('./crest/crest-service');
const { createPlacementTracker } = require('./tracking/placement-tracker');
const { createTrackerState } = require('./tracking/tracker-state');
const { createRankTracker } = require('./tracking/rank-tracker');
const { createMockController } = require('./tracking/mock-controller');
const { createRankRouter } = require('./routes/rank.routes');
const { createCrestRouter } = require('./routes/crest.routes');
const { createTestRouter } = require('./routes/test.routes');
const { createDiagRouter } = require('./routes/diag.routes');

// Only for the version/platform header at the top of each log session, so a
// report tells us which build produced it. Not an Electron dependency.
const pkg = require('../../package.json');

// The overlay page and the shared modules it loads are served from source --
// there is no build step, so these are the real directories.
const OVERLAY_DIR = path.join(__dirname, '..', 'overlay');
const SHARED_DIR = path.join(__dirname, '..', 'shared');

/**
 * Creates a self-contained overlay server instance.
 * @param {object} opts
 * @param {function} opts.onStatusChange - called with the latest status object whenever it changes (for the GUI dashboard)
 * @param {function} [opts.log] - custom logger, defaults to console
 * @param {string} [opts.logDir] - directory for overlay.log; console-only if omitted.
 *   Injected rather than resolved here because src/server must not require Electron.
 */
function createOverlayServer({ onStatusChange, log, logDir } = {}) {
  const app = express();
  app.use(express.json());

  // The file sink exists whenever a directory was given, and the module-level
  // `log` every server module already takes is pointed at it -- so turning on
  // file logging changed no call site anywhere.
  const diag = createDiagLog({ dir: logDir });
  if (!log) log = diag.path ? diag.log : defaultLog;

  let config = {
    riotApiKey: '',
    gameName: '',
    tagLine: '',
    regionRoute: 'europe',
    platformRoute: 'euw1',
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  };
  const getConfig = () => config;

  let httpServer = null;

  // ---- Wiring ----
  // mock is created last because it needs the state the trackers own, while the
  // trackers only need to *ask* whether mock is on -- so that one edge is a
  // late-bound predicate rather than a circular dependency.
  let mock = null;
  const isMockMode = () => !!mock && mock.isEnabled();

  const riot = createRiotClient({ getConfig, log });
  const crests = createCrestService({ log });
  const placements = createPlacementTracker({ riot, log, isMockMode });
  const state = createTrackerState({ placements });
  const rank = createRankTracker({
    riot, state, placements, getConfig, isMockMode, log, emit: emitStatus,
  });
  mock = createMockController({ state, placements, log });

  // The retry ladder resolves placements outside any poll, so it needs its own
  // way to push the result to the dashboard.
  placements.onCatchupResolved(() => {
    state.syncPlacements();
    emitStatus();
  });

  function getStatus() {
    return {
      ...state.data,
      isMockMode: isMockMode(),
      isPolling: rank.isPolling(),
      region: config.regionLabel || '',
    };
  }

  function emitStatus() {
    if (onStatusChange) onStatusChange({ ...getStatus(), hasApiKey: !!config.riotApiKey });
  }

  // ---- Routes ----
  app.use('/api/crest', createCrestRouter({ crests }));
  app.use('/api', createRankRouter({
    getRankPayload: () => ({
      ...state.data,
      isMockMode: isMockMode(),
      region: config.regionLabel || '',
    }),
  }));
  app.use('/api/test', createTestRouter({ mock, state, emit: emitStatus }));
  app.use('/api/diag', createDiagRouter({ diag }));

  // overlay.html and its styles/scripts, plus the shared modules those scripts
  // load. The filename is part of the Browser Source URL users have already
  // configured, so it must stay `/overlay.html`.
  app.use(express.static(OVERLAY_DIR));
  app.use('/shared', express.static(SHARED_DIR));

  return {
    app,

    // Where the app's "Open log folder" button points, and how it knows whether
    // there is a file to point at.
    diagnosticsPath: diag.path,
    readDiagnostics: diag.read,

    // The resolved sink, so main-process code outside this module (the updater)
    // can write to the same file. That file exists to be sent to us when
    // something goes wrong on a machine we don't have, and "the update failed"
    // is exactly such a report.
    log,

    start(port) {
      return new Promise((resolve, reject) => {
        httpServer = app.listen(port, () => {
          diag.session({
            app: `${pkg.name} ${pkg.version}`,
            platform: `${process.platform} ${process.arch}`,
            versions: `node ${process.versions.node}`
              + (process.versions.electron ? `, electron ${process.versions.electron}` : '')
              + (process.versions.chrome ? `, chrome ${process.versions.chrome}` : ''),
          });
          log('SERVER', `Listening on http://localhost:${port}`);
          rank.start();
          resolve(port);
        });
        httpServer.on('error', reject);
      });
    },

    stop() {
      rank.stop();
      return new Promise((resolve) => {
        if (httpServer) httpServer.close(() => resolve());
        else resolve();
      });
    },

    updateConfig(newConfig) {
      // Identity == which ladder position we're tracking. Note what is NOT
      // here: the API key. A personal key expires every 24h and gets pasted in
      // mid-stream (the README tells users to do exactly that), and treating
      // that as an identity change reset the session baseline to 0 and wiped
      // the placement strip every single day. A credential rotation needs a
      // refetch, not a reset.
      //
      // platformRoute has to be in here even though regionRoute already is:
      // euw1/eun1 both route to `europe`, as do na1/br1 to `americas`, so
      // regionRoute alone misses a move to a different ladder.
      const identityChanged =
        newConfig.gameName !== config.gameName ||
        newConfig.tagLine !== config.tagLine ||
        newConfig.platformRoute !== config.platformRoute ||
        newConfig.regionRoute !== config.regionRoute;
      const keyChanged = newConfig.riotApiKey !== config.riotApiKey;
      const pollChanged = newConfig.pollIntervalMs !== config.pollIntervalMs;

      config = { ...config, ...newConfig };

      if (identityChanged) rank.resetIdentity();

      if (pollChanged && rank.isPolling()) {
        rank.start(); // restart with the new interval
      } else if (identityChanged || keyChanged) {
        rank.poll();
      }
    },

    getConfig() {
      return { ...config, riotApiKey: config.riotApiKey ? '••••••••' : '' };
    },

    getStatus,

    setMockMode(enabled) {
      mock.setEnabled(enabled);
      emitStatus();
    },
  };
}

module.exports = { createOverlayServer };
