# Self-improve loop (Phase 25)

`npm run self-improve` — Sofia's supervised self-improvement: failed traces
in, gated improvements out. Nothing here phones home; drafts come from an
optional local Ollama, and every merge decision is computed by the
`decideMerge` gate in `scripts/self-improve.mjs`, which the agent itself
can never modify (see The Law).

## The loop

```
failed task traces (daemon memory) ─┐
mirror confidence lines (daemon) ────┤
failed eval tasks (--eval-json) ────┴─→ proposals (one branch each)
                                          ├─ skill patch (failure mode / retire)
                                          ├─ prompt/code draft (Ollama, --fix-file)
                                          └─ diagnosis report (no brain / no file)
                                       → sandbox eval per branch (disposable
                                         git worktree + harness's own fresh
                                         daemon; deps symlinked unless the
                                         branch touches manifests)
                                       → gate → merge | PR | drop
```

## The Law (enforced, not aspirational)

The agent can NEVER modify:

- `companion/policy*` — the safety policy,
- `scripts/eval*` — the eval suite and its baseline,
- `scripts/self-improve*` — its own approval logic.

`classifyFiles` checks every branch diff before any merge or PR. A
violation **deletes the branch** and drops the change with a loud log —
no PR, no merge, no trace left behind. `--fix-file` pointing at a
forbidden path refuses before anything is drafted. The working tree must
be clean or the run refuses to start.

Beyond that: **code and report branches always open a PR** — they are
never auto-merged. Only skill and prompt branches may merge, and only
through the gate below.

## The gate (`decideMerge`)

- **No regressions, ever.** Any failure present on the branch but absent
  on base blocks auto-merge (prompt → PR for a human; skill → dropped,
  branch kept for forensics).
- **Prompt margin** counts fixed failures:
  `|fixed| ≥ max(1, ceil(margin × |base|))`, default `--margin=0.5`.
  A green baseline means "nothing to beat" — the change is dropped.
- **Skill margin** is defined over task traces, not suite scores: the
  patch must validate, link ≥1 failed task trace, and ride a
  regression-free sandbox run. (Skills move *future* behavior; the suite
  cannot score them yet. Desktop-task replay is the designed next
  metric.) Skill data deploys to live daemon memory only AFTER merge,
  re-validated at apply time — stale patches are skipped, never forced.

## Proposers

| Signal | Proposal | Fate |
|---|---|---|
| Failed `task` episode matches a live skill + reflection has a `Failed:` cause | `memory/patches/*.json` adding the failure mode | Auto-mergeable |
| Skill rate < 0.5 over ≥5 uses (dream hasn't swept yet) | Status → `retired` patch | Auto-mergeable |
| Recurring error pattern (same `tool:kind` ×2+, Phase 27) matched to a live skill | `memory/patches/*.json` adding the pattern as a failure mode | Auto-mergeable |
| Failed evals + `--fix-file` + Ollama | Unified-diff draft on a branch | Prompt file + gate → merge; else PR |
| Failed evals, no file or no brain | `SELF_IMPROVE_REPORT.md` diagnosis | PR |

Skill attribution that feeds the rates: after every task, the task-tool
records the outcome against the top recalled how-to
(`recall-attribution` — documented in `src/tools/task-tool.ts`).

Mirror (Phase 27): every task also banks one `mirror` episode line
(`Mirror task #N conf=C ok=1|0|x steps=S [tools=…]`, outcome excluded from
calibration when cancelled). `--report` prints the calibration summary
(Brier + over/under-confidence gap) and the top `tool:kind` patterns;
patterns at ×2+ become skill-patch proposals with `motivating` = occurrence
count. Shared logic: `memory/mirror.mjs` (parse/mine/calibrate), formatted
by `src/core/task-mirror.ts` — the canonical line is pinned in both suites.

## Usage

```sh
# Analyze only — branches, merges, and PRs all disabled:
npm run self-improve -- --report

# Full loop with eval failures as signals (daemon must be running for
# skill signals: SOPHIA_COMPANION_PORT / SOPHIA_COMPANION_TOKEN):
npm run eval -- --json=eval.json
npm run self-improve -- --eval-json=eval.json

# Let it draft repairs for specific files (Ollama on :11434):
npm run self-improve -- --eval-json=eval.json --fix-file=src/core/task-decider.ts

# Stricter margin (fix 80% of baseline failures):
npm run self-improve -- --eval-json=eval.json --margin=0.8
```

## Scheduling (weekly or on demand)

On demand is the CLI above. Weekly is your OS scheduler — the loop is a
plain node script, so:

```sh
# cron — Sundays 04:00 (after the 03:00 dream), daemon running:
0 4 * * 0 cd /path/to/SofiaUI && SOPHIA_COMPANION_TOKEN=... npm run eval -- --json=/tmp/eval.json >/dev/null 2>&1 && SOPHIA_COMPANION_TOKEN=... npm run self-improve -- --eval-json=/tmp/eval.json >>/var/log/sophia-improve.log 2>&1
```

Windows: a Task Scheduler action running the same two commands via
`cmd /c`, with the token in the task's environment.

## Fire drill (proves the loop without touching your data)

```sh
export SOPHIA_COMPANION_PORT=7798 SOPHIA_COMPANION_TOKEN=drill SOPHIA_DATA_DIR=$(mktemp -d)
node companion/server.mjs &  # temp daemon, temp data
# …plant a skill + failed task + reflection via any WS client…
SOPHIA_COMPANION_PORT=7798 SOPHIA_COMPANION_TOKEN=drill npm run self-improve -- --report
# expect: "signals: 1 failed task trace(s)" + a skill-N proposal
```

## What the loop deliberately does NOT do

- Invent prompt prose from nothing — drafts need failing evals, a
  `--fix-file` scope, and a local model; anything else is a report PR.
- Touch flaky-timing margins — duration-based "improvement" is noise;
  the margin counts fixed failures only.
- Run the daemon itself — it connects as a client (skill signals) and
  lets the harness spawn sandboxed daemons (eval replays).
