# TFT Live Overlay

Electron desktop app that polls the Riot API for a player's Teamfight Tactics
rank/LP and serves an animated overlay page to Streamlabs/OBS as a Browser
Source.

## Naming

The project name is **TFT Live Overlay** (`tft-live-overlay`). It was
previously called several inconsistent things (`real-time-tft-overlay-app`,
`Real-Time TFT Overlay`, `TFT LP Overlay`, `TFTStats`). If you find any of
those, it's a leftover — normalize it.

## Architecture

Four execution contexts, one repo, no build step:

```
src/
├── shared/     process-agnostic domain code — loadable from Node AND a browser
├── main/       Electron main process
├── preload/    the contextBridge surface
├── renderer/   settings/dashboard window (loaded over file://)
├── overlay/    the page OBS loads (served over http://)
└── server/     Express + Riot polling
assets/         app/tray icons (outside src/, referenced by electron-builder)
```

- **`src/shared/`** — `tiers.js` (tier names, order, slugs, colours,
  `rankScore`) and `lp-math.js` (`TIER_BASE`, `getAbsoluteLP`,
  `getTierProgress`, `applyLPChange`). Written as **UMD** because there is no
  bundler: the same file has to `require()` in Node and load from a `<script>`
  tag in both browser surfaces. Keep it free of Express, Electron and DOM.
- **`src/main/`** — `index.js` is lifecycle only (single-instance lock,
  `gracefulShutdown`, wiring). The tray, the window, `settings.json` in
  `app.getPath('userData')` (never in the repo — it holds a Riot API key), the
  region map and the IPC handlers each have their own module. Every
  `ipcMain.handle` lives in `main/ipc.js` and nowhere else, mirrored
  one-for-one in the preload.
- **`src/preload/index.js`** — the entire IPC surface, exposed as
  `window.tftApp` via `contextBridge`. `contextIsolation: true`,
  `nodeIntegration: false`. Adding a renderer capability means adding it here
  *and* in `main/ipc.js`.
- **`src/renderer/`** — the settings/dashboard window (plain HTML/CSS/JS, no
  framework). Three tabs: Dashboard, Settings, Test. Scripts are split by
  panel, each exposing one `init`, called from `scripts/index.js`.
- **`src/overlay/overlay.html`** — the overlay itself. Served statically at
  `http://localhost:3000/overlay.html`; polls `GET /api/rank` every 2.5s. This
  is what OBS loads, and the path is baked into Browser Sources users have
  already configured — **the filename must not change**.
- **`src/server/`** — Express on **port 3000**, deliberately fixed for the same
  reason. `index.js` is the composition root; the Riot client, the two
  trackers, mock mode, the crest proxy and the routes are separate modules.
  Exported as a module so it can be driven from the GUI (live config changes,
  no restart) rather than env vars.

### Browser code uses classic scripts, not ES modules

Both browser surfaces load ordered `<script src>` tags and attach to one
namespace (`window.TFTOverlay`, `window.TFTSettings`). This is not an oversight:
the settings window is loaded via `loadFile`, i.e. `file://`, where Chromium
blocks module scripts on CORS grounds. Keeping both surfaces on the same
mechanism means shared code works in either without a build step. **Script order
matters** — `/shared` and the helper modules first, `index.js` last.

## Things that will bite you

- **The overlay polls, the server polls, and they're different intervals.**
  Server → Riot is the user-configured `pollIntervalMs` (default 5s, sized
  against the 100 req/2min personal-key limit). Overlay → server is a fixed
  2.5s in `overlay/scripts/index.js`. Don't conflate them.
- **LP math is absolute-LP based** (`getAbsoluteLP`). Master/GM/Challenger
  intentionally share one LP base — see the comment on `TIER_BASE` before
  "fixing" it.
- **`applyLPChange` is mock-mode only.** The live path reads tier/rank/LP
  straight from Riot and never calls it. Its only job is making the Test tab
  behave like the real ladder, so a divergence there means an overlay code path
  you can't exercise before it happens on stream.
- **Mock mode writes into the same state the live path writes.** That's
  deliberate — it's the only way the Test tab exercises real code paths — which
  is why `tracker-state.js` exists as a named owner, and why
  `mock-controller.js` snapshots *and* restores both it and the placement
  tracker on the way in and out.
- **Identity is `gameName`/`tagLine`/`platformRoute`/`regionRoute` — not the
  API key.** Personal keys expire every 24h and get pasted in mid-stream;
  treating that as an identity change resets the session baseline and wipes the
  placement strip. See the comment in `updateConfig`.
- **Placement lags LP.** Riot's match index updates after the league entry, so
  placements are fetched on a retry ladder (`PLACEMENT_CATCHUP_DELAYS_MS`).
  A placement that shows up seconds late is expected behavior, not a bug.
- **Motion is gated on a class, not on `prefers-reduced-motion`.** It used to be
  the media query, and one OS checkbox — Windows' "Show animations in Windows",
  or the "Adjust for best performance" preset that every gaming guide
  recommends — silently deleted the sheen, the particles and every rank-change
  effect in *every* browser on that machine at once, OBS's CEF and a plain
  Chrome tab alike. It read as a broken build, not as a preference. The card is
  rendered for the stream's viewers, not for the operator, so the operator's
  accessibility setting is the wrong signal; `scripts/motion.js` now writes
  `.reduce-motion` only when the URL asks (`?motion=reduce`, or `?motion=os` to
  opt back into the old behaviour). There are no media queries left in the
  overlay CSS — keep it that way.
- **Rank crests are proxied, not hotlinked.** `GET /api/crest/:tier` fetches
  from Community Dragon and normalises every tier to equal visual area with
  `sharp`. `sharp` is a native module — it prints a harmless Electron-compat
  warning on Linux.
- **Closing the window doesn't quit.** It hides to tray so the server stays up
  for OBS. Real shutdown goes through `gracefulShutdown()`.
- **Single-instance lock** is on; a second launch focuses the existing window.

## Testing

There's no automated test suite. Manual verification runs through the **Test**
tab / `POST /api/test/event` and `POST /api/test/toggle-mock`, which drive mock
rank and LP changes without burning API quota. Use mock mode for any UI work.

For a machine you don't have access to, `src/overlay/scripts/selfcheck.js` is
the channel: the overlay measures its own environment — whether the animation
*clocks* are advancing (not whether a frame looks different, which the sheen's
89%-idle keyframes make useless), whether each stylesheet returned rules, the
Chromium version, the GPU — and POSTs it to `/api/diag`, which appends a
verdict to `logs/overlay.log` in `userData`. Dashboard → Troubleshooting
surfaces it. `diag-log.js` scrubs anything matching a Riot key on the way in
and out, because the whole point of that file is that users send it to people.

`src/server` has no Electron dependency, so it can be driven from plain Node
for a smoke test without launching the app:

```bash
node -e "require('./src/server').createOverlayServer({onStatusChange(){}}).start(3999)"
```

## Conventions

- Comments in this codebase explain *why*, often citing the specific Riot API
  behavior that forced a decision. Match that — don't add comments that restate
  the code.
- No build step, no bundler, no TypeScript. Keep it that way unless asked.
- Server modules are factory functions that take their dependencies as an
  argument (`createRankTracker({ riot, state, ... })`) rather than importing
  singletons. That's what keeps state ownership explicit and confines the wiring
  to `src/server/index.js`.
- API keys never get logged or returned; `/api/config`-style responses mask the
  key (see the `'••••••••'` masking in `src/server/index.js`).
