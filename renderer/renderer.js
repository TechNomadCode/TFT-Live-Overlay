// No polling here -- status arrives via a push from the main process
// (onStatusUpdate) whenever it actually changes, so this window burns
// zero CPU sitting idle between updates.

const CREST_ORIGIN = ''; // same-origin relative path, server runs on the same port

// ---- Tabs ----
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ---- Overlay URL ----
async function initOverlayUrl() {
  const url = await window.tftApp.getOverlayUrl();
  document.getElementById('overlayUrl').textContent = url;
}
initOverlayUrl();

document.getElementById('copyUrlBtn').addEventListener('click', async () => {
  await window.tftApp.copyOverlayUrl();
  const btn = document.getElementById('copyUrlBtn');
  const original = btn.textContent;
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = original; }, 1200);
});

document.getElementById('openBrowserBtn').addEventListener('click', () => {
  window.tftApp.openOverlayInBrowser();
});

document.getElementById('devPortalLink').addEventListener('click', (e) => {
  e.preventDefault();
  window.open('https://developer.riotgames.com/', '_blank');
});

// ---- Settings ----
async function loadSettingsIntoForm() {
  const s = await window.tftApp.getSettings();
  document.getElementById('gameName').value = s.gameName || '';
  document.getElementById('tagLine').value = s.tagLine || '';
  document.getElementById('platformRoute').value = s.platformRoute || 'euw1';
  document.getElementById('riotApiKey').value = s.riotApiKey || '';
  document.getElementById('pollInterval').value = String(s.pollIntervalMs || 15000);
}
loadSettingsIntoForm();

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  const settings = {
    gameName: document.getElementById('gameName').value.trim(),
    tagLine: document.getElementById('tagLine').value.trim().replace(/^#/, ''),
    platformRoute: document.getElementById('platformRoute').value,
    riotApiKey: document.getElementById('riotApiKey').value.trim(),
    pollIntervalMs: parseInt(document.getElementById('pollInterval').value, 10),
  };
  await window.tftApp.saveSettings(settings);
  const el = document.getElementById('saveConfirm');
  el.textContent = 'Saved — applying immediately, no restart needed.';
  setTimeout(() => { el.textContent = ''; }, 3000);
});

// ---- Test panel ----
async function sendTestEvent(action, payload = {}) {
  const url = await window.tftApp.getOverlayUrl();
  const base = url.replace(/\/overlay\.html$/, '');
  try {
    await fetch(`${base}/api/test/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch (err) {
    console.error('Test event failed:', err);
  }
}

document.querySelectorAll('.btn[data-lp]').forEach((btn) => {
  btn.addEventListener('click', () => {
    sendTestEvent('lp_change', {
      lpChange: parseInt(btn.dataset.lp, 10),
      placement: parseInt(btn.dataset.placement, 10),
    });
    document.getElementById('mockToggle').checked = true;
  });
});

document.getElementById('applyRankBtn').addEventListener('click', () => {
  sendTestEvent('set_rank', {
    newTier: document.getElementById('testTier').value,
    newRank: document.getElementById('testRank').value,
  });
  document.getElementById('mockToggle').checked = true;
});

document.getElementById('triggerErrorBtn').addEventListener('click', () => {
  sendTestEvent('error', { errorMsg: 'Simulated error from Test panel' });
});
document.getElementById('clearErrorBtn').addEventListener('click', () => sendTestEvent('reset_error'));
document.getElementById('resetSessionBtn').addEventListener('click', () => sendTestEvent('reset_session'));

document.getElementById('mockToggle').addEventListener('change', (e) => {
  window.tftApp.setMockMode(e.target.checked);
});

// ---- Live status (pushed from main process) ----
const TIER_FILE = {
  IRON: 'iron', BRONZE: 'bronze', SILVER: 'silver', GOLD: 'gold',
  PLATINUM: 'platinum', EMERALD: 'emerald', DIAMOND: 'diamond',
  MASTER: 'master', GRANDMASTER: 'grandmaster', CHALLENGER: 'challenger',
};

// Mirrors the overlay's strip so Settings changes stay easy to sanity-check.
const MINI_PLACEMENT_SLOTS = 5;
function renderMiniPlacements(list) {
  const el = document.getElementById('miniPlacements');
  if (!el) return;
  let html = '';
  for (let i = 0; i < MINI_PLACEMENT_SLOTS; i++) {
    const p = list[i];
    if (typeof p === 'number') {
      const cls = p === 1 ? 'first' : p <= 4 ? 'top4' : 'bot4';
      html += `<span class="pl ${cls}">${p}</span>`;
    } else {
      html += '<span class="pl empty">-</span>';
    }
  }
  if (el.innerHTML !== html) el.innerHTML = html;
}

function applyStatus(status) {
  // Top status pill
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

  // Error card
  const errorCard = document.getElementById('errorCard');
  if (status.error) {
    errorCard.style.display = 'block';
    document.getElementById('errorText').textContent = status.error;
  } else {
    errorCard.style.display = 'none';
  }

  // Mini preview card
  document.getElementById('miniName').textContent = status.gameName || '—';
  document.getElementById('miniTag').textContent = status.tagLine ? ' #' + status.tagLine : '';
  const miniRegion = document.getElementById('miniRegion');
  miniRegion.textContent = status.region || '';
  miniRegion.style.display = status.region ? '' : 'none';
  document.getElementById('miniTier').textContent =
    status.tier === 'UNRANKED' || !status.tier ? 'Unranked' : `${status.tier} ${status.rank || ''}`;
  document.getElementById('miniLp').textContent =
    status.tier && status.tier !== 'UNRANKED' ? `${status.leaguePoints || 0} LP` : '';
  renderMiniPlacements(status.recentPlacements || []);

  const sessLP = status.sessionLP || 0;
  const sessSign = sessLP >= 0 ? '+' : '';
  const sessionEl = document.getElementById('miniSession');
  const avg = status.sessionAvgPlacement;
  sessionEl.textContent = `Session: ${sessSign}${sessLP} LP` +
    (typeof avg === 'number' ? ` (avg ${avg.toFixed(1)})` : '');
  sessionEl.className = 'mini-session' + (sessLP > 0 ? ' positive' : sessLP < 0 ? ' negative' : '');

  const crestFile = TIER_FILE[status.tier];
  const emblemImg = document.getElementById('miniEmblem');
  if (crestFile) {
    const newSrc = `${CREST_ORIGIN}/api/crest/${crestFile}`;
    if (emblemImg.src !== window.location.origin + newSrc && !emblemImg.src.endsWith(newSrc)) {
      // The renderer loads from file://, so crest images must be fetched
      // from the local server's actual origin, not relative to this page.
      window.tftApp.getOverlayUrl().then((url) => {
        const base = url.replace(/\/overlay\.html$/, '');
        emblemImg.src = `${base}/api/crest/${crestFile}`;
      });
    }
    emblemImg.style.visibility = 'visible';
  } else {
    emblemImg.style.visibility = 'hidden';
  }

  document.getElementById('mockToggle').checked = !!status.isMockMode;
}

window.tftApp.onStatusUpdate(applyStatus);

// Also grab an initial snapshot on load (in case no change event has
// fired yet since we opened the window)
window.tftApp.getStatus().then(applyStatus);