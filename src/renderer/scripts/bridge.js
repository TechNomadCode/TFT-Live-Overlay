// Thin wrapper over window.tftApp (the preload bridge) plus the one thing that
// doesn't go through IPC: HTTP calls to the local overlay server.
//
// This window is loaded from file://, so anything that addresses the server --
// the preview iframe's src, test events -- has to use the server's real origin.
// That origin only exists on the main-process side, hence the async lookup and
// the cache.

(function (ns) {
  'use strict';

  let cachedBase = null;

  async function overlayBase() {
    if (cachedBase === null) {
      const url = await window.tftApp.getOverlayUrl();
      cachedBase = url.replace(/\/overlay\.html$/, '');
    }
    return cachedBase;
  }

  /** Drives POST /api/test/event. Failures are logged, never surfaced -- a dead
   *  server is already visible in the sidebar's status readout, and the Test
   *  page can't do anything useful without one. */
  async function postTestEvent(action, payload = {}) {
    try {
      await fetch(`${await overlayBase()}/api/test/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
    } catch (err) {
      console.error('Test event failed:', err);
    }
  }

  ns.overlayBase = overlayBase;
  ns.postTestEvent = postTestEvent;
}(window.TFTSettings = window.TFTSettings || {}));
