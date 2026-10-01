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

## Phase 11a — Decision loop: plan → verify → replan (✅, loop rewritten in 18)
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

## Phase 15 — Hands check: see why voice can't reach the PC (✅)
- New `src/ui/HandsCard.tsx` in Diagnostics: three live gates between a
  voice command and the real PC — voice brain (cloud = tools available,
  local/airplane = no voice tools by design), Computer skill switch,
  companion link — plus a safe read-only "Test hands" button that reads
  the cursor through the real registry path (skill guard included)
  without moving anything. All-green? It says what to try and when to
  reload for a fresh voice session.
- Verified along the way: policy needs no confirmation for mouse/type,
  `computer`/`task` are declared on both voice paths and enabled by
  default; local voice (Ollama) has no tool support at all — the one
  structural gap, left for a future phase.
  No daemon changes; eval stays 100% (15 pass · 0 fail · 1 skip).

## Phase 16 — Companion hardening + API auth (✅)
- `policy.mjs`: `appAllowed()` is exact-match only (no `.includes`);
  `CONFIRM_WORDS` substring scan replaced by `classifyRisk()` (word
  boundaries over args + daemon-read OCR/UIA target text for click/hotkey
  — Send/Pay/Delete/Submit/Buy targets gate); `confirm:true` from the
  model is ignored — the daemon issues one-time `confirmation_id`s bound
  to action+args, redeemed only via `approve()` (the UI/voice-confirm
  `type:"confirm"` path), 5-min TTL, spent after one redemption attempt.
- `system.mjs`: linux launch is `spawn(binary, [], {detached, ignore})`
  via an allowlist→binary map (no `sh -c`); `sendKeysFor()` parses
  `ctrl+shift+t`→`^+t` with all modifiers replaced and `{ENTER}`/`{F4}`
  mappings (win-combos stay on keybd); `DisplayMetrics` (DPI scale +
  virtual-screen offsets, env-overridable) converts at every backend
  boundary — external contract stays physical pixels; win32 drag via
  ABSOLUTE mouse events, darwin drag via cliclick, darwin scroll via
  Quartz wheel events, win32 volume via CoreAudio (set + get).
- `server.mjs`: reads target text before `check()` for click/hotkey;
  new `type:"confirm"` redemption message; `confirmation_id` passthrough.
- Web protocol follow-through: `confirmation_id` threaded through
  companion-client → computer-tool → registry → TaskLoop (`deps.confirm`
  after user approval); model-set `confirm`/task autoConfirm removed.
- Auth: `requireSophiaSession()` gates every `/api/sophia/*` route (deny
  by default; dev-allow only when auth is off with no database, per repo
  convention); new `sophiaFetch()` attaches the preview bearer token at
  all 20 client call sites. Verified live: 200 default dev, 401 signed-out
  with auth on.
- Tests 99+282 pass, eval 100% (15 pass · 0 fail · 1 skip).

## Phase 17 — win32 native backend, zero-spawn input (✅)
- `win32.mjs`: persistent koffi FFI backend ({% trans %} APIs stay resident —
  replaces ~15 PowerShell call sites with one loader. Same action names;
  native results add `via: 'native'`. Selection is load-time only:
  win32 + koffi installed + no `SOPHIA_WIN32_NATIVE=0` → native.
- Mouse move/click/scroll/drag via hand-rolled 40-byte INPUT buffers
  (koffi-struct parity test proves the layout); unicode typing per
  UTF-16 unit (braces/emoji verbatim, no SendKeys escaping); hotkeys
  via VK taps incl. `win+` combos (lone `win` taps Start); DPI-aware
  virtual-screen metrics; BitBlt screenshots (`.bmp`); window
  enumeration + focus with exe-match-required targeting; `open_app`
  focuses the launched app (≤4s). Target-text gates read foreground
  title/control text natively (<1ms, no spawn); legacy path keeps UIA.
- Residual PowerShell (documented): `notify` toasts, `get/set_volume`
  (CoreAudio COM), full legacy fallback when koffi is absent.
- `active_window` accepts `list: true` (top-level windows for focus
  decisions). `npm run bench --prefix companion` probes latency
  (budget p95 < 50ms; `--intrusive` clicks/types after a countdown).
- Tests 116+283 pass, eval 100% (15 pass · 0 fail · 1 skip).

## Phase 18 — Seeing loop: observe → one action → verify (✅)
- `companion/observe.mjs` (+ test): new `observe` companion action returning
  `{screenshot_b64` (long edge ≤1568px + scale factor), `active_window`,
  `ui_tree` (UIA on win32, AX on macOS: name/role/bounds/enabled), notes}.
  Wired through policy + server allowlist; AX corpus tests run anywhere.
- `src/core/task-decider.ts` (+ test, replaces task-planner): the brain picks
  ONE action per call — screenshot + ui_tree in every prompt, prefers element
  ids, falls back to shot-space coords; `normalizeObservation` validates the
  daemon payload; episodic recall grounds every task. Plan-upfront is gone.
- `src/core/TaskLoop.ts` (+ test) rewritten as a single-step loop: decide →
  safety-gate → resolve target (id→physical center, coords÷scale) → approve →
  act → settle → observe; stops on repeated screen states; max 12 steps,
  2 retries. Daemon gates redeem via `confirmation_id`; kill switch and
  approval UI unchanged; TaskPanel renders steps as the loop decides them.
- `src/lib/chat-image.ts` (+ test): multimodal chat helper (image+text to the
  brain); `sophia-server.ts` threads the screenshot through; `computer` tool
  exposes `observe` loop-only (kept out of the LLM schema so base64 pixels
  never ride a function-response cycle). Tests 134+297 pass, eval 100%
  (16 pass · 0 fail · 1 skip).

## Phase 19 — Live voice hardening: resilient sessions, background tasks (✅)
- `src/lib/sophia-live-server.ts`: Live sessions set `contextWindowCompression`
  (slidingWindow) + `sessionResumption` with banked-handle reuse; `goAway`
  triggers a seamless reconnect (client socket stays open, context carries over,
  stale-session callbacks silenced by generation). LIVE_TOOLS gains `task` +
  `observe` (mirrors of the registry schemas); system prompt rewritten for
  on-demand vision + non-blocking tasks. Continuous screen video retired.
- `src/tools/task-tool.ts`: invoke returns `{started:true}` immediately; the loop
  runs in the background. A new goal supersedes the running task (redirect);
  cancel:true stops it; generations orphan stale runs. No more task_busy.
- `src/sophia/voice/TaskNarrator.ts` (+ test): one spoken line per step ("opened
  Excel, typing now"), first-retry hints, voiced approval questions, result
  announcements. Wired to the live session in SophiaOS; silent when offline
  (TaskPanel covers it).
- Barge-in: bare stop/cancel kills the running task instantly; yes/no answers
  resolve approval pauses (narrow matchers in the narrator, called from
  tryDirectCommand). Hands-free task loop closed.
- `src/tools/observe-tool.ts` (+ test, registered): on-demand eyes — companion
  screenshot → frame bus → live session; the function response carries metadata
  only. Browser one-shot fallback when the daemon is offline.
  ScreenVisionBridge: interval retired, captureOnce() serves single peeks.
- Latency: the relay measures per-turn voice-to-voice (speech-end → first
  audio), logs every turn, warns + alerts past 1s; the provider records into
  LatencyMeter (new recordExternal) and notifies. Tests 134+314 pass, eval 100%
  (16 pass · 0 fail · 1 skip).

## Phase 20 — Direct-path parity: every transport resilient + measured (✅)
- `src/sophia/voice/live-setup.ts` (+ test): the raw BidiGenerateContent setup
  builder — session config verbatim, plus `contextWindowCompression`
  (slidingWindow) and `sessionResumption` (banked handle or `{}`); pure
  `bankableResumeHandle` rule (resumable:false never overwrites a good handle).
- `GeminiLiveProvider`: direct setup built by the builder; handles banked from
  `sessionResumptionUpdate`; `goAway` triggers a seamless same-transport resume
  (quiet close → `start({directOnly:true})`, no error emit); unexpected drops
  keep transport affinity so the handle survives those too. Direct turns
  measured with the shared `LiveTurnLatency` (mic → first audio, `gemini-live-direct`
  route, same 1s alert). Relay path untouched.
- `LiveApiProvider` (ConversationManager path): records `turn_latency` /
  `latency_alert` telemetry into LatencyMeter, warns past 1s. All three live
  transports are now measured. Tests 134+317 pass, eval 100%
  (16 pass · 0 fail · 1 skip).

## Phase 21 — Semantic memory: hybrid vector recall for episodes (✅)
- `POST /api/sophia/embed` (in `sophia-server.ts`): local Ollama `/api/embeddings`
  (`nomic-embed-text`, `OLLAMA_EMBED_MODEL`-overridable), same SSRF guard as the
  chat brains, auth-gated with the other routes. 503 when Ollama is down.
- `src/lib/ollama-embed.ts` + `src/lib/embeddings.ts` (+ tests): standalone
  Ollama call and the `embedTexts` client — null on any failure, callers always
  degrade to keyword search. Vectors upgrade recall, never gate it.
- `companion/episodes.mjs` (+ test): `embedding` column (PRAGMA-guarded ALTER for
  old DBs, inline for JSONL); `episodes_search` accepts `vector` and fuses a
  cosine leg with BM25 hits by RRF (dim mismatches skipped, scan capped);
  stored vectors never ship in hits. Pure `asVector`/`cosineSim`/`rrfFuse`.
- `src/lib/episodes.ts` (+ tests): vector/embedding passthrough + `hybrid` flag;
  `searchEpisodesHybrid` and `addEpisodeEnriched` (best-effort embed, silent
  fallback). Task recall + task memory + EpisodesPanel search/pin all upgraded.
- Eval `episodes_vector_recall`: planted episode found with zero keyword overlap,
  ranked first, no vector leak. Tests 139+325 pass, eval 100%
  (17 pass · 0 fail · 1 skip).

## Phase 22 — Trust & control: agent bar, target preview, receipts, onboarding, splits (✅)
- `src/core/TaskLoop.ts` (+ tests): `StepPreviewTarget` (physical click point +
  element box, drag end-points) flows from `resolveStepTarget` into step records,
  `step` events, and a new `preview` event raised on every approval pause (with
  the fresh screenshot) and dismissed on resume/terminal states.
- `src/ui/AgentBar.tsx`: persistent "Agent is controlling your PC" strip — live
  step text, big red Stop, Esc to stop (dialogs own Esc while open); voice
  "stop" already barged in via `tryDirectCommand`.
- `src/ui/TargetPreview.tsx`: approval modal showing the screenshot with the
  click point / element box / drag path drawn over it (Approve & run / Deny;
  Esc denies). The browser can't draw on the OS screen, so pauses carry the
  picture to the user instead.
- Daemon receipts: `summarizeAction` + `readRecent` in `companion/policy.mjs`
  (+ tests), `actions_recent` action, enriched `actions.log.jsonl` lines
  (human `detail`, machine `undo` for file move/trash/restore only; typed and
  message content never logged). `src/lib/receipts.ts` + `src/ui/ReceiptsPanel.tsx`
  (StatusCluster entry) render newest-first receipts with Undo; the Undo tap is
  the explicit approval, so gated undos redeem through the UI confirm path.
- Eval `actions_receipts`: receipts ordered/shaped/secret-free, receipt undo
  restores a moved file, `actions_recent` doesn't log itself.
- `src/ui/Onboarding.tsx` rebuilt as a 4-step wizard (pair → permissions →
  hands → safe read-only demo), mounted after boot; flag in `src/lib/onboarded.ts`.
- Splits, zero behavior change: `SettingsSheet` 1559 → 248-line shell +
  `src/ui/settings/` (13 modules); `SophiaOS` 1248 → 1067-line core +
  `src/sophia/os/` (prefs, diagnostics, speech, wake). Public APIs unchanged.
- Gates: typecheck + lint clean, tests 144+328 pass, eval 100%
  (18 pass · 0 fail · 1 skip), build passes.

## Phase 23 — Real desktop evals, injection armor, release gates (✅)
- `scripts/eval-desktop.mjs`: 20 real desktop tasks (Notepad ×5, files ×4,
  cross-app ×3, web forms ×3, system ×2, injection ×3) driving the PRODUCTION
  TaskLoop + REAL SofiaJudge against the real daemon; only the decider is a
  deterministic plan stub ($0, no flaky model). Verified by file bytes, live
  window titles, CDP page text, and daemon gate pauses. Self-skip unless
  `EVAL_DESKTOP=1` on Windows, so local runs stay green.
- `scripts/eval-desktop-runner.mjs`: plan stub with `find` (UI-tree queries),
  `waitForWindow` probes, `argsFn` chaining, default-deny pauses with explicit
  `approvals` allowlist, hostile-injection mode (benign prefix, then the
  injected step forever — worst-case model compliance), per-task timeouts,
  steps/cost reporting, and failure diagnostics (window + tree dump).
- Injection armor, three layers: `src/core/injection-guard.ts` (override
  phrases + note exfil verbs the goal never authorized; echo rule keeps the
  user's own words legal) runs FIRST in `TaskLoop.gateDecision`, before the
  judge, with no ticket and no appeal; `plan:exfil-host` judge evidence tanks
  steps reaching network hosts the goal never named; `decidePrompt` rule 7
  brands screen text UNTRUSTED DATA. The daemon's confirmation gates stay the
  backstop.
- `companion/system.mjs`: `targetTextAt` falls back to the UIA probe when the
  native (<1ms) path comes back empty — the click gate can no longer miss a
  "Send"/"Delete" label just because Chrome owner-draws its buttons.
- Harness: `--suite=all|core|desktop`, `--json`, `--markdown` (CI step
  summary), `--baseline` (release gate: regressions fail closed), per-task
  steps + time + cost, `ctx.confirm` (UI-confirm role over WS) + `ctx.spend`;
  `scripts/eval-baseline.json` pins all 39 tasks at 100%.
- CI: `.github/workflows/eval.yml` (core on ubuntu, desktop on windows-latest
  with debug-port Chrome) and `release.yml` (tag-gated: both suites must clear
  the baseline before a GitHub release is cut with the eval reports attached).
- Gates: typecheck + lint clean, tests 348 pass (+144 JS segment), eval 100%
  (18 pass · 0 fail · 21 skip on a headless box), desktop suite proven
  headlessly (9 runner tests: real loop + real judge vs a mock daemon).

## Phase 24 — Long-term memory: four stores, nightly dreams, per-turn recall (✅)
- `memory/` engine (Honcho-shaped, self-contained): working (current task),
  episodic (what happened + screenshots + outcome), semantic (facts with source
  + confidence + timestamp), procedural (learned skills); write-time Deriver
  banks conclusions from task/chat/turn episodes; retrieval is hybrid vector +
  full-text + recency, token-budgeted, embeddings never leak into rows.
- Nightly dream (`memory/consolidate.mjs` + `AmbientScheduler`
  memory-consolidation, daily 03:00, the one routine exempt from quiet hours):
  merges duplicates, resolves contradictions (newest × highest-confidence wins,
  losers superseded never deleted), decays the unused, flags the faint (<0.4),
  summarizes old episodes, proposes skills from repeated task patterns;
  cooldown + min-delta guarded, silent by design (summary in lastSignature).
- Rules enforced in `memory/schema.mjs` + `memory/actions.mjs`: facts require a
  source tag; non-user/assistant sources are `untrusted` with confidence capped
  at 0.4; only the user (explicit edit = endorsement) can lift trust; every
  write lands in the writes log; user can view/edit/pin/delete/export all.
- Daemon: 16 `memory_*` actions (`memory/actions.mjs` via `companion/server.mjs`,
  registered in ACTIONS, content-free audit receipts); client `src/lib/memory.ts`
  (typed wrappers, best-effort embed, `recallForTurn` never throws);
  `SophiaOS.sendText` injects the recall block every turn; task-tool parks the
  running goal in working memory and banks the outcome as an episode.
- UI: `src/ui/MemoryBrowser.tsx` (Facts/Episodes/How-tos/Working/Writes tabs,
  edit/pin/delete/export + Dream-now) in Settings → Memory & Facts.
- Gates: typecheck clean, tests 354 pass, eval 100% (23 pass · 0 fail · 1 skip
  core on a headless box), baseline pins all 44 tasks at 100%.

## Phase 24b — Memory hardening: episode screenshots, real skill steps, ungated writes (✅)
- Task episodes now bank what the spec promised: the step trail
  (`episodeTrail` → `[trail: observe → click → type]`) plus an outcome
  screenshot (best-effort, headed-only, 1.8 MB cap so doomed uploads never
  fly); headless tasks bank trailless imageless episodes as before.
- Skill induction closes the "prompt 3" placeholder: repeated wins with an
  identical trail induce `{ trail, via: 'induction', support }` steps;
  varied executions fall back honestly to `{ note: 'varied executions;
  pattern only' }`. Pure `commonTrail`/`extractTrail`, unit-tested.
- Real bug found by the new eval: `classifyRisk` scanned EVERY action's
  args, so a task episode reading "restart the printer" was
  confirmation-gated and silently dropped. Memory-family writes
  (`memory_*`, `store_*`, `episodes_*`) are now never gated — content is
  data, not instructions (plus a policy unit test; the induction eval keeps
  "Restart" in its text as a full-path regression guard).
- Gates: typecheck clean, tests 525 pass (170 JS + 355 TS segments),
  eval 100% (25 pass · 0 fail · 1 skip core), baseline pins all 46.

## Phase 25 — Critic reflections, skill distillation v2, self-improvement loop (✅)
- Critic (`src/core/task-critic.ts`, pure + tested): after every task the
  reflection banks as a `reflection` episode (goal, trail, `Failed:` cause
  lines, verdict) linked to its task episode; failures carry higher
  importance. Task episodes also bank `[moves: click@Login; …]` beside the
  trail for induction parameters.
- Skill envelope v2 (`distillSkill`, pure + tested): trail, concrete moves,
  params (`{step, tool, param, examples}`), preconditions, verification
  (`episode-outcome`/`done`), failureModes — or an honest pattern-only
  fallback. `memory_skill_use` records executions (17th action); derived
  `successRate`; <0.5 over ≥5 uses retires immediately + dream sweep
  (`skillsRetired`). The task-tool attributes every run to its top
  recalled how-to so rates move with production evidence; the How-tos tab
  shows rate and failure modes.
- Self-improve loop (`scripts/self-improve.mjs` + `SELF_IMPROVE.md`):
  failed task traces + `--eval-json` failures → skill patches (failure
  modes, retires), Ollama code drafts (`--fix-file`), or diagnosis
  reports — one branch each, full suite replayed in a disposable worktree
  sandbox, then merge / PR / drop via `decideMerge` (no-regressions +
  margin; code/report always PR). The Law: `companion/policy*`,
  `scripts/eval*`, `scripts/self-improve*` are forbidden — a touching
  branch is deleted, the change dropped. Refuses dirty trees; skill data
  deploys to live memory only after merge. 7 red-team unit tests; live
  --report drill proven against a temp daemon.
- Gates: typecheck clean, tests 540 pass (181 JS + 359 TS segments),
  eval 100% (26 pass · 0 fail · 1 skip core), baseline pins all 47.

## Phase 26 — Autonomy tiers + async approval queue (✅)
- `src/policy/autonomy.ts`: AUTO (reversible/allowlisted), NOTIFY (do it +
  toast, undo named where receipts support it), GATE (send/pay/delete/
  credentials/install/terminal). Gate evaluates FIRST from (action, args);
  the level only moves named actions AUTO↔NOTIFY — credentials and payments
  gate on every level. `ApprovalQueue`: unguessable single-use expiring ids,
  `approve`/`deny` demand an explicit `via: 'ui' | 'voice-confirm'` —
  model/tool/screen channels are rejected structurally.
- Untrusted-data law: screen/web/file/model text can only ESCALATE tiers
  (risk words → gate); smuggled `{tier:'auto'}`, "auto approve", and
  goal-override prose are inert — pinned by injection tests, including a
  daemon-agreement battery (tierOf GATE ⟺ `classifyRisk` risky) so the
  client mirror can never drift from the wire backstop.
- Wiring (`autonomy-wiring.ts`, installed in `App.tsx`): TaskLoop pauses
  become queue requests with desktop-toast + phone-push fan-out (voice
  already speaks via TaskNarrator; push ships as a swappable interface
  with a log default); TargetPanel approve/deny route through
  `resolveTaskApproval` (user intent wins over queue expiry; falls back
  when the bridge is off). NOTIFY toasts hook the single `companion.send`
  choke point via an optional `afterReply` observer (unset = zero change).
- Daemon backstop (`policy.mjs`): credential USE gates — `store_get` /
  `type_text` / `browser_type` mentioning password/token/secret shapes
  require confirmation, while vault storage (`store_put`) and diary/
  memory content stay clean. Pinned by policy unit tests + the
  `credentials_gate_use` eval (use gates, storage flows).
- Settings → Autonomy: careful/balanced/bold SegRow (`sophia:autonomy:v1`)
  with the always-asks list stated in the UI so the promise is visible.
- Gates: typecheck clean, tests 553 pass (182 JS + 371 TS segments),
  eval 100% (27 pass · 0 fail · 1 skip core), baseline pins all 48.

## Eval
`npm run eval` — self-contained battery (27 pass · 0 fail · 21 skip on a headless box):
core, memory (store + FTS5 episodes + 8 long-term-memory tasks: fact lifecycle/trust rules,
episode→context recall, working round-trip, contradiction newest-wins, consolidation shape),
files+safety (sandbox escape blocked), system
(health shape), voice (local engine info), safety (confirmation gates, credential-use gates, kill-switch flow,
unknown-action rejection), skills (`skills_list` shape), browser (auto-skips without Chrome),
desktop (20 real tasks; auto-skip without `EVAL_DESKTOP=1` on Windows).

## Where Sophia beats Stonic
1. Cross-platform on day one (Stonic: Windows only)
2. Any brain — local Ollama/LM Studio or any cloud key (Stonic: Gemini only)
3. DOM-level browser control via CDP, not just pixels
4. Transparent safety: visible step log, spoken confirmations, kill switch, allowlists, budgets
5. Airplane mode: cloud keys are an upgrade, never a requirement
