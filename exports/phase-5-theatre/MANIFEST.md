# Phase 5 — Theatre (recovery artifact)

Rebuilt 2026-09-29 after the sandbox loss described in `RECOVERY.md`.
Branch: `arena/01a0ebb7-sofiaui`.

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

**New**
- `src/lib/themes.ts` — the four UI themes (Sofia/Ember/Verdant/
  Nebula): ids, labels, accents, `applyUiTheme`/`currentUiTheme`.
- `src/lib/themes.test.ts` — 4 tests: registry shape, guards, a
  stubbed-document round-trip, and the `styles.css` wiring contract
  (sky ramp mapped, four theme blocks, no hardcoded glows).
- `src/lib/world-map.ts` — real continent data: Natural Earth 110m
  land rasterised to a 120×60 bitmask (base64, ~30% land) plus
  `landAt`, `fibonacciSphere` and orthographic `project`.
- `src/lib/world-map.test.ts` — 5 tests: mask sanity, land/ocean
  probes, wrapping, lattice spread, projection faces.
- `src/lib/headlines.ts` — the news wire: HN front-page fetch with
  timeout, defensive parse, localStorage cache, offline fallback.
- `src/lib/headlines.test.ts` — 6 tests: mixed-junk parse, cache
  round-trip + corruption, fetch success/failure, age bands.
- `src/core/AgentTown.ts` — Iris/Vera/Atlas/Forge standup sim:
  specialty-first claims, paced work, drift-in chores, capped feed,
  persistence, hidden-tab silence; injectable clock + RNG.
- `src/core/agent-town.test.ts` — 11 tests: claims, completion,
  pause/reset, caps, persistence, subscribers.
- `src/ui/ThemePicker.tsx` — swatch radio group for Settings.
- `src/ui/WorldPanel.tsx` — draggable dot-matrix globe (real
  continents, hub pulses, reduced-motion still) + headlines wire.
- `src/ui/TownPanel.tsx` — agent cards, shared Backlog/Doing/Done
  board, chore composer, standup feed.
- `src/ui/TheatrePanel.tsx` — tabbed Theatre shell (World · Town).

**Changed**
- `src/styles.css` — the `sky-*` ramp remapped to runtime
  `--th-sky-*` variables; accent tokens follow; four `[data-theme]`
  blocks with true Tailwind palettes; plain-CSS glows converted.
- `src/sophia/SophiaOS.ts` — `theme` joins prefs (default Sofia):
  sanitised on load, applied on boot and every save.
- `src/ui/SettingsSheet.tsx` — `ThemePicker` in Base Form & Display.
- `src/ui/OrbOverlay.tsx` — hex-alpha gradient rebuilt on
  `color-mix` so theme `var()` colours stay valid.
- `src/App.tsx`, `src/ui/Hud.tsx` — Theatre panel state, Dock
  button, `W` toggle, Esc chain, `command:ui` target.
- `src/tools/types.ts`, `src/tools/ui-control.ts`,
  `src/tools/registry.ts`, `src/lib/sophia-live-server.ts` —
  `theatre` joins the panel names, the `ui_control` tool and both
  voice-tool schemas.
- All UI files with hardcoded sky glows (`App`, `BootScreen`,
  `ChatPanel`, `DailyHealth`, `DailyMedia`, `DesktopBlock`,
  `DiagnosticsModal`, `Hud`, `MicPermissionModal`, `MindPanels`,
  `Onboarding`, `Terminal`, `sophia.css`) — mechanical conversion
  to `var(--th-glow*)` / `var(--th-sky-400)` triplets. The orb
  entity (`EmotionEngine`, WebGL) intentionally keeps its colours.
- `package.json` — four new test files join `npm test`.
- `RECOVERY.md`, `ROADMAP.md` — Phase 5 marked rebuilt.

## Proof

- `EVAL.log` — `npm run eval` exit 0: 100% (13 pass · 0 fail · 1 skip).
  No daemon changes this phase, so no new tasks; the battery is
  untouched and green.
- `TEST.log` — `npm test` exit 0: 79 + 164 pass, 0 fail.
- `npm run typecheck`, `npm run lint`, `npm run build` all clean.
- Built CSS verified: `--color-sky-400:var(--th-sky-400)` plus all
  four `[data-theme]` blocks with true palette values.

## Notes

- The sandbox blocks general web access, so the continent mask was
  sourced via the reachable npm registry (`world-atlas@2` +
  `topojson-client@3`, one-shot rasteriser, ASCII-verified) and the
  headlines wire degrades to cache + embedded fallback offline.
- A re-clone mid-session rewound the branch pointer to the base
  commit and wiped `node_modules`; the tree was byte-identical to
  the pushed Phase 4 commit, so recovery was `git reset` to the
  remote tip plus `npm ci` (root + companion) — no work lost.
