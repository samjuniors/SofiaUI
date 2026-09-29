# Phase 8–9 UI — Local voice surface (recovery artifact)

Rebuilt 2026-09-29 after the sandbox loss described in `RECOVERY.md`.
Branch: `arena/01a0ebb7-sofiaui`.

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

**New**
- `src/ui/AirplanePanel.tsx` — Settings → Ear & Mouth block:
  airplane toggle, readiness lights (companion/TTS/STT/brain),
  Auto/Cloud/Local routing segment showing the live chain via
  `describeChain(planRoutes(routeInputFrom(serverStatus,
  readiness, mode, airplane)))`, Test voice (`speakLocal`) and
  Test brain (`askLocalBrain('Reply with exactly: OK')`) buttons.
- `src/ui/WakeWordBlock.tsx` — Settings → Ear & Mouth block:
  wake toggle (`os.savePrefs({wake})`), editable comma-separated
  phrases → `os.setWakeWords(words.split(','))`, reset to defaults;
  stays in sync with the System-section toggle via the `os`
  `prefs` event.
- `src/tools/local-voice-tool.ts` — `local_voice` tool
  (readiness/speak/ask/on/off) with its LLM schema; injectable
  `LocalVoiceBackend` for tests, real backend loaded lazily so the
  module never pulls the extensionless import chain into node.
- `src/tools/local-voice-tool.test.ts` — 6 tests with a fake backend.

**Changed**
- `src/tools/registry.ts` — tool registered with schema (joins the
  voice + chat declarations automatically).
- `src/core/SkillsRegistry.ts` — `local_voice` joins LOCAL_SKILLS
  (toggleable; the guard refuses it when disabled).
- `src/ui/SettingsSheet.tsx` — WakeWordBlock + AirplanePanel mounted
  at the end of Ear & Mouth (fed live `serverStatus`).
- `package.json` — new test file joins `npm test`.
- `RECOVERY.md`, `ROADMAP.md` — Phase 8–9 UI marked rebuilt.

## Proof

- `EVAL.log` — `npm run eval` exit 0: 100% (15 pass · 0 fail · 1 skip).
  No daemon changes this phase, so no new tasks; the battery is
  untouched and green.
- `TEST.log` — `npm test` exit 0: 79 + 208 pass, 0 fail.
- `npm run typecheck`, `npm run lint`, `npm run build` all clean.

## Notes

- The tool must not statically import `airplane-mode` (or anything
  that chains into extensionless relative imports) — node
  `--experimental-strip-types` test runs fail on those. The lazy
  `loadRealBackend()` dynamic import keeps the runtime + test worlds
  apart.
- WakeWordBlock guards empty phrase lists back to defaults, so a
  blank save can never leave the spotter with nothing to match.
