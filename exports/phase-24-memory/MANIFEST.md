# Phase 24 — Long-term memory: four stores, nightly dreams, per-turn recall (recovery artifact)

Built 2026-09-30 on `arena/01a0ebb7-sofiaui`. Sofia grows a real memory:
four Honcho-shaped stores on the daemon, a Deriver that banks conclusions at
write time, hybrid retrieval injected into every turn, and a nightly dream
that merges, resolves, decays, flags, summarizes, and proposes skills — all
under strict trust rules (sourced facts only, untrusted capped, user-only
endorsement, every write logged).

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

- `memory/` (new) — the engine. `schema.mjs` (validation + trust: facts
  require a source tag; only `user`/`assistant` are trusted; untrusted
  confidence capped at 0.4), `store.mjs` (node:sqlite + JSON fallback, FTS5
  + vector legs), `derive.mjs` (write-time Deriver: explicit + deductive
  conclusions in Honcho's formal-logic shape), `retrieve.mjs` (hybrid
  vector + full-text + recency, token-budgeted `block`, embeddings stripped
  from rows, recall touches feed decay), `consolidate.mjs` (the dream:
  merge duplicates, newest × highest-confidence contradiction resolution
  with supersede-never-delete, decay, flag-below-0.4, episode summaries,
  skill induction ≥2 support / activation ≥3, cooldown + min-delta
  guarded), `actions.mjs` (16-action daemon dispatch + writes log),
  `memory.test.mjs` (23 tests), `README.md` (design record + Honcho map).
- `companion/server.mjs` — dispatches the 16 `memory_*` actions.
- `companion/policy.mjs` — actions registered in ACTIONS; audit receipts
  carry store + op + ref only, never memory content.
- `src/lib/memory.ts` (new) — typed client (best-effort embed,
  `recallForTurn` never throws) + `clearWorking`; `src/lib/memory.test.ts`
  (5 tests).
- `src/ui/MemoryBrowser.tsx` (new) — Facts / Episodes / How-tos / Working /
  Writes tabs with edit/pin/delete/export + Dream-now; mounted in
  `src/ui/settings/MindSections.tsx` (Memory & Facts accordion).
- `src/sophia/AmbientScheduler.ts` — `memory-consolidation` builtin (daily
  03:00, enabled, `runInQuietHours` opt-in — the one routine that runs
  inside quiet hours), silent dream branch (summary in `lastSignature`,
  never alerts); `ambient-scheduler.test.ts` (15 tests).
- `src/lib/proactive-wiring.ts` — `consolidate` handler (daemon dream via
  `runConsolidationNow`; companion down → recorded error + backoff).
- `src/sophia/SophiaOS.ts` — `sendText` injects the recall block every turn
  (`context.recall`, null when nothing remembered).
- `src/tools/task-tool.ts` — running goal parked in working memory, outcome
  banked as an episode with kind/outcome/importance; all best-effort.
- `src/tools/proactive-tool.test.ts` — handler + 3-routine list updates.
- `scripts/eval-tasks.mjs` — 5 memory tasks (fact lifecycle + trust rules,
  episode→context recall, working round-trip, contradiction newest-wins,
  consolidation shape/cooldown); `scripts/eval-baseline.json` pins all 44.
- `package.json` — `npm test` runs `memory/memory.test.mjs` +
  `src/lib/memory.test.ts`.
- `ROADMAP.md` — Phase 24 entry.

## Gates (this run)

- `npx tsc --noEmit`: clean.
- `npm test`: 354 pass · 0 fail (see `TEST.log`).
- `npm run eval -- --baseline=scripts/eval-baseline.json`: 100%
  (23 pass · 0 fail · 21 skip), BASELINE: no regressions (see `EVAL.log`).

## Restore notes

Copy `files/` over a checkout of this branch at the Phase 24 commit, then
`npm run setup && npm test && npm run eval:core`. Memory data lives under
`$SOPHIA_DATA_DIR/memory/` (sqlite or JSON fallback + `shots/`); the dream
runs at 03:00 local via the scheduler, or on demand from Memory & Facts.
