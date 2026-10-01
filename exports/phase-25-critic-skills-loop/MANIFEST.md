# Phase 25 — Critic reflections, skill distillation v2, self-improvement loop (recovery artifact)

Built 2026-09-30 on `arena/01a0ebb7-sofiaui`, on top of Phase 24b
(`4c3f791`). This is the "prompt 3" phase: the critic that reflects after
every task, the full Skill schema with success rates and retirement, and
the supervised loop that turns failures into gated improvements.

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

- `src/core/task-critic.ts` (new) — pure `critiqueTask` (goal, steps,
  worked/failed, verdict) + `failureCause`; banked form has
  machine-readable `Failed:` lines. `task-critic.test.ts` (3 tests).
- `src/tools/task-tool.ts` — `episodeMoves` (`[moves: click@Login; …]`)
  banked beside the trail; critic reflection banked as a `reflection`
  episode linked to its task episode; every run attributed to the top
  recalled how-to via `recordSkillUse`. (+1 test.)
- `memory/` — `reflection` episode kind; skill envelope v2
  (`distillSkill`: trail, moves, params, preconditions, verification,
  failureModes); `memory_skill_use` (17th action) with derived
  `successRate`, cause banking, auto-retire <0.5 over ≥5 uses; dream
  retirement sweep (`skillsRetired`); `listEpisodes` outcome filter;
  context skills carry use/success counts. (+4 engine tests → 29.)
- `companion/server.mjs` + `policy.mjs` — dispatch, ACTIONS, content-free
  `memory_skill_use` receipt.
- `src/lib/memory.ts` — `TurnMemory.skills`, `recordSkillUse`,
  `MemorySkill.successRate/steps`; `src/ui/MemoryBrowser.tsx` How-tos
  show rate and failure modes.
- `scripts/self-improve.mjs` (new) + `SELF_IMPROVE.md` — the loop:
  failed task traces + `--eval-json` → skill patches / Ollama drafts /
  reports, one branch each, sandbox worktree replays, `decideMerge`
  gate (no-regressions + margin; code/report always PR; forbidden
  paths delete the branch). `self-improve.test.mjs` (7 tests incl.
  red-team: policy/suite/self modification refused).
- `scripts/eval-tasks.mjs` (+1: `memory_skill_use_rate` — counting,
  cause banking, 2/5 → retired; `consolidate_shape` gains
  `skillsRetired`), `scripts/eval-baseline.json` (47 tasks),
  `package.json` (`self-improve` runner + test segments), `ROADMAP.md`.

## Gates (this run)

- `npx tsc --noEmit`: clean.
- `npm test`: 540 pass · 0 fail (181 JS + 359 TS segments — `TEST.log`).
- `npm run eval -- --baseline=scripts/eval-baseline.json`: 100%
  (26 pass · 0 fail · 21 skip), BASELINE: no regressions (`EVAL.log`).
- Live drills: signal→proposal chain vs a temp daemon (matched skill +
  valid patch); `--report` on the committed tree; dirty-tree refusal.

## Restore notes

Copy `files/` over a checkout of this branch at the Phase 25 commit, then
`npm run setup && npm test && npm run eval:core`. Skill rates live in the
daemon DB (`success_count`/`use_count`); the loop needs a running daemon
for skill signals and (optionally) Ollama on :11434 for code drafts.
