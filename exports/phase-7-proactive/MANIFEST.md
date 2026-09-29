# Phase 7 — Proactive & provable (recovery artifact)

Rebuilt 2026-09-29 after the sandbox loss described in `RECOVERY.md`.
Branch: `arena/01a0ebb7-sofiaui`.

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

**New**
- `src/sophia/AmbientScheduler.ts` — EventTarget singleton: `daily`
  (HH:MM) + `interval` (everyMs) rules, quiet hours 22:30–07:45,
  delta-only alerts via signatures, 30s ticks, `sophia:proactive:v1`
  persistence, injectable `{healthCheck, briefing, alert}` handlers,
  `healthNow`/`runNow` explicit runs; built-ins health-watch
  (enabled, 4h, alerts score<70 or warnings changed) and
  morning-briefing (disabled, 08:00).
- `src/sophia/ambient-scheduler.test.ts` — 14 tests under a stub
  clock + storage (quiet boundaries, due logic, `lastRunAt`
  re-arming, delta sequences, persistence, failure backoff).
- `src/lib/proactive-wiring.ts` — hosts the singleton: healthCheck
  via companion `health_snapshot`, briefing composer, alert → toast
  + info card, companion-reconnect catch-up tick.
- `src/tools/proactive-tool.ts` — `proactive` tool
  (list/enable/disable/health_now) with its LLM schema; injectable
  scheduler for tests.
- `src/tools/proactive-tool.test.ts` — 6 tests with a fake scheduler.
- `src/ui/ProactivePanel.tsx` — routines list with toggles, rule /
  last / next run, manual Run now, quiet-hours footnote.

**Changed**
- `src/App.tsx` — `wireProactive()` booted next to `wireMind()`.
- `src/tools/registry.ts` — tool registered with schema (joins the
  voice + chat declarations automatically) + progress label.
- `src/core/SkillsRegistry.ts` — `proactive` joins LOCAL_SKILLS
  (toggleable; the guard refuses it when disabled).
- `src/ui/SettingsSheet.tsx` — Proactive & Routines accordion with
  an enabled-count badge.
- `package.json` — two new test files join `npm test`.
- `RECOVERY.md`, `ROADMAP.md` — Phase 7 marked rebuilt.

## Proof

- `EVAL.log` — `npm run eval` exit 0: 100% (15 pass · 0 fail · 1 skip).
  No daemon changes this phase, so no new tasks; the battery is
  untouched and green.
- `TEST.log` — `npm test` exit 0: 79 + 202 pass, 0 fail.
- `npm run typecheck`, `npm run lint`, `npm run build` all clean.

## Notes

- Quiet hours freeze routines without advancing state, so nothing
  is silently swallowed overnight — deferred checks run at 07:45.
- Failed checks back off to the next slot (recorded as `lastError`)
  instead of retry-spamming every 30s tick.
- Failing health re-alerts only on bucket/warning-set changes; a
  score drift from 62→63 while unhealthy stays silent by design.
