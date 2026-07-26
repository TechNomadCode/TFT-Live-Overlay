// The runtime log file, and the formatter that turns an overlay self-check into
// something a user can paste into a thread.
//
// Everything in src/server already takes `log` as a dependency rather than
// reaching for console, so routing those lines to a file needed no changes
// anywhere else -- this is just another sink. What is new is the second channel:
// the overlay posts its self-check to POST /api/diag and it lands in the same
// file, interleaved with the server's own lines, so one attachment covers both
// halves of the app.
//
// The directory is injected instead of resolved from app.getPath('userData')
// because nothing in src/server may depend on Electron -- that is what keeps the
// plain-node smoke test in CLAUDE.md working. With no directory (that smoke
// test) this degrades to console only.

const fs = require('fs');
const path = require('path');

const LOG_FILE = 'overlay.log';
const MAX_BYTES = 2 * 1024 * 1024;
const READ_TAIL_BYTES = 256 * 1024;

// A Riot personal key expires every 24h and gets pasted into this app
// constantly, and the whole point of this file is that users send it to other
// people. Nothing here is supposed to log a key -- this is the backstop for the
// day something does.
const KEY_PATTERN = /RGAPI-[0-9a-fA-F-]{8,}/g;

function scrub(text) {
  return String(text).replace(KEY_PATTERN, 'RGAPI-<redacted>');
}

// UTC, and marked as such. The old console logger used toLocaleTimeString, which
// is friendlier to read but ambiguous the moment a log crosses a timezone -- and
// crossing a timezone is the entire purpose of this file.
function stamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

/** Chromium version out of a UA string -- the fastest way to know whether a
 *  CSS feature could even have been supported on the reporting machine. */
function chromiumVersion(userAgent) {
  const match = /Chrom(?:e|ium)\/(\d+)/.exec(String(userAgent || ''));
  return match ? Number(match[1]) : null;
}

/**
 * The single most useful line in the file: what the report actually says went
 * wrong. Ordered by how upstream the cause is, because a missing stylesheet
 * also produces every downstream symptom.
 */
function verdict(report) {
  const anims = report.animations || {};
  const sheets = report.stylesheets || [];
  const motion = report.motion || {};
  const sheen = anims.sheen;

  const emptySheets = sheets.filter((s) => s.rules === 0);
  if (!sheets.length) return 'NO STYLESHEETS AT ALL — the page loaded but styles/*.css did not.';
  if (emptySheets.length) {
    return 'STYLESHEET DID NOT LOAD — 0 rules in: '
      + emptySheets.map((s) => s.href).join(', ')
      + '. The card cannot draw correctly, let alone animate.';
  }

  if (report.scriptErrors && report.scriptErrors.length) {
    return 'SCRIPT ERROR — ' + report.scriptErrors[0]
      + ' (a script failing part-way leaves some layers built and others not)';
  }

  if (motion.reduced) {
    return motion.mode === 'os'
      ? 'MOTION OFF, INHERITED FROM THE MACHINE — ?motion=os and this OS asks for '
        + 'reduced motion (Windows: "Show animations in Windows" off, or '
        + '"Adjust for best performance"). Drop ?motion=os from the URL.'
      : 'MOTION OFF BY REQUEST — the URL carries ?motion=reduce.';
  }

  if (!sheen || !sheen.found) return 'NO SHEEN ELEMENT — overlay.html is not the version this build ships.';
  if (sheen.animationName === 'none') {
    return 'SHEEN ANIMATION NOT APPLIED — card.css loaded but its animation is not '
      + 'on the element. Something is overriding it; not a known cause.';
  }
  if (sheen.clockAdvancedMs === null) {
    return 'CANNOT TELL — this browser has no Element.getAnimations(), so the clock '
      + 'could not be sampled. Chromium ' + (chromiumVersion(report.userAgent) || '?')
      + ' is older than this app supports.';
  }
  if (sheen.clockAdvancedMs <= 0) {
    return 'ANIMATION CLOCK IS FROZEN — the animation is applied but not advancing. '
      + 'The source is hidden or throttled (visibility: '
      + ((report.viewport || {}).visibility || '?')
      + '). In OBS check "Shutdown source when not visible" and whether the source '
      + 'is actually active in the current scene.';
  }

  if (report.card && report.card.moteCount === 0) {
    return 'SHEEN RUNS BUT THERE ARE NO PARTICLES — buildMotes() never ran or found '
      + 'no host element.';
  }
  if (report.card && /\bpending\b/.test(report.card.classes)) {
    return 'ANIMATIONS FINE, CARD NOT TRACKING — the card is in the pending state, '
      + 'which hides the particles and the tier material by design. This is a Riot '
      + 'API / settings problem, not a rendering one.';
  }
  if (report.card && !/\bt-[a-z]/.test(report.card.classes)) {
    return 'ANIMATIONS FINE, NO TIER APPLIED — no t-<tier> class on the card, so the '
      + 'per-tier material and particle recipe in materials.css never matched.';
  }

  return 'HEALTHY — animations are applied and their clocks are advancing.';
}

function formatReport(report) {
  const anims = report.animations || {};
  const motion = report.motion || {};
  const view = report.viewport || {};
  const card = report.card || {};
  const chromium = chromiumVersion(report.userAgent);
  const lines = [];

  lines.push('=== Overlay self-check (measured inside the browser rendering the overlay) ===');
  lines.push('  verdict        : ' + verdict(report));
  lines.push('  chromium       : ' + (chromium === null ? 'unknown' : chromium));
  lines.push('  user agent     : ' + report.userAgent);
  lines.push('  motion mode    : ' + motion.mode + '   reduced: ' + motion.reduced
    + '   OS asks for reduced: ' + report.osPrefersReducedMotion);
  lines.push('  viewport       : ' + view.width + 'x' + view.height
    + ' @' + view.devicePixelRatio + 'x   visibility: ' + view.visibility);
  lines.push('  gpu renderer   : ' + report.renderer);
  lines.push('  card classes   : ' + card.classes + '   motes built: ' + card.moteCount);

  lines.push('  stylesheets    :');
  (report.stylesheets || []).forEach((s) => {
    lines.push('      ' + (s.rules === 0 ? 'FAILED  ' : s.rules < 0 ? 'opaque  ' : 'ok      ')
      + String(s.rules).padStart(4, ' ') + ' rules  ' + s.href);
  });

  lines.push('  animated layers:');
  Object.keys(anims).forEach((name) => {
    const a = anims[name];
    if (!a.found) {
      lines.push('      ' + name.padEnd(10, ' ') + ' element not present');
      return;
    }
    lines.push('      ' + name.padEnd(10, ' ')
      + 'name=' + a.animationName
      + '  clock+' + a.clockAdvancedMs + 'ms'
      + '  state=' + a.playState
      + '  display=' + a.display
      + '  opacity=' + a.opacity);
  });

  const unsupported = Object.keys(report.cssSupport || {})
    .filter((k) => report.cssSupport[k] === false);
  lines.push('  css support    : ' + (unsupported.length
    ? 'MISSING → ' + unsupported.join(', ')
    : 'all probed properties supported'));

  if (report.scriptErrors && report.scriptErrors.length) {
    lines.push('  script errors  :');
    report.scriptErrors.forEach((e) => lines.push('      ' + e));
  }

  lines.push('=== end self-check ===');
  return lines.join('\n');
}

/**
 * @param {object} opts
 * @param {string} [opts.dir] - where to write overlay.log; console-only if omitted
 */
function createDiagLog({ dir } = {}) {
  let filePath = null;

  if (dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      filePath = path.join(dir, LOG_FILE);
      // One generation of history, rotated at startup rather than per write --
      // a stream runs for hours and the interesting lines are usually the last
      // ones, but the previous session is often what the user meant to send.
      const stats = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
      if (stats && stats.size > MAX_BYTES) fs.renameSync(filePath, filePath + '.1');
    } catch (err) {
      // A log file that cannot be created must not stop the overlay serving.
      console.log(`[DIAG] Could not open log directory ${dir}: ${err.message}`);
      filePath = null;
    }
  }

  function write(text) {
    if (!filePath) return;
    try {
      fs.appendFileSync(filePath, scrub(text) + '\n', 'utf8');
    } catch (err) { /* already reported at startup; don't spam per line */ }
  }

  function log(level, message) {
    const line = `[${stamp()}] [${String(level).padEnd(9, ' ')}] ${message}`;
    console.log(scrub(line));
    write(line);
  }

  return {
    path: filePath,
    log,

    session(header) {
      write('');
      write('#'.repeat(72));
      write(`# session started ${stamp()}`);
      Object.keys(header || {}).forEach((k) => write(`# ${k}: ${header[k]}`));
      write('#'.repeat(72));
    },

    report(payload) {
      const text = formatReport(payload || {});
      console.log(scrub(text));
      write(`[${stamp()}] [SELFCHECK]`);
      write(text);
      // Scrubbed on the way out too: a verdict can quote a script error, and a
      // script error can quote anything.
      return scrub(verdict(payload || {}));
    },

    /** Tail of the file, for the app's "Copy diagnostics" button. */
    read() {
      if (!filePath || !fs.existsSync(filePath)) return '';
      try {
        const size = fs.statSync(filePath).size;
        const start = Math.max(0, size - READ_TAIL_BYTES);
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        fs.closeSync(fd);
        return buf.toString('utf8');
      } catch (err) {
        return `Could not read ${filePath}: ${err.message}`;
      }
    },
  };
}

module.exports = { createDiagLog, formatReport, verdict, chromiumVersion, scrub };
