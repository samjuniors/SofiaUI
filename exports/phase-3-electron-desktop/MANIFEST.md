# Phase 3 — Desktop presence / Electron (recovery artifact)

Rebuilt 2026-09-29 after the sandbox loss described in `RECOVERY.md`.
Branch: `arena/01a0ebb7-sofiaui`.

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

**New**
- `electron/main.cjs` — tray + menu, global hotkeys (toggle main/orb),
  start-at-login, single-instance lock, main window (hides to tray) +
  compact always-on-top orb window, managed companion spawn with bundled
  token (defers when the port is busy), bounded daemon restarts, IPC relay.
  Zero `require` calls (repo eslint rule) — Electron via dynamic `import()`.
- `electron/preload.cjs` — `contextBridge` → `window.sophiaDesktop`
  (pairing, window controls, orb↔main relay, login item); lands
  asynchronously with a `sophia:desktop-ready` event.
- `electron/desktop-config.cjs` — pure URL/window/hotkey/pairing/icon/login
  builders + frozen IPC channel map; no Electron needed.
- `electron/desktop-config.test.mjs` — 15 tests incl. the standing
  no-`require()` rule check on the runtime files.
- `electron/dev.mjs` — dev launcher (waits for Vite, spawns Electron).
- `electron/make-tray-icon.mjs` + `electron/tray.png` — zero-dep icon.
- `electron/README.md` — run/layout/security/packaging notes.
- `src/types/desktop.d.ts` — `window.sophiaDesktop` typing.
- `src/ui/OrbOverlay.tsx` — compact `?orb=1` overlay (state dot, mic
  relay, expand button).
- `src/ui/DesktopBlock.tsx` — Settings → System desktop controls
  (pop-out orb, start-at-login); renders nothing in plain browsers.

**Changed**
- `src/App.tsx` — `?orb=1` branch (after all hooks), main→orb state
  broadcast, orb-command listener.
- `src/lib/companion-client.ts` — desktop auto-pair: bundled token+port
  preferred over manual codes (`connect` → `applyDesktopPairing` → socket).
- `src/core/mind-wiring.ts` — auto-connect on boot under the shell.
- `src/ui/SettingsSheet.tsx` — `DesktopBlock` in the System section.
- `package.json` / `package-lock.json` — `main: electron/main.cjs`,
  `electron:start` / `electron:dev` scripts, `electron` devDependency,
  `node --check` + electron tests in `npm test`.
- `RECOVERY.md`, `ROADMAP.md` — Phase 3 marked rebuilt.

## Proof

- `EVAL.log` — `npm run eval`: 100% (11 pass · 0 fail · 1 skip).
- `TEST.log` — `npm test`: all green (79 + 116, 0 fail).
- `npm run typecheck`, `npm run lint`, and `vite build` all clean.
- `node electron/main.cjs` without the binary prints the install hint and
  exits 1 (graceful degradation proven).

## Environment note

The sandbox blocks the GitHub release CDN, so the Electron *binary* could
not be downloaded here (`npx electron --version` fails); the npm package,
lockfile, and all headless proofs above are unaffected. On any normal
machine `npm install` fetches the binary via postinstall and
`npm run dev` + `npm run electron:dev` launches the shell.

## Restore

Copy `files/*` back over a checkout of the base commit, `npm install`
(with network access for the Electron binary), then `npm test` +
`npm run eval`.
