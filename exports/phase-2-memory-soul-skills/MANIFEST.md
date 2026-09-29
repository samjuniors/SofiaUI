# Phase 2 — Memory · Soul · Skills (recovery artifact)

Rebuilt 2026-09-29 after the sandbox loss described in `RECOVERY.md`.
Branch: `arena/01a0ebb7-sofiaui`.

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

**New**
- `src/core/Soul.ts` — persona dials (warmth, humour, formality, verbosity,
  energy) + catchphrases + boundaries; presets Warm Companion → Playful Mate →
  Professional → JARVIS; `systemPromptFor()`; newest-wins companion sync
  (`sophia:soul`); silent (no prompt override) while factory-default.
- `src/core/MemoryStore.ts` — durable facts: user name, people, preferences,
  standing instructions; newest-wins companion sync (`sophia:memory-store`);
  `memoryContextFor()` prompt block (`''` when empty).
- `src/core/SkillsRegistry.ts` — local tool catalogue + live companion
  `skills_list` merge; on/off switches (protocol actions locked on); usage
  stats; fail-open for uncatalogued tools.
- `src/core/mind-wiring.ts` — client-only glue, called once from `App.tsx`:
  installs the Skills guard on the tool registry, records usage from
  `tool:lifecycle` events, auto-syncs Memory/Soul + Skills when the companion
  link is up.
- `src/ui/MindPanels.tsx` — `MemoryPanel`, `SoulPanel`, `SkillsPanel`.
- `src/core/soul.test.ts`, `memory-store.test.ts`, `skills-registry.test.ts`
  — 31 unit tests (pure stores + injected fake companion callers).

**Changed**
- `src/tools/registry.ts` — `guard` hook (disabled skill → `skill_disabled`),
  `list()`, `describeInProgress()` with in-flight tracking, registered
  schemas join the LLM declarations.
- `src/lib/sophia-server.ts` — `ChatBody.context { soul, memory }`, consumed
  by every brain (Gemini / Claude / OpenAI-compatible incl. Ollama, LM
  Studio, Grok, OpenAI) via `chatSystemPrompt()`.
- `src/sophia/control.ts` — voice path: `sessionConfig()` appends the mind
  note (empty unless the user personalised something).
- `src/sophia/SophiaOS.ts` — `sendText()` posts the mind context.
- `src/ui/SettingsSheet.tsx` — Memory / Soul / Skills accordions with badges.
- `src/App.tsx` — `wireMind()` on boot.
- `scripts/eval-tasks.mjs` — new `skills_list_shape` task (skills category).
- `package.json` — new test files in `npm test`.
- `RECOVERY.md`, `ROADMAP.md` — Phase 2 marked rebuilt.

## Proof

- `EVAL.log` — `npm run eval`: 100% (11 pass · 0 fail · 1 skip).
- `TEST.log` — `npm test`: all green (64 + 116, 0 fail).
- `npm run typecheck`, `npm run lint`, and `vite build` all clean.
- E2E: chat `context` verified reaching a stub Ollama backend's system prompt
  (persona paragraph + memory block appended to the stock prompt).

## Restore

Copy `files/*` back over a checkout of the base commit, `npm install`,
then `npm test` + `npm run eval`.
