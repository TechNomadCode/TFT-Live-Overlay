// The Settings tab: read persisted settings into the form, write them back.
// Saving applies immediately -- see updateConfig in the overlay server.

(function (ns) {
  'use strict';

  const SAVE_CONFIRM_MS = 3000;
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

  async function fillForm() {
    const s = await window.tftApp.getSettings();
    document.getElementById('gameName').value = s.gameName || '';
    document.getElementById('tagLine').value = s.tagLine || '';
    document.getElementById('platformRoute').value = s.platformRoute || 'euw1';
    document.getElementById('riotApiKey').value = s.riotApiKey || '';
    document.getElementById('pollInterval').value = String(s.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS);
  }

  async function init() {
    await fillForm();

    document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
      await window.tftApp.saveSettings(readForm());
      const confirmEl = document.getElementById('saveConfirm');
      confirmEl.textContent = 'Saved — applying immediately, no restart needed.';
      setTimeout(() => { confirmEl.textContent = ''; }, SAVE_CONFIRM_MS);
    });
  }

  ns.initSettingsForm = init;
}(window.TFTSettings = window.TFTSettings || {}));
