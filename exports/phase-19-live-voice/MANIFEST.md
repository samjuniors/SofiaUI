# Phase 19 — Live voice hardening (recovery artifact)

Built 2026-09-29 on `arena/01a0ebb7-sofiaui`. Four workstreams, one theme:
the live voice loop is now resilient (sessions survive `goAway`), the task
loop runs in the background with a voice, the model sees on demand instead
of via a video firehose, and every turn's latency is measured + alarmed.

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

- `src/lib/sophia-live-server.ts` — Live connect sets
  `contextWindowCompression: { slidingWindow: {} }` and
  `sessionResumption` (banked handle reused; `{}` on first connect).
  `sessionResumptionUpdate` handles are banked only when resumable;
  `goAway` triggers `reconnectLive()` (fresh `connectLive()`, client
  socket stays open, `{type:'reconnecting'}` then `{type:'ready',
  resumed:true}`). A generation counter silences stale-session
  callbacks. LIVE_TOOLS gains `task` + `observe` (hand-mirrors of
  TASK_SCHEMA/OBSERVE_SCHEMA — this module cannot import the client
  tool graph). System prompt: on-demand vision replaces continuous
  video claims; background-task behavior specified.
- `src/lib/live-turn-latency.ts` (+ test) — pure turn measurement:
  last mic packet → first model audio. Skips unprompted/stale speech.
  Budget: `LIVE_LATENCY_ALERT_MS = 1000`.
- `src/tools/task-tool.ts` (+ rewritten test) — invoke returns
  `{started:true}` immediately; generations orphan superseded runs; a
  new goal redirects, cancel:true stops. Terminal states stream via
  taskEvents. `isTaskRunning()` exported for barge-in.
- `src/sophia/voice/TaskNarrator.ts` (+ test) — one spoken line per
  step (past+present folded: "opened Excel, typing now"), first-retry
  hints, voiced approval questions, result announcements. Announcer
  injected via `setTaskAnnouncer`; `isAwaitingTaskApproval` +
  `matchTaskCancelUtterance` + `matchApprovalAnswer` exported.
- `src/sophia/SophiaOS.ts` — wires the announcer to gemini-live
  `sendPrompt` with kind-specific prefixes; silent when disconnected.
- `src/sophia/control.ts` — tryDirectCommand: voice approval answers
  + barge-in cancel first; "look at my screen" takes one shot into
  the frame bus instead of starting a stream.
- `src/tools/observe-tool.ts` (+ test, registered in `registry.ts`) —
  companion observe → pixels to `observeFrameEvents`, metadata to the
  function response. Injectable browser-capture fallback.
- `src/sophia/vision/ScreenVisionBridge.ts` — 1.5s interval deleted;
  `captureOnce()` serves single peeks; `registerFrameCallback` gone;
  `vision:state`/`vision:frame` events kept for the UI.
- `src/sophia/voice/GeminiLiveProvider.ts` — subscribes to the frame
  bus (both transports), records `turn_latency`, warns + notifies on
  `latency_alert`, ignores `reconnecting` (seamless by design).
- `src/core/LatencyMeter.ts` (+ test) — `recordExternal()` for
  relay-measured turns, judged against the same 800 ms budget.
- `src/ui/LatencyCard.tsx` — copy updated (Live telemetry now flows).
- `package.json` — three new test files registered.

## Verify

- `npm run typecheck`, `npm run lint` — clean.
- `npm test` — 134 + 314 pass (see TEST.log).
- `npm run eval` — 100%, 16 pass · 0 fail · 1 skip (see EVAL.log).
- `npm run build` — passes.

## Notes for the next session

- `@google/genai` 2.24.0 API (verified in `dist/node/node.d.ts`):
  `LiveConnectConfig.contextWindowCompression/sessionResumption`,
  `LiveServerMessage.goAway/sessionResumptionUpdate`. The server file
  calls `live.connect` through `any`, so tsc cannot check these field
  names — verify against the installed .d.ts after SDK upgrades.
- The `server/` live prompt and the registry schemas are hand-mirrored
  (task, observe); keep them in sync when either changes.
- Sandbox had no `node_modules` at phase start (`npm install` + companion
  install needed before typecheck/lint/build).
