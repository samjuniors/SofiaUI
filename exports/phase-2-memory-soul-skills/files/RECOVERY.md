# RECOVERY — what was lost, what is rebuilt, what remains

**Incident (2026-09-29):** the sandbox was re-cloned and the working tree reverted to
base commit `3b2ab43`. All Phase 0–9 work (commits up to `8d6b1c9`, ~15k lines, and the
`exports/` zips) was wiped from the sandbox. GitHub holds only the merged hardening PR
(#1: LLM URL-override guards, model-ID updates, server policy).

**This tree is the rebuild.** Phase 8–9 code was recreated verbatim from the session
record; the companion daemon + eval battery were reconstructed from the design record
and re-proven green (100% eval, all tests passing).

---

## ✅ Rebuilt in this tree (tested green)

| Area | Files | State |
|---|---|---|
| Companion daemon (Phase 1 core) | `companion/server.mjs` + modules | ✅ eval 100% |
| Safety policy | `companion/policy.mjs` (allowlists, confirmation gates, kill switch, step budget, audit log) | ✅ tested |
| Memory | `companion/store.mjs` (node:sqlite + JSON fallback), `companion/episodes.mjs` (FTS5 + bm25) | ✅ tested |
| Files | `companion/files.mjs` (sandboxed roots, recoverable trash) | ✅ tested |
| Health / media / grounding | `companion/health.mjs`, `media.mjs`, `ground.mjs` (tesseract) | ✅ shape-tested |
| Airplane-mode voice (Phase 8) | `companion/voice.mjs` (voice_info / tts_local / stt_local; Piper→say→SAPI→espeak, whisper.cpp or `SOPHIA_STT_URL`) | ✅ verbatim + tested |
| WAV codec | `src/lib/wav.ts` | ✅ verbatim + tested |
| Airplane orchestrator | `src/lib/airplane-mode.ts` (readiness probe, speakLocal, listenOnce, askLocalBrain/askLocal) | ✅ verbatim |
| Voice router (Phase 9) | `src/lib/voice-router.ts` (Auto/Cloud/Local, fallback both directions) | ✅ verbatim + 11 tests |
| Local transport (Phase 9) | `src/sophia/voice/LocalVoiceProvider.ts` (Whisper ears → Ollama brain → local mouth) | ✅ verbatim |
| Wake word (Phase 9) | `matchesWakeWord` + configurable phrases in `src/core/WakeWordDetection.ts` and `src/sophia/voice/wake.ts`, persisted via `sophia:wake:v1` | ✅ verbatim + 7 tests |
| Cloud→local fallback | `ConversationManager.runLocalTurn()`; `SophiaOS.activate()` appends `local` last in the provider order; airplane forces `local` | ✅ verbatim |
| Eval battery | `scripts/eval-harness.mjs` + `eval-tasks.mjs` (11 tasks + 1 skip) | ✅ 100% |
| Memory (Phase 2) | `src/core/MemoryStore.ts` — name, people, preferences, standing instructions; newest-wins sync to companion `store_*` (`sophia:memory-store`); `memoryContextFor` prompt block | ✅ rebuilt + 10 tests |
| Soul (Phase 2) | `src/core/Soul.ts` — 5 dials + catchphrases + boundaries, presets Warm Companion → JARVIS; `systemPromptFor`; newest-wins sync (`sophia:soul`); silent when factory-default | ✅ rebuilt + 11 tests |
| Skills (Phase 2) | `src/core/SkillsRegistry.ts` — local tools + companion `skills_list` merge, on/off (locked protocol actions), usage stats; `src/core/mind-wiring.ts` installs the registry guard + lifecycle stats + auto-sync | ✅ rebuilt + 10 tests |
| Mind UI (Phase 2) | `src/ui/MindPanels.tsx` (`MemoryPanel`, `SoulPanel`, `SkillsPanel`) in Settings accordions | ✅ rebuilt |
| Tool registry ext. | `src/tools/registry.ts` — `guard` hook (disabled skills → `skill_disabled`), `list()`, `describeInProgress()`, registered schemas join the LLM declarations | ✅ rebuilt |
| Chat context | `ChatBody.context {soul, memory}` consumed by every brain (Gemini/Claude/OpenAI-compat) via `chatSystemPrompt`; voice path via `ControlLayer.sessionConfig`; client sends from `SophiaOS.sendText` | ✅ rebuilt + e2e-proven |

## ❌ Lost — must be rebuilt in the new session (designs preserved below)

### Phase 3 — Desktop presence (Electron)
- `electron/main.cjs` (tray, global hotkey, start-at-login), `electron/preload.cjs` (contextBridge; note: no `require` inside preload — eslint), compact always-on-top orb window, Companion auto-pair via bundled token.

### Phase 4 — Daily skills UI
- Files panel, PC-health card, media controls, WhatsApp draft-first flow (draft never sends; `send` confirms) — all driving the companion actions that already exist in this tree.

### Phase 5 — Theatre
- 4 colour themes via CSS variables (`--color-*`; Tailwind v4 `sky-*` maps to `var(--color-sky-*)`), World Monitor (dot-globe + headlines), Agent Town (Iris/Vera/Atlas/Forge shared task board).

### Phase 6 — Perception & depth
- `src/core/LatencyMeter.ts` (800 ms voice-to-voice target, Diagnostics card; exports a singleton), episodic-memory UI over `episodes_*`, OCR grounding UI over `ground_text/ground_ocr`, screen-vision bridge already present in base (`ScreenVisionBridge.ts`).

### Phase 7 — Proactive & provable
- `src/sophia/AmbientScheduler.ts` — EventTarget singleton; rules `daily(timeOfDay "HH:MM")` / `interval(everyMs)`; quiet hours 22:30–07:45 (`isQuietHours`); delta-only alerts via `lastSignature`; `TICK_MS=30000`; localStorage `sophia:proactive:v1`; injectable handlers `{healthCheck, briefing, alert}`; built-ins morning-briefing (disabled default) + health-watch (enabled, 4h, alerts score<70 or warnings changed). Interval rules must re-arm `lastRunAt` in tests; type rule consts as `ProactiveRule`.
- `src/lib/proactive-wiring.ts` (healthCheck→companion `health_snapshot`; alert/briefing→notify+showCard via controlLayer), `src/tools/proactive-tool.ts` (list/enable/disable/health_now), `src/ui/ProactivePanel.tsx` (Settings accordion).

### Phase 8–9 UI (small, rebuild with the libs already here)
- `src/ui/AirplanePanel.tsx` — Settings block: airplane toggle, readiness lights (companion/TTS/STT/brain), Voice-routing segment (Auto/Cloud/Local) showing `describeChain(planRoutes(routeInputFrom(status, readiness, mode, airplane)))`, Test voice / Test brain buttons.
- `src/ui/WakeWordBlock.tsx` — Settings block: wake toggle (`os.savePrefs({wake})`), custom phrases → `os.setWakeWords(words.split(','))`.
- `src/tools/local-voice-tool.ts` — `local_voice` tool (readiness/speak/ask/on/off) once the tool registry is restored.

### Tool registry (Phases 1–2 infrastructure)
- `src/tools/registry.ts` — typed `ITool` registry, declarations for the LLM, `describeInProgress`; tools registered there gain voice + chat access. Rebuild before re-adding tools.

## Companion protocol (canonical, as rebuilt)

```
client→daemon  {"type":"hello","token":TOKEN}
daemon→client  {"type":"welcome","actions":N}        (4003 bad token, 4001 timeout)
client→daemon  {"type":"action","id":7,"action":"ping","args":{}}
daemon→client  {"type":"result","id":7,"ok":true,"result":{...}}
                                ok:false + error + detail (+needsConfirmation)
```
Env: `SOPHIA_COMPANION_PORT` (7788), `SOPHIA_COMPANION_TOKEN` (random), `SOPHIA_COMPANION_ORIGINS`,
`SOPHIA_COMPANION_STEP_BUDGET` (40), `SOPHIA_DATA_DIR` (~/.sophia), `SOPHIA_FILES_ROOTS`,
`SOPHIA_TTS_ENGINE`, `SOPHIA_PIPER_MODEL`, `SOPHIA_WHISPER_MODEL`, `SOPHIA_STT_URL`,
`SOPHIA_CHROME_PATH`, `SOPHIA_CDP_PORT`.

## Run

```
npm install && npm run setup     # root deps + companion deps (ws, playwright-core optional)
npm run dev                      # web app
node companion/server.mjs        # daemon (prints pairing code)
npm test                         # 38 unit tests
npm run eval                     # companion reliability battery (100% baseline)
```

## Rules carried forward
- No auth on `/api/sophia` for now (user decision).
- Sofia UI architecture is upgraded, never replaced.
- Keep artifacts in `exports/`; user handles GitHub push/transfer.
- Known sandbox traps: banner prints before WS bind (retry-connect in harness);
  `xdotool` absent → accept `action_failed` as gate-cleared; node `--test` needs explicit
  `.ts` extensions in imports; `allowImportingTsExtensions` is on, so `.ts` imports are fine.
