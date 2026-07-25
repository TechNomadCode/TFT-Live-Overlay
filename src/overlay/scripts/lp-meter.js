// The LP figure: the rolling number and the direction marker beside it.

(function (ns) {
  'use strict';

  const ROLL_DURATION_MS = 1200;
  const TREND_VISIBLE_MS = 4000;

  let currentDisplayedLP = 0;
  let isFirstLoad = true;
  let animationFrameId = null;
  let trendTimeout = null;

  // The rolling LP figure already shows how much changed, so this only has to
  // answer which way. Replaces the old corner badge, which cost the rank row
  // 55px of permanent reserved space to display something visible for 3.5s.
  function showTrend(delta) {
    const node = ns.el('lpTrend');
    if (!node || delta === 0) return;

    clearTimeout(trendTimeout);
    node.textContent = delta > 0 ? '▲' : '▼';
    node.className = 'lp-trend show ' + (delta > 0 ? 'up' : 'down');

    trendTimeout = setTimeout(() => {
      node.className = 'lp-trend ' + (delta > 0 ? 'up' : 'down');
    }, TREND_VISIBLE_MS);
  }

  // Smooth numerical roll-up / roll-down animation, same as any normal
  // gain/loss. `delta` is only used for the trend marker (server-computed via
  // absolute LP, so it stays correctly signed across a promotion) -- it's
  // intentionally decoupled from the visible number, which just rolls between
  // whatever the old and new raw LP values are, exactly like every other LP
  // change.
  function animateLP(targetLP, delta, isNewDelta) {
    if (isFirstLoad) {
      currentDisplayedLP = targetLP;
      ns.el('lpVal').textContent = targetLP;
      isFirstLoad = false;
      return;
    }

    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    // isNewDelta guards against re-firing the marker on every poll -- the
    // server's lastDelta value persists in latestData until the next actual
    // match, so without this it would re-trigger (and its fade-out timer would
    // keep resetting) on every single poll cycle forever, making it look
    // permanently stuck instead of fading out.
    if (delta && isNewDelta) showTrend(delta);

    if (currentDisplayedLP === targetLP) return;

    const startLP = currentDisplayedLP;
    const diff = targetLP - startLP;
    const startTime = performance.now();

    function step(now) {
      const progress = Math.min((now - startTime) / ROLL_DURATION_MS, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      currentDisplayedLP = Math.round(startLP + (diff * eased));
      ns.el('lpVal').textContent = currentDisplayedLP;

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(step);
      } else {
        currentDisplayedLP = targetLP;
        ns.el('lpVal').textContent = targetLP;
        animationFrameId = null;
      }
    }

    animationFrameId = requestAnimationFrame(step);
  }

  ns.animateLP = animateLP;
  ns.showTrend = showTrend;
}(window.TFTOverlay = window.TFTOverlay || {}));
