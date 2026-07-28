// The Support page: credit, the donate links, and the update controls.
//
// Every link here leaves the app. They're plain anchors opened with
// window.open rather than a new IPC call, because main-window.js already routes
// setWindowOpenHandler to shell.openExternal and denies in-window navigation --
// the same thing the Riot dev-portal link on Account relies on.
//
// This module also owns the Support nav pip, for the same reason status-view.js
// owns the Practice one: the module holding the data source flags its own nav
// item. Update state arrives on its own IPC channel and has nothing else to do
// with rank status.

(function (ns) {
  'use strict';

  const DONATE_URL = 'https://buymeacoffee.com/technomad';
  const REPO_URL = 'https://github.com/TechNomadCode/TFT-Live-Overlay';
  const ISSUE_URL = 'https://github.com/TechNomadCode/TFT-Live-Overlay/issues/new';
  const AUTHOR_URL = 'https://github.com/TechNomadCode';

  // get-update-status answers null until the updater exists, which happens
  // after the overlay server binds -- possibly a moment after this window
  // finished loading. One retry covers that gap without polling.
  const STATUS_RETRY_MS = 1500;

  let releasesUrl = REPO_URL + '/releases/latest';

  function el(id) { return document.getElementById(id); }

  function openExternal(url) {
    return (event) => {
      event.preventDefault();
      window.open(url);
    };
  }

  /**
   * One row of copy per state. `sub` is the second line, `dot` the status
   * colour, and the two action buttons are mutually exclusive: `install`
   * restarts in place, `download` hands off to the browser on platforms that
   * can't self-install.
   */
  function describe(status) {
    const version = status.version ? `Version ${status.version}` : 'A new version';

    switch (status.state) {
      case 'dev':
        return {
          state: 'Development build',
          sub: 'Auto-update only runs in an installed copy.',
          dot: '',
        };
      case 'checking':
        return { state: 'Checking for updates…', sub: '', dot: '' };
      case 'none':
        return { state: "You're up to date", sub: '', dot: 'ok' };
      case 'available':
        return { state: `${version} is available`, sub: 'Starting download…', dot: 'warn' };
      case 'downloading':
        return {
          state: `Downloading ${status.version ? `version ${status.version}` : 'update'}`,
          sub: typeof status.percent === 'number' ? `${status.percent}%` : '',
          dot: 'warn',
          progress: true,
        };
      case 'ready':
        return {
          state: `${version} is ready`,
          sub: 'It installs when you restart. Finish your stream first.',
          dot: 'ok',
          install: true,
        };
      // macOS: Squirrel refuses to install over an unsigned app, so the update
      // is real but has to be applied by hand. Saying "download" instead of
      // silently doing nothing is the whole point of this state.
      case 'manual':
        return {
          state: `${version} is available`,
          sub: 'macOS builds are unsigned, so this one installs by hand.',
          dot: 'warn',
          download: true,
        };
      case 'error':
        return {
          state: status.message || "Couldn't check for updates",
          sub: 'Check your connection, or download the latest build manually.',
          dot: 'error',
          download: true,
        };
      default:
        return { state: 'Not checked yet', sub: '', dot: '' };
    }
  }

  function render(status) {
    const view = describe(status);

    el('updateDot').className = 'dot' + (view.dot ? ' ' + view.dot : '');
    el('updateState').textContent = view.state;
    el('updateSub').textContent = view.sub;

    el('installUpdateBtn').style.display = view.install ? '' : 'none';
    el('downloadUpdateBtn').style.display = view.download ? '' : 'none';

    const progress = el('updateProgress');
    progress.style.display = view.progress ? '' : 'none';
    if (view.progress) {
      el('updateProgressFill').style.width = (status.percent || 0) + '%';
    }

    // Nothing to re-check while a download is in flight, and a second check
    // mid-download just confuses electron-updater's state machine.
    el('checkUpdateBtn').disabled =
      status.state === 'checking' || status.state === 'downloading' || status.state === 'dev';

    // Visible from any page, the same way practice mode is -- an update that
    // finished downloading is worth noticing before the next stream, not on the
    // next accidental visit to this page.
    el('navSupport').classList.toggle('flagged', status.state === 'ready' || status.state === 'manual');

    if (status.releasesUrl) {
      releasesUrl = status.releasesUrl;
      el('downloadUpdateBtn').href = status.releasesUrl;
    }
    if (status.currentVersion) el('aboutVersion').textContent = status.currentVersion;
  }

  async function loadStatus(allowRetry) {
    const status = await window.tftApp.getUpdateStatus();
    if (status) {
      render(status);
    } else if (allowRetry) {
      setTimeout(() => loadStatus(false), STATUS_RETRY_MS);
    }
  }

  function init() {
    el('donateSide').addEventListener('click', openExternal(DONATE_URL));
    el('donateBtn').addEventListener('click', openExternal(DONATE_URL));
    el('authorLink').addEventListener('click', openExternal(AUTHOR_URL));
    el('repoBtn').addEventListener('click', openExternal(REPO_URL));
    el('aboutRepoLink').addEventListener('click', openExternal(REPO_URL));
    el('issueBtn').addEventListener('click', openExternal(ISSUE_URL));

    // Not openExternal: this one's target changes with the payload, so it reads
    // whatever the last status set.
    el('downloadUpdateBtn').addEventListener('click', (event) => {
      event.preventDefault();
      window.open(releasesUrl);
    });

    el('checkUpdateBtn').addEventListener('click', () => window.tftApp.checkForUpdates());
    el('installUpdateBtn').addEventListener('click', () => window.tftApp.installUpdate());

    window.tftApp.getAppInfo().then((info) => {
      el('aboutVersion').textContent = info.version;
    });

    window.tftApp.onUpdateStatus(render);
    loadStatus(true);
  }

  ns.initSupport = init;
}(window.TFTSettings = window.TFTSettings || {}));
