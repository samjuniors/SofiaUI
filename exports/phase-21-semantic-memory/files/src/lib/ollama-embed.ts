/**
 * lib/ollama-embed.ts — Phase 21: one Ollama /api/embeddings call.
 *
 * Standalone (no server graph) so node tests cover it; the web server's
 * /embed route is a thin SSRF-guarded wrapper. Returns null on ANY failure
 * (Ollama down, no model, timeout, malformed) — callers degrade to
 * keyword search. Local + free: the default model is nomic-embed-text.
 */

export interface OllamaEmbedOpts {
  /** Base URL, already SSRF-resolved by the caller. */
  baseUrl: string;
  model?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

const MAX_TEXTS = 8;
const MAX_CHARS = 2000;
const MAX_DIMS = 4096;

export async function ollamaEmbed(texts: string[], opts: OllamaEmbedOpts): Promise<number[][] | null> {
  const list = texts
    .map((t) => (typeof t === 'string' ? t.trim().slice(0, MAX_CHARS) : ''))
    .filter(Boolean)
    .slice(0, MAX_TEXTS);
  if (list.length === 0) return null;
  const fetchFn = opts.fetchFn ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
  try {
    const res = await fetchFn(`${opts.baseUrl.replace(/\/+$/, '')}/api/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: opts.model || 'nomic-embed-text', input: list }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { embeddings?: unknown } | null;
    const embs = body?.embeddings;
    if (!Array.isArray(embs) || embs.length !== list.length) return null;
    for (const e of embs) {
      if (
        !Array.isArray(e) ||
        e.length === 0 ||
        e.length > MAX_DIMS ||
        !e.every((n) => typeof n === 'number' && Number.isFinite(n))
      ) {
        return null;
      }
    }
    return embs as number[][];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
