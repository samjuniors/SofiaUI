# Phase 15 — Hands check: see why voice can't reach the PC (recovery artifact)

Built 2026-09-29 on `arena/01a0ebb7-sofiaui`. The user asked why voice
still couldn't use mouse/keyboard after Phase 13. Verification found
the code paths correct (both voice sessions declare `computer`, skill
enabled by default, no confirmation needed for mouse/type) — so the
remaining causes are all on the user's machine/setup, and this phase
ships the instrument that proves which one: a Hands check card in
Diagnostics.

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

**New**
- `src/ui/HandsCard.tsx` — three live gates (voice brain cloud/local,
  Computer skill on/off, companion linked/offline with error) + safe
  read-only cursor test through `toolRegistry.invoke` (the exact path
  voice uses, skill guard included). Guidance when all green.

**Changed**
- `src/ui/DiagnosticsModal.tsx` — renders HandsCard as section 7
  (particle section renumbered to 8); doc comment updated.
- `RECOVERY.md`, `ROADMAP.md` — Phase 15 recorded.

## Proof

- `EVAL.log` — `npm run eval` exit 0: 100% (15 pass · 0 fail · 1 skip).
- `TEST.log` — `npm test` exit 0: 79 + 281 pass, 0 fail.
- `npm run typecheck`, `npm run lint`, `npm run build` all clean.

## Notes

- No new unit tests: view composition over tested stores/registry;
  verification is typecheck + lint + build (same basis as 12b/14).
- Structural finding: LocalVoiceProvider (Ollama/airplane) has no
  tool support — voice hands require the cloud brain. A local-tools
  loop (Ollama function-calling) is the natural follow-up phase.
- For the user: pull, `npm run dev:all`, pair the banner, open
  Diagnostics (pill → Diagnostics or `D`), read Hands check, press
  "Test hands (safe)". If the brain row says LOCAL, switch Ear &
  Mouth routing off airplane/local.
