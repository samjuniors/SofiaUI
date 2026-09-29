/**
 * lib/episodes.ts — typed client for episodic memory (Phase 6).
 *
 * Searchable moments over the companion `episodes_*` actions (FTS5 when
 * node:sqlite is available, JSON-lines fallback otherwise). Same injectable
 * caller shape as the daily skills, so tests run daemon-free.
 */

import { companion, type CompanionReply } from './companion-client.ts';

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
): Promise<{ id?: number; ts: number; engine: EpisodeEngine }> {
  const res = await call(caller, 'episodes_add', {
    text: needText(text, 'Episode text'),
    role: role.trim().slice(0, 24) || 'note',
  });
  return {
    id: typeof res.id === 'number' ? res.id : undefined,
    ts: typeof res.ts === 'number' ? res.ts : Date.now(),
    engine: engineOf(res),
  };
}

/** Full-text search over past moments (bm25-ranked on fts5). */
export async function searchEpisodes(
  caller: EpisodeCaller = defaultEpisodeCaller,
  q: string,
  limit = 8,
): Promise<{ engine: EpisodeEngine; hits: Episode[] }> {
  const res = await call(caller, 'episodes_search', {
    q: needText(q, 'Search text'),
    limit: Math.min(50, Math.max(1, Math.floor(limit) || 8)),
  });
  const hits = Array.isArray(res.hits) ? res.hits : [];
  return {
    engine: engineOf(res),
    hits: hits.map(toEpisode).filter((e): e is Episode => e !== null),
  };
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
