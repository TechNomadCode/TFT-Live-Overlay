// The Account page: read persisted settings into the form, write them back.
// Saving applies immediately -- see updateConfig in the overlay server.

(function (ns) {
  'use strict';

  const SAVE_CONFIRM_MS = 2500;
  const DEFAULT_POLL_INTERVAL_MS = 5000;

  function readForm() {
    return {
      gameName: document.getElementById('gameName').value.trim(),
      // Users paste the tag with or without the leading '#'; Riot's account
      // endpoint wants it without.
      tagLine: document.getElementById('tagLine').value.trim().replace(/^#/, ''),
      platformRoute: document.getElementById('platformRoute').value,
      riotApiKey: document.getElementById('riotApiKey').value.trim(),
      pollIntervalMs: parseInt(document.getElementById('pollInterval').value, 10),
    };
  }

  // Built from the main process' REGION_MAP rather than hardcoded here. The
  // markup used to carry its own copy of all eleven regions, which is one
  // rename away from offering a platform the server can't route.
  async function fillRegions() {
    const map = await window.tftApp.getRegionMap();
    const select = document.getElementById('platformRoute');
    select.innerHTML = '';
    for (const [platform, [, badge, fullName]] of Object.entries(map)) {
      const option = document.createElement('option');
      option.value = platform;
      option.textContent = fullName ? `${badge} — ${fullName}` : badge;
      select.append(option);
    }
  }

  async function fillForm() {
    const s = await window.tftApp.getSettings();
    document.getElementById('gameName').value = s.gameName || '';
    document.getElementById('tagLine').value = s.tagLine || '';
    document.getElementById('platformRoute').value = s.platformRoute || 'euw1';
    document.getElementById('riotApiKey').value = s.riotApiKey || '';
    document.getElementById('pollInterval').value = String(s.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS);
  }

  async function init() {
    // Regions first: setting platformRoute against an empty <select> silently
    // does nothing, and the saved region would come back as whatever landed
    // first in the list.
    await fillRegions();
    await fillForm();

    document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
      await window.tftApp.saveSettings(readForm());
      const confirmEl = document.getElementById('saveConfirm');
      confirmEl.textContent = 'Saved';
      setTimeout(() => { confirmEl.textContent = ''; }, SAVE_CONFIRM_MS);
    });
  }

  ns.initSettingsForm = init;
}(window.TFTSettings = window.TFTSettings || {}));
