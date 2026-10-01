/**
 * lib/embeddings.ts — Phase 21: client for local text embeddings.
 *
 * `embedTexts` calls POST /api/sophia/embed (Ollama nomic-embed-text on the
 * host) and returns validated vectors, or null when embeddings are
 * unavailable for any reason. Callers ALWAYS degrade to keyword search —
 * vectors upgrade recall, they never gate it.
 */

import { sophiaFetch } from './sophia-fetch.ts';

export type EmbedFn = (texts: string[]) => Promise<number[][] | null>;

const MAX_DIMS = 4096;

export function isEmbedding(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.length <= MAX_DIMS &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/** Embed up to 8 texts; null when the embed backend is unavailable. */
export async function embedTexts(
  texts: string[],
  fetcher: typeof fetch = sophiaFetch as unknown as typeof fetch,
): Promise<number[][] | null> {
  const list = texts
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter(Boolean)
    .slice(0, 8);
  if (list.length === 0) return null;
  try {
    const res = await fetcher('/api/sophia/embed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts: list }),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { embeddings?: unknown } | null;
    const embs = body?.embeddings;
    if (!Array.isArray(embs) || embs.length !== list.length || !embs.every(isEmbedding)) return null;
    return embs as number[][];
  } catch {
    return null;
  }
}
