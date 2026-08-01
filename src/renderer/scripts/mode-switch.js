// The ladder switch on the Overlay page, and the one place the app window knows
// which ladder is selected.
//
// This lives on the Overlay page rather than Account because it isn't a change
// to *what* is tracked -- the server polls both ladders from a single league
// call regardless. It only selects which one the card draws, which makes it a
// display choice, and puts it next to the preview that reflects it.
//
// Saving goes through the same save-settings channel as the Account form. That
// handler merges rather than replaces, so writing this one key can't drop the
// Riot ID, and the Account form's save can't drop this.

(function (ns, Modes) {
  'use strict';

  let current = Modes.RANKED;
  const listeners = [];

  function gameMode() { return current; }

  /** Panels that need to follow the selection register here (see test-panel). */
  function onModeChange(cb) { listeners.push(cb); }

  function announce() {
    listeners.forEach((cb) => cb(current));
  }

  async function init() {
    const select = document.getElementById('gameMode');
    if (!select) return;

    const settings = await window.tftApp.getSettings();
    current = Modes.coerceMode(settings.gameMode);
    select.value = current;
    announce();

    select.addEventListener('change', async () => {
      current = Modes.coerceMode(select.value);
      await window.tftApp.saveSettings({ gameMode: current });
      // No refetch to wait on: both ladders are already tracked, so the server
      // serves the other one immediately and the preview iframe picks it up on
      // its own next poll.
      announce();
    });
  }

  ns.initModeSwitch = init;
  ns.gameMode = gameMode;
  ns.onModeChange = onModeChange;
}(window.TFTSettings = window.TFTSettings || {}, window.TFT.Modes));
