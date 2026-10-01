# Phase 11c — Judge memory: learning that survives restarts (recovery artifact)

Built 2026-09-29 on `arena/01a0ebb7-sofiaui`. Phase 11b's judge learned
within a session and forgot everything on reload; now its learning
persists and compounds — buckets plus self-tuning evidence weights.

## The method (added in 11c)

1. **Kind-bearing evidence** — gate evidences carry stable identities
   (`plan:length`, `plan:expect`, `plan:risk`). Tickets snapshot the
   kinds + probabilities that fired, so the later outcome can grade
   each voice individually.
2. **Multiplicative weight learning** — each resolved outcome nudges
   every fired kind ±6% (×1.06 when it pointed at the outcome,
   ÷1.06 when it missed), clamped to 0.25–4×. An evidence pack that
   keeps crying success while tasks fail is gradually muted; one
   that warns correctly gains influence. Only the gate learns —
   verify/recovery have no ground truth, unchanged restraint.
3. **Two-leg persistence** — `JudgeMemory` writes localStorage on
   every save and the companion `store_put` when paired; load takes
   the newest copy by `updatedAt` and pushes a newer local copy up.
   Malformed copies are ignored, transport failures degrade to
   judging uncalibrated. The runner loads once (first task) and
   saves after every task; neither leg can throw into the loop.

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

**New**
- `src/core/judge-memory.ts` — `JudgeMemory` (load/save/newest-wins/
  push-up, injected caller + storage, `companion.send` default via
  the MemoryStore pattern).
- `src/core/judge-memory.test.ts` — 8 tests (both legs, failure of
  either leg, null storage, newest-wins both directions, push-up,
  empty, malformed).

**Changed**
- `src/core/decision-judge.ts` — `Evidence.kind`; tickets carry `ev`;
  calibrator learns weights (`weight()`, clamped), snapshots
  `{buckets, weights}`, restores new + legacy buckets-only +
  malformed-safe shapes with count/weight sanitation; judge threads
  learned multipliers through all three questions and gains
  `importMemory()`.
- `src/core/decision-judge.test.ts` — 5 tests (nudge directions,
  clamps, ticket evidence, learned weights strictly moving a gate
  judgment 3→≤2 after 12 failures, snapshot round-trip + legacy +
  garbage).
- `src/tools/task-tool.ts` — shared judge loads persisted learning
  once, saves after every task (best-effort, never throws).
- `package.json` — new test file joins `npm test`.
- `RECOVERY.md`, `ROADMAP.md` — Phase 11c recorded.

## Proof

- `EVAL.log` — `npm run eval` exit 0: 100% (15 pass · 0 fail · 1 skip).
- `TEST.log` — `npm test` exit 0: 79 + 278 pass, 0 fail.
- `npm run typecheck`, `npm run lint`, `npm run build` all clean.

## Notes

- `companion-client` exports no `defaultCaller` — the correct UI-side
  call path is `companion.send(action, args)` (see MemoryStore). An
  early 11c draft imported a nonexistent default and was corrected
  before it ever ran.
- Weight learning is deliberately slow (±6%): a handful of tasks
  calibrates buckets first; weights compound over dozens of tasks.
- Snapshot key `sofia.judge.calibration.v1`, document `{v, updatedAt,
  calib}` — version field reserved for future migrations.
