# Sofia → Sophia Roadmap

A voice-first, living AI interface: sees your screen, controls your computer, talks back.
Upgraded toward Stonic AI parity and beyond — without replacing the Sofia UI.

## Phase 0 — Foundation (✅)
Audit of the SofiaUI base; SOPHIA_AUDIT.md, SOPHIA_ARCHITECTURE.md, SOPHIA_VISION.md.

## Phase 1 — Operator: voice → completed task (🔨 core rebuilt)
Companion daemon (`companion/server.mjs`): WebSocket on 127.0.0.1, token pairing,
computer control (mouse/keyboard/apps/notifications/screenshots per OS), safety policy
(allowlists, confirmation gates, kill switch, step budget, audit log). **Rebuilt from
design after sandbox loss; eval battery green.**

## Phase 2 — Memory · Soul · Skills (✅ rebuilt)
MemoryStore + Soul dials (Warm Companion → JARVIS) + Skills registry/UI, persisted
via companion store; every chat brain + the voice session consume the mind through
the chat `context` field. 31 new unit tests; eval 11 pass · 0 fail · 1 skip.

## Phase 3 — Desktop presence (✅ rebuilt)
Electron shell: tray + menu, global hotkeys, start-at-login, compact
always-on-top orb (`?orb=1` overlay + main↔orb relay), managed companion
with bundled-token auto-pair. `npm run dev` + `npm run electron:dev`.
15 new unit tests; eval stays 11 pass · 0 fail · 1 skip.

## Phase 4 — Daily skills (✅ rebuilt)
Tabbed Daily panel (Files · Health · Media · WhatsApp draft-first),
typed `daily-skills` client (22 tests), shared companion pairing strip,
Dock + `F` key + `daily` voice panel wiring.
Eval stays 100%: 13 pass · 0 fail · 1 skip.

## Phase 5 — Theatre (✅ rebuilt)
Four CSS-variable UI themes (sky ramp follows `data-theme`), World
Monitor (real-continent dot globe + news wire), Agent Town (Iris/Vera/
Atlas/Forge standup sim + board) in a tabbed Theatre panel.
26 new unit tests; eval stays 100%: 13 pass · 0 fail · 1 skip.

## Phase 6 — Perception & depth (✅ rebuilt)
LatencyMeter (800 ms budget, Diagnostics card, modular/local hooks),
episodic-memory UI (Settings → Memory & Facts), OCR grounding card
(Diagnostics). Screen-vision bridge already in base, untouched.
18 new unit tests; eval stays 100%: 15 pass · 0 fail · 1 skip.

## Phase 7 — Proactive & provable (✅ rebuilt)
AmbientScheduler (quiet hours, delta-only alerts, health-watch +
morning-briefing), companion wiring, `proactive` voice tool, Settings
routines accordion. 20 new unit tests; eval stays 100%:
15 pass · 0 fail · 1 skip.

## Phase 8 — Airplane mode: fully local voice (✅ rebuilt)
- Companion `voice_info` / `tts_local` / `stt_local` (`companion/voice.mjs`): Piper →
  macOS `say` → Windows SAPI → espeak-ng; whisper.cpp or `SOPHIA_STT_URL`. Missing
  binaries degrade into per-OS install hints, never a crash.
- `src/lib/wav.ts` + `src/lib/airplane-mode.ts`: pure WAV codec, readiness probe,
  `speakLocal` / `listenOnce` / `askLocalBrain` / `askLocal`.
- Settings → Ear & Mouth: `AirplanePanel` (airplane toggle, readiness lights,
  Auto/Cloud/Local routing chain, Test voice/brain) + `local_voice` voice tool
  (readiness/speak/ask/on/off). 6 new unit tests; eval stays 100%.

## Phase 9 — Wake word + one voice policy for cloud and local (✅ rebuilt)
- Configurable wake phrase (`matchesWakeWord`, persisted, word-boundary-safe) driving
  both `WakeWordSpotter` and the legacy detector.
- `src/lib/voice-router.ts`: Auto / Cloud / Local with fallback in **both directions** —
  Gemini Live leads when keys exist; local catches any outage; airplane never reaches out.
- `src/sophia/voice/LocalVoiceProvider.ts`: airplane transport as a first-class provider
  (Whisper ears → Ollama brain → Piper/espeak/say/SAPI mouth). `SophiaOS.activate()`
  appends it last in the cloud order; `ConversationManager.runLocalTurn()` recovers a
  failed cloud turn locally.
- Settings → Ear & Mouth: `WakeWordBlock` (wake toggle + custom phrases →
  `os.setWakeWords`, synced with the System toggle).

## Eval
`npm run eval` — self-contained battery (11 pass · 0 fail · 1 skip on a headless box):
core, memory (store + FTS5 episodes), files+safety (sandbox escape blocked), system
(health shape), voice (local engine info), safety (confirmation gates, kill-switch flow,
unknown-action rejection), skills (`skills_list` shape), browser (auto-skips without Chrome).

## Where Sophia beats Stonic
1. Cross-platform on day one (Stonic: Windows only)
2. Any brain — local Ollama/LM Studio or any cloud key (Stonic: Gemini only)
3. DOM-level browser control via CDP, not just pixels
4. Transparent safety: visible step log, spoken confirmations, kill switch, allowlists, budgets
5. Airplane mode: cloud keys are an upgrade, never a requirement
