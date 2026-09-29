# Phase 22 — Trust & control: agent bar, target preview, receipts, onboarding, splits (recovery artifact)

Built 2026-09-30 on `arena/01a0ebb7-sofiaui`. The agent is now supervised:
a persistent control bar with Stop, a see-before-it-clicks approval overlay,
an activity receipt list with undo for reversible file ops, and a first-run
wizard — plus the two big-file splits (SettingsSheet, SophiaOS) done with
zero behavior change.

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

- `src/core/TaskLoop.ts` (+ tests) — `StepPreviewTarget` (physical click
  point + element box; drag end-points; null when targetless) flows from
  `resolveStepTarget` into step records, `step` events, and a new `preview`
  event raised on every approval pause (question + reason + target + the
  fresh screenshot) and dismissed on resume/deny/terminal states.
- `src/ui/AgentBar.tsx` (new) — persistent "Agent is controlling your PC"
  strip: live step text, big red Stop, Esc to stop. Dialogs own Esc while
  open; inputs keep theirs. Mounted in App for every view.
- `src/ui/TargetPreview.tsx` (new) — approval modal: the pause screenshot
  with crosshair / element box / drag path in an SVG overlay, Approve & run
  / Deny (Esc denies — a parked pause must resolve, never hide).
- `companion/policy.mjs` (+ tests) — `summarizeAction` (redacted human
  detail per action; typed/dictated/message content NEVER logged, lengths
  only) with machine `undo` for files_move / files_trash / files_restore;
  `readRecent(n)` (windowed 256KB tail, corrupt lines skipped, capped);
  `actions_recent` in ACTIONS (read-only, never gated, non-mutating).
- `companion/server.mjs` — `actions_recent` dispatch returning
  `{ receipts }`; all four audit sites enriched with `detail` (+ `undo`
  when reversible). `actions_recent` never logs itself (no feedback loop).
- `src/lib/receipts.ts` (new) — `fetchRecentActions` + `undoReceipt`
  (allowlisted to the three file ops; the Undo tap is the explicit
  approval, so gated undos redeem via the UI confirm path and retry once).
- `src/ui/ReceiptsPanel.tsx` (new) — newest-first receipts with per-row
  Undo, refresh, offline + error states; entry button in StatusCluster
  (`src/ui/Hud.tsx`), `receiptsOpen` state in `src/App.tsx`.
- `scripts/eval-tasks.mjs` — `actions_receipts`: receipts ordered, shaped,
  secret-free; the receipt's own undo op restores a moved file end to end;
  reading receipts writes no receipt.
- `src/ui/Onboarding.tsx` (rewrite) + `src/lib/onboarded.ts` (new) —
  4-step wizard (pair companion → permissions incl. mic → Hands check via
  embedded HandsCard → deterministic read-only demo: active window +
  screenshot), mounted after boot; keeps the `sophia:onboarded` key.
- `src/ui/SettingsSheet.tsx` + `src/ui/settings/` (13 modules, new) —
  1559 → 248-line shell; sections render their own accordion (badges stay
  next to their mutators), store listeners and server-status fetch stay in
  the shell. Verbatim JSX, zero visual change.
- `src/sophia/SophiaOS.ts` + `src/sophia/os/` (4 modules, new) — prefs
  (types/defaults/loader), diagnostics (snapshot builders), speech (neural
  TTS + mic/voice self-tests), wake (spotter lifecycle behind a live-read
  host). 1248 → 1067-line runtime core; public API unchanged.
- `ROADMAP.md` — this entry.

## Verify

- `npm run typecheck`, `npm run lint` — clean.
- `npm test` — 144 + 328 pass (see TEST.log).
- `npm run eval` — 100%, 18 pass · 0 fail · 1 skip (see EVAL.log).
- `npm run build` — passes.

## Notes for the next session

- One transient eval dip (94%) during the phase re-ran green three times;
  the battery has a pre-existing flake somewhere outside the receipts task.
- `wakeDetector` in SophiaOS is dead (never assigned, only a `?.` no-op in
  `activate`) — left untouched on purpose.
- Non-id-targeted `type_text` etc. yield no preview target by design; the
  overlay says so instead of guessing.
- Task↔receipt correlation (which task produced which log lines) is still
  open, as is the pre-vector episode backfill from Phase 21.
- Sandbox loses `node_modules` between turns — reinstall root + companion
  when `tsc`/tests go missing.
