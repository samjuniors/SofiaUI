# Phase 11b — Decision core: our own Jev, zero API (recovery artifact)

Built 2026-09-29 on `arena/01a0ebb7-sofiaui`. The user pointed at
TypeSafe's Jev (typed decisions + calibrated confidence, no
hallucination) and asked for OUR OWN version with no API — so the
System-One judge is decision math, not model calls.

## The method (what Jev does, rebuilt)

Jev: state + typed questions in, schema-valid answers with calibrated
probabilities out. Ours:

1. **Log-odds evidence fusion** — each judgment runs small
   deterministic evidence scorers over structured state and pools
   them as prior + Σ weight × logit(p), the fusion behind naive
   Bayes / logistic regression. Every evidence carries a `why`, so
   every judgment is explainable.
2. **Outcome calibration** — our RLCD: plan-gate tickets record the
   predicted probability; task completion reports done/failed back
   into per-question reliability buckets (Laplace-smoothed), bending
   future predictions toward observed frequencies. The judge gets
   better calibrated the more tasks run — no training run needed.
3. **Honest confidence** — extremity × evidence agreement ×
   experience. Conflicting evidence or no history yields LOW
   confidence, and the loop asks instead of acting.

Only the plan gate is calibrated: it has clean ground truth (the task
later succeeded/failed). Verifying the verifier would only reinforce
the heuristic, so verification stays uncalibrated — a deliberate
restraint, documented in the module.

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

**New**
- `src/core/decision-judge.ts` — `SofiaJudge` (Choice/Score/Noul),
  `fuseEvidence`, `confidenceOf`, `BucketCalibrator`
  (pending/resolve/adjusted + snapshot/restore), `parseJudgeState`,
  evidence packs for plan gate / verify / recovery triple.
- `src/core/decision-judge.test.ts` — 11 tests (fusion math,
  confidence, calibration learning + persistence, state parsing,
  gate scoring + learning loop, verify evidence, recovery choices,
  honest strictness on unknown shapes).

**Changed**
- `src/core/TaskLoop.ts` — advisory `judge` dep: plan gate (shared
  by initial + replan paths), verify second-opinion, recovery Choice
  with shared replan budget, per-step approval memory across
  retries, calibration tickets resolved at finish (accepted plans
  only). Judge errors always fail open.
- `src/core/task-loop.test.ts` — 7 new tests (gate reject/pass,
  fail-open, retry_same, ask_user approve/deny, low-confidence
  fallback, override, doubt-flip).
- `src/core/task-planner.ts` — `PlannerContext.memory` + prompt line
  + `recallSimilar` (top-3 past tasks, best-effort).
- `src/core/task-planner.test.ts` — 2 new tests (recall, prompt).
- `src/tools/task-tool.ts` — real runner wires the shared
  `SofiaJudge` (one instance, so calibration learns across tasks)
  and memory recall into planning.
- `package.json` — new test file joins `npm test`.
- `RECOVERY.md`, `ROADMAP.md` — Phase 11b recorded.

## Proof

- `EVAL.log` — `npm run eval` exit 0: 100% (15 pass · 0 fail · 1 skip).
  No daemon changes; the battery is untouched and green.
- `TEST.log` — `npm test` exit 0: 79 + 265 pass, 0 fail.
- `npm run typecheck`, `npm run lint`, `npm run build` all clean.

## Notes

- Same-file parallel edits CONFLICT in this environment (last write
  wins silently): the retry-evidence retune was lost once and had to
  be re-applied. One edit per file per round from here on.
- `prefer-const` flags a `let` that is assigned exactly once after a
  closure reads it; the gate ticket uses a `const` holder object.
- Calibration is memory-only in 11b (shared judge instance). The
  snapshot/restore API is ready for companion-store persistence —
  the natural Phase 11c alongside memory-backed evidence weights.
