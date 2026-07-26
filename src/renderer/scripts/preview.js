// Points the preview frame at the real overlay.
//
// Not a re-implementation: the card's look is ~950 lines of CSS keyed on classes
// the overlay's own scripts write, so anything drawn by hand here starts drifting
// the moment the overlay changes -- which is exactly what happened to the
// mini-card this replaced. The overlay polls /api/rank itself, so there is no
// data to plumb through; it shows what OBS shows, including rank-change moments.
//
// The src has to be absolute: this window is loaded over file://, where a
// relative path resolves against the filesystem rather than the local server.

(function (ns) {
  'use strict';

  async function init() {
    const frame = document.getElementById('previewFrame');
    if (!frame) return;
    // motion=full explicitly: the overlay's default is already full, but the
    // preview should never inherit a reduced-motion decision, since the point of
    // it is checking the animations viewers will see.
    frame.src = `${await ns.overlayBase()}/overlay.html?scale=1&motion=full`;
  }

  ns.initPreview = init;
}(window.TFTSettings = window.TFTSettings || {}));
