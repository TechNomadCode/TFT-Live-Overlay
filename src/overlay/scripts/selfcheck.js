// What the overlay can observe about its own environment, posted back to the
// app so it lands in a log file the user can send on.
//
// This exists because the overlay is the one part of this app that runs where we
// have no visibility at all. OBS and Streamlabs render it in their own bundled
// CEF with no devtools and no console, and even in a plain browser the person
// seeing the problem is not the person who can read a stack trace. The first
// report of "the sheen and the particles aren't there" came off a machine we
// could not inspect and produced no evidence whatsoever.
//
// Three causes look identical on screen -- a card that draws but never moves --
// and have completely different fixes, so the report is built to separate them:
//
//   1. The stylesheets never arrived.   -> a sheet reporting rules: 0.
//   2. Motion is switched off.          -> motion.reduced, and every
//                                          animation-name computing to 'none'.
//   3. The animations are declared but  -> the correct animation-name and a
//      their clock is not running.         clock that does not advance, which
//                                          is what a hidden or throttled
//                                          Browser Source looks like.
//
// Sampling the sheen's transform would NOT separate 2 from 3: its keyframes park
// it at the start position for ~89% of the cycle, so two samples 250ms apart are
// identical even when it is working perfectly (see the note in card.css). An
// animation's currentTime keeps advancing through that hold, so the clock is
// what gets sampled.
//
// Loaded first of all the overlay scripts, and self-scheduling rather than
// waiting for index.js to call it, because the failure that most needs reporting
// is a script blowing up before index.js ever runs.

(function (ns) {
  'use strict';

  // Long enough for the first /api/rank poll to have landed a tier class, so
  // the report describes the card the user is actually looking at rather than
  // the pending state every load passes through.
  const REPORT_DELAY_MS = 4000;
  const CLOCK_SAMPLE_MS = 250;

  // Every continuously animated layer on the card. `motes b` covers the
  // particles; the per-tier recipes in materials.css only ever change which
  // keyframes it runs, so one sample is enough to tell whether the field moves.
  const ANIMATED = [
    ['sheen', '.sheen i'],
    ['motes', '.motes b'],
    ['blade', '.blade i'],
    ['waitPulse', '.wait-line .pulse'],
  ];

  const scriptErrors = [];

  // Installed at script-evaluation time, not from an init call, so it is already
  // listening while the remaining <script> tags execute.
  window.addEventListener('error', (e) => {
    scriptErrors.push(e.message + (e.filename ? ` (${e.filename}:${e.lineno})` : ''));
  });
  window.addEventListener('unhandledrejection', (e) => {
    scriptErrors.push('unhandled rejection: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason)));
  });

  // A stylesheet that 404s still appears in document.styleSheets, with zero
  // rules -- which is the only way to tell "did not load" from "loaded and the
  // rule simply does not match".
  function stylesheetReport() {
    return Array.prototype.map.call(document.styleSheets, (sheet) => {
      let rules = -1;
      try {
        rules = sheet.cssRules.length;
      } catch (err) {
        rules = -1; // cross-origin, or blocked
      }
      return { href: String(sheet.href || 'inline').replace(location.origin, ''), rules };
    });
  }

  // Not a general feature sweep -- only the properties this page actually
  // depends on, each with a Chromium baseline recent enough that an old CEF
  // could plausibly be missing it.
  function cssSupportReport() {
    if (!window.CSS || !CSS.supports) return { supportsUnavailable: true };
    return {
      inset: CSS.supports('inset', '0px'),
      flexGap: CSS.supports('gap', '12px'),
      maskImage: CSS.supports('mask-image', 'linear-gradient(90deg, #000, transparent)'),
      webkitMaskImage: CSS.supports('-webkit-mask-image', 'linear-gradient(90deg, #000, transparent)'),
      filterBlur: CSS.supports('filter', 'blur(2px)'),
      zoom: CSS.supports('zoom', '1.5'),
    };
  }

  function clockOf(el) {
    if (!el || !el.getAnimations) return null;
    const anims = el.getAnimations();
    if (!anims.length) return null;
    return { playState: anims[0].playState, currentTime: Number(anims[0].currentTime) };
  }

  function sampleClocks() {
    const out = {};
    ANIMATED.forEach((probe) => {
      out[probe[0]] = clockOf(document.querySelector(probe[1]));
    });
    return out;
  }

  function animationReport(before, after) {
    const out = {};
    ANIMATED.forEach((probe) => {
      const name = probe[0];
      const el = document.querySelector(probe[1]);
      if (!el) {
        out[name] = { found: false };
        return;
      }
      const cs = getComputedStyle(el);
      const b = before[name];
      const a = after[name];
      out[name] = {
        found: true,
        display: cs.display,
        opacity: cs.opacity,
        animationName: cs.animationName,
        animationDuration: cs.animationDuration,
        animationPlayState: cs.animationPlayState,
        playState: a ? a.playState : 'no-animation-object',
        // The load-bearing number: > 0 means the animation clock is running,
        // whatever the card happens to look like at this instant.
        clockAdvancedMs: b && a ? Math.round(a.currentTime - b.currentTime) : null,
      };
    });
    return out;
  }

  // SwiftShader here means the host is compositing in software -- OBS's
  // "Enable Browser Source Hardware Acceleration" being off, or a machine with
  // no usable GPU. It does not stop animations, but it changes what "the blur
  // looks wrong" means, so it is worth having in the same report.
  function rendererReport() {
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return 'no webgl context';
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unavailable';
      // Hand the context straight back; this page has no other use for one.
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return String(name);
    } catch (err) {
      return 'error: ' + err.message;
    }
  }

  function buildReport(before, after) {
    const card = document.getElementById('card');
    const motes = document.getElementById('motes');
    return {
      at: new Date().toISOString(),
      userAgent: navigator.userAgent,
      motion: ns.motion || { mode: 'unknown', reduced: null },
      // Kept even though motion.js already records it: this is the value that
      // used to decide the whole thing, and a report from an older build in the
      // wild is still worth being able to read.
      osPrefersReducedMotion: !!(window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        visibility: document.visibilityState,
      },
      renderer: rendererReport(),
      stylesheets: stylesheetReport(),
      cssSupport: cssSupportReport(),
      card: {
        classes: card ? card.className : '(no #card)',
        moteCount: motes ? motes.childElementCount : -1,
      },
      animations: animationReport(before, after),
      scriptErrors: scriptErrors.slice(),
    };
  }

  function send(report) {
    // Deliberately fire-and-forget: a diagnostic that can break the overlay is
    // worse than no diagnostic.
    try {
      fetch('/api/diag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      }).catch(() => {});
    } catch (err) { /* nothing useful to do here */ }
  }

  function report() {
    const before = sampleClocks();
    setTimeout(() => send(buildReport(before, sampleClocks())), CLOCK_SAMPLE_MS);
  }

  ns.report = report;
  setTimeout(report, REPORT_DELAY_MS);
}(window.TFTOverlay = window.TFTOverlay || {}));
