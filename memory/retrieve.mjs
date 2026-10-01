/**
 * memory/retrieve.mjs — Phase 24: hybrid retrieval + per-turn context.
 * Honcho's context(), adapted: three legs (vector cosine + full-text +
 * recency) fused by RRF, top-k per store, token-budgeted assembly.
 * Vectors upgrade recall; keyword + recency always work.
 */

import { CONF, cleanVector } from './schema.mjs';

/** Cosine similarity; 0 for dim mismatch or zero vectors. Pure. */
export function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/** Reciprocal-rank fuse ranked legs into merged items. Pure. */
export function rrfFuse(legs, limit, k = CONF.RRF_K) {
  const scores = new Map();
  for (const leg of legs) {
    leg.forEach((entry, rank) => {
      const prev = scores.get(entry.key);
      const add = 1 / (k + rank);
      if (prev) prev.score += add;
      else scores.set(entry.key, { score: add, item: entry.item });
    });
  }
  return [...scores.values()]
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((e) => e.item);
}

/** Exponential recency in [0,1]. Pure. */
export function recencyScore(ts, now = Date.now(), tauDays = 30) {
  if (!Number.isFinite(ts) || ts <= 0) return 0;
  const days = Math.max(0, (now - ts) / 86400000);
  return Math.exp(-days / Math.max(1, tauDays));
}

export function tokenize(s) {
  return String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
}

/** Keyword trigger match for skills: overlap ranked. Pure. */
export function matchSkills(skills, query, limit = 3) {
  const qt = new Set(tokenize(query));
  if (!qt.size) return [];
  const scored = [];
  for (const s of skills) {
    if (!s || s.status === 'retired') continue;
    const tt = tokenize(`${s.name} ${s.trigger}`);
    let hits = 0;
    for (const t of tt) if (qt.has(t)) hits++;
    if (hits > 0) scored.push({ s, hits, active: s.status === 'active' ? 1 : 0 });
  }
  scored.sort((a, b) => b.active - a.active || b.hits - a.hits);
  return scored.slice(0, limit).map((e) => e.s);
}

const vecLeg = (rows, vec, keyOf) => {
  const scored = [];
  for (const r of rows) {
    if (!Array.isArray(r.embedding)) continue;
    const sim = cosineSim(vec, r.embedding);
    if (sim > 0) scored.push({ key: keyOf(r), item: r, sim });
  }
  scored.sort((x, y) => y.sim - x.sim);
  return scored;
};

async function recallFacts(store, q, vec, topK) {
  const pool = Math.min(50, Math.max(topK * 3, 12));
  const legs = [];
  if (q) {
    const kw = await store.searchFacts(q, pool);
    const byId = new Map();
    legs.push(kw.map((h) => ({ key: `f:${h.id}`, byId, id: h.id })));
    void byId;
  }
  const scanned = await store.scanFacts(Boolean(vec));
  const byId = new Map(scanned.map((r) => [r.id, r]));
  if (legs.length) {
    legs[0] = legs[0].map((e) => ({ key: e.key, item: byId.get(e.id) })).filter((e) => e.item);
  }
  if (vec) legs.push(vecLeg(scanned, vec, (r) => `f:${r.id}`));
  const fresh = [...scanned].sort((a, b) => (b.lastAccess || b.updatedAt) - (a.lastAccess || a.updatedAt));
  legs.push(fresh.slice(0, pool).map((r) => ({ key: `f:${r.id}`, item: r })));
  return rrfFuse(legs.filter((l) => l.length), topK);
}

async function recallEpisodes(store, sessionId, q, vec, topK) {
  const pool = Math.min(50, Math.max(topK * 3, 12));
  const legs = [];
  if (q) {
    const kw = await store.searchEpisodes(q, pool);
    legs.push(kw.map((h) => ({ key: `e:${h.id}`, id: h.id })));
  }
  const scanned = await store.scanEpisodes(Boolean(vec));
  const byId = new Map(scanned.map((r) => [r.id, r]));
  if (legs.length) {
    legs[0] = legs[0].map((e) => ({ key: e.key, item: byId.get(e.id) })).filter((e) => e.item);
  }
  if (vec) legs.push(vecLeg(scanned, vec, (r) => `e:${r.id}`));
  const fresh = [...scanned].sort((a, b) => (b.lastUsed || b.ts) - (a.lastUsed || a.ts));
  // Current session first: continuity beats archaeology.
  const own = fresh.filter((r) => r.sessionId === sessionId);
  const rest = fresh.filter((r) => r.sessionId !== sessionId);
  legs.push([...own, ...rest].slice(0, pool).map((r) => ({ key: `e:${r.id}`, item: r })));
  return rrfFuse(legs.filter((l) => l.length), topK);
}

function peerCardOf(facts) {
  const pinned = facts.filter((f) => f.pinned);
  const solid = facts
    .filter((f) => !f.pinned && f.sourceTrust === 'trusted' && f.confidence >= 0.8)
    .sort((a, b) => b.confidence - a.confidence || a.text.length - b.text.length);
  return [...pinned, ...solid].slice(0, 8);
}

const short = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function factLine(f) {
  const conf = Math.round(f.confidence * 100);
  const tag = f.sourceTrust === 'trusted' ? `via ${f.source}` : `via ${f.source} (unverified)`;
  return `• ${short(f.text, 220)} [${tag}, ${conf}%]`;
}

function episodeLine(e) {
  const when = new Date(e.ts).toISOString().slice(0, 10);
  const out = e.outcome && e.outcome !== 'none' ? ` → ${e.outcome}` : '';
  return `• ${short(e.summary || e.text, 220)} (${e.kind}, ${when}${out})`;
}

/**
 * Assemble the per-turn memory block within a token budget. Sections fill
 * in priority order (working → peer card → facts → episodes → skills) and
 * the render stops when the budget is spent.
 */
export function buildBlock(sections, tokens) {
  const budget = Math.max(100, Math.min(Number(tokens) || 1200, 8000)) * CONF.CHARS_PER_TOKEN;
  const lines = [];
  let used = 0;
  const push = (s) => {
    if (used + s.length + 1 > budget) return false;
    lines.push(s);
    used += s.length + 1;
    return true;
  };
  if (sections.working) {
    const w = sections.working;
    const bits = [];
    if (w.goal) bits.push(`goal: ${short(w.goal, 300)}`);
    if (w.plan) bits.push(`plan: ${short(w.plan, 600)}`);
    if (w.scratchpad) bits.push(`notes: ${short(w.scratchpad, 800)}`);
    if (bits.length && !push(`Current task — ${bits.join(' · ')}`)) return finish();
  }
  const pushList = (title, items) => {
    if (!items.length) return true;
    if (!push(title)) return false;
    for (const it of items) if (!push(it)) return false;
    return true;
  };
  const finish = () => ({ block: lines.join('\n'), chars: used, budget });
  if (sections.peerCard?.length && !pushList('About the user:', sections.peerCard.map((f) => `• ${short(f.text, 160)}`))) return finish();
  if (sections.facts?.length && !pushList('Remembered:', sections.facts.map(factLine))) return finish();
  if (sections.episodes?.length && !pushList('Previously:', sections.episodes.map(episodeLine))) return finish();
  if (sections.skills?.length && !pushList('Known how-tos:', sections.skills.map((s) => `• ${short(s.name, 80)} — when ${short(s.trigger, 140)}`))) return finish();
  if (sections.sessionSummary && !push('Session so far: ' + short(sections.sessionSummary, 400))) return finish();
  return finish();
}

/**
 * Full context assembly: recall + touch + budget + render.
 * Never throws on empty stores — returns an empty block instead.
 */
export async function assembleContext(store, opts = {}) {
  const sessionId = typeof opts.sessionId === 'string' && opts.sessionId ? opts.sessionId : 'default';
  const q = typeof opts.query === 'string' ? opts.query.trim().slice(0, 300) : '';
  const vec = cleanVector(opts.vector);
  const topK = Math.min(Math.max(Number(opts.topK) || 6, 1), 20);
  const tokens = Math.max(100, Math.min(Number(opts.tokens) || 1200, 8000));

  const [working, session, facts, episodes, skills] = await Promise.all([
    store.getWorking(sessionId),
    store.getSession(sessionId),
    recallFacts(store, q, vec, topK),
    recallEpisodes(store, sessionId, q, vec, topK),
    store.allSkills(),
  ]);
  // Use counts feed decay + frequency: touching is part of recall.
  await Promise.all([
    ...facts.map((f) => store.updateFact(f.id, { touch_access: true })),
    ...episodes.map((e) => store.updateEpisode(e.id, { touch_use: true })),
  ]);
  const matchedSkills = q ? matchSkills(skills, q, 3) : [];
  const peerCard = peerCardOf(facts);
  const { block, chars, budget } = buildBlock(
    { working, peerCard, facts, episodes, skills: matchedSkills, sessionSummary: session?.summary ?? null },
    tokens,
  );
  const clean = (rows) => rows.map((r) => {
    const { embedding: _d, ...rest } = r;
    void _d;
    return rest;
  });
  return {
    working, peerCard: clean(peerCard), facts: clean(facts), episodes: clean(episodes),
    skills: matchedSkills.map((s) => ({ id: s.id, name: s.name, trigger: s.trigger, status: s.status, confidence: s.confidence, successCount: s.successCount ?? 0, useCount: s.useCount ?? 0 })),
    sessionSummary: session?.summary ?? null,
    budget: { tokens, chars, used: chars },
    block,
  };
}
