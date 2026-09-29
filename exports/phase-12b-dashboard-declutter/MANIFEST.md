# Phase 12b — Dashboard declutter: an OS control center (recovery artifact)

Built 2026-09-29 on `arena/01a0ebb7-sofiaui`. The user found the
dashboard cramped and friction-y, wanted an OS feel, settings editors
out, the important things (companion first) one tap away, and the
main Sofia view stripped to essentials.

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

**Changed**
- `src/ui/DashboardView.tsx` — rewritten: three labeled roomy
  sections (NOW: task + routines; SYSTEM: companion pairing via the
  shared `CompanionBlock`, quick-action tiles, live system status;
  MEMORY: moments + memory/skills summary tiles). Full Memory/Skills
  editors removed (live counts + "Edit/Manage in Settings" links).
  Wider canvas (7xl), bigger gaps/padding, header slimmed to
  title + status pills.
- `src/App.tsx` — bottom-left terminal button removed from the main
  view (dashboard quick actions + backtick cover it); dashboard gets
  the `onBackToSofia` shortcut.
- `RECOVERY.md`, `ROADMAP.md` — Phase 12b recorded.

## Proof

- `EVAL.log` — `npm run eval` exit 0: 100% (15 pass · 0 fail · 1 skip).
- `TEST.log` — `npm test` exit 0: 79 + 281 pass, 0 fail.
- `npm run typecheck`, `npm run lint`, `npm run build` all clean.

## Notes

- No new unit tests: pure view composition over already-tested
  panels and stores; verification is typecheck + lint + build.
- Settings has no section deep-link (accordion state is internal),
  so summary tiles open Settings without pre-selecting a section.
- Main view now holds only: orb, dock, brand/status/identity HUD,
  status pill, floating task approvals, transient badges, and the
  offline-only companion banner.
