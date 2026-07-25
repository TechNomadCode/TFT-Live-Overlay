# TFT Live Overlay

A simple desktop app that shows your Teamfight Tactics rank, LP gain/loss,
session gains, and recent placement history on your Streamlabs or OBS stream
with low latency — it talks to the Riot API directly, so there's no
third-party service in the path adding its own rate limits.
## Running it

```
npm install
npm start
```

**If `npm start` errors with "Electron failed to install correctly":**
Recent npm versions block dependency install scripts by default (a response
to a run of real supply-chain attacks on npm packages in late 2025/2026) —
Electron's install script is what downloads its actual binary, so if it
gets blocked, `node_modules/electron` ends up empty. This `package.json`
ships with `electron` and `electron-winstaller` (used when building a
Windows installer) pre-approved via the `allowScripts` field, so a normal
`npm install` shouldn't hit this. If it still does — e.g. a newer npm
changes the format, or a future dependency adds its own install script —
fix it the same way:
```
npm install-scripts approve <package-name>
npm install
```
Run `npm install-scripts ls` first if you're not sure which package needs it.

A window opens with three tabs: **Dashboard**, **Settings**, **Test**.
The app also adds a tray icon — closing the window just hides it; the
overlay server keeps running so Streamlabs/OBS never loses connection.
Quit fully from the tray icon's "Quit" option.

## First-time setup

1. Open **Settings**
2. Enter your Riot ID (name + tag, no `#`) and pick your region
3. Paste a Riot API key from [developer.riotgames.com](https://developer.riotgames.com/) — personal keys expire every 24h, just paste a fresh one in here when that happens, no restart needed
4. Click **Save Settings** — takes effect immediately

## Adding it to Streamlabs / OBS

Go to **Dashboard** → click **Copy URL** → add a **Browser Source** in
Streamlabs pointing to that URL (`http://localhost:3000/overlay.html`
by default).

### Why Browser Source and not a captured window

I looked at wrapping the overlay itself in the Electron window and having
OBS/Streamlabs capture that window instead. It's worse on every axis:

- **Browser Source renders off-screen**, composited directly into the
  stream by Streamlabs' own lightweight Chromium instance — no visible
  window, no window manager, no extra compositing step.
- **Window capture adds a hop**: your GPU draws the window, the OS
  compositor (DWM on Windows) composites it, then OBS/Streamlabs has to
  capture *that* composited output — extra latency and a common source of
  stutter, especially with anything transparent.
- **Transparency is fragile with window capture** — getting a truly
  alpha-transparent capture working reliably (vs. a black or checkered
  background) depends on capture method and GPU driver, and breaks
  across setups. Browser Source transparency just works, always has.

So the app still runs the exact same local HTTP server approach — the
GUI is just for configuring and monitoring it instead of editing files
and env vars by hand.

## Building a distributable installer

For a double-click installer (`.exe` / `.dmg` / `.AppImage`) instead of
running from source:

```
npm run build
```

This uses `electron-builder`, configured in `package.json`, and outputs
to a `dist/` folder. Build on the OS you're targeting — cross-compiling
Windows installers from Mac/Linux (or vice versa) needs extra tooling
(Wine, etc.) that isn't set up here.

## About the npm warnings

**Deprecated package warnings** (`inflight`, `glob@7.x`, `boolean@3.2.0`, `tar@6.2.1`)
all come from inside `electron-builder`'s own dependency tree — not
anything this project imports directly. They only matter for `npm run
build` (packaging an installer), never for `npm start`.

**Vulnerabilities**: `npm audit` originally flagged 9 (8 high, 1 critical).
I traced every one of them:

- 8 of the 9 (including the critical `tar` one) came from `electron-builder`
  being two years stale. Bumped it `24.13.3 → ^26.0.0` — verified our
  existing `build` config still loads correctly under the new version.
- The 9th was a real CVE in `electron` itself (ASAR integrity bypass +
  an AppleScript injection issue on macOS). Reading the actual advisory,
  it's scoped to apps that enable specific opt-in hardening flags or call
  `app.moveToApplicationsFolder()` — this app does neither. Even so,
  bumped `electron` `30.0.0 → ^43.0.0` (the version `npm audit` itself
  recommends) to close it outright rather than argue the theoretical
  case. That's a 13-major-version jump, so before shipping it I re-ran
  the full test suite against it: window load, settings save + persist
  across a reload, mock rank/LP changes reflecting on the dashboard,
  the crest image endpoint, tray-close-keeps-server-alive behavior, and
  clean shutdown on quit — all identical to the pre-upgrade results, and
  `sharp` (crest trimming) confirmed still producing byte-identical output
  under Electron 43's newer bundled Node/V8. `npm audit` now reports
  0 vulnerabilities.


## Notes

- Settings are stored in your OS's app-data folder (`app.getPath('userData')`),
  not in the project folder — safe to move/reinstall the app without losing config.
- The overlay port is fixed at `3000` so an existing Streamlabs Browser
  Source keeps working across updates without reconfiguring.
- On Linux, `sharp` (used to auto-trim rank crest images) prints a startup
  warning about Electron binary compatibility — this is a known, generally
  harmless notice; it was tested working correctly during development.
  Windows/Mac don't show this warning.
- LP only updates once Riot finishes processing a completed match — polling
  faster than a few seconds doesn't get you fresher data sooner. The default
  is 5s, which stays comfortably within a personal key's rate limit
  (100 requests/2min); go higher in Settings if you'd rather be extra
  conservative with your key's quota.

## License

MIT — see [LICENSE](LICENSE).

## Disclaimer

TFT Live Overlay isn't endorsed by Riot Games and doesn't reflect the views or
opinions of Riot Games or anyone officially involved in producing or managing
Riot Games properties. Riot Games and all associated properties are trademarks
or registered trademarks of Riot Games, Inc.