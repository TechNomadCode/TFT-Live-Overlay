// GET /api/rank — what the overlay page polls every 2.5s.

const express = require('express');

/**
 * @param {object} deps
 * @param {function} deps.getRankPayload - the full overlay payload
 */
function createRankRouter({ getRankPayload }) {
  const router = express.Router();

  router.get('/rank', (req, res) => {
    res.json(getRankPayload());
  });

  return router;
}

module.exports = { createRankRouter };
