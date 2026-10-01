# Phase 13 — Hands that work: voice gets the real PC (recovery artifact)

Built 2026-09-29 on `arena/01a0ebb7-sofiaui`. The user reported Sofia
couldn't type, in-app browser search was broken, local files wouldn't
open, and the mouse never moved. Diagnosis (traced end-to-end, daemon
smoke-tested healthy):

1. The voice Live session (`LIVE_TOOLS`) never declared the `computer`
   tool — voice literally had no mouse/keyboard/hands.
2. Pairing was undiscoverable: no auto-connect in plain browsers, no
   global prompt, and `not_connected` errors were dead ends.
3. `system_control open_app` opened FAKE web pages (calculator→desmos,
   notepad→wikipedia) instead of launching real apps.

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

**New**
- `src/ui/CompanionBanner.tsx` — slim global pairing bar (status,
  code + Pair, saved-pairing retry, exact terminal command), shown in
  every view while the companion is unreachable.
- `scripts/dev-all.mjs` — one command boots daemon + app with prefixed
  logs, installing companion deps first when missing; Ctrl-C stops both.

**Changed**
- `src/lib/sophia-live-server.ts` — `LIVE_TOOLS` gains
  `COMPUTER_SCHEMA` (client executes via the registry); prompt routes
  mouse/type/keys/apps/files/real-Chrome to it with a speak-the-fix
  rule; `dashboard` added to the voice `control_ui` enum.
- `src/tools/system-control.ts` — `open_app` delegates to real
  companion launches; fake app→website map deleted; description
  corrected to in-app + real browser/app scope.
- `src/sophia/control.ts` — voice "open X" failures raise a
  notification (companion-aware message) instead of dying silently.
- `src/tools/computer-tool.ts` — `not_connected` errors and the `see`
  hint speak exact fix steps; Linux xdotool-missing failures suggest
  the install + X11 note; new `open_file` action → `files_open`.
- `src/tools/computer-tool.test.ts` — 3 new tests (open_file mapping,
  actionable not_connected, xdotool hint) + `see` hint update.
- `src/core/mind-wiring.ts` — boot tries the stored pairing once in
  plain browsers (Electron flow unchanged).
- `src/ui/BrowserPanel.tsx` — in-app search retries DDG→Mojeek once
  when the proxy reports failure (DDG bot-walls server fetches).
- `src/App.tsx` — global banner render.
- `package.json` — `dev:all` + `companion` scripts; dev-all joins the
  `node --check` gates.
- `RECOVERY.md`, `ROADMAP.md` — Phase 13 recorded.

## Proof

- `EVAL.log` — `npm run eval` exit 0: 100% (15 pass · 0 fail · 1 skip).
- `TEST.log` — `npm test` exit 0: 79 + 281 pass, 0 fail.
- `npm run typecheck`, `npm run lint`, `npm run build` all clean.
- Daemon smoke test (this session): pair ok, 50 actions, ping ok,
  files_roots ok, get_cursor/type_text fail gracefully headless
  (`spawn xdotool ENOENT`), open_app correctly allowlist-gated.

## Notes

- For the user: run `npm run dev:all` (or `npm run companion` in a
  second terminal next to `npm run dev`), paste the printed pairing
  code into the banner, and voice gains hands immediately.
- Linux desktops need `sudo apt install xdotool` and an X11 session
  (Wayland cannot be driven); the tool error now says so itself.
- No daemon changes — the companion protocol was already correct.
