// Decides whether the card animates, and is the only thing that writes the
// `reduce-motion` class the opt-out block in tokens.css hangs off.
//
// Default is full motion. That is a deliberate reversal: the opt-out used to be
// driven straight off `prefers-reduced-motion`, which on Windows is the same bit
// as "Adjust for best performance", so a machine tuned for gaming rendered a
// completely static card and looked like a broken build. See the long comment in
// tokens.css for why the OS preference is the wrong signal for a graphic that is
// rendered for an audience rather than for the operator.
//
// Runs before the first paint so the class is in place for the initial frame --
// adding it later would let one frame of animation through.

(function (ns) {
  'use strict';

  const MODES = ['full', 'reduce', 'os'];

  // `?motion=` is read here and not in index.js' applyScaleFromQuery because
  // this has to happen before anything else renders, and index.js runs last.
  function resolveMotionMode() {
    const asked = (new URLSearchParams(location.search).get('motion') || '').toLowerCase();
    return MODES.indexOf(asked) === -1 ? 'full' : asked;
  }

  function osPrefersReduced() {
    // matchMedia is present everywhere this page can load; the guard is for the
    // capture harness in docs/_gif-build, which runs it through a bare DOM.
    if (!window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function applyMotionMode() {
    const mode = resolveMotionMode();
    const reduced = mode === 'reduce' || (mode === 'os' && osPrefersReduced());
    document.documentElement.classList.toggle('reduce-motion', reduced);

    // Read back by the self-check, so a report says which of the two ways the
    // card ended up static -- asked for it, or inherited it from the machine.
    ns.motion = { mode, reduced, osPrefersReduced: osPrefersReduced() };
    return ns.motion;
  }

  ns.applyMotionMode = applyMotionMode;
  applyMotionMode();
}(window.TFTOverlay = window.TFTOverlay || {}));
