// Core overlay server logic, packaged as a reusable module.
// The Electron main process owns one instance of this and drives it from
// the GUI (start/stop, live settings changes) instead of env vars + restarts.

const express = require('express');
const path = require('path');
const sharp = require('sharp');

const CREST_SOURCE_BASE =
  'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-';
const VALID_TIERS = new Set([
  'iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald',
  'diamond', 'master', 'grandmaster', 'challenger'
]);

// Tiers below Master run 4 divisions x 100 LP = 400 LP per tier.
// 7 tiers below Master (Iron..Diamond) x 400 = 2800, which lines up
// exactly with Master's base. Master/Grandmaster/Challenger share that
// same base because they're NOT separate LP bands -- Grandmaster and
// Challenger are population-capped labels applied to the same continuous
// Master LP pool (Riot requires 200+ LP for GM, 500+ LP for Challenger,
// on top of a top-N-players cutoff -- not an LP offset). Verified against
// Set 17 (2026) ranked docs.
const TIER_BASE = {
  IRON: 0, BRONZE: 400, SILVER: 800, GOLD: 1200,
  PLATINUM: 1600, EMERALD: 2000, DIAMOND: 2400,
  MASTER: 2800, GRANDMASTER: 2800, CHALLENGER: 2800
};
const RANK_BASE = { IV: 0, III: 100, II: 200, I: 300 };

// tft-match-v1's ids endpoint has no queue filter (unlike LoL's match-v5), so
// ranked matches are filtered client-side on queue_id. 1100 = RANKED_TFT;
// 1090 is normal, 1130 Hyper Roll, 1160 Double Up -- those must not pollute
// the placement strip, since the league entry we track is ranked-only.
const RANKED_TFT_QUEUE_ID = 1100;
const PLACEMENT_HISTORY_SIZE = 5;
// Hard ceiling on match lookups per cycle so a long absence (or a burst of
// games between polls) can never spike request count against the key budget.
const MAX_MATCH_LOOKUPS_PER_CYCLE = 5;
const MATCH_ID_MEMORY = 40;
// The league entry (LP/rank) updates almost immediately after a game, but the
// match document is indexed by a separate system that lags behind it. So the
// moment we detect a finished match, its placement often isn't queryable yet.
// Without a retry the placement is only picked up when the NEXT game ends,
// leaving the strip permanently one match behind. These are the retry delays.
const PLACEMENT_CATCHUP_DELAYS_MS = [5000, 15000, 30000, 60000, 120000, 240000];

function getAbsoluteLP(tier, rank, lp) {
  if (!tier || tier === 'UNRANKED') return 0;
  const baseTier = TIER_BASE[tier] || 0;
  const baseRank = (tier === 'MASTER' || tier === 'GRANDMASTER' || tier === 'CHALLENGER')
    ? 0 : (RANK_BASE[rank] || 0);
  return baseTier + baseRank + (lp || 0);
}

const TIER_ORDER = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
const RANK_ORDER = ['IV', 'III', 'II', 'I'];
// Riot does not carry negative LP across a demotion boundary -- dropping below
// 0 LP places you in the division below at a fixed LP value. So a single loss
// can only ever cost you one division, no matter how large it was.
const DEMOTION_LANDING_LP = 75;

// Applies an LP delta the way a real match result would: rolling a
// division on +/-100 LP, rolling a tier once a division rolls past
// IV/I, and handling the two special boundaries -- Diamond I promotes
// into Master with no division at all, and Master demotes back to
// Diamond I on dropping below 0 LP.
//
// Demotion crosses tiers, matching Riot: Gold IV at 0 LP losing LP drops to
// Silver I, it does NOT floor at Gold IV. Only Iron IV floors, because there
// is nothing below it. This function is mock-mode only (the live path reads
// real tier/rank straight from Riot), so its whole job is fidelity -- and
// without cross-tier demotion the overlay's derank rendering could never be
// exercised before it happened live on stream.
//
// NOT modelled: demotion shield, the few games of protection you get right
// after promoting into a new tier. That depends on games-played-since-
// promotion, which mock mode doesn't track, so mock deranks slightly more
// eagerly than live will.
//
// Grandmaster/Challenger aren't auto-promoted/demoted here since that's
// gated by server population, not LP alone -- those stay a manual choice
// via "Simulate Rank".
function applyLPChange(tier, rank, lp, delta) {
  if (!tier || tier === 'UNRANKED') {
    tier = 'IRON';
    rank = 'IV';
    lp = 0;
  }

  if (tier === 'MASTER' || tier === 'GRANDMASTER' || tier === 'CHALLENGER') {
    const newLp = lp + delta;
    if (newLp < 0) {
      // Only Master itself demotes to Diamond I on Riot's actual rules;
      // GM/Challenger dropping below their population cutoff demotes to
      // Master, not Diamond -- but we can't simulate population cutoffs
      // in mock mode, so treat all three the same way here.
      return { tier: 'DIAMOND', rank: 'I', lp: DEMOTION_LANDING_LP };
    }
    return { tier, rank, lp: newLp };
  }

  let tierIdx = TIER_ORDER.indexOf(tier);
  let rankIdx = RANK_ORDER.indexOf(rank);
  if (tierIdx === -1) tierIdx = 0;
  if (rankIdx === -1) rankIdx = 0;
  let newLp = lp + delta;

  while (newLp >= 100) {
    newLp -= 100;
    if (rankIdx < 3) {
      rankIdx += 1;
    } else if (tierIdx < TIER_ORDER.length - 1) {
      tierIdx += 1;
      rankIdx = 0;
    } else {
      return { tier: 'MASTER', rank: '', lp: newLp }; // Diamond I -> Master
    }
  }
  // Single step, not a loop: the landing LP is fixed, so one result can only
  // ever drop you one division.
  if (newLp < 0) {
    if (rankIdx > 0) {
      rankIdx -= 1;                     // Gold II -> Gold III
      newLp = DEMOTION_LANDING_LP;
    } else if (tierIdx > 0) {
      tierIdx -= 1;                     // Gold IV -> Silver I
      rankIdx = RANK_ORDER.length - 1;
      newLp = DEMOTION_LANDING_LP;
    } else {
      newLp = 0;                        // Iron IV -- nothing below it
    }
  }

  return { tier: TIER_ORDER[tierIdx], rank: RANK_ORDER[rankIdx], lp: newLp };
}

// Progress toward the next TIER, for the overlay's goal bar. Deliberately
// per-tier and not per-division: "153 LP to PLATINUM" is a milestone a viewer
// can follow across a whole stream, where "53 to Gold I" resets every other
// game and reads as noise.
//
// Null at Master and above. GM and Challenger are population-gated, not LP
// thresholds, so there is no fixed number to count down to -- see TIER_BASE.
function getTierProgress(tier, rank, lp) {
  const idx = TIER_ORDER.indexOf(tier);
  if (idx === -1) return { lpToNextTier: null, nextTierName: null, tierProgressPct: null };

  const abs = getAbsoluteLP(tier, rank, lp);
  const currentBase = TIER_BASE[tier];
  // TIER_ORDER stops at Diamond, so the tier above the last entry is Master.
  const nextTierName = idx < TIER_ORDER.length - 1 ? TIER_ORDER[idx + 1] : 'MASTER';
  const span = TIER_BASE[nextTierName] - currentBase;

  return {
    lpToNextTier: Math.max(0, TIER_BASE[nextTierName] - abs),
    nextTierName,
    tierProgressPct: Math.max(0, Math.min(100, ((abs - currentBase) / span) * 100)),
  };
}

function defaultLog(level, message) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] [${level.padEnd(8, ' ')}] ${message}`);
}

/**
 * Creates a self-contained overlay server instance.
 * @param {object} opts
 * @param {function} opts.onStatusChange - called with the latest status object whenever it changes (for the GUI dashboard)
 * @param {function} [opts.log] - custom logger, defaults to console
 */
function createOverlayServer({ onStatusChange, log = defaultLog } = {}) {
  const app = express();
  app.use(express.json());

  let config = {
    riotApiKey: '',
    gameName: '',
    tagLine: '',
    regionRoute: 'europe',
    platformRoute: 'euw1',
    pollIntervalMs: 5000,
  };

  let puuid = null;
  let initialSessionStats = null;
  let isMockMode = false;
  let consecutiveFailures = 0;
  let pollTimer = null;
  let httpServer = null;
  // Tracks the previous poll's absolute LP + match count so we can compute
  // "how much did this match actually change" using absolute LP rather
  // than the raw displayed within-division LP. That distinction matters
  // because a promotion resets the displayed LP to a low number (e.g.
  // Diamond IV 90 -> Diamond III 28) even on a WIN -- diffing the raw
  // display value alone would show that as a misleading LP loss.
  let previousAbsLP = null;
  let previousMatchesPlayed = null;
  let deltaSeq = 0; // increments only on a genuine new delta event
  // Placement history. recentPlacements is newest-first and drives the overlay
  // strip; sessionPlacements holds only matches observed *after* the session
  // baseline locked, so the session average never counts games from before
  // you started streaming. knownMatchIds dedupes so each match is fetched once.
  let recentPlacements = [];
  let sessionPlacements = [];
  let knownMatchIds = new Set();
  let placementsInitialized = false;
  // Ranked matches we know finished (league entry moved) but whose placement
  // the match API hasn't served yet.
  let pendingPlacements = 0;
  let catchupTimer = null;
  let catchupAttempt = 0;

  let latestData = {
    gameName: '', tagLine: '', tier: 'UNRANKED', rank: '',
    leaguePoints: 0, wins: 0, losses: 0,
    sessionLP: 0, sessionWins: 0, sessionLosses: 0,
    lastDelta: 0, deltaSeq: 0,
    lpToNextTier: null, nextTierName: null, tierProgressPct: null,
    recentPlacements: [], sessionAvgPlacement: null,
    updatedAt: null, error: null,
  };

  function emitStatus() {
    if (onStatusChange) onStatusChange({ ...latestData, isMockMode, isPolling: !!pollTimer, hasApiKey: !!config.riotApiKey, region: config.regionLabel || '' });
  }

  async function riotFetch(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, {
        headers: { 'X-Riot-Token': config.riotApiKey },
        signal: controller.signal,
      });
      if (!res.ok) {
        const errorText = await res.text();
        if (res.status === 403) log('ERROR', 'Riot API Key is invalid or expired!');
        throw new Error(`Riot API ${res.status}: ${errorText}`);
      }
      return res.json();
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Riot API request timed out after 8s');
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function resolvePuuid() {
    log('INIT', `Resolving PUUID for Riot ID: ${config.gameName}#${config.tagLine}...`);
    const url = `https://${config.regionRoute}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(config.gameName)}/${encodeURIComponent(config.tagLine)}`;
    const data = await riotFetch(url);
    log('SUCCESS', `Resolved PUUID: ${data.puuid.slice(0, 12)}...`);
    return data.puuid;
  }

  // Mock events write into the very same state the live path uses, and live
  // state is only refreshed when a NEW match is detected -- so on returning to
  // live there was nothing to trigger a correction and simulated results stuck
  // around. Snapshot everything mock can touch on the way in, put it back on
  // the way out. Costs no extra API calls.
  //
  // This has to cover initialSessionStats as well as the placement arrays: mock
  // "Reset Session" nulls the baseline, and the next simulated LP change
  // re-locks it against FABRICATED LP. Returning to live then computed
  // sessionLP as (real absolute LP - mock absolute LP), which can be thousands
  // of LP off on stream.
  let preMockState = null;

  function applyMockMode(enabled) {
    if (enabled && !isMockMode) {
      preMockState = {
        recent: [...recentPlacements],
        session: [...sessionPlacements],
        known: new Set(knownMatchIds),
        initialized: placementsInitialized,
        pending: pendingPlacements,
        sessionStats: initialSessionStats ? { ...initialSessionStats } : null,
        // Restoring the displayed values too means the overlay snaps straight
        // back to real rank on toggle-off, instead of showing simulated rank
        // until the next poll lands.
        data: { ...latestData },
      };
      cancelCatchup();
    } else if (!enabled && isMockMode && preMockState) {
      recentPlacements = preMockState.recent;
      sessionPlacements = preMockState.session;
      knownMatchIds = preMockState.known;
      placementsInitialized = preMockState.initialized;
      pendingPlacements = preMockState.pending;
      initialSessionStats = preMockState.sessionStats;
      latestData = preMockState.data;
      preMockState = null;
      if (pendingPlacements > 0) scheduleCatchup();
      latestData.recentPlacements = [...recentPlacements];
      latestData.sessionAvgPlacement = sessionAveragePlacement();
    }
    isMockMode = enabled;
  }

  function sessionAveragePlacement() {
    if (!sessionPlacements.length) return null;
    const sum = sessionPlacements.reduce((a, b) => a + b, 0);
    return Math.round((sum / sessionPlacements.length) * 10) / 10;
  }

  // One list request, then a detail request only for match IDs we've never
  // seen. In steady state that's zero extra calls; a finished game costs the
  // list plus one detail. Deliberately not called on every poll -- see the
  // new-match hook in fetchRank.
  async function fetchPlacements({ countTowardSession }) {
    const base = `https://${config.regionRoute}.api.riotgames.com/tft/match/v1`;
    const ids = await riotFetch(`${base}/matches/by-puuid/${puuid}/ids?start=0&count=${PLACEMENT_HISTORY_SIZE}`);
    if (!Array.isArray(ids)) return 0;
    let discovered = 0;

    const unseen = ids.filter((id) => !knownMatchIds.has(id)).slice(0, MAX_MATCH_LOOKUPS_PER_CYCLE);
    // Walk oldest -> newest so unshifting leaves recentPlacements newest-first.
    for (const id of unseen.slice().reverse()) {
      const match = await riotFetch(`${base}/matches/${id}`);
      knownMatchIds.add(id);
      if (!match || !match.info || match.info.queue_id !== RANKED_TFT_QUEUE_ID) continue;
      const me = (match.info.participants || []).find((p) => p.puuid === puuid);
      if (!me || typeof me.placement !== 'number') continue;
      recentPlacements.unshift(me.placement);
      if (countTowardSession) sessionPlacements.push(me.placement);
      discovered++;
    }

    recentPlacements = recentPlacements.slice(0, PLACEMENT_HISTORY_SIZE);
    if (knownMatchIds.size > MATCH_ID_MEMORY) {
      knownMatchIds = new Set(Array.from(knownMatchIds).slice(-MATCH_ID_MEMORY));
    }
    return discovered;
  }

  function cancelCatchup() {
    if (catchupTimer) clearTimeout(catchupTimer);
    catchupTimer = null;
    catchupAttempt = 0;
  }

  // Only ever runs in the window just after a real game, and stops the moment
  // every known match has a placement -- so steady-state cost stays at zero.
  function scheduleCatchup() {
    if (catchupTimer) return;
    if (catchupAttempt >= PLACEMENT_CATCHUP_DELAYS_MS.length) {
      log('PLACEMENT', `Gave up waiting on ${pendingPlacements} match(es); will resolve after the next game`);
      cancelCatchup();
      return;
    }
    const delay = PLACEMENT_CATCHUP_DELAYS_MS[catchupAttempt++];
    catchupTimer = setTimeout(async () => {
      catchupTimer = null;
      if (isMockMode || !puuid || pendingPlacements <= 0) { cancelCatchup(); return; }
      try {
        const found = await fetchPlacements({ countTowardSession: true });
        if (found > 0) {
          pendingPlacements = Math.max(0, pendingPlacements - found);
          latestData.recentPlacements = [...recentPlacements];
          latestData.sessionAvgPlacement = sessionAveragePlacement();
          log('PLACEMENT', `Match API caught up: resolved ${found}, ${pendingPlacements} still pending`);
          emitStatus();
        }
      } catch (err) {
        log('ERROR', `Placement catch-up failed: ${err.message}`);
      }
      if (pendingPlacements > 0) scheduleCatchup();
      else cancelCatchup();
    }, delay);
    if (catchupTimer.unref) catchupTimer.unref();
  }

  async function fetchRank() {
    if (isMockMode) return;

    if (!config.riotApiKey || !config.gameName || !config.tagLine) {
      latestData = { ...latestData, error: 'Not configured — set your Riot ID and API key in Settings', updatedAt: new Date().toISOString() };
      emitStatus();
      return;
    }

    try {
      if (!puuid) puuid = await resolvePuuid();
      const url = `https://${config.platformRoute}.api.riotgames.com/tft/league/v1/by-puuid/${puuid}`;
      const entries = await riotFetch(url);
      // Ranked-only, deliberately. A player who's only played Hyper Roll or
      // Double Up this set still HAS league entries -- RANKED_TFT_TURBO /
      // RANKED_TFT_DOUBLE_UP -- but those carry ratedTier/ratedRating instead
      // of tier/rank/leaguePoints. Falling back to entries[0] put a literal
      // "undefined undefined" on the overlay. No ranked entry means unranked,
      // which the branch below already handles correctly.
      const entry = Array.isArray(entries)
        ? entries.find((e) => e.queueType === 'RANKED_TFT')
        : null;

      if (!entry) {
        // No ranked entry means the tracked ladder position no longer exists --
        // fresh account, or a set rollover that wiped everyone's rank. Drop the
        // delta trackers too, otherwise previousMatchesPlayed stays at the old
        // set's game count and the `matchesPlayed > previous` test below can't
        // fire again until the new set passes it.
        previousAbsLP = null;
        previousMatchesPlayed = null;
        initialSessionStats = null;
        latestData = {
          ...latestData, tier: 'UNRANKED', rank: '', leaguePoints: 0, wins: 0, losses: 0,
          sessionLP: 0, sessionWins: 0, sessionLosses: 0, lastDelta: 0,
          lpToNextTier: null, nextTierName: null, tierProgressPct: null,
          recentPlacements: [...recentPlacements], sessionAvgPlacement: sessionAveragePlacement(),
          updatedAt: new Date().toISOString(), error: null,
        };
      } else {
        const currentAbsLP = getAbsoluteLP(entry.tier, entry.rank, entry.leaguePoints);
        if (!initialSessionStats) {
          initialSessionStats = { absLP: currentAbsLP, wins: entry.wins, losses: entry.losses };
          log('SESSION', `Baseline locked: ${entry.tier} ${entry.rank} (${entry.leaguePoints} LP)`);
        }

        // Backfill the strip once so it isn't empty on launch. These games
        // predate the session, so they must not feed the session average.
        if (!placementsInitialized) {
          placementsInitialized = true;
          try {
            await fetchPlacements({ countTowardSession: false });
          } catch (err) {
            log('ERROR', `Placement backfill failed: ${err.message}`);
          }
        }

        const matchesPlayed = entry.wins + entry.losses;
        let lastDelta = 0;
        if (previousMatchesPlayed !== null && matchesPlayed > previousMatchesPlayed) {
          // A new match (or matches, if more than one finished between
          // polls) completed since the last check -- the true LP swing
          // is the absolute-LP difference, which stays correctly signed
          // even across a promotion/demotion.
          lastDelta = currentAbsLP - previousAbsLP;
          deltaSeq++; // marks this as a fresh event, not a repeat of the last poll
          // Only place we spend match-API calls. A placement failure must not
          // take down rank/LP, so it's isolated.
          pendingPlacements += matchesPlayed - previousMatchesPlayed;
          catchupAttempt = 0; // fresh match deserves a fresh backoff
          try {
            const found = await fetchPlacements({ countTowardSession: true });
            pendingPlacements = Math.max(0, pendingPlacements - found);
          } catch (err) {
            log('ERROR', `Placement fetch failed: ${err.message}`);
          }
          if (pendingPlacements > 0) {
            log('PLACEMENT', `${pendingPlacements} match(es) not indexed yet, retrying`);
            scheduleCatchup();
          } else {
            cancelCatchup();
          }
        }
        previousAbsLP = currentAbsLP;
        previousMatchesPlayed = matchesPlayed;

        latestData = {
          gameName: config.gameName, tagLine: config.tagLine,
          tier: entry.tier, rank: entry.rank, leaguePoints: entry.leaguePoints,
          wins: entry.wins, losses: entry.losses,
          sessionLP: currentAbsLP - initialSessionStats.absLP,
          sessionWins: entry.wins - initialSessionStats.wins,
          sessionLosses: entry.losses - initialSessionStats.losses,
          lastDelta, deltaSeq,
          ...getTierProgress(entry.tier, entry.rank, entry.leaguePoints),
          recentPlacements: [...recentPlacements],
          sessionAvgPlacement: sessionAveragePlacement(),
          updatedAt: new Date().toISOString(), error: null,
        };
      }
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures++;
      if (consecutiveFailures <= 3 || consecutiveFailures % 12 === 0) {
        log('ERROR', `Fetch failed (${consecutiveFailures} in a row): ${err.message}`);
      }
      latestData = { ...latestData, error: err.message, updatedAt: new Date().toISOString() };
    }
    emitStatus();
  }

  // ---- Crest normalisation endpoint ----
  // Trimming alone isn't enough. Riot's emblem artwork has very different
  // proportions per tier once the transparent margin is gone -- roughly 1.16:1
  // for Gold and Platinum up to 1.66:1 for Iron and Diamond. Dropped into a
  // fixed box with object-fit:contain, the wide ones scale down to fit the
  // width and end up visibly smaller: Diamond and Iron rendered about 74% of
  // Gold's visual weight, which read as the overlay being inconsistent between
  // ranks rather than as a property of the source images.
  //
  // So every crest is scaled to the same rendered AREA (not the same height --
  // equal height would make the wide ones overflow) and padded onto one shared
  // canvas. The overlay then draws every tier at identical visual weight, and
  // Diamond looks like Gold. Done once per tier, then cached.
  const CREST_CANVAS_W = 224;   // 2x the on-card box, for crisp downscaling
  const CREST_CANVAS_H = 160;
  // Gold's area when contained in the box, which is the look we're matching.
  const CREST_TARGET_AREA = 7520 * 4;

  async function normaliseCrest(sourceBuffer) {
    const trimmed = await sharp(sourceBuffer).trim({ threshold: 10 })
      .toBuffer({ resolveWithObject: true });
    const { width, height } = trimmed.info;

    // Equal-area scale, then clamped so an unusually wide or tall crest still
    // fits the canvas rather than being cropped by it.
    let scale = Math.sqrt(CREST_TARGET_AREA / (width * height));
    scale = Math.min(scale, CREST_CANVAS_W / width, CREST_CANVAS_H / height);

    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    // Centre by padding, NOT by a second `fit: contain` resize -- contain scales
    // up anything smaller than the box, which would push every crest back out
    // to a canvas edge and undo the equal-area sizing above.
    const left = Math.floor((CREST_CANVAS_W - w) / 2);
    const top = Math.floor((CREST_CANVAS_H - h) / 2);

    return sharp(trimmed.data)
      .resize(w, h, { fit: 'fill', kernel: 'lanczos3' })
      .extend({
        left, top,
        right: CREST_CANVAS_W - w - left,
        bottom: CREST_CANVAS_H - h - top,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
  }

  const crestCache = new Map();
  // Negative cache: a failed source fetch used to be retried on every single
  // request, so an unreachable CDN (or an offline user) meant one outbound
  // 8s-timeout request per overlay poll, indefinitely. Remember failures for
  // a cooldown window and answer from that instead of re-hitting the source.
  const crestFailures = new Map(); // tier -> timestamp we're allowed to retry at
  const CREST_RETRY_COOLDOWN_MS = 60000;

  app.get('/api/crest/:tier', async (req, res) => {
    const tier = req.params.tier.toLowerCase();
    if (!VALID_TIERS.has(tier)) return res.status(400).send('Unknown tier');
    if (crestCache.has(tier)) {
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(crestCache.get(tier));
    }
    const retryAt = crestFailures.get(tier);
    if (retryAt && Date.now() < retryAt) {
      return res.status(502).send('Crest unavailable');
    }
    try {
      const sourceUrl = `${CREST_SOURCE_BASE}${tier}.png`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      let response;
      try {
        response = await fetch(sourceUrl, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(`Source fetch ${response.status}`);
      const sourceBuffer = Buffer.from(await response.arrayBuffer());
      const normalised = await normaliseCrest(sourceBuffer);
      crestCache.set(tier, normalised);
      crestFailures.delete(tier);
      log('CREST', `Normalised and cached emblem-${tier}.png`);
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(normalised);
    } catch (err) {
      crestFailures.set(tier, Date.now() + CREST_RETRY_COOLDOWN_MS);
      log('ERROR', `Crest fetch/normalise failed for ${tier}: ${err.message} — not retrying for ${CREST_RETRY_COOLDOWN_MS / 1000}s`);
      res.status(502).send('Crest unavailable');
    }
  });

  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/rank', (req, res) => {
    res.json({ ...latestData, isMockMode, region: config.regionLabel || '' });
  });

  app.post('/api/test/event', (req, res) => {
    const { action, lpChange, newTier, newRank, errorMsg, placement } = req.body;
    applyMockMode(true);

    if (!initialSessionStats) {
      initialSessionStats = {
        absLP: getAbsoluteLP(latestData.tier, latestData.rank, latestData.leaguePoints),
        wins: latestData.wins, losses: latestData.losses,
      };
    }

    if (action === 'lp_change') {
      const beforeAbsLP = getAbsoluteLP(latestData.tier, latestData.rank, latestData.leaguePoints);
      const result = applyLPChange(latestData.tier, latestData.rank, latestData.leaguePoints, lpChange);
      latestData.tier = result.tier;
      latestData.rank = result.rank;
      latestData.leaguePoints = result.lp;
      const afterAbsLP = getAbsoluteLP(result.tier, result.rank, result.lp);
      // Compute the delta the exact same way the live path does (actual
      // absolute-LP difference), not the raw requested lpChange -- those
      // two only diverge at a tier's floor, where a big loss gets
      // clamped at Division IV / 0 LP. Using the true post-clamp change
      // keeps mock mode's badge numbers consistent with what live data
      // would actually show in the same situation.
      latestData.lastDelta = afterAbsLP - beforeAbsLP;
      latestData.deltaSeq = ++deltaSeq;
      // Riot's wins/losses on a TFT league entry mean top-4 / bottom-4, not
      // LP sign -- at high MMR a 4th can still be slightly negative. So when
      // the simulated event carries a placement, that decides it, and the LP
      // sign is only the fallback for a bare LP nudge with no placement.
      if (typeof placement === 'number' && placement >= 1 && placement <= 8) {
        if (placement <= 4) latestData.wins += 1;
        else latestData.losses += 1;
      } else if (lpChange > 0) {
        latestData.wins += 1;
      } else if (lpChange < 0) {
        latestData.losses += 1;
      }
      // Mock must land in the same arrays the live path writes, so the strip
      // and the session average behave identically under test.
      if (typeof placement === 'number' && placement >= 1 && placement <= 8) {
        recentPlacements.unshift(placement);
        recentPlacements = recentPlacements.slice(0, PLACEMENT_HISTORY_SIZE);
        sessionPlacements.push(placement);
      }
    } else if (action === 'set_rank') {
      latestData.tier = newTier;
      latestData.rank = newRank;
      latestData.lastDelta = 0; // a manual rank pick isn't a "match result"
      latestData.leaguePoints = 0;
      // ...and for the same reason it must not land in the session total. Move
      // the baseline with it, otherwise jumping Unranked -> Gold IV reads as a
      // +1247 LP session before a single simulated game has been played.
      if (initialSessionStats) {
        initialSessionStats.absLP = getAbsoluteLP(newTier, newRank, 0);
      }
    } else if (action === 'error') {
      latestData.error = errorMsg || 'Simulated Test Error!';
    } else if (action === 'reset_error') {
      latestData.error = null;
    } else if (action === 'reset_session') {
      initialSessionStats = null;
      sessionPlacements = [];
      latestData.sessionLP = 0;
      latestData.sessionWins = 0;
      latestData.sessionLosses = 0;
    }

    const currentAbsLP = getAbsoluteLP(latestData.tier, latestData.rank, latestData.leaguePoints);
    if (initialSessionStats) {
      latestData.sessionLP = currentAbsLP - initialSessionStats.absLP;
      latestData.sessionWins = latestData.wins - initialSessionStats.wins;
      latestData.sessionLosses = latestData.losses - initialSessionStats.losses;
    }
    latestData.recentPlacements = [...recentPlacements];
    latestData.sessionAvgPlacement = sessionAveragePlacement();
    Object.assign(latestData, getTierProgress(latestData.tier, latestData.rank, latestData.leaguePoints));
    latestData.updatedAt = new Date().toISOString();

    emitStatus();
    res.json({ success: true, isMockMode, latestData });
  });

  app.post('/api/test/toggle-mock', (req, res) => {
    applyMockMode(req.body.enable);
    log('TEST', `Mock mode: ${isMockMode ? 'ON' : 'OFF'}`);
    emitStatus();
    res.json({ isMockMode });
  });

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    fetchRank();
    pollTimer = setInterval(fetchRank, config.pollIntervalMs);
    emitStatus();
  }

  function stopPolling() {
    cancelCatchup();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    emitStatus();
  }

  return {
    app,

    start(port) {
      return new Promise((resolve, reject) => {
        httpServer = app.listen(port, () => {
          log('SERVER', `Listening on http://localhost:${port}`);
          startPolling();
          resolve(port);
        });
        httpServer.on('error', reject);
      });
    },

    stop() {
      stopPolling();
      return new Promise((resolve) => {
        if (httpServer) httpServer.close(() => resolve());
        else resolve();
      });
    },

    updateConfig(newConfig) {
      // Identity == which ladder position we're tracking. Note what is NOT
      // here: the API key. A personal key expires every 24h and gets pasted in
      // mid-stream (the README tells users to do exactly that), and treating
      // that as an identity change reset the session baseline to 0 and wiped
      // the placement strip every single day. A credential rotation needs a
      // refetch, not a reset.
      //
      // platformRoute has to be in here even though regionRoute already is:
      // euw1/eun1 both route to `europe`, as do na1/br1 to `americas`, so
      // regionRoute alone misses a move to a different ladder.
      const identityChanged =
        newConfig.gameName !== config.gameName ||
        newConfig.tagLine !== config.tagLine ||
        newConfig.platformRoute !== config.platformRoute ||
        newConfig.regionRoute !== config.regionRoute;
      const keyChanged = newConfig.riotApiKey !== config.riotApiKey;
      const pollChanged = newConfig.pollIntervalMs !== config.pollIntervalMs;

      config = { ...config, ...newConfig };

      if (identityChanged) {
        puuid = null;
        initialSessionStats = null;
        consecutiveFailures = 0;
        recentPlacements = [];
        sessionPlacements = [];
        knownMatchIds = new Set();
        placementsInitialized = false;
        pendingPlacements = 0;
        // These two are the delta high-water mark. Leaving them pointing at the
        // previous account is what produced a phantom four-figure LP swing on
        // switching to an account with more games played -- and, in the other
        // direction, silently wedged delta detection until the new account
        // passed the old one's game count.
        previousAbsLP = null;
        previousMatchesPlayed = null;
        latestData = { ...latestData, lastDelta: 0 };
        cancelCatchup();
      }
      if (pollChanged && pollTimer) {
        startPolling(); // restart with new interval
      } else if (identityChanged || keyChanged) {
        fetchRank();
      }
    },

    getConfig() {
      return { ...config, riotApiKey: config.riotApiKey ? '••••••••' : '' };
    },

    getStatus() {
      return { ...latestData, isMockMode, isPolling: !!pollTimer, region: config.regionLabel || '' };
    },

    setMockMode(enabled) {
      applyMockMode(enabled);
      emitStatus();
    },
  };
}

module.exports = { createOverlayServer, getAbsoluteLP, applyLPChange, getTierProgress, TIER_BASE, RANK_BASE };