/**
 * lib/episodes.ts — typed client for episodic memory (Phase 6).
 *
 * Searchable moments over the companion `episodes_*` actions (FTS5 when
 * node:sqlite is available, JSON-lines fallback otherwise). Same injectable
 * caller shape as the daily skills, so tests run daemon-free.
 *
 * Phase 21: hybrid recall — `searchEpisodesHybrid` embeds the query (local
 * Ollama, best-effort) and the daemon fuses a cosine leg with keyword hits
 * by RRF. Vectors upgrade recall; they never gate it.
 */

import { companion, type CompanionReply } from './companion-client.ts';
import { embedTexts, isEmbedding, type EmbedFn } from './embeddings.ts';

export type EpisodeCaller = (
  action: string,
  args?: Record<string, unknown>,
) => Promise<CompanionReply<unknown>>;

export const defaultEpisodeCaller: EpisodeCaller = (action, args) =>
  companion.send(action, args ?? {});

export class EpisodeError extends Error {
  code: string;
  detail?: string;

  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = 'EpisodeError';
    this.code = code;
    this.detail = detail;
  }
}

async function call(
  caller: EpisodeCaller,
  action: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  let reply: CompanionReply<unknown>;
  try {
    reply = await caller(action, args);
  } catch (err) {
    throw new EpisodeError('transport', 'Could not reach the companion.', err instanceof Error ? err.message : String(err));
  }
  if (!reply.ok) {
    throw new EpisodeError(
      reply.error || 'action_failed',
      reply.detail || reply.error || 'The companion could not do that.',
      reply.detail,
    );
  }
  return (reply.result ?? {}) as Record<string, unknown>;
}

export type EpisodeEngine = 'fts5' | 'jsonl' | 'unknown';

export interface Episode {
  id?: number;
  ts: number;
  role: string;
  text: string;
}

function toEpisode(raw: unknown): Episode | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.text !== 'string' || !e.text.trim()) return null;
  return {
    id: typeof e.id === 'number' ? e.id : undefined,
    ts: typeof e.ts === 'number' && Number.isFinite(e.ts) ? e.ts : 0,
    role: typeof e.role === 'string' && e.role ? e.role : 'note',
    text: e.text,
  };
}

function engineOf(res: Record<string, unknown>): EpisodeEngine {
  return res.engine === 'fts5' || res.engine === 'jsonl' ? res.engine : 'unknown';
}

function needText(value: unknown, what: string): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) throw new EpisodeError('validation', `${what} is required.`);
  return s;
}

/** Pin a moment to episodic memory. */
export async function addEpisode(
  caller: EpisodeCaller = defaultEpisodeCaller,
  text: string,
  role = 'note',
  opts: { embedding?: number[] } = {},
): Promise<{ id?: number; ts: number; engine: EpisodeEngine }> {
  const res = await call(caller, 'episodes_add', {
    text: needText(text, 'Episode text'),
    role: role.trim().slice(0, 24) || 'note',
    ...(isEmbedding(opts.embedding) ? { embedding: opts.embedding } : {}),
  });
  return {
    id: typeof res.id === 'number' ? res.id : undefined,
    ts: typeof res.ts === 'number' ? res.ts : Date.now(),
    engine: engineOf(res),
  };
}

/**
 * Pin a moment with its embedding when the embed backend is up; plain
 * keyword-only add otherwise. Never throws for embed failures.
 */
export async function addEpisodeEnriched(
  caller: EpisodeCaller = defaultEpisodeCaller,
  text: string,
  role = 'note',
  embed: EmbedFn = embedTexts,
): Promise<{ id?: number; ts: number; engine: EpisodeEngine }> {
  let embedding: number[] | undefined;
  try {
    const embs = await embed([needText(text, 'Episode text')]);
    if (embs && isEmbedding(embs[0])) embedding = embs[0];
  } catch {
    embedding = undefined;
  }
  return addEpisode(caller, text, role, embedding ? { embedding } : {});
}

/** Full-text search over past moments (bm25-ranked on fts5). */
export async function searchEpisodes(
  caller: EpisodeCaller = defaultEpisodeCaller,
  q: string,
  limit = 8,
  opts: { vector?: number[] } = {},
): Promise<{ engine: EpisodeEngine; hybrid: boolean; hits: Episode[] }> {
  const res = await call(caller, 'episodes_search', {
    q: needText(q, 'Search text'),
    limit: Math.min(50, Math.max(1, Math.floor(limit) || 8)),
    ...(isEmbedding(opts.vector) ? { vector: opts.vector } : {}),
  });
  const hits = Array.isArray(res.hits) ? res.hits : [];
  return {
    engine: engineOf(res),
    hybrid: res.hybrid === true,
    hits: hits.map(toEpisode).filter((e): e is Episode => e !== null),
  };
}

/**
 * Hybrid recall: embed the query (best-effort) and let the daemon fuse a
 * cosine leg with keyword hits. Falls back to keyword search when the
 * embed backend is down — same results as searchEpisodes then.
 */
export async function searchEpisodesHybrid(
  caller: EpisodeCaller = defaultEpisodeCaller,
  q: string,
  limit = 8,
  embed: EmbedFn = embedTexts,
): Promise<{ engine: EpisodeEngine; hybrid: boolean; hits: Episode[] }> {
  let vector: number[] | undefined;
  try {
    const embs = await embed([needText(q, 'Search text')]);
    if (embs && isEmbedding(embs[0])) vector = embs[0];
  } catch {
    vector = undefined;
  }
  return searchEpisodes(caller, q, limit, vector ? { vector } : {});
}

/** Newest moments first. */
export async function recentEpisodes(
  caller: EpisodeCaller = defaultEpisodeCaller,
  limit = 8,
): Promise<{ engine: EpisodeEngine; episodes: Episode[] }> {
  const res = await call(caller, 'episodes_recent', {
    limit: Math.min(50, Math.max(1, Math.floor(limit) || 8)),
  });
  const list = Array.isArray(res.episodes) ? res.episodes : [];
  return {
    engine: engineOf(res),
    episodes: list.map(toEpisode).filter((e): e is Episode => e !== null),
  };
}

/** Compact relative time for the memory list. */
export function episodeAge(ts: number, now: number = Date.now()): string {
  if (!ts) return 'unknown';
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}
