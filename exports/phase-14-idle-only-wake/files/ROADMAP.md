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

## Phase 10 — Real hands + eyes (✅)
- `computer` voice/chat tool (`src/tools/computer-tool.ts`): real desktop apps
  (Windows Media Player, Paint, Snipping Tool, Task Manager added to the
  companion allowlist), real mouse move/click/scroll, typing, hotkeys (`win`
  opens Start via keybd_event — SendKeys can't emit it), on-screen text
  grounding, active window, notifications, and same-tab real-Chrome control
  over CDP. Voice "open …" fast-path routed to it; `system_control`
  re-scoped to Sofia's in-app panels; vision voice commands fall back to a
  tap-the-button hint (browsers need a click for screen share).
- `src/ui/VisionGlow.tsx`: glowing edge outline while Vision is live +
  top-center Vision (tap to toggle) and PC-link chips; the `see` action
  answers "can you see my desktop" with vision flag + foreground window +
  cursor. 13 new unit tests; eval stays 100% (15 pass · 0 fail · 1 skip).

## Phase 11a — Decision loop: plan → verify → replan (✅)
- `src/core/task-planner.ts`: clean-slate brain planner over `/api/sophia/chat`
  (grounded with the foreground window/cursor/vision snapshot); JSON-only
  computer plans, max 8 steps, every step declaring what the executor must
  observe afterwards; strict validation (computer-only, known actions).
- `src/core/TaskLoop.ts`: the observe→act→verify loop — approval pauses for
  planned confirm steps AND daemon `confirmation_required` gates (retry with
  confirm:true), heuristic verification against window titles + on-screen
  text, bounded replans (2) with failure context, step budget (12), cancel,
  `task:state` event stream, outcome stored to episodic memory.
- `src/tools/task-tool.ts` (`task` goal/cancel, one at a time) + live
  `src/ui/TaskPanel.tsx` step log with Approve/Deny/Stop. Single actions
  still go straight to `computer` (cheaper/faster). 24 new unit tests;
  eval stays 100% (15 pass · 0 fail · 1 skip).

## Phase 11b — Decision core: our own Jev, zero API (✅)
- `src/core/decision-judge.ts` (`SofiaJudge`): Jev's essence rebuilt as our
  own method — Choice/Score/Noul judgments over structured state via
  log-odds evidence fusion (naive-Bayes-style logit pooling, every
  evidence explainable), plus a bucket calibrator that bends plan-gate
  probabilities toward observed task outcomes. Microseconds per call,
  offline, free, hallucination impossible by construction.
- TaskLoop gains the advisory judge: 1–5 plan safety gate (≤2 rejected),
  verify second-opinion on heuristic misses and expectation-less steps,
  and recovery Choice (retry_same / replan / ask_user) sharing the
  replan budget. Judge errors always fail open to heuristic behavior.
- Planner recalls top-3 similar episodes into its context (learning
  loop); gate outcomes resolve calibration tickets at finish (accepted
  plans only — rejected plans carry no observed outcome). 20 new unit
  tests; eval stays 100% (15 pass · 0 fail · 1 skip).

## Phase 11c — Judge memory: learning that survives restarts (✅)
- `src/core/judge-memory.ts`: the judge's learning state (reliability
  buckets + adaptive evidence weights) persists to localStorage always
  and the companion store when paired; newest copy wins, a newer local
  copy is pushed up on load. Every leg is best-effort — learning can
  never break judging.
- Gate tickets now carry the kind-bearing evidences that fired
  (`plan:length`, `plan:expect`, `plan:risk`); each reported outcome
  nudges them ±6% (clamped 0.25–4×): evidence that pointed at the
  outcome gains voice, evidence that missed loses it. Verify/recovery
  stay unweighted — still no ground truth there, same honest restraint.
- `task` runner loads persisted learning once and saves after every
  task. Snapshot shape is versioned; legacy buckets-only and malformed
  snapshots restore safely. 13 new unit tests; eval stays 100%
  (15 pass · 0 fail · 1 skip).

## Phase 13 — Hands that work: voice gets the real PC (✅)
- Root-caused four user reports (no typing, broken in-app search, no
  local files, no mouse) to three defects: the voice session never
  declared the `computer` tool, pairing was undiscoverable (no
  auto-connect, no global prompt), and `system_control open_app`
  opened fake web pages instead of real apps. Daemon protocol
  smoke-tested healthy (pair + ping + files work; headless mouse
  fails gracefully).
- `LIVE_TOOLS` gains `COMPUTER_SCHEMA` + prompt routing (mouse, type,
  keys, apps, files, real Chrome); client already executed it via the
  registry. `dashboard` added to the voice `control_ui` enum.
- `system_control open_app` now delegates to real companion launches;
  the fake app→website map is deleted; voice "open X" failures surface
  a notification instead of dying silently.
- `src/ui/CompanionBanner.tsx`: slim global pairing bar (code + Pair +
  retry + exact command) in every view until linked; boot tries the
  stored pairing once in plain browsers too.
- `not_connected` tool errors and the `see` hint now speak exact fix
  steps (`npm run companion` / `npm run dev:all` + paste the code);
  Linux xdotool-missing failures suggest the apt install + X11 note.
- New `computer.open_file` → daemon `files_open` (sandboxed);
  `scripts/dev-all.mjs` (`npm run dev:all`) boots daemon + app with
  dep preflight; in-app search retries DDG→Mojeek on proxy failure.
  3 new unit tests; eval stays 100% (15 pass · 0 fail · 1 skip).

## Phase 12 — Dashboard view + side rail (✅)
- `src/ui/ViewRail.tsx`: slim icon rail on the left edge — orbit icon
  for the main Sofia view, grid icon for the dashboard. Click to flip
  the whole interface; `V` key, Escape-to-go-back, and the voice
  `dashboard` target all switch too.
- `src/ui/DashboardView.tsx`: one-screen OS control center with every
  always-present panel — running task (`TaskPanel` embed mode, with a
  "no task" placeholder when idle), live status pills, Memory & Facts,
  Moments, Skills, Routines — plus mic/chat/terminal/diagnostics/
  settings shortcuts in the header. The orb keeps animating behind;
  floating chat/diagnostics still open above it. No daemon changes;
  eval stays 100% (15 pass · 0 fail · 1 skip).

## Phase 12b — Dashboard declutter: an OS control center (✅)
- `DashboardView` rebuilt around three roomy labeled sections with
  breathing space (wider canvas, bigger gaps/padding, section titles):
  NOW (running task + routines), SYSTEM (companion pairing card,
  quick-action tiles, live system status), MEMORY (moments + compact
  memory/skills summaries). The full Memory/Skills settings editors
  left the dashboard — summary tiles show live counts with one-click
  "Edit/Manage in Settings".
- Companion is now one tap away in the dashboard (full pairing strip,
  not just the banner); quick actions cover Talk/Chat/Terminal/
  Diagnostics/Settings/Sofia as OS-style tiles.
- Main Sofia view keeps only the essentials (orb, dock, status pill,
  task approvals); the bottom-left terminal button moved to dashboard
  quick actions (backtick still toggles it). No daemon changes; eval
  stays 100% (15 pass · 0 fail · 1 skip).

## Phase 14 — Idle-only: standby removed, wake made reliable (✅)
- "Standby" was never a mode, only labels — all user-visible instances
  (status pill, dock mic hint, connection badge, Settings audio
  strings) now read Idle, and the overpromising "Say Hey Sofia" nag
  is gone from the resting label.
- Mic button is one-way wake: it always enters a session and never
  pauses (tapping it mid-turn used to pause her — half the "sometimes
  it wakes, sometimes not"). Pause/resume stays on the orb tap; `M` /
  space follow the mic button.
- Wake-word reliability: the spotter now schedules its own restart
  after transient recognizer errors (previously it could die silently
  while idle), exposes `isArmed()`, and a 30s app watchdog calls
  `os.ensureWakeArmed()` to re-arm it whenever wake is wanted, the
  mic isn't hard-denied, and no session is live.
  No daemon changes; eval stays 100% (15 pass · 0 fail · 1 skip).

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
