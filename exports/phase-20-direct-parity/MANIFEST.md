# Phase 20 — Direct-path parity (recovery artifact)

Built 2026-09-29 on `arena/01a0ebb7-sofiaui`. Phase 19 hardened the relay
path only; the direct-Google fallback (used whenever `/api/live-ws` is
unreachable) still died on `goAway` and measured nothing. This phase closes
the gap: every live transport is now resumable, compressed, and measured.

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

- `src/sophia/voice/live-setup.ts` (new) — pure setup builder for the raw
  BidiGenerateContent handshake: voice config, transcriptions, VAD
  tuning verbatim, plus `contextWindowCompression: {slidingWindow: {}}`
  and `sessionResumption` (banked `{handle}` or `{}`). Pure
  `bankableResumeHandle()` banking rule.
- `src/sophia/voice/live-setup.test.ts` (new) — 3 tests: config verbatim,
  compression/handle matrix, banking rule.
- `src/sophia/voice/GeminiLiveProvider.ts` — direct `ws.onopen` sends the
  built setup with the banked handle; `sessionResumptionUpdate` handles
  banked; `goAway` → `resumeDirect()` (quiet close, transcript flush,
  `start({directOnly:true})`, reentrancy-guarded, no error emit);
  unexpected drops keep transport affinity (`wasLocal` capture) so the
  handle survives those too. Direct turns measured via the shared
  `LiveTurnLatency` (mic send → first audio; boundaries on
  interrupted/turnComplete), route `gemini-live-direct`, same 1s
  `notifySlowTurn` alert as relay telemetry. Banked handle survives
  stop/start (server state lives ~24h).
- `src/core/providers/LiveApiProvider.ts` — records relay `turn_latency`
  / `latency_alert` into LatencyMeter (route `live-api`), warns past 1s.
- `package.json` — live-setup.test.ts registered.
- `ROADMAP.md` — this entry.

## Verify

- `npm run typecheck`, `npm run lint` — clean.
- `npm test` — 134 + 317 pass (see TEST.log).
- `npm run eval` — 100%, 16 pass · 0 fail · 1 skip (see EVAL.log).
- `npm run build` — passes.

## Notes for the next session

- Deliberately NOT implemented: transparent resumption with message
  replay (`transparent: true` + `lastConsumedClientMessageIndex`
  buffering). Voice audio replay across a voice gap buys nothing; both
  paths resume on the handle alone. Revisit only for text-heavy turns.
- Provider orchestration (resume flow, wiring) has no node tests — it
  needs WebSocket/AudioContext. The pure seams (setup builder, banking
  rule, turn measurement) are covered; the rest is integration-tested
  by real calls.
- Narrator `sendPrompt` lines sent during the ~1-3s resume window are
  dropped (socket guarded); TaskPanel retains everything.
- Wire field names are camelCase on the raw Bidi WS (`sessionResumption`,
  `sessionResumptionUpdate`, `goAway`) matching the provider's existing
  dialect; the SDK path uses the same names (see Phase 19 manifest).
- Sandbox loses `node_modules` between turns — reinstall root +
  companion before typecheck/lint/build.
