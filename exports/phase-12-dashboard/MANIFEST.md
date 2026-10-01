# Phase 12 — Dashboard view + side rail (recovery artifact)

Built 2026-09-29 on `arena/01a0ebb7-sofiaui`. The user asked for a
simple icon at the side to flip between the main Sofia UI and a
dashboard/OS screen holding every always-present panel.

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

**New**
- `src/ui/ViewRail.tsx` — left-edge icon rail (`AppView` =
  `'sofia' | 'dashboard'`): orbit icon for main view, grid icon for
  dashboard, active glow, tooltips with the `V` shortcut.
- `src/ui/DashboardView.tsx` — full-screen control center (z-20,
  under floating panels, orb animating behind): header with live
  state/transport/health pills + mic/chat/terminal/diagnostics/
  settings shortcuts, and a widget grid reusing the existing
  self-contained panels — Task (embedded), Memory & Facts, Moments,
  Skills, Routines.

**Changed**
- `src/ui/TaskPanel.tsx` — `embedded` prop: drops the floating
  fixed positioning for grid layout and renders a "No task running"
  placeholder when idle (floating behavior untouched when absent).
- `src/App.tsx` — `view` state; floating TaskPanel only in Sofia
  view; rail + dashboard render after boot; `V` toggles views;
  Escape walks back dashboard → Sofia; voice `command:ui` accepts
  the `dashboard` target.
- `RECOVERY.md`, `ROADMAP.md` — Phase 12 recorded.

## Proof

- `EVAL.log` — `npm run eval` exit 0: 100% (15 pass · 0 fail · 1 skip).
- `TEST.log` — `npm test` exit 0: 79 + 265 pass, 0 fail.
- `npm run typecheck`, `npm run lint`, `npm run build` all clean.

## Notes

- No new unit tests: the phase is pure view composition over
  already-tested panels; verification is typecheck + lint + build.
- Dashboard sits at z-20 so chat (z-30), diagnostics and the boot
  screen (z-50) keep working above it; the rail (z-40) stays
  clickable in both views.
