// The Practice page. There is no automated test suite; this panel plus
// POST /api/test/* is how overlay code paths get exercised without waiting on a
// real match or spending API quota.

(function (ns, Tiers) {
  'use strict';

  function forceMockToggleOn() {
    // Any simulated event switches the server into mock mode server-side, so
    // reflect that here rather than leaving the toggle lying about the state.
    document.getElementById('mockToggle').checked = true;
  }

  // Master, Grandmaster and Challenger are one flat pool -- there is no
  // Grandmaster II to pick. Riot's league entries do carry a fixed rank: "I"
  // for all three, but it means nothing: getAbsoluteLP ignores it for apex
  // tiers, and the card prints the tier name alone.
  function syncDivisionAvailability() {
    const apex = Tiers.isApexTier(document.getElementById('testTier').value);
    const division = document.getElementById('testRank');
    division.disabled = apex;
    division.title = apex ? 'This tier has no divisions' : '';
  }

  function init() {
    const tierSelect = document.getElementById('testTier');
    tierSelect.addEventListener('change', syncDivisionAvailability);
    syncDivisionAvailability();

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
      const newTier = tierSelect.value;
      ns.postTestEvent('set_rank', {
        newTier,
        // '' rather than the disabled select's leftover value -- that's what
        // applyLPChange writes when a simulated win promotes Diamond I into
        // Master, so arriving at an apex tier either way leaves identical state.
        newRank: Tiers.isApexTier(newTier) ? '' : document.getElementById('testRank').value,
      });
      forceMockToggleOn();
    });

    document.getElementById('triggerErrorBtn').addEventListener('click', () => {
      ns.postTestEvent('error', { errorMsg: 'Example error, triggered from the Practice page.' });
    });
    document.getElementById('clearErrorBtn').addEventListener('click', () => ns.postTestEvent('reset_error'));
    document.getElementById('resetSessionBtn').addEventListener('click', () => ns.postTestEvent('reset_session'));

    document.getElementById('mockToggle').addEventListener('change', (e) => {
      window.tftApp.setMockMode(e.target.checked);
    });

    // The banner on the Overlay page is the one place practice mode is visible
    // without navigating to it, so it gets its own way out.
    document.getElementById('practiceOffBtn').addEventListener('click', () => {
      window.tftApp.setMockMode(false);
      document.getElementById('mockToggle').checked = false;
    });
  }

  ns.initTestPanel = init;
}(window.TFTSettings = window.TFTSettings || {}, window.TFT.Tiers));
