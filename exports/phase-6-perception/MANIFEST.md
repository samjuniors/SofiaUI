# Phase 6 — Perception & depth (recovery artifact)

Rebuilt 2026-09-29 after the sandbox loss described in `RECOVERY.md`.
Branch: `arena/01a0ebb7-sofiaui`.

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

**New**
- `src/core/LatencyMeter.ts` — voice-to-voice latency against the
  800 ms budget: turn spans (brain + mouth), stats (last/avg/p50/
  best/worst/budget hits), capped history, subscribers, injectable
  clock, and the `latencyMeter` singleton.
- `src/core/latency-meter.test.ts` — 9 tests under a fake clock.
- `src/ui/LatencyCard.tsx` — Diagnostics card: last-turn readout
  with within/over verdict, stat cells, budget-line sparkline.
- `src/lib/episodes.ts` — typed `episodes_add/search/recent`
  client (injectable caller, `EpisodeError`, relative ages).
- `src/lib/episodes.test.ts` — 5 tests with a fake transport.
- `src/ui/EpisodesPanel.tsx` — recent moments, full-text search,
  pin-a-moment with roles; Settings → Memory & Facts.
- `src/lib/grounding.ts` — typed `ground_text`/`ground_ocr`
  client; tesseract absence surfaces as a setup state.
- `src/lib/grounding.test.ts` — 4 tests with a fake transport.
- `src/ui/GroundingCard.tsx` — Diagnostics card: find-text
  (coordinates + box), scan-words chips, install hint.

**Changed**
- `src/core/ConversationManager.ts` — meter hooks: `startTurn`
  on speech-end (cloud/local route), `markBrain` after the brain
  answers, `markVoice` on the first modular PCM chunk, `cancel`
  on interruption/error; local turns re-route + mark via hooks.
- `src/lib/airplane-mode.ts` — `speakLocal` accepts optional
  `onFirstAudio` hooks (fires when audio lands, before the
  awaited playback); existing callers unaffected.
- `src/sophia/voice/LocalVoiceProvider.ts` — `answer()` starts,
  brains, voices and cancels turns through the meter.
- `src/ui/DiagnosticsModal.tsx` — Latency + Grounding cards
  (sections 5–6), header list updated.
- `src/ui/SettingsSheet.tsx` — `EpisodesPanel` in Memory & Facts.
- `scripts/eval-tasks.mjs` — `episodes_roundtrip` (memory) and
  `ground_unavailable_graceful` (perception) tasks.
- `package.json` — three new test files join `npm test`.
- `RECOVERY.md`, `ROADMAP.md` — Phase 6 marked rebuilt.

## Proof

- `EVAL.log` — `npm run eval` exit 0: 100% (15 pass · 0 fail · 1 skip).
- `TEST.log` — `npm test` exit 0: 79 + 182 pass, 0 fail.
- `npm run typecheck`, `npm run lint`, `npm run build` all clean.

## Notes

- The meter covers modular-cloud + local/airplane turns only: the
  Gemini Live bidi stream reports no turn boundaries, so it is
  honestly documented as unmeasured in the card's empty state.
- No daemon changes: episodes and grounding drive companion
  actions already in the tree. `ScreenVisionBridge.ts` was
  verified present in base and left untouched.
