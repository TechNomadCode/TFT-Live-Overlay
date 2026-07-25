// The Test tab. There is no automated test suite; this panel plus
// POST /api/test/* is how overlay code paths get exercised without waiting on a
// real match or spending API quota.

(function (ns) {
  'use strict';

  function forceMockToggleOn() {
    // Any simulated event switches the server into mock mode server-side, so
    // reflect that here rather than leaving the toggle lying about the state.
    document.getElementById('mockToggle').checked = true;
  }

  function init() {
    document.querySelectorAll('.btn[data-lp]').forEach((btn) => {
      btn.addEventListener('click', () => {
        ns.postTestEvent('lp_change', {
          lpChange: parseInt(btn.dataset.lp, 10),
          placement: parseInt(btn.dataset.placement, 10),
        });
        forceMockToggleOn();
      });
    });

    document.getElementById('applyRankBtn').addEventListener('click', () => {
      ns.postTestEvent('set_rank', {
        newTier: document.getElementById('testTier').value,
        newRank: document.getElementById('testRank').value,
      });
      forceMockToggleOn();
    });

    document.getElementById('triggerErrorBtn').addEventListener('click', () => {
      ns.postTestEvent('error', { errorMsg: 'Simulated error from Test panel' });
    });
    document.getElementById('clearErrorBtn').addEventListener('click', () => ns.postTestEvent('reset_error'));
    document.getElementById('resetSessionBtn').addEventListener('click', () => ns.postTestEvent('reset_session'));

    document.getElementById('mockToggle').addEventListener('change', (e) => {
      window.tftApp.setMockMode(e.target.checked);
    });
  }

  ns.initTestPanel = init;
}(window.TFTSettings = window.TFTSettings || {}));
