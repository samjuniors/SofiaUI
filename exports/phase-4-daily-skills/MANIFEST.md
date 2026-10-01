# Phase 4 — Daily skills UI (recovery artifact)

Rebuilt 2026-09-29 after the sandbox loss described in `RECOVERY.md`.
Branch: `arena/01a0ebb7-sofiaui`.

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

**New**
- `src/lib/daily-skills.ts` — typed client for the daily companion
  skills: files, PC health, media, WhatsApp draft-first. Injectable
  caller (default: the live companion link), `DailyError` codes,
  phone/path/volume validation, `joinChild`, `isSetupError`, formatters.
- `src/lib/daily-skills.test.ts` — 22 tests with a fake transport:
  sorting, validation, confirm-flag threading, draft-first send gate,
  shape normalisation, formatters.
- `src/ui/DailyPanel.tsx` — tabbed Daily panel (Files · Health ·
  Media · WhatsApp) + shared `CompanionBlock` pairing strip (also
  rendered in Settings → System). Auto-connects on open when a pairing
  already exists.
- `src/ui/DailyFiles.tsx` — root chips, breadcrumbs, search, preview,
  open-in-default-app, inline rename, two-step trash, session restore.
- `src/ui/DailyHealth.tsx` — score ring, CPU/RAM bars, disks, battery,
  top processes, warnings; refreshes every 30s while open.
- `src/ui/DailyMedia.tsx` — transport (prev/play-pause/next/stop) +
  volume slider and mute over the best-effort `media_*` actions.
- `src/ui/DailyWhatsApp.tsx` — unread banner, draft-first compose:
  drafting never sends, Send wakes only for the exact drafted text and
  still asks inline; degrades to a setup card until the daemon gains
  playwright-core + a Chrome profile.

**Changed**
- `src/App.tsx` — `dailyOpen` state, `<DailyPanel/>`, Dock props,
  `command:ui` `daily` target (+ `all` close), `F` toggle, Esc chain.
- `src/ui/Hud.tsx` — Dock `dailyOpen`/`onToggleDaily` + Folder button.
- `src/ui/SettingsSheet.tsx` — `CompanionBlock` in System & Gestures.
- `src/tools/types.ts`, `src/tools/ui-control.ts`, `src/tools/registry.ts`,
  `src/lib/sophia-live-server.ts` — `daily` joins the panel names, the
  `ui_control` tool, and both voice-tool schemas, so "open Daily" works
  by voice with no extra dispatch code (`command:ui` is generic).
- `scripts/eval-tasks.mjs` — `media_status_shape` (media) and
  `whatsapp_unavailable_graceful` (messaging) tasks locking the
  contracts the UI depends on.
- `package.json` — `daily-skills.test.ts` joins `npm test`.
- `RECOVERY.md`, `ROADMAP.md` — Phase 4 marked rebuilt.

## Proof

- `EVAL.log` — `npm run eval` exit 0: 100% (13 pass · 0 fail · 1 skip).
- `TEST.log` — `npm test` exit 0: 79 + 138 pass, 0 fail.
- `npm run typecheck`, `npm run lint`, `npm run build` all clean.

## Notes

- No daemon changes: every tab drives companion actions already in the
  tree (`files_*`, `health_*`, `media_*`, `whatsapp_*`); `files_trash`
  and `whatsapp_send` stay behind their confirmation gates, with the
  UI doing the first inline-confirm step and the policy the second.
- WhatsApp actions fail closed (`action_failed` + playwright hint)
  until the optional backend is configured; the UI treats that as a
  setup state, not an error.
