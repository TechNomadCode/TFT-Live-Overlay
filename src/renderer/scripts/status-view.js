// Renders a status payload into the top pill, the error card and the live
// preview mini-card.
//
// No polling here -- status arrives via a push from the main process
// (onStatusUpdate) whenever it actually changes, so this window burns zero CPU
// sitting idle between updates.

(function (ns, Tiers) {
  'use strict';

  // Mirrors the overlay's strip so Settings changes stay easy to sanity-check.
  const PLACEMENT_SLOTS = 5;

  let lastCrestSlug = null;

  function renderStatusPill(status) {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    if (status.isMockMode) {
      dot.className = 'dot warn';
      text.textContent = 'Mock mode';
    } else if (status.error) {
      dot.className = 'dot error';
      text.textContent = 'Error';
    } else if (status.isPolling) {
      dot.className = 'dot ok';
      text.textContent = 'Live';
    } else {
      dot.className = 'dot';
      text.textContent = 'Stopped';
    }
  }

  function renderErrorCard(status) {
    const card = document.getElementById('errorCard');
    if (status.error) {
      card.style.display = 'block';
      document.getElementById('errorText').textContent = status.error;
    } else {
      card.style.display = 'none';
    }
  }

  function renderPlacements(list) {
    const row = document.getElementById('miniPlacements');
    if (!row) return;
    let html = '';
    for (let i = 0; i < PLACEMENT_SLOTS; i++) {
      const p = list[i];
      if (typeof p === 'number') {
        const cls = p === 1 ? 'first' : p <= 4 ? 'top4' : 'bot4';
        html += `<span class="pl ${cls}">${p}</span>`;
      } else {
        html += '<span class="pl empty">-</span>';
      }
    }
    if (row.innerHTML !== html) row.innerHTML = html;
  }

  function renderSession(status) {
    const lp = status.sessionLP || 0;
    const avg = status.sessionAvgPlacement;
    const el = document.getElementById('miniSession');
    el.textContent = `Session: ${lp >= 0 ? '+' : ''}${lp} LP` +
      (typeof avg === 'number' ? ` (avg ${avg.toFixed(1)})` : '');
    el.className = 'mini-session' + (lp > 0 ? ' positive' : lp < 0 ? ' negative' : '');
  }

  // Compare the slug rather than img.src: src reads back as a resolved absolute
  // URL, so comparing it against what we're about to build never matches and
  // re-requests the image on every status push.
  async function renderCrest(tier) {
    const slug = Tiers.slugFor(tier);
    const img = document.getElementById('miniEmblem');
    if (!slug) {
      img.style.visibility = 'hidden';
      return;
    }
    if (slug !== lastCrestSlug) {
      lastCrestSlug = slug;
      img.src = await ns.crestUrl(slug);
    }
    img.style.visibility = 'visible';
  }

  function renderPreview(status) {
    document.getElementById('miniName').textContent = status.gameName || '—';
    document.getElementById('miniTag').textContent = status.tagLine ? ' #' + status.tagLine : '';

    const region = document.getElementById('miniRegion');
    region.textContent = status.region || '';
    region.style.display = status.region ? '' : 'none';

    document.getElementById('miniTier').textContent =
      status.tier === 'UNRANKED' || !status.tier ? 'Unranked' : `${status.tier} ${status.rank || ''}`;
    document.getElementById('miniLp').textContent =
      status.tier && status.tier !== 'UNRANKED' ? `${status.leaguePoints || 0} LP` : '';

    renderPlacements(status.recentPlacements || []);
    renderSession(status);
    renderCrest(status.tier);
  }

  function applyStatus(status) {
    renderStatusPill(status);
    renderErrorCard(status);
    renderPreview(status);
    document.getElementById('mockToggle').checked = !!status.isMockMode;
  }

  function init() {
    window.tftApp.onStatusUpdate(applyStatus);
    // Also grab an initial snapshot on load, in case no change event has fired
    // yet since we opened the window.
    window.tftApp.getStatus().then(applyStatus);
  }

  ns.applyStatus = applyStatus;
  ns.initStatusView = init;
}(window.TFTSettings = window.TFTSettings || {}, window.TFT.Tiers));
