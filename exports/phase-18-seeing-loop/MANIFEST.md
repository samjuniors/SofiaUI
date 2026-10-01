# Phase 18 — Seeing loop: observe → one action → verify (recovery artifact)

Built 2026-09-29 on `arena/01a0ebb7-sofiaui`. The task loop now sees:
every step starts from a fresh `observe` (screenshot + active window +
UI tree), the brain picks ONE action against that screenshot, the loop
resolves/approves/acts/verifies, and stops on repeated screen states.
The plan-up-to-8-steps-upfront planner is deleted.

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

- `companion/observe.mjs` (new) — the `observe` companion action: scaled
  screenshot (long edge ≤1568px) + `scale` factor, `active_window`,
  `ui_tree` (UIA on win32, AX on macOS via osascript/JXA, `none`
  elsewhere), byte budgets, pure parsers (`parseUiaTree`, `parseAxTree`).
- `companion/observe.test.mjs` (new) — parser/budget tests incl. a
  Playwright-synthesized AX corpus; runs on any OS.
- `companion/policy.mjs`, `companion/server.mjs` — observe allowlist +
  dispatch wiring.
- `companion/README.md` — observe section.
- `src/core/task-decider.ts` (new, replaces `task-planner.ts`) — prompt
  builder (screenshot + ui_tree every call), strict JSON parse
  (computer-only, no model `confirm`), target/coords validation,
  `normalizeObservation` (daemon payload → `TaskObservation`),
  per-task episodic recall. Element ids preferred, shot-space coords
  as fallback.
- `src/core/task-decider.test.ts` (new) — 10 tests.
- `src/core/TaskLoop.ts` (rewritten) — single-step loop: decide →
  judge safety-gate → `resolveStepTarget` (id→physical center,
  coords÷scale, daemon never sees ids) → approval pause → act →
  settle → observe → repeat-stop → verify. Bounds: 12 steps,
  2 consecutive retries, repeat tolerance 1. Daemon
  `confirmation_required` pauses and redeems `confirmation_id`;
  model `confirm:true` is never sent. Kill switch + memory unchanged.
- `src/core/task-loop.test.ts` (rewritten) — 29 tests.
- `src/lib/chat-image.ts` + test (new) — multimodal chat helper.
- `src/lib/sophia-server.ts` — threads the screenshot through chat.
- `src/tools/task-tool.ts` — rewired: per-task recall, `decide` dep
  via `decideWithBrain`, `observe` dep via computer `observe`.
- `src/tools/computer-tool.ts` (+ test) — `observe` invoke case,
  deliberately NOT in `COMPUTER_SCHEMA` (base64 must not ride LLM
  function responses).
- `src/ui/TaskPanel.tsx` — renders `decided` steps as they arrive,
  `retry` notes; no upfront plan UI.
- `package.json` — test list: computer + decider + loop + chat-image.
- `ROADMAP.md` — this entry; Phase 11a marked rewritten-in-18.

Deleted (not in `files/`): `src/core/task-planner.ts` and
`src/core/task-planner.test.ts` (`git rm`).

## Verify

- `npm run typecheck`, `npm run lint` — clean.
- `npm test` — 134 + 297 pass (see TEST.log).
- `npm run eval` — 100%, 16 pass · 0 fail · 1 skip (see EVAL.log).
- `npm run build` — passes.

## Notes for the next session

- Tool payloads >~11KB get truncated in transit: keep writes/appends
  small and re-verify with tests/`od` after every big heredoc.
- `read_file`/terminal output double backslashes; `od -c` is ground
  truth for `\n` vs `\\n` questions.
- `task-decider.ts` and `TaskLoop.ts` both needed mid-write truncation
  recovery this phase (`head -n <last-good>` + quoted-heredoc append).
