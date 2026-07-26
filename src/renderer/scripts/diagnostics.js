// The Dashboard's Troubleshooting card.
//
// Both buttons exist for the same reason: the overlay renders in a browser we
// don't control and can't inspect, so the only way to find out why a card looked
// wrong on someone else's PC is to have that PC tell us. The overlay posts its
// own measurements to the server (see src/overlay/scripts/selfcheck.js); these
// two buttons are how a non-technical tester gets them to us without being asked
// to find a folder or open devtools.

(function (ns) {
  'use strict';

  const CONFIRM_LABEL_MS = 1400;

  // Same pattern as the Copy URL button: the label is the whole confirmation,
  // because a toast in a window this small covers the thing you just clicked.
  function flash(button, message) {
    const original = button.dataset.label || button.textContent;
    button.dataset.label = original;
    button.textContent = message;
    setTimeout(() => { button.textContent = original; }, CONFIRM_LABEL_MS);
  }

  function init() {
    const copyBtn = document.getElementById('copyDiagBtn');
    const revealBtn = document.getElementById('revealLogBtn');

    copyBtn.addEventListener('click', async () => {
      const result = await window.tftApp.copyDiagnostics();
      // An empty log is the normal state right after a fresh install, and it is
      // worth saying so -- otherwise "Copied!" on an empty clipboard sends the
      // user off to paste nothing.
      flash(copyBtn, result.ok ? 'Copied!' : 'Nothing logged yet');
    });

    revealBtn.addEventListener('click', async () => {
      const result = await window.tftApp.revealLog();
      if (!result.ok) flash(revealBtn, 'No log file yet');
    });
  }

  ns.initDiagnostics = init;
}(window.TFTSettings = window.TFTSettings || {}));
