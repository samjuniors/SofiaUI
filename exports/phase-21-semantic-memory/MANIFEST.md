# Phase 21 — Semantic memory: hybrid vector recall (recovery artifact)

Built 2026-09-29 on `arena/01a0ebb7-sofiaui`. Implements the vision doc's
explicit next step (§2 Memory): local embeddings for vector recall. Episode
search is now hybrid — BM25 keywords plus a cosine leg over stored vectors,
fused by RRF — and task grounding, task memory, and the memory panel all
speak it. Everything degrades to keyword search when Ollama is down.

## What's inside

`files/` mirrors the repo paths of every file this phase added or changed:

- `src/lib/sophia-server.ts` — `POST /api/sophia/embed` route + handler:
  Ollama `/api/embeddings` via the shared SSRF guard, model
  `OLLAMA_EMBED_MODEL` (default `nomic-embed-text`), 400 on missing text,
  503 with fix-it detail when Ollama is down. Inherits the Phase 16
  auth gate.
- `src/lib/ollama-embed.ts` (+ test) — standalone Ollama call (clips to
  8 texts × 2000 chars, 15s abort, strict matrix validation), null on
  any failure. No server graph, so node tests cover it directly.
- `src/lib/embeddings.ts` (+ test) — `embedTexts` client over
  `sophiaFetch` (bearer-aware) + `isEmbedding` validator + `EmbedFn`
  seam. Null on any failure.
- `companion/episodes.mjs` — `embedding` column (PRAGMA-guarded ALTER,
  JSONL inline); `episodes_add` stores validated vectors;
  `episodes_search` takes `vector`, scans stored embeddings (dim-gated,
  2000-row cap), fuses by RRF, returns `hybrid` flag. Hits and recents
  are shaped clean — vectors never leave the daemon. Pure
  `asVector`/`cosineSim`/`rrfFuse` (+ `__resetEpisodes` test seam).
- `companion/episodes.test.mjs` (new, registered) — 5 tests: pure
  helpers, keyword baseline, zero-overlap vector recall ranked first,
  dim-mismatch/invalid degradation, vector-less invisibility.
- `src/lib/episodes.ts` (+ tests) — embedding/vector passthrough,
  `hybrid` flag, `searchEpisodesHybrid`, `addEpisodeEnriched`.
- `src/tools/task-tool.ts` — recall via hybrid, remember via enriched.
- `src/ui/EpisodesPanel.tsx` — search via hybrid, pin via enriched.
- `scripts/eval-tasks.mjs` — `episodes_vector_recall`: per-run-unique
  vector, zero keyword overlap, asserts ranked-first + hybrid flag +
  no vector leak.
- `package.json` — three new test files registered.
- `ROADMAP.md`, `SOPHIA_VISION.md` — this entry; §2 status updated.

## Verify

- `npm run typecheck`, `npm run lint` — clean.
- `npm test` — 139 + 325 pass (see TEST.log).
- `npm run eval` — 100%, 17 pass · 0 fail · 1 skip (see EVAL.log).
- `npm run build` — passes.

## Notes for the next session

- Deliberately NOT implemented: backfill of pre-vector episodes.
  Candidates: lazy embed-on-read in `episodes_recent`, or a one-shot
  sweep. Old episodes stay keyword-findable either way.
- The eval vector is derived from `Date.now()` so concurrent/old runs
  can never tie at cosine 1.0 and flake the ranked-first assertion.
- Sandbox loses `node_modules` between turns; the companion reinstall
  once skipped optional deps (koffi) — rerun install if the koffi
  parity test SKIPs instead of passing.
- `/embed` takes no client URL override (fixed local Ollama by design);
  the chat brains keep their override policy untouched.
