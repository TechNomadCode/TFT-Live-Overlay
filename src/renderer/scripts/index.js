// App window entry point. Each panel module exposes a single init, and this is
// the only place that decides they run.

(function (ns) {
  'use strict';

  ns.initNav();
  ns.initOverlayLink();
  // Before the panels that follow the selected ladder. It resolves the saved
  // mode asynchronously and then announces it, so those panels are registered
  // as listeners well before the first announcement lands either way.
  ns.initModeSwitch();
  ns.initPreview();
  ns.initDiagnostics();
  ns.initSettingsForm();
  ns.initTestPanel();
  ns.initSupport();
  ns.initStatusView();
}(window.TFTSettings = window.TFTSettings || {}));
