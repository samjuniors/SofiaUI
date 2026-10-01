# Sofia memory/ — Phase 24: four stores, hybrid recall, nightly dreams

Long-term memory for a stateful agent, studied from [Honcho](https://honcho.dev/)
and adapted to Sofia's constraints: **local-first, free, no vendor**. Honcho
reasons with custom models (Neuromancer) behind an API; Sofia derives with
deterministic extractors on-device and consolidates with explicit rules —
same shape (derive at write, dream in background, budget per turn), no bill.

## Honcho → Sofia mapping

| Honcho | Sofia | Notes |
|---|---|---|
| Messages trigger reasoning | Episodes (task/turn/chat/moment) trigger the Deriver | Stored immediately, derived synchronously (cheap, deterministic) |
| Deriver: explicit + deductive conclusions | `derive.mjs` extractors | "remember…", "my X is Y", preferences, corrections, commitments — each cites premise episode ids |
| Peer representations (conclusions + summaries + peer card) | Semantic facts + session summaries + computed peer card | Peer = the user (+ named people later); perspective scoping deferred |
| Dreamer: periodic deduction + induction | `consolidate.mjs` nightly job | Dedupe, contradiction resolution, decay, flags, session summaries, skill induction (≥2 supporting episodes) |
| `context()` token-budgeted | `memory_context` action | Working → peer card → top-k facts → top-k episodes → matched skills, stops when the budget is spent |
| Scopes (visibility boundaries) | Source-trust tags | `user`/`assistant` = trusted; pages/files/tools = untrusted, confidence-capped, always tagged |
| Evidence | `premises[]` on facts + writes log | Every derived fact traces to its episodes |
| Queue status / manual dream | `runs` log + `memory_consolidate` + scheduler routine | Single-flight, 8h cooldown, min-delta 10, manual trigger bypasses guards |
| Search (top-k, max distance) | Vector + FTS + recency, RRF-fused | Client-supplied vectors (Ollama, best-effort); keyword + recency always work |

Deliberate deltas: no induction/abduction by LLM (deterministic rules only —
induction = repeated successful task patterns → skill candidates); no
multi-peer perspectives yet (schema has the slots); summaries are extractive
(no LLM rewriting, so nothing can be hallucinated into memory).

## The 4 stores (`store.mjs`, SQLite + JSON fallback)

- **working** — current task, session-scoped: goal, plan, scratchpad,
  entities. One doc per session, overwritten freely, injected wholesale.
- **episodic** — what happened: text, kind, outcome (`done`/`failed`/
  `cancelled`/`none`), summary, importance (decays with disuse),
  screenshots (files under `memory/shots/`, ≤2MB PNG/JPEG each), embedding.
- **semantic** — facts: text, subject slot, **source + sourceTrust +
  confidence + timestamp**, premises, status (`active`/`superseded`/
  `flagged`), pinned (peer card), access counts, embedding.
- **procedural** — learned how-tos: name, trigger, steps (shape defined by
  prompt 3 — currently `{note, pattern}` + source episodes), success/use
  counts, status (`candidate`/`active`/`retired`).

Plus: `sessions` (boundaries + extractive summaries), `writes` (every
mutation: ts, store, op, ref, actor, summary), `runs` (consolidation log).

## Rules (enforced in code, contracted in tests)

1. **No source tag, no fact.** `memory_fact_add` rejects sourceless writes.
2. **Untrusted origins stay untrusted.** Trust derives from the source and
   can only be downgraded by writers; upgrades require an explicit *user*
   edit (endorsement). Untrusted confidence is capped at 0.4.
3. **Quarantine, not deletion.** Low-confidence items are `flagged`
   (excluded from recall, visible in the UI); duplicates/contradictions
   resolve to `superseded` with a pointer to the winner. Only the user
   deletes — via UI or `memory_delete`.
4. **Corroboration earns trust.** Repeated independent observations merge
   with a support bonus and can rescue flagged items back to active.
5. **The user owns everything.** View, edit, delete, and export (`memory_export`
   → full JSON, vectors opt-in) any memory from Settings → Memory & Facts.
6. **Writes are logged twice.** The per-store `writes` log (summaries) and
   the daemon audit log (store + op + ref — memory *content* never lands in
   receipts, same rule as typed content).
7. **Recall never fails a turn.** Empty stores, missing daemon, missing
   Ollama → empty block, silent degradation. Vectors upgrade recall; they
   never gate it.

## Retrieval (`retrieve.mjs`)

Three legs fused by RRF (k=60): **vector cosine** (client-embedded query vs
stored embeddings, Ollama `nomic-embed-text`, best-effort), **full-text**
(FTS5 bm25 / substring fallback), **recency** (exponential, τ=90d facts /
30d episodes; current session sorts first). Returned rows are touched
(`accessCount`/`useCount` feed decay). Assembly budget defaults to 1200
tokens × 4 chars; `topK` defaults to 6 per store.

## Consolidation (`consolidate.mjs`)

Nightly at 03:00 via the AmbientScheduler (`memory-consolidation` routine,
runs inside quiet hours by design) + manual trigger from the UI.
Deduction: exact + near-duplicate merge (cosine ≥0.92), slot-contradiction
resolution (newest × highest-confidence wins, ties to newer), exponential
decay (τ=180d facts / 90d episodes, floor 0.05), low-confidence flags,
extractive session summaries after 30 idle days. Induction: ≥2 successful
task episodes sharing a normalized pattern → skill candidate; ≥3 → active.

## Files

- `schema.mjs` — validation/normalization (pure, backend-agnostic)
- `store.mjs` — SQLite + JSON persistence (`createMemoryStore(dataDir)`)
- `derive.mjs` — write-time conclusion extractors (pure)
- `retrieve.mjs` — hybrid recall + budgeted assembly
- `consolidate.mjs` — the dream cycle
- `actions.mjs` — `memory_*` daemon dispatch (`MEMORY_ACTIONS` contract)
- `memory.test.mjs` — 23 contract tests
