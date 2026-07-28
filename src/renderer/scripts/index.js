// App window entry point. Each panel module exposes a single init, and this is
// the only place that decides they run.

(function (ns) {
  'use strict';

  ns.initNav();
  ns.initOverlayLink();
  ns.initPreview();
  ns.initDiagnostics();
  ns.initSettingsForm();
  ns.initTestPanel();
  ns.initSupport();
  ns.initStatusView();
}(window.TFTSettings = window.TFTSettings || {}));
