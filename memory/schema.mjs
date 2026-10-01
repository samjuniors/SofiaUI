/**
 * memory/schema.mjs — Phase 24: validation + normalization for the 4 stores.
 * Pure (no I/O): every write passes through here so the SQLite and JSON
 * backends enforce identical contracts.
 *
 * Stores: working (current task, session-scoped), episodic (what happened:
 * text + outcome + screenshots), semantic (facts with source + confidence +
 * timestamp + premises), procedural (learned skill candidates).
 */

export const STORES = ['working', 'episodic', 'semantic', 'procedural'];

export const FACT_STATUS = ['active', 'superseded', 'flagged'];
export const SKILL_STATUS = ['candidate', 'active', 'retired'];
export const OUTCOMES = ['done', 'failed', 'cancelled', 'none'];
export const EPISODE_KINDS = ['task', 'turn', 'chat', 'moment', 'reflection', 'mirror'];

export const CONF = {
  UNTRUSTED_CONF_CAP: 0.4,
  FLAG_BELOW: 0.25,
  DEDUP_COSINE: 0.92,
  DECAY_TAU_FACT_DAYS: 180,
  DECAY_TAU_EPISODE_DAYS: 90,
  RECENCY_TAU_FACT_DAYS: 90,
  RECENCY_TAU_EPISODE_DAYS: 30,
  MAX_FACT_LEN: 500,
  MAX_EPISODE_LEN: 4000,
  MAX_SHOT_BYTES: 2 * 1024 * 1024,
  MAX_SHOTS_PER_EPISODE: 4,
  RRF_K: 60,
  CHARS_PER_TOKEN: 4,
  RETIRE_BELOW: 0.5,
  RETIRE_MIN_USES: 5,
  MAX_FAILURE_MODES: 8,
};

const clamp01 = (n, fallback = 0.5) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
};

const cleanText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Canonical form for dedup/contradiction matching. Pure. */
export function normalizeText(t) {
  return String(t ?? '')
    .toLowerCase()
    .replace(/^(please\s+)?(remember|note|don't forget)( that)?\s+/, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract a "my <slot> is <value>" style subject slot, or null. Pure. */
export function extractSlot(text) {
  const m = /\bmy ([\w][\w -]{0,40}?) (?:is|are)\b/i.exec(String(text ?? ''));
  if (!m) return null;
  const slot = m[1].trim().toLowerCase().replace(/\s+/g, ' ');
  return slot || null;
}

/**
 * Source trust derivation. Trust can only be DOWNGRADED by the writer, never
 * upgraded: untrusted origins stay untrusted no matter what the args claim.
 * (Upgrades happen only through an explicit user edit in memory_update.)
 */
export function trustOf(source, claimed) {
  const s = String(source ?? '').trim().toLowerCase();
  const base = s === 'user' || s === 'assistant' ? 'trusted' : 'untrusted';
  if (base === 'untrusted') return 'untrusted';
  return claimed === 'untrusted' ? 'untrusted' : 'trusted';
}

export function cleanVector(v, maxDims = 4096) {
  if (!Array.isArray(v) || v.length === 0 || v.length > maxDims) return null;
  for (const n of v) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  }
  return v;
}

export function validFactInput(a = {}) {
  const text = cleanText(a.text, CONF.MAX_FACT_LEN);
  if (!text) throw new Error('missing text');
  const source = cleanText(a.source, 160);
  if (!source) throw new Error('missing source: facts require a source tag');
  const trust = trustOf(source, a.sourceTrust);
  let confidence = clamp01(a.confidence, trust === 'trusted' ? 0.7 : CONF.UNTRUSTED_CONF_CAP);
  if (trust === 'untrusted') confidence = Math.min(confidence, CONF.UNTRUSTED_CONF_CAP);
  return {
    text,
    subject: cleanText(a.subject, 80) || extractSlot(text) || null,
    source,
    sourceTrust: trust,
    confidence,
    premises: Array.isArray(a.premises) ? a.premises.filter((n) => Number.isInteger(n)).slice(0, 8) : [],
    pinned: a.pinned === true,
    embedding: cleanVector(a.embedding),
  };
}

export function validEpisodeInput(a = {}) {
  const text = cleanText(a.text, CONF.MAX_EPISODE_LEN);
  if (!text) throw new Error('missing text');
  return {
    sessionId: cleanText(a.sessionId, 80) || 'default',
    kind: EPISODE_KINDS.includes(a.kind) ? a.kind : 'moment',
    text,
    outcome: OUTCOMES.includes(a.outcome) ? a.outcome : 'none',
    summary: cleanText(a.summary, 500) || null,
    importance: clamp01(a.importance, 0.5),
    shots: [], // filled by the action layer (files live under dataDir)
    embedding: cleanVector(a.embedding),
  };
}

const validShotB64 = (b64) => {
  if (typeof b64 !== 'string' || !b64) return null;
  const m = /^data:(image\/(png|jpeg));base64,(.+)$/.exec(b64.trim()) || [null, null, null, b64.trim()];
  const ext = m[2] === 'jpeg' ? 'jpg' : 'png';
  let buf;
  try {
    buf = Buffer.from(m[3], 'base64');
  } catch {
    return null;
  }
  if (buf.length === 0 || buf.length > CONF.MAX_SHOT_BYTES) return null;
  const isPng = buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isJpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (!isPng && !isJpg) return null;
  return { buf, ext: isJpg ? 'jpg' : ext };
};

export function validShots(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list.slice(0, CONF.MAX_SHOTS_PER_EPISODE)) {
    const v = validShotB64(item);
    if (v) out.push(v);
  }
  return out;
}

export function validSkillInput(a = {}) {
  const name = cleanText(a.name, 120);
  if (!name) throw new Error('missing name');
  const trigger = cleanText(a.trigger, 300);
  if (!trigger) throw new Error('missing trigger');
  return {
    name,
    trigger,
    steps: a.steps && typeof a.steps === 'object' ? a.steps : { note: 'steps not yet distilled' },
    sourceEpisodes: Array.isArray(a.sourceEpisodes)
      ? a.sourceEpisodes.filter((n) => Number.isInteger(n)).slice(0, 16)
      : [],
    successCount: Math.max(0, Math.min(1000000, Number(a.successCount) || 0)),
    useCount: Math.max(0, Math.min(1000000, Number(a.useCount) || 0)),
  };
}

export function validWorkingInput(a = {}) {
  return {
    sessionId: cleanText(a.sessionId, 80) || 'default',
    goal: cleanText(a.goal, 500) || null,
    plan: cleanText(a.plan, 2000) || null,
    scratchpad: cleanText(a.scratchpad, 4000) || null,
    entities: Array.isArray(a.entities)
      ? a.entities.filter((e) => typeof e === 'string' && e.trim()).map((e) => e.trim().slice(0, 80)).slice(0, 20)
      : [],
  };
}
