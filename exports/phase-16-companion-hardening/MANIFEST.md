# Phase 16 — Companion hardening + API auth (recovery artifact)

Built 2026-09-29 on `arena/01a0ebb7-sofiaui`. The user ordered six
companion fixes (each with a test in `policy.test.mjs`) plus better-auth
on every `/api/sophia/*` route, deny by default. All six shipped with
20 new companion tests, the web confirm protocol was migrated to match
(item 4 reaches into the tool/TaskLoop layers), and the API gate was
verified live (200 default dev, 401 signed-out with auth on).

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

**Companion (items 1–6)**
- `companion/policy.mjs` — `appAllowed()` exact-match only; `CONFIRM_WORDS`
  substring scan replaced by `classifyRisk()` (word boundaries + daemon-read
  target text); one-time `confirmation_id`s (`issue`/`approve`/`redeem`,
  model `confirm:true` ignored).
- `companion/system.mjs` — linux allowlist→binary map + detached spawn;
  `sendKeysFor()` hotkey parser; `DisplayMetrics` (DPI + virtual-screen
  offsets) with per-backend conversion; win32 ABSOLUTE drag, darwin drag,
  Quartz scroll, CoreAudio volume set/get; UIA/focused-element target reads.
- `companion/server.mjs` — target-text gathering for click/hotkey,
  `type:"confirm"` redemption message, `confirmation_id` passthrough.
- `companion/policy.test.mjs` — 20 new tests (33 total with voice suite).
- `companion/README.md` — confirm protocol + DPI env vars documented.

**Web protocol follow-through (item 4)**
- `src/lib/companion-client.ts` — `confirmation_id` on replies, `action` on
  confirmed, new `confirm()` redemption call (UI/voice handler only).
- `src/tools/computer-tool.ts` — model `confirm` dropped from schema;
  `confirmation_id` threaded; id surfaced on `confirmation_required`.
- `src/tools/registry.ts` — id passes through on failure results.
- `src/core/TaskLoop.ts` — `deps.confirm` redemption after user approval;
  pre-approved steps redeem without asking twice; no self-confirm.
- `src/tools/task-tool.ts` — real-runner `confirm` dep; model can no longer
  set autoConfirm (schema field removed).
- `src/core/task-loop.test.ts`, `src/tools/task-tool.test.ts`,
  `src/tools/computer-tool.test.ts` — updated to the id protocol.

**API auth**
- `src/lib/sophia-server.ts` — `requireSophiaSession()` gates every
  `/api/sophia/*` route (deny by default; dev-allow only when auth is off
  with no database, mirroring `requireUserId`).
- `src/lib/sophia-fetch.ts` — new bearer-attaching fetch wrapper.
- 11 client files — all 20 `/api/sophia/*` fetch sites use `sophiaFetch`.

**Docs**
- `RECOVERY.md`, `ROADMAP.md` — Phase 16 recorded.

## Proof

- `EVAL.log` — `npm run eval` exit 0: 100% (15 pass · 0 fail · 1 skip).
- `TEST.log` — `npm test` exit 0: 99 + 282 pass, 0 fail.
- `npm run typecheck`, `npm run lint`, `npm run build` all clean.
- Live curl: default dev 200 + chat 503 (past gate, no keys); auth-on 401
  on GET/POST/garbage-bearer.
