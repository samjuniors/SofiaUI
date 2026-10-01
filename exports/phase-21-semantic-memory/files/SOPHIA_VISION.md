# SOPHIA_VISION — where Sofia goes next (rebuilt after sandbox loss)

Research-backed plan to make Sofia the best voice-first desktop companion of 2026.
Status reflects the rebuild state of this tree — see RECOVERY.md for the full ledger.

## 1. Voice

**1.1 Presence & interruption.** Barge-in, VAD, wake-then-listen choreography.
Status: base repo ships VAD + interruption; tuning continues.

**1.2 Latency.** Tuned stacks land 0.7–1.1 s voice-to-voice in 2026 research.
Status: LatencyMeter (800 ms target, Diagnostics card) is a Phase 6 rebuild item.

**1.3 Airplane-mode Sophia (the killer differentiator).** *(Phase 8+9 REBUILT in this
tree: Companion voice engines, airplane orchestrator, voice router, LocalVoiceProvider,
configurable wake phrase. Remaining: a WASM open-wake-word engine (openWakeWord) to make
the always-on trigger itself fully offline.)*
On-device everything: open wake word (wake word must stay on-device per industry
consensus [8]), local STT (Whisper class), local brain (Ollama — Qwen3 ~8B is the 2026
tool-calling sweet spot [7]), streaming local TTS (CosyVoice2 ~150 ms or NeuTTS Air
offline [2]). Cloud becomes an *upgrade*, not a requirement. This is the moat no cloud
assistant can copy.
Code: `companion/voice.mjs`, `src/lib/airplane-mode.ts`, `src/lib/wav.ts`,
`src/lib/voice-router.ts`, `src/sophia/voice/LocalVoiceProvider.ts`.

[2] Voice 2026 research: CosyVoice2 streams TTS at ~150 ms; Fish Speech V1.5 multilingual;
IndexTTS-2 for emotion; NeuTTS Air offline. Whisper remains the OSS STT default.
[7] Ollama + Qwen3 8B = viable local tool-calling model 2026.
[8] https://picovoice.ai/blog/complete-guide-to-wake-word/ — wake word on-device;
2–4 syllables, distinctive phonemes; local detection + secondary verification.

## 2. Memory

Taxonomy: episodic / semantic / procedural / graph. Mem0 (vector+graph+KV, LongMemEval
49%); Zep/Graphiti temporal knowledge graph (63%, sub-200 ms retrieval) — best for "what
was true when"; Letta OS-style tiered memory. Vector recall 10–50 ms; graph 50–150 ms.
Status: companion `store_*` + FTS5 `episodes_*` rebuilt here; Phase 21 shipped local
embeddings (Ollama `nomic-embed-text` via `/api/sophia/embed`) with hybrid RRF recall —
task grounding, episode search, and pinned moments all vector-enriched with keyword
fallback. Remaining: lazy backfill of pre-vector episodes on read.

## 3. Computer use

OSWorld = gold standard (369 tasks; human ~72–84%); frontier agents ~60–80%. Failure
modes: GUI grounding, multi-app reasoning, long-horizon state tracking. Small
high-quality trajectory data beats raw scale (PC Agent-E).
Status: companion control + CDP browser actions rebuilt here; OCR grounding
(`ground_text`) rebuilt; eval battery tracks reliability release over release.

## 4. Proactive & provable

**4.1 The proactive loop** — the biggest market gap (Home Assistant can't do scheduled
reasoning + a chat face alone). Status: Phase 7 rebuild item (full spec in RECOVERY.md:
AmbientScheduler, quiet hours, delta-only alerts, health-watch).
**4.2 The eval harness** — how we *prove* "best". Status: REBUILT here —
`npm run eval`, 100% baseline (10 pass · 1 skip). VM-desktop tasks remain future work.

## Provenance note

The original vision doc (with full citations) was lost in the 2026-09-29 sandbox reset.
This rebuild preserves every decision that influenced shipped code; citation detail can
be re-expanded in the next session from the same sources.
