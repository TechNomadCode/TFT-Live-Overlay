// POST /api/diag — the overlay's self-check landing here from whatever browser
// is rendering it. See src/overlay/scripts/selfcheck.js for what it contains and
// why it exists; this end only has to accept it and never fail.

const express = require('express');

/**
 * @param {object} deps
 * @param {object} deps.diag - the diag log (see src/server/diag-log.js)
 */
function createDiagRouter({ diag }) {
  const router = express.Router();

  router.post('/', (req, res) => {
    // The verdict goes back in the response as well as into the log, so the
    // report is reachable from a browser's network tab without finding the file.
    res.json({ ok: true, verdict: diag.report(req.body) });
  });

  return router;
}

module.exports = { createDiagRouter };
