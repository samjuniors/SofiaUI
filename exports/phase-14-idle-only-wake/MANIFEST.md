# Phase 14 — Idle-only: standby removed, wake made reliable (recovery artifact)

Built 2026-09-29 on `arena/01a0ebb7-sofiaui`. The user reported Sofia
stuck on "standby", waking only sometimes, and asked to remove
standby in favor of idle. Diagnosis: standby was never a mode — just
labels on idle/ambient/completed — while two real defects broke
waking: the mic button toggled pause instead of waking whenever she
was mid-turn, and the wake-word spotter could die silently on
transient recognizer errors.

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

**Changed**
- `src/App.tsx` — mic button is one-way wake (resume + enterSession,
  never pause); 30s watchdog interval calls `os.ensureWakeArmed()`.
- `src/sophia/SophiaOS.ts` — new `ensureWakeArmed()`: re-arms the
  spotter when wake is wanted, mic isn't hard-denied, no session is
  live, and the spotter lost its recognizer. Never throws.
- `src/sophia/voice/wake.ts` — transient recognizer errors
  (audio-capture/network) schedule their own restart instead of
  relying on onend; new `isArmed()` health getter.
- `src/ui/SofiaStatusPill.tsx` — resting labels → Idle; Gemini badge
  title → idle.
- `src/ui/Hud.tsx` — connection badge → Idle; mic hints → "Idle ·
  Click to speak" / "Sofia is active · Click to speak"; internal
  `isStandby` renamed `isIdle`.
- `src/ui/SettingsSheet.tsx` — audio strings → Idle.
- `src/sophia/audio/ScoreEngine.ts`, `src/core/UserVoiceProfile.ts` —
  comment touch-ups (no behavior change).
- `RECOVERY.md`, `ROADMAP.md` — Phase 14 recorded.

## Proof

- `EVAL.log` — `npm run eval` exit 0: 100% (15 pass · 0 fail · 1 skip).
- `TEST.log` — `npm test` exit 0: 79 + 281 pass, 0 fail.
- `npm run typecheck`, `npm run lint`, `npm run build` all clean.
- Post-change grep: zero user-visible "standby" strings remain
  (only the internal `standDown()` method name, unchanged API).

## Notes

- No new unit tests: labels + browser-API wiring over the existing
  unit-tested `matchesWakeWord`; verification is typecheck + lint +
  build (same basis as 12b).
- Pause still exists as a state (needed to stop her mid-speech) — it
  just lives on the orb tap now, and the pill reads Paused honestly.
- If "Hey Sofia" still misses often on the user's machine, the next
  step is mic-level diagnostics (testMic + capture state in
  Diagnostics), not more spotter restarts.
