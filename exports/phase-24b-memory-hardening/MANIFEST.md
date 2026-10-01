# Phase 24b — Memory hardening: episode screenshots, real skill steps, ungated writes (recovery artifact)

Built 2026-09-30 on `arena/01a0ebb7-sofiaui`, on top of Phase 24 (`71eecb5`).
A re-audit of the shipped memory system against the spec found two genuine
gaps plus one real bug; all three are closed here.

## What was missing (honest audit)

1. Task episodes banked text + outcome but **never the screenshot** the spec
   requires — the `shots` plumbing existed end to end with zero writers.
2. Induced skills carried a **placeholder** (`steps.note: 'skill steps
   defined by prompt 3'`) — proposed and activated, but with no usable body.
3. **Bug:** `classifyRisk` scanned EVERY action's args, so any memory write
   mentioning a risk word ("restart the printer", "delete the temp files")
   was confirmation-gated and — because task-tool memory is best-effort —
   silently dropped. The memory log was losing exactly the outcomes it
   exists to keep.

## What's inside

`files/` mirrors the repo paths of every file this increment changed:

- `src/tools/task-tool.ts` — `episodeTrail()` banks `[trail: observe →
  click → type]` on every task episode; outcome screenshot captured
  best-effort (headed-only, 1.8 MB cap, daemon drops anything bigger).
- `memory/consolidate.mjs` — `extractTrail`/`commonTrail` (pure):
  induction strips the marker before pattern-grouping, then banks
  `{ trail, via: 'induction', support }` when ≥2 wins share one shape,
  `{ note: 'varied executions; pattern only' }` otherwise.
- `companion/policy.mjs` — `memory_*`/`store_*`/`episodes_*` never gate:
  memory content is data, not instructions.
- Tests: `memory/memory.test.mjs` (+2: trail helpers, real-vs-fallback
  steps), `src/tools/task-tool.test.ts` (+1: `episodeTrail`),
  `companion/policy.test.mjs` (+1: six gated-word writes pass, real
  instruction still gates), `scripts/eval-tasks.mjs` (+2 end-to-end:
  `memory_skill_induction` — 3 wins → ACTIVE skill with `trail` steps,
  keeps "Restart" in its text as a full-path gating regression guard;
  `memory_episode_shots` — valid PNG saved to `memory/shots/`, junk
  dropped, `shots: 1`).
- `scripts/eval-baseline.json` (46 tasks), `ROADMAP.md` (24b entry).

## Gates (this run)

- `npx tsc --noEmit`: clean.
- `npm test`: 525 pass · 0 fail (170 JS + 355 TS segments — see `TEST.log`).
- `npm run eval -- --baseline=scripts/eval-baseline.json`: 100%
  (25 pass · 0 fail · 21 skip), BASELINE: no regressions (see `EVAL.log`).

## Restore notes

Copy `files/` over a checkout of this branch at the Phase 24b commit, then
`npm run setup && npm test && npm run eval:core`.
