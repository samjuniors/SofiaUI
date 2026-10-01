# Sofia desktop shell (Electron)

Phase 3 — Desktop presence. A tray-resident shell around the Sofia web app:
global hotkeys, start-at-login, a full window, a compact always-on-top orb,
and a managed companion daemon whose token is bundled into the renderer —
no manual pairing code.

## Run

```sh
npm install          # includes electron (devDependency)
npm run dev          # terminal 1: the Vite app on http://127.0.0.1:8080
npm run electron:dev # terminal 2: waits for Vite, then launches the shell
```

`npm run electron:start` launches the shell directly against
`ELECTRON_START_URL` (or `SOPHIA_APP_URL`, or the dev default) — useful
against a served production build such as `npm run preview`.

> The `electron` package downloads its platform binary from GitHub
> releases during `npm install`. On networks that block the release CDN,
> point `ELECTRON_MIRROR` at an accessible mirror and reinstall.

## Layout

| File | Role |
|---|---|
| `main.cjs` | Main process: windows, tray, hotkeys, login item, daemon, IPC |
| `preload.cjs` | `contextBridge` → `window.sophiaDesktop` (typed in `src/types/desktop.d.ts`) |
| `desktop-config.cjs` | Pure config builders — unit-tested, no Electron needed |
| `desktop-config.test.mjs` | 15 tests, runs under plain `node --test` |
| `dev.mjs` | Dev launcher: waits for Vite, spawns Electron |
| `make-tray-icon.mjs` | Zero-dep tray PNG generator (writes `tray.png`) |
| `tray.png` | Tray + window icon (regenerate with the script above) |

## How it works

- **Windows.** Main (`1280×860`, hides to tray instead of quitting) plus the
  orb (`232×96`, frameless, transparent, always-on-top) rendering the same
  app with `?orb=1` — `App.tsx` swaps in the compact `OrbOverlay`, which
  talks back through the bridge (`sendOrbCommand` → main, `sendMainState` →
  orb). Single-instance lock; second launch focuses the main window.
- **Companion.** On boot, main checks the companion port: busy → it defers
  to your own `node companion/server.mjs` (renderer pairs manually); free →
  it spawns the bundled `companion/server.mjs` with a fresh token and
  exposes `{ port, token, managed }` via `getPairing()`. The renderer
  (`companion-client.ts`) prefers the bundled token, and `mind-wiring.ts`
  auto-connects on boot with one retry. Bounded restarts (2×) on daemon
  crash, then manual-pairing fallback.
- **Hotkeys.** `CmdOrCtrl+Shift+S` toggles the main window,
  `CmdOrCtrl+Shift+O` the orb (overridable via `SOPHIA_HOTKEY_MAIN` /
  `SOPHIA_HOTKEY_ORB`; invalid or taken accelerators warn and skip).
- **Start at login.** Tray checkbox + Settings → System toggle, both driving
  `app.setLoginItemSettings`.

## Security notes

- Renderer: `contextIsolation: true`, `nodeIntegration: false`; the page
  only sees the minimal `sophiaDesktop` surface (no raw `ipcRenderer`).
- `sandbox` is explicitly **off**: the repo eslint config forbids `require`
  calls, so the preload loads Electron via dynamic `import()`, which
  sandboxed preloads don't provide. The isolation boundary above stays
  intact. If Electron ever ships ESM preload scripts, switch the bridge to
  a static import and flip `sandbox` back on in `desktop-config.cjs`.
- The bridge lands asynchronously (dynamic import); renderer code reads
  `window.sophiaDesktop` lazily and a `sophia:desktop-ready` event marks
  its arrival.
- The managed token is bundled in-memory only — main never prints it
  (the tray menu offers an explicit *Copy pairing code* for other devices).

## Environment

| Variable | Purpose |
|---|---|
| `ELECTRON_START_URL` | URL the shell loads (dev launcher sets this) |
| `SOPHIA_APP_URL` | Fallback URL (served builds) |
| `SOPHIA_HOTKEY_MAIN` / `SOPHIA_HOTKEY_ORB` | Hotkey overrides |
| `SOPHIA_COMPANION_PORT` / `SOPHIA_COMPANION_TOKEN` | Daemon port / pre-shared token |
| `SOPHIA_COMPANION_SCRIPT` | Explicit daemon script path |
| `SOPHIA_NODE_PATH` | Node binary used to spawn the daemon |
| `SOPHIA_TRAY_ICON` | Explicit tray icon path |

## Packaging (future work)

This phase covers the development shell. Distributable installers
(electron-builder / forge, asar with the companion + a served app bundle)
are a later packaging pass — `main.cjs` already resolves daemon and icon
paths from `process.resourcesPath` when `app.isPackaged` is set.
