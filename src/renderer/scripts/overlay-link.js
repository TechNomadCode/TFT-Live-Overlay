// The Overlay page card that hands the user their Browser Source URL.

(function (ns) {
  'use strict';

  const COPIED_LABEL_MS = 1200;

  async function init() {
    document.getElementById('overlayUrl').textContent = await window.tftApp.getOverlayUrl();

    const copyBtn = document.getElementById('copyUrlBtn');
    copyBtn.addEventListener('click', async () => {
      await window.tftApp.copyOverlayUrl();
      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = original; }, COPIED_LABEL_MS);
    });

    document.getElementById('openBrowserBtn').addEventListener('click', () => {
      window.tftApp.openOverlayInBrowser();
    });

    // Opened through the main process' window-open handler, which routes it to
    // the real browser -- never into this window.
    document.getElementById('devPortalLink').addEventListener('click', (e) => {
      e.preventDefault();
      window.open('https://developer.riotgames.com/', '_blank');
    });
  }

  ns.initOverlayLink = init;
}(window.TFTSettings = window.TFTSettings || {}));
