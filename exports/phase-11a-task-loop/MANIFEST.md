# Phase 11a — Decision loop: plan → verify → replan (recovery artifact)

Built 2026-09-29 on `arena/01a0ebb7-sofiaui`. Sofia's prefrontal cortex:
multi-step desktop goals that plan, check their work by observation,
recover via replanning, and ask before irreversible steps — the
production computer-use loop (observe → act → verify), with the JEPA
"predict the consequence, then verify" idea implemented symbolically
instead of as a trained world model.

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

**New**
- `src/core/task-planner.ts` — plan types, planner prompt (grounded
  with the PC snapshot), strict `parsePlan` validation
  (computer-only, known actions, ≤8 steps, typed expectations),
  `planWithBrain` over `/api/sophia/chat` with an empty history.
- `src/core/task-planner.test.ts` — 8 tests (parse/validate/prompt,
  stubbed-fetch planner incl. failure modes).
- `src/core/TaskLoop.ts` — dependency-free loop: plan → checkpoint →
  act → verify → replan; pauses on planned gates AND daemon
  confirmation gates; bounded replans (2) + step budget (12);
  cancel/resume; `task:state` event bus; outcome → episodic memory.
- `src/core/task-loop.test.ts` — 12 tests (happy path, replan,
  exhaustion, pauses, daemon gates, budget, cancel, autoConfirm).
- `src/tools/task-tool.ts` — `task` tool (goal/confirm/cancel, one at
  a time) wiring the real deps: brain planner, registry executor,
  computer.see + find_text observer, episodes memory hook.
- `src/tools/task-tool.test.ts` — 4 tests with a stub runner.
- `src/ui/TaskPanel.tsx` — floating live step-log card: plan steps
  with states, replan notes, Approve/Deny on pauses, Stop, summary.

**Changed**
- `src/tools/registry.ts` — tool registered with schema + label.
- `src/core/SkillsRegistry.ts` — `task` joins LOCAL_SKILLS.
- `src/App.tsx` — `<TaskPanel />` on the main screen.
- `package.json` — three new test files join `npm test`.
- `RECOVERY.md`, `ROADMAP.md` — Phase 11a recorded.

## Proof

- `EVAL.log` — `npm run eval` exit 0: 100% (15 pass · 0 fail · 1 skip).
  No daemon changes; the battery is untouched and green.
- `TEST.log` — `npm test` exit 0: 79 + 245 pass, 0 fail.
- `npm run typecheck`, `npm run lint`, `npm run build` all clean.

## Notes

- Node strip-types traps hit again: TS parameter properties
  (`constructor(private ...)`) are unsupported — use explicit fields;
  runtime (non-type) imports need explicit `.ts` suffixes.
- Plans are computer-only and cap at 8 steps; the loop caps at 12
  executed steps and 2 replans — long tasks chain via follow-up goals.
- Verification is symbolic (window titles + grounded text), not pixel
  diffing: on the voice path the streaming frames let the model see
  too; a learned visual predictor stays a possible Phase 11c.
