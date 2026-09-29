# Phase 10 — Real hands + eyes (recovery artifact)

Built 2026-09-29 on `arena/01a0ebb7-sofiaui`. This phase is new work, not
a rebuild: it closes the gap where voice/chat could only drive Sofia's
own in-app panels and never the user's real PC.

## Why

- "Open Windows Media Player" matched neither the voice fast-path (6 apps)
  nor the server open_app map (~11 Windows apps), so it silently opened
  Google in the fake in-app browser. The companion allowlist lacked
  `wmplayer` too.
- The companion daemon already had hands (`click`, `move_mouse`,
  `scroll`, `type_text`, same-tab Chrome over CDP) — but no LLM tool
  exposed them, so Sofia could never click, move the mouse, or scroll.
- "Can you see my desktop" answered "no" because Screen Vision was never
  started; voice "look at my screen" fails silently (getDisplayMedia
  needs a real click), and nothing showed vision state on screen.

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

**New**
- `src/tools/computer-tool.ts` — `computer` tool (open_app, open_url,
  click/double_click/right_click, move_mouse, scroll, type_text,
  hotkey, find_text, active_window, cursor, browser_go/click/type/read,
  notify, see) with its LLM schema; friendly app-name normalization;
  injectable backend, real backend loaded lazily.
- `src/tools/computer-tool.test.ts` — 13 tests with a fake backend.
- `src/ui/VisionGlow.tsx` — emerald edge-glow overlay while Vision is
  live + top-center Vision (tap to toggle) and PC-link status chips.

**Changed**
- `src/tools/registry.ts` — tool registered with schema (voice + chat
  gain it automatically) + progress label.
- `src/tools/system-control.ts` — description re-scoped to Sofia's
  in-app panels so the model picks `computer` for the real PC.
- `src/core/SkillsRegistry.ts` — `computer` joins LOCAL_SKILLS.
- `src/sophia/control.ts` — voice "open …" fast-path covers 20+ apps
  and routes to the computer tool; vision voice commands fall back to
  a tap-the-Vision-button hint when the click-less attempt fails.
- `src/App.tsx` — `<VisionGlow />` mounted on the main screen.
- `companion/policy.mjs` — win32 allowlist += wmplayer, mspaint,
  snippingtool, taskmgr.
- `companion/system.mjs` — win-combos (`win`, `win+e`, `win+r`) via
  keybd_event; SendKeys cannot emit the Windows key.
- `package.json` — new test file joins `npm test`.
- `RECOVERY.md`, `ROADMAP.md` — Phase 10 recorded; the last stale
  lost-block (tool registry, verified present since Phase 2) removed.

## Proof

- `EVAL.log` — `npm run eval` exit 0: 100% (15 pass · 0 fail · 1 skip).
  Daemon edits are allowlist + hotkey-path only; the battery is
  untouched and green.
- `TEST.log` — `npm test` exit 0: 79 + 221 pass, 0 fail.
- `npm run typecheck`, `npm run lint`, `npm run build` all clean.

## Notes

- "Open start menu" now works two ways: hotkey `win` (exact), or with
  Vision on, the model can see the screen and click the Start button.
- Browser work reuses the user's real tab (`firstPage`), so Sofia
  navigates like a human instead of spawning new tabs.
- Destructive/sensitive actions still ask first: the daemon returns
  `confirmation_required`, the tool surfaces it, the model asks out
  loud, then retries with confirm:true.
