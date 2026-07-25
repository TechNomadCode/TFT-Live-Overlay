// Settings window entry point. Each panel module exposes a single init, and
// this is the only place that decides they run.

(function (ns) {
  'use strict';

  ns.initTabs();
  ns.initOverlayLink();
  ns.initSettingsForm();
  ns.initTestPanel();
  ns.initStatusView();
}(window.TFTSettings = window.TFTSettings || {}));
