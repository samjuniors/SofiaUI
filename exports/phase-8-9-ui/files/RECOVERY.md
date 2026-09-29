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
| Desktop shell (Phase 3) | `electron/main.cjs` — tray + menu, global hotkeys, start-at-login, single-instance, main + orb windows, managed companion spawn with bundled token; zero `require` calls (repo eslint rule), Electron via dynamic `import()` | ✅ rebuilt |
| Preload bridge (Phase 3) | `electron/preload.cjs` — `contextBridge` → `window.sophiaDesktop` (typed in `src/types/desktop.d.ts`); async-safe, `sophia:desktop-ready` event | ✅ rebuilt |
| Desktop config (Phase 3) | `electron/desktop-config.cjs` — pure URL/window/hotkey/pairing/icon builders; `dev.mjs` launcher; `make-tray-icon.mjs` + `tray.png` | ✅ rebuilt + 15 tests |
| Orb overlay (Phase 3) | `src/ui/OrbOverlay.tsx` (`?orb=1` branch in `App.tsx`); main↔orb relay; `DesktopBlock` in Settings → System; companion auto-pair in `companion-client.ts` + `mind-wiring.ts` | ✅ rebuilt |
| Daily client (Phase 4) | `src/lib/daily-skills.ts` — typed files/health/media/WhatsApp wrappers over the companion link; `DailyError` codes, draft-first send gate, setup-error detection | ✅ rebuilt + 22 tests |
| Daily UI (Phase 4) | `src/ui/DailyPanel.tsx` (tabbed Files · Health · Media · WhatsApp + shared `CompanionBlock` pairing strip, also in Settings → System); `DailyFiles/Health/Media/WhatsApp.tsx`; Dock button + `F` key + `daily` voice panel (`ui_control`, live schemas, `command:ui`) | ✅ rebuilt |
| Daily eval (Phase 4) | `media_status_shape` + `whatsapp_unavailable_graceful` tasks (13 pass · 1 skip) | ✅ 100% |
| UI themes (Phase 5) | `src/lib/themes.ts` — Sofia/Ember/Verdant/Nebula; Tailwind `sky-*` ramp remapped to runtime `--th-*` vars in `styles.css`; hardcoded sky glows converted to theme triplets; `ThemePicker` in Settings → Base Form & Display; persisted in prefs, applied on boot | ✅ rebuilt + 4 tests |
| World Monitor (Phase 5) | `src/lib/world-map.ts` — real 110m continent bitmask + projection maths; `src/lib/headlines.ts` — HN wire with cache + fallback; `src/ui/WorldPanel.tsx` — draggable dot globe + headlines | ✅ rebuilt + 11 tests |
| Agent Town (Phase 5) | `src/core/AgentTown.ts` — Iris/Vera/Atlas/Forge standup sim (claim → work → done, drift-in chores, persisted); `src/ui/TownPanel.tsx` — agents, board, feed; `TheatrePanel` shell + Dock/voice/`W` wiring (`theatre` panel) | ✅ rebuilt + 11 tests |
| Latency meter (Phase 6) | `src/core/LatencyMeter.ts` — 800 ms voice-to-voice budget, singleton; hooked into `ConversationManager` (modular first-chunk + local turns) and `LocalVoiceProvider.answer`, with `speakLocal` first-audio hooks; `src/ui/LatencyCard.tsx` in Diagnostics | ✅ rebuilt + 9 tests |
| Episodes UI (Phase 6) | `src/lib/episodes.ts` — typed `episodes_*` client; `src/ui/EpisodesPanel.tsx` — recent, FTS search, pin-a-moment in Settings → Memory & Facts | ✅ rebuilt + 5 tests |
| Grounding UI (Phase 6) | `src/lib/grounding.ts` — typed `ground_text`/`ground_ocr` client with tesseract setup-state; `src/ui/GroundingCard.tsx` — find-text + scan-words in Diagnostics | ✅ rebuilt + 4 tests |
| Perception eval (Phase 6) | `episodes_roundtrip` (memory) + `ground_unavailable_graceful` (perception) tasks (15 pass · 1 skip) | ✅ 100% |
| Ambient scheduler (Phase 7) | `src/sophia/AmbientScheduler.ts` — EventTarget singleton; `daily`/`interval` rules, quiet hours 22:30–07:45, delta-only alerts via signatures, 30s ticks, `sophia:proactive:v1` persistence; built-ins health-watch (on, 4h) + morning-briefing (off, 08:00) | ✅ rebuilt + 14 tests |
| Proactive wiring (Phase 7) | `src/lib/proactive-wiring.ts` — healthCheck→`health_snapshot`, briefing composer, alert→notify+info-card, companion-reconnect catch-up tick; booted from `App.tsx` | ✅ rebuilt |
| Proactive tool+UI (Phase 7) | `src/tools/proactive-tool.ts` (list/enable/disable/health_now) registered with LLM schema + Skills entry; `src/ui/ProactivePanel.tsx` in Settings → Proactive & Routines | ✅ rebuilt + 6 tests |
| Local voice UI (Phase 8–9) | `src/ui/AirplanePanel.tsx` (airplane toggle, readiness lights, Auto/Cloud/Local routing chain, Test voice/brain) + `src/ui/WakeWordBlock.tsx` (wake toggle + editable phrases) in Settings → Ear & Mouth; `src/tools/local-voice-tool.ts` (readiness/speak/ask/on/off) registered with LLM schema + Skills entry | ✅ rebuilt + 6 tests |

## ❌ Lost — must be rebuilt in the new session (designs preserved below)

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
