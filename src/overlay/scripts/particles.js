// The ambient particle field.
//
// Built once at startup and never rebuilt. Position, size, duration, delay and
// travel are baked into CSS custom properties per element, so a rank change is
// a class swap on the card -- materials.css decides what these elements look
// like and how they move for the current tier, and the DOM never has to be
// touched again. Challenger hides the layer outright rather than restyling it.
//
// The values are generated from the index rather than Math.random() so the
// field is identical on every load: a stream that reloads the Browser Source
// mid-session shouldn't visibly reshuffle.

(function (ns) {
  'use strict';

  const MOTE_COUNT = 20;

  function buildMotes() {
    const host = ns.el('motes');
    // Idempotent -- a second call would double the field.
    if (!host || host.childElementCount) return;

    let html = '';
    for (let i = 0; i < MOTE_COUNT; i++) {
      const x = Math.round(((i * 37) % 100) * 0.94) + 2;
      const size = [2, 3, 2, 4, 3][i % 5];
      const dur = 7 + ((i * 3) % 6);
      const delay = ((i * 1.7) % 9).toFixed(1);
      const dx = ((i % 5) - 2) * 7;
      const rise = 70 + ((i * 11) % 40);
      html += '<b style="' +
        `--x:${x}%;--s:${size}px;--dur:${dur}s;--d:${delay}s;--dx:${dx}px;--rise:${rise}px` +
        '"></b>';
    }
    host.innerHTML = html;
  }

  ns.buildMotes = buildMotes;
}(window.TFTOverlay = window.TFTOverlay || {}));
