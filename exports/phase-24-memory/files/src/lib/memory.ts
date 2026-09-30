/**
 * lib/memory.ts — Phase 24: typed client for the 4 memory stores.
 *
 * Working / episodic / semantic / procedural over the companion `memory_*`
 * actions, same injectable-caller shape as the episodes client so tests run
 * daemon-free. Writes embed best-effort (Ollama, local, free); recall fuses
 * vector + full-text + recency in the daemon. `recallForTurn` never throws —
 * a turn must never die because memory is unavailable.
 */

import { companion, type CompanionReply } from './companion-client.ts';
import { embedTexts, isEmbedding, type EmbedFn } from './embeddings.ts';

export type MemoryCaller = (
  action: string,
  args?: Record<string, unknown>,
) => Promise<CompanionReply<unknown>>;

export const defaultMemoryCaller: MemoryCaller = (action, args) =>
  companion.send(action, args ?? {});

export class MemoryError extends Error {
  code: string;
  detail?: string;

  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = 'MemoryError';
    this.code = code;
    this.detail = detail;
  }
}

async function call(
  caller: MemoryCaller,
  action: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  let reply: CompanionReply<unknown>;
  try {
    reply = await caller(action, args);
  } catch (err) {
    throw new MemoryError('transport', 'Could not reach the companion.', err instanceof Error ? err.message : String(err));
  }
  if (!reply.ok) {
    throw new MemoryError(
      reply.error || 'action_failed',
      reply.detail || reply.error || 'The companion could not do that.',
      reply.detail,
    );
  }
  return (reply.result ?? {}) as Record<string, unknown>;
}

export type MemoryEngine = 'fts5' | 'jsonl' | 'unknown';
export type MemoryStoreName = 'semantic' | 'episodic' | 'procedural' | 'working' | 'sessions';

export interface MemoryFact {
  id: number;
  ts: number;
  text: string;
  subject: string | null;
  source: string;
  sourceTrust: 'trusted' | 'untrusted';
  confidence: number;
  status: string;
  pinned: boolean;
  accessCount: number;
}

export interface MemoryEpisode {
  id: number;
  ts: number;
  sessionId: string;
  kind: string;
  text: string;
  outcome: string;
  summary: string | null;
  importance: number;
  shots: Array<{ path: string; bytes: number }>;
}

export interface MemorySkill {
  id: number;
  ts: number;
  name: string;
  trigger: string;
  status: string;
  confidence: number;
  successCount: number;
  useCount: number;
}

export interface WorkingState {
  sessionId: string;
  updatedAt: number;
  goal: string | null;
  plan: string | null;
  scratchpad: string | null;
  entities: string[];
}

export interface TurnMemory {
  block: string;
  facts: MemoryFact[];
  episodes: MemoryEpisode[];
  working: WorkingState | null;
}

function toFact(raw: unknown): MemoryFact | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const f = raw as Record<string, unknown>;
  if (typeof f.id !== 'number' || typeof f.text !== 'string') return null;
  return {
    id: f.id,
    ts: typeof f.ts === 'number' ? f.ts : 0,
    text: f.text,
    subject: typeof f.subject === 'string' ? f.subject : null,
    source: typeof f.source === 'string' ? f.source : 'unknown',
    sourceTrust: f.sourceTrust === 'untrusted' ? 'untrusted' : 'trusted',
    confidence: typeof f.confidence === 'number' ? f.confidence : 0,
    status: typeof f.status === 'string' ? f.status : 'active',
    pinned: f.pinned === true,
    accessCount: typeof f.accessCount === 'number' ? f.accessCount : 0,
  };
}

function toEpisode(raw: unknown): MemoryEpisode | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== 'number' || typeof e.text !== 'string') return null;
  return {
    id: e.id,
    ts: typeof e.ts === 'number' ? e.ts : 0,
    sessionId: typeof e.sessionId === 'string' ? e.sessionId : 'default',
    kind: typeof e.kind === 'string' ? e.kind : 'moment',
    text: e.text,
    outcome: typeof e.outcome === 'string' ? e.outcome : 'none',
    summary: typeof e.summary === 'string' ? e.summary : null,
    importance: typeof e.importance === 'number' ? e.importance : 0,
    shots: Array.isArray(e.shots) ? (e.shots as Array<{ path: string; bytes: number }>) : [],
  };
}

function toSkill(raw: unknown): MemorySkill | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== 'number' || typeof s.name !== 'string') return null;
  return {
    id: s.id,
    ts: typeof s.ts === 'number' ? s.ts : 0,
    name: s.name,
    trigger: typeof s.trigger === 'string' ? s.trigger : '',
    status: typeof s.status === 'string' ? s.status : 'candidate',
    confidence: typeof s.confidence === 'number' ? s.confidence : 0,
    successCount: typeof s.successCount === 'number' ? s.successCount : 0,
    useCount: typeof s.useCount === 'number' ? s.useCount : 0,
  };
}

function toWorking(raw: unknown): WorkingState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const w = raw as Record<string, unknown>;
  return {
    sessionId: typeof w.sessionId === 'string' ? w.sessionId : 'default',
    updatedAt: typeof w.updatedAt === 'number' ? w.updatedAt : 0,
    goal: typeof w.goal === 'string' ? w.goal : null,
    plan: typeof w.plan === 'string' ? w.plan : null,
    scratchpad: typeof w.scratchpad === 'string' ? w.scratchpad : null,
    entities: Array.isArray(w.entities) ? w.entities.filter((e): e is string => typeof e === 'string') : [],
  };
}

function engineOf(res: Record<string, unknown>): MemoryEngine {
  return res.engine === 'fts5' || res.engine === 'jsonl' ? res.engine : 'unknown';
}

function needText(value: unknown, what: string): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) throw new MemoryError('validation', `${what} is required.`);
  return s;
}

async function maybeEmbed(text: string, embed: EmbedFn): Promise<number[] | undefined> {
  try {
    const embs = await embed([text]);
    if (embs && isEmbedding(embs[0])) return embs[0];
  } catch {
    /* embed backend down — keyword-only write */
  }
  return undefined;
}

/** Remember one fact. Source tag required (daemon enforces). */
export async function addMemoryFact(
  caller: MemoryCaller = defaultMemoryCaller,
  opts: { text: string; subject?: string; source: string; confidence?: number; premises?: number[] },
  embed: EmbedFn = embedTexts,
): Promise<{ id: number; sourceTrust: string; confidence: number; engine: MemoryEngine }> {
  const text = needText(opts.text, 'Fact text');
  const embedding = await maybeEmbed(text, embed);
  const res = await call(caller, 'memory_fact_add', {
    text,
    ...(opts.subject ? { subject: opts.subject } : {}),
    source: needText(opts.source, 'Source tag'),
    ...(typeof opts.confidence === 'number' ? { confidence: opts.confidence } : {}),
    ...(opts.premises ? { premises: opts.premises } : {}),
    ...(embedding ? { embedding } : {}),
  });
  return {
    id: typeof res.id === 'number' ? res.id : -1,
    sourceTrust: typeof res.sourceTrust === 'string' ? res.sourceTrust : 'unknown',
    confidence: typeof res.confidence === 'number' ? res.confidence : 0,
    engine: engineOf(res),
  };
}

/** Log what happened (task outcome, turn, chat note). Auto-derives conclusions. */
export async function addMemoryEpisode(
  caller: MemoryCaller = defaultMemoryCaller,
  opts: {
    text: string;
    kind?: string;
    outcome?: string;
    sessionId?: string;
    source?: string;
    importance?: number;
    shots?: string[];
  },
  embed: EmbedFn = embedTexts,
): Promise<{ id: number; derivedIds: number[]; engine: MemoryEngine }> {
  const text = needText(opts.text, 'Episode text');
  const embedding = await maybeEmbed(text, embed);
  const res = await call(caller, 'memory_episode_add', {
    text,
    ...(opts.kind ? { kind: opts.kind } : {}),
    ...(opts.outcome ? { outcome: opts.outcome } : {}),
    ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
    ...(opts.source ? { source: opts.source } : {}),
    ...(typeof opts.importance === 'number' ? { importance: opts.importance } : {}),
    ...(opts.shots ? { shots: opts.shots } : {}),
    ...(embedding ? { embedding } : {}),
  });
  return {
    id: typeof res.id === 'number' ? res.id : -1,
    derivedIds: Array.isArray(res.derivedIds) ? res.derivedIds.filter((n): n is number => typeof n === 'number') : [],
    engine: engineOf(res),
  };
}

/** Save working state for the current task/session. */
export async function putWorking(
  caller: MemoryCaller = defaultMemoryCaller,
  opts: { sessionId?: string; goal?: string; plan?: string; scratchpad?: string; entities?: string[] },
): Promise<{ sessionId: string }> {
  const res = await call(caller, 'memory_working_put', { ...opts });
  return { sessionId: typeof res.sessionId === 'string' ? res.sessionId : 'default' };
}

export async function getWorking(
  caller: MemoryCaller = defaultMemoryCaller,
  sessionId = 'default',
): Promise<WorkingState | null> {
  const res = await call(caller, 'memory_working_get', { sessionId });
  return toWorking(res.working);
}

/** Drop working state (task finished / session reset). */
export async function clearWorking(
  caller: MemoryCaller = defaultMemoryCaller,
  sessionId = 'default',
): Promise<void> {
  await call(caller, 'memory_working_clear', { sessionId });
}

/**
 * Per-turn recall: top-k facts + episodes + working, token-budgeted,
 * pre-rendered as a prompt block. NEVER throws — degradation is silent
 * (companion down, embed backend down, empty stores → empty block).
 */
export async function recallForTurn(
  query: string,
  opts: {
    caller?: MemoryCaller;
    sessionId?: string;
    topK?: number;
    tokens?: number;
    embed?: EmbedFn;
  } = {},
): Promise<TurnMemory> {
  const empty: TurnMemory = { block: '', facts: [], episodes: [], working: null };
  const caller = opts.caller ?? defaultMemoryCaller;
  const q = query.trim().slice(0, 300);
  if (!q) return empty;
  try {
    let vector: number[] | undefined;
    try {
      const embs = await (opts.embed ?? embedTexts)([q]);
      if (embs && isEmbedding(embs[0])) vector = embs[0];
    } catch {
      vector = undefined;
    }
    const res = await call(caller, 'memory_context', {
      query: q,
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
      topK: opts.topK ?? 6,
      tokens: opts.tokens ?? 1200,
      ...(vector ? { vector } : {}),
    });
    return {
      block: typeof res.block === 'string' ? res.block : '',
      facts: Array.isArray(res.facts) ? res.facts.map(toFact).filter((f): f is MemoryFact => f !== null) : [],
      episodes: Array.isArray(res.episodes) ? res.episodes.map(toEpisode).filter((e): e is MemoryEpisode => e !== null) : [],
      working: toWorking(res.working),
    };
  } catch {
    return empty;
  }
}

/** Browse any store (the user's window into their memory). */
export async function listMemories(
  caller: MemoryCaller = defaultMemoryCaller,
  store: MemoryStoreName,
  opts: { status?: string; q?: string; limit?: number; offset?: number } = {},
): Promise<unknown[]> {
  const res = await call(caller, 'memory_list', { store, ...opts });
  return Array.isArray(res.rows) ? res.rows : [];
}

export async function updateMemory(
  caller: MemoryCaller = defaultMemoryCaller,
  store: MemoryStoreName,
  id: number,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const res = await call(caller, 'memory_update', { store, id, patch, actor: 'user' });
  return res.updated === true;
}

export async function deleteMemory(
  caller: MemoryCaller = defaultMemoryCaller,
  store: MemoryStoreName,
  id: number | string,
): Promise<boolean> {
  const res = await call(caller, 'memory_delete', { store, id, actor: 'user' });
  return res.deleted === true;
}

export async function exportMemory(
  caller: MemoryCaller = defaultMemoryCaller,
  includeVectors = false,
): Promise<Record<string, unknown>> {
  return call(caller, 'memory_export', { ...(includeVectors ? { includeVectors: true } : {}) });
}

export async function memoryWrites(
  caller: MemoryCaller = defaultMemoryCaller,
  limit = 30,
): Promise<Array<{ id: number; ts: number; store: string; op: string; refId: string; actor: string; summary: string }>> {
  const res = await call(caller, 'memory_writes', { limit });
  if (!Array.isArray(res.writes)) return [];
  return res.writes.filter((w): w is Record<string, unknown> => typeof w === 'object' && w !== null).map((w) => ({
    id: typeof w.id === 'number' ? w.id : 0,
    ts: typeof w.ts === 'number' ? w.ts : 0,
    store: typeof w.store === 'string' ? w.store : '',
    op: typeof w.op === 'string' ? w.op : '',
    refId: typeof w.refId === 'string' ? w.refId : '',
    actor: typeof w.actor === 'string' ? w.actor : '',
    summary: typeof w.summary === 'string' ? w.summary : '',
  }));
}

export async function memoryCounts(
  caller: MemoryCaller = defaultMemoryCaller,
): Promise<Record<string, number>> {
  const res = await call(caller, 'memory_counts', {});
  const c = (res.counts ?? {}) as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(c)) out[k] = typeof v === 'number' ? v : 0;
  return out;
}

export async function runConsolidationNow(
  caller: MemoryCaller = defaultMemoryCaller,
  force = false,
): Promise<{ skipped: string | null; stats: Record<string, number> | null }> {
  const res = await call(caller, 'memory_consolidate', { ...(force ? { force: true } : {}) });
  return {
    skipped: typeof res.skipped === 'string' ? res.skipped : null,
    stats: typeof res.stats === 'object' && res.stats !== null ? (res.stats as Record<string, number>) : null,
  };
}
