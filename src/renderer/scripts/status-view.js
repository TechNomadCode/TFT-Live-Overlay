// Renders a status payload into the sidebar readout, the practice-mode and
// error banners, and the practice toggle.
//
// The overlay preview is deliberately not fed from here -- it's an iframe of the
// real overlay, which polls the server itself. See scripts/preview.js.
//
// No polling here either: status arrives via a push from the main process
// (onStatusUpdate) whenever it actually changes, so this window burns zero CPU
// sitting idle between updates.

(function (ns, Tiers) {
  'use strict';

  function renderStatusHead(status) {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    if (status.isMockMode) {
      dot.className = 'dot warn';
      text.textContent = 'Practice mode';
    } else if (status.error) {
      dot.className = 'dot error';
      text.textContent = 'Error';
    } else if (status.isPolling) {
      dot.className = 'dot ok';
      text.textContent = 'Live';
    } else {
      dot.className = 'dot';
      text.textContent = 'Not tracking';
    }
  }

  function renderRank(status) {
    const el = document.getElementById('statusRank');
    if (!status.tier || status.tier === 'UNRANKED') {
      // Distinguish "we have no key/ID yet" from "this account is genuinely
      // unranked" -- they need completely different things from the user.
      el.textContent = status.hasApiKey && status.gameName ? 'Unranked' : 'Not set up yet';
      return;
    }
    const name = status.tier.charAt(0) + status.tier.slice(1).toLowerCase();
    // Riot still reports a division for Master and above; the ladder has none
    // there, and the card doesn't draw one. Say the same thing the card says.
    const division = status.rank && !Tiers.isApexTier(status.tier) ? ` ${status.rank}` : '';
    el.innerHTML = '';
    el.append(`${name}${division} `);
    const lp = document.createElement('span');
    lp.className = 'lp';
    lp.textContent = `${status.leaguePoints || 0} LP`;
    el.append(lp);
  }

  function renderSession(status) {
    const el = document.getElementById('statusSession');
    const lp = status.sessionLP || 0;
    const avg = status.sessionAvgPlacement;
    const games = (status.sessionWins || 0) + (status.sessionLosses || 0);

    if (!games) {
      el.textContent = 'No games yet this session';
      return;
    }

    el.innerHTML = '';
    const delta = document.createElement('span');
    delta.className = lp > 0 ? 'gain' : lp < 0 ? 'loss' : '';
    delta.textContent = `${lp > 0 ? '+' : ''}${lp} LP`;
    el.append(delta, ` this session${typeof avg === 'number' ? ` · avg ${avg.toFixed(1)}` : ''}`);
  }

  function renderBanners(status) {
    const practice = document.getElementById('practiceBanner');
    practice.style.display = status.isMockMode ? '' : 'none';
    // Also flag the nav item, so practice mode is visible from every page --
    // the failure it prevents is going live with fake LP on screen.
    document.getElementById('navPractice').classList.toggle('flagged', !!status.isMockMode);

    const error = document.getElementById('errorBanner');
    if (status.error) {
      error.style.display = '';
      document.getElementById('errorText').textContent = status.error;
    } else {
      error.style.display = 'none';
    }
  }

  function applyStatus(status) {
    renderStatusHead(status);
    renderRank(status);
    renderSession(status);
    renderBanners(status);
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
