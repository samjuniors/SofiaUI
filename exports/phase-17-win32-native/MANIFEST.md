# Phase 17 — win32 native backend, zero-spawn input (recovery artifact)

Built 2026-09-29 on `arena/01a0ebb7-sofiaui`. Replaces per-call
PowerShell in `companion/system.mjs` with one persistent native helper
(koffi FFI); same action names, `<50ms` click/type budget.

## Why koffi (backend decision, locked)

- **nut.js rejected**: `@nut-tree/nut-js` 404s on npm (genuinely
  delisted; control package resolves) and prebuilds are a paid
  subscription — violates the FREE constraint.
- **Rust/C# sidecar rejected**: no Windows toolchain here to build or
  verify one, plus an IPC protocol to maintain.
- **koffi 3.3.2** (optional dep): installs in ~2s from prebuilds,
  `__stdcall` + callbacks + out-params + struct-by-value all verified
  against scratch C libs before a line of win32 code was written.

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

- `companion/win32.mjs` (new) — the native backend. Constants + pure
  helpers (INPUT builders, VK parser, BMP writer, window shapers),
  singleton koffi loader (user32/kernel32/gdi32/shcore), executors,
  `nativeSystemAction()` dispatcher (12 actions), `nativeTargetText()`,
  `nativeFocusedText()`, `nativeMetrics()`, `nativeWindows()`.
  Selection is load-time only: win32 + koffi + no
  `SOPHIA_WIN32_NATIVE=0`. Executor errors propagate (never silent
  PS fallback); UIPI short-sends throw with an admin hint.
- `companion/win32.test.mjs` (new) — 17 tests: backend selection,
  byte-exact INPUT layouts, unicode verbatim, combo→VK parsing,
  SendKeys parity, coords/metrics, BMP bytes, window shapes,
  exe-match-required focus, koffi struct parity (runs when installed).
- `companion/bench.mjs` (new) — latency probe, win32 only; budget
  p95 < 50ms; `--intrusive` clicks/types after a 5s countdown.
- `companion/system.mjs` — native dispatch hook, native target-text
  and metrics branches; PowerShell branches are now legacy fallback.
- `companion/package.json` — koffi optional dep, bench script.
- `companion/README.md` — native backend section.
- `src/tools/computer-tool.ts` (+ test) — `active_window` passes
  `list: true` for window enumeration.
- `package.json` — win32 tests + bench check in the gate.
- `RECOVERY.md`, `ROADMAP.md` — Phase 17 entries.

## Locked win32 details (for the next native session)

- x64 INPUT = 40B: type@0 u32; mouse dx@8/dy@12/data@16/flags@20/
  time@24/extra@28; key vk@8 u16/scan@10/flags@12/time@16/extra@24.
- Drag = MOVE|ABSOLUTE|VIRTUALDESK `0xC001` (negative-origin desks).
- Unicode per UTF-16 code unit, wVk=0; surrogates as separate units.
- Extended flag: arrows/home/end/pgup/pgdn/ins/del/win/numlock/prtsc.
- Scans via MapVirtualKeyW (moves real games/remote-desktop).
- Metrics: GetSystemMetrics(76–79) + GetDpiForSystem after
  SetProcessDpiAwarenessContext(-4).
- Screenshot: BitBlt → GetDIBits BI_RGB 32bpp → `.bmp` writer.
- Focus: EnumWindows → exe basename via QueryFullProcessImageNameW
  (WOW64-safe) → restore + SetForegroundWindow; exe match required,
  never focus a stranger window.
- Residual PowerShell: notify toasts, get/set_volume (CoreAudio COM),
  legacy fallback when koffi is absent.

## Proof

`TEST.log`: tests 116+283 pass, eval 100% (15 pass · 0 fail · 1 skip).
FFI verification notes (scratch libs in /tmp, not preserved): 7/8
patterns OK on Linux (union size expected LP64/LLP64 divergence,
re-confirmed with int32 LLP64 emulation); void*↔BigInt round-trip,
Buffer-as-struct, _Inout_ DWORD, struct-by-value POINT, char16_t*
strings all OK.
