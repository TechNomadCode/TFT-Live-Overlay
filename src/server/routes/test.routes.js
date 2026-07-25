// POST /api/test/* — the Test tab's driver. There is no automated test suite;
// this is how every overlay code path gets exercised without waiting on a real
// match or spending API quota.

const express = require('express');

/**
 * @param {object} deps
 * @param {object} deps.mock - mock controller
 * @param {object} deps.state - tracker state
 * @param {function} deps.emit - push the current status to the host process
 */
function createTestRouter({ mock, state, emit }) {
  const router = express.Router();

  router.post('/event', (req, res) => {
    mock.applyEvent(req.body);
    emit();
    res.json({ success: true, isMockMode: mock.isEnabled(), latestData: state.data });
  });

  router.post('/toggle-mock', (req, res) => {
    mock.toggle(req.body.enable);
    emit();
    res.json({ isMockMode: mock.isEnabled() });
  });

  return router;
}

module.exports = { createTestRouter };
