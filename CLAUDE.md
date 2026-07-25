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

Three processes' worth of code, in one repo:

- **`main.js`** — Electron main process. Owns the tray icon, the settings
  window, `settings.json` in `app.getPath('userData')` (never in the repo —
  it holds a Riot API key), and a single `createOverlayServer()` instance.
  All renderer↔main communication is `ipcMain.handle` at the bottom of the
  file, mirrored one-for-one in `preload.js`.
- **`preload.js`** — the entire IPC surface, exposed as `window.tftApp` via
  `contextBridge`. `contextIsolation: true`, `nodeIntegration: false`. Adding
  a renderer capability means adding it here *and* in `main.js`.
- **`renderer/`** — the settings/dashboard window (plain HTML/CSS/JS, no
  framework). Three tabs: Dashboard, Settings, Test.
- **`overlay-server.js`** — Express server on **port 3000**, deliberately
  fixed so an existing Browser Source keeps working across updates. Holds all
  the Riot polling and LP math. Exported as a module so it can be driven from
  the GUI (live config changes, no restart) rather than env vars.
- **`public/overlay.html`** — the overlay itself, self-contained. Served
  statically; polls `GET /api/rank` every 2.5s. This is what OBS loads.

## Things that will bite you

- **The overlay polls, the server polls, and they're different intervals.**
  Server → Riot is the user-configured `pollIntervalMs` (default 5s, sized
  against the 100 req/2min personal-key limit). Overlay → server is a fixed
  2.5s in `overlay.html`. Don't conflate them.
- **LP math is absolute-LP based** (`getAbsoluteLP`). Master/GM/Challenger
  intentionally share one LP base — see the comment on `TIER_BASE` before
  "fixing" it.
- **`applyLPChange` is mock-mode only.** The live path reads tier/rank/LP
  straight from Riot and never calls it. Its only job is making the Test tab
  behave like the real ladder, so a divergence there means an overlay code path
  you can't exercise before it happens on stream.
- **Identity is `gameName`/`tagLine`/`platformRoute`/`regionRoute` — not the
  API key.** Personal keys expire every 24h and get pasted in mid-stream;
  treating that as an identity change resets the session baseline and wipes the
  placement strip. See the comment in `updateConfig`.
- **Placement lags LP.** Riot's match index updates after the league entry, so
  placements are fetched on a retry ladder (`PLACEMENT_CATCHUP_DELAYS_MS`).
  A placement that shows up seconds late is expected behavior, not a bug.
- **Rank crests are proxied, not hotlinked.** `GET /api/crest/:tier` fetches
  from Community Dragon and trims whitespace with `sharp`. `sharp` is a native
  module — it prints a harmless Electron-compat warning on Linux.
- **Closing the window doesn't quit.** It hides to tray so the server stays up
  for OBS. Real shutdown goes through `gracefulShutdown()`.
- **Single-instance lock** is on; a second launch focuses the existing window.

## Testing

There's no automated test suite. Manual verification runs through the **Test**
tab / `POST /api/test/event` and `POST /api/test/toggle-mock`, which drive mock
rank and LP changes without burning API quota. Use mock mode for any UI work.

## Conventions

- Comments in this codebase explain *why*, often citing the specific Riot API
  behavior that forced a decision. Match that — don't add comments that restate
  the code.
- No build step, no bundler, no TypeScript. Keep it that way unless asked.
- API keys never get logged or returned; `/api/config`-style responses mask the
  key (see the `'••••••••'` masking in `overlay-server.js`).
