/**
 * memory/consolidate.mjs — Phase 24: the Dreamer (Honcho's dreaming,
 * adapted). A periodic consolidation cycle over the 4 stores:
 * deduction (merge duplicates, resolve contradictions, refresh weights)
 * then induction (repeated successes become skill candidates). Runs nightly
 * via the scheduler + on manual trigger; single-flight, cooldown-guarded,
 * min-delta-guarded. Never deletes: losers are superseded, the user deletes.
 */
import { CONF, normalizeText } from './schema.mjs';
import { cosineSim, recencyScore } from './retrieve.mjs';

export const DREAM_KIND = 'nightly';
export const COOLDOWN_MS = 8 * 3600_000;
export const MIN_DELTA = 10;
export const SUMMARY_AFTER_MS = 30 * 86400_000;
export const INDUCT_MIN_SUPPORT = 2;
export const ACTIVATE_MIN_SUPPORT = 3;

let inFlight = false;
/** Test seam. */
export function __resetDream() {
  inFlight = false;
}

/** Canonical task pattern for induction grouping. Pure. */
export function normalizePattern(goal) {
  return String(goal ?? '')
    .toLowerCase()
    .replace(/[a-z]:\\[^\s]*/g, ' ')
    .replace(/\/[^\s]*/g, ' ')
    .replace(/["“”«»„'‘’‚‹›'‚`´]/g, ' ')
    .replace(/\b\d+(\.\d+)?\b/g, '#')
    .replace(/[^a-z0-9#\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

const round2 = (n) => Math.round(n * 100) / 100;

/** Winner = newest × highest-confidence; ties break to the newer row. Pure. */
export function pickWinner(a, b, now = Date.now()) {
  const score = (f) => f.confidence + 0.3 * recencyScore(f.updatedAt || f.ts, now, 90);
  const sa = score(a);
  const sb = score(b);
  if (sa !== sb) return sa > sb ? a : b;
  return b.id > a.id ? b : a;
}

export function decayed(conf, lastTouch, now, tauDays) {
  const d = decayFactor(lastTouch, now, tauDays);
  return Math.max(0.05, round2(conf * d));
}

function decayFactor(lastTouch, now, tauDays) {
  if (!Number.isFinite(lastTouch) || lastTouch <= 0) return 1;
  const days = Math.max(0, (now - lastTouch) / 86400000);
  return Math.exp(-days / Math.max(1, tauDays));
}

const short = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function sessionSummary(session, episodes) {
  const done = episodes.filter((e) => e.outcome === 'done').length;
  const failed = episodes.filter((e) => e.outcome === 'failed').length;
  const first = episodes[episodes.length - 1];
  const last = episodes[0];
  const bits = [`${episodes.length} episodes (${done} done${failed ? `, ${failed} failed` : ''})`];
  if (first) bits.push(`first: ${short(first.text, 140)}`);
  if (last && last !== first) bits.push(`last: ${short(last.text, 140)}`);
  return bits.join('. ').slice(0, 500);
}

function skillTrigger(pattern) {
  const words = pattern.split(' ').filter((w) => w.length >= 4 && w !== '#');
  const seen = [];
  for (const w of words) {
    if (!seen.includes(w)) seen.push(w);
    if (seen.length >= 6) break;
  }
  return seen.join(' ') || pattern.slice(0, 60);
}

/**
 * One dream cycle. Returns run stats; every mutation is written to the
 * writes log with actor 'consolidation'.
 */
export async function runConsolidation(store, opts = {}) {
  const force = opts.force === true;
  const actor = opts.actor || 'consolidation';
  const cooldownMs = Number(opts.cooldownMs ?? COOLDOWN_MS);
  const minDelta = Number(opts.minDelta ?? MIN_DELTA);
  if (inFlight) return { skipped: 'already running', stats: null };
  inFlight = true;
  const t0 = Date.now();
  const stats = { merged: 0, resolved: 0, decayed: 0, flagged: 0, summarized: 0, skillsProposed: 0, skillsActivated: 0 };
  try {
    const last = await store.lastRun(DREAM_KIND);
    if (!force && last && t0 - last.ts < cooldownMs) {
      return { skipped: 'cooldown', stats: null, lastRun: last.ts };
    }
    if (!force && last && (await store.changedSince(last.ts)) < minDelta) {
      return { skipped: 'no new memories', stats: null, lastRun: last.ts };
    }

    // ── Deduction 1: merge duplicate facts ──
    // Flagged rows participate: a fresh observation corroborates them back
    // above the floor (support bonus), which is how untrusted items earn
    // their way out of quarantine — never by assertion, only by repetition.
    const facts = await store.scanFacts(true, true);
    const byNorm = new Map();
    for (const f of facts) {
      const key = normalizeText(f.text);
      if (!key) continue;
      if (!byNorm.has(key)) byNorm.set(key, []);
      byNorm.get(key).push(f);
    }
    const mergedIds = new Set();
    for (const group of byNorm.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => a.id - b.id);
      const keep = group[group.length - 1];
      const premises = [...new Set(group.flatMap((g) => g.premises))].slice(0, 8);
      const confidence = Math.min(0.95, round2(Math.max(...group.map((g) => g.confidence)) + 0.05 * (group.length - 1)));
      const rescued = keep.status === 'flagged' && confidence >= CONF.FLAG_BELOW;
      await store.updateFact(keep.id, {
        premises: JSON.stringify(premises),
        confidence,
        pinned: keep.pinned || group.some((g) => g.pinned) ? 1 : 0,
        ...(rescued ? { status: 'active' } : {}),
      });
      for (const loser of group.slice(0, -1)) {
        await store.updateFact(loser.id, { status: 'superseded', superseded_by: keep.id });
        mergedIds.add(loser.id);
        stats.merged++;
        await store.logWrite({ store: 'semantic', op: 'merge', refId: String(loser.id), actor, summary: `dup of #${keep.id}: ${short(loser.text, 90)}` });
      }
    }
    // Near-dupes by embedding (only when both sides carry vectors).
    const survivors = facts.filter((f) => !mergedIds.has(f.id));
    const withVec = survivors.filter((f) => Array.isArray(f.embedding));
    for (let i = 0; i < withVec.length; i++) {
      if (mergedIds.has(withVec[i].id)) continue;
      for (let j = i + 1; j < withVec.length; j++) {
        if (mergedIds.has(withVec[j].id)) continue;
        if (cosineSim(withVec[i].embedding, withVec[j].embedding) < CONF.DEDUP_COSINE) continue;
        const [older, newer] = withVec[i].id < withVec[j].id ? [withVec[i], withVec[j]] : [withVec[j], withVec[i]];
        await store.updateFact(older.id, { status: 'superseded', superseded_by: newer.id });
        mergedIds.add(older.id);
        stats.merged++;
        await store.logWrite({ store: 'semantic', op: 'merge', refId: String(older.id), actor, summary: `near-dup of #${newer.id}` });
        break;
      }
    }

    // ── Deduction 2: resolve contradictions (same slot, different value) ──
    const live = survivors.filter((f) => !mergedIds.has(f.id) && f.subject);
    const bySlot = new Map();
    for (const f of live) {
      const key = normalizeText(f.subject);
      if (!key) continue;
      if (!bySlot.has(key)) bySlot.set(key, []);
      bySlot.get(key).push(f);
    }
    for (const group of bySlot.values()) {
      const values = new Map();
      for (const f of group) {
        const v = normalizeText(f.text);
        if (!values.has(v)) values.set(v, []);
        values.get(v).push(f);
      }
      if (values.size < 2) continue;
      let winner = group[0];
      for (const f of group.slice(1)) winner = pickWinner(winner, f, t0);
      for (const f of group) {
        if (f.id === winner.id) continue;
        await store.updateFact(f.id, { status: 'superseded', superseded_by: winner.id });
        stats.resolved++;
        await store.logWrite({ store: 'semantic', op: 'resolve', refId: String(f.id), actor, summary: `slot "${short(f.subject, 40)}" → #${winner.id} wins` });
      }
    }

    // ── Deduction 3: decay the unused, flag the faint ──
    // Anything under the floor gets flagged — whether decay put it there or
    // it arrived faint (untrusted items start life near the floor).
    for (const f of survivors) {
      if (mergedIds.has(f.id) || f.pinned || f.status !== 'active') continue;
      const fresh = decayed(f.confidence, f.lastAccess || f.updatedAt, t0, CONF.DECAY_TAU_FACT_DAYS);
      if (fresh < f.confidence) stats.decayed++;
      const flagged = fresh < CONF.FLAG_BELOW;
      if (fresh !== f.confidence || flagged) {
        await store.updateFact(f.id, { confidence: fresh, ...(flagged ? { status: 'flagged' } : {}) });
      }
      if (flagged) {
        stats.flagged++;
        await store.logWrite({ store: 'semantic', op: 'flag', refId: String(f.id), actor, summary: `low confidence (${fresh}): ${short(f.text, 80)}` });
      }
    }
    const episodes = await store.scanEpisodes(false);
    for (const e of episodes) {
      const fresh = decayed(e.importance, e.lastUsed || e.ts, t0, CONF.DECAY_TAU_EPISODE_DAYS);
      if (fresh < e.importance) {
        stats.decayed++;
        await store.updateEpisode(e.id, { importance: fresh });
      }
    }

    // ── Deduction 4: summarize settled sessions (extractive, no LLM) ──
    const stale = await store.sessionsNeedingSummary(SUMMARY_AFTER_MS, 10);
    for (const s of stale) {
      const eps = await store.listEpisodes({ sessionId: s.sessionId, limit: 100 });
      if (!eps.length) continue;
      await store.setSessionSummary(s.sessionId, sessionSummary(s, eps));
      stats.summarized++;
      await store.logWrite({ store: 'episodic', op: 'summarize', refId: s.sessionId, actor, summary: `${eps.length} episodes condensed` });
    }

    // ── Induction: repeated successes become skill candidates ──
    const wins = episodes.filter((e) => e.kind === 'task' && e.outcome === 'done');
    const byPattern = new Map();
    for (const e of wins) {
      const p = normalizePattern(e.text);
      if (p.length < 12) continue;
      if (!byPattern.has(p)) byPattern.set(p, []);
      byPattern.get(p).push(e);
    }
    const skills = await store.allSkills();
    for (const [pattern, group] of byPattern) {
      if (group.length < INDUCT_MIN_SUPPORT) continue;
      const ids = group.map((e) => e.id);
      const existing = skills.find((s) => s.status !== 'retired' && normalizePattern(`${s.name} ${s.trigger}`) === pattern);
      if (existing) {
        const union = [...new Set([...existing.sourceEpisodes, ...ids])].slice(0, 16);
        const patch = { source_episodes: JSON.stringify(union), success_count: union.length };
        if (existing.status === 'candidate' && union.length >= ACTIVATE_MIN_SUPPORT) {
          patch.status = 'active';
          patch.confidence = 0.7;
          stats.skillsActivated++;
          await store.logWrite({ store: 'procedural', op: 'activate', refId: String(existing.id), actor, summary: `${union.length} supporting episodes` });
        }
        await store.updateSkill(existing.id, patch);
        continue;
      }
      const id = await store.insertSkill({
        name: short(group[0].text, 100),
        trigger: skillTrigger(pattern),
        steps: { note: 'skill steps defined by prompt 3', pattern },
        sourceEpisodes: ids.slice(0, 16),
        successCount: group.length,
        useCount: 0,
      });
      stats.skillsProposed++;
      await store.logWrite({ store: 'procedural', op: 'propose', refId: String(id), actor, summary: `${group.length}×: ${short(pattern, 80)}` });
      if (group.length >= ACTIVATE_MIN_SUPPORT) {
        await store.updateSkill(id, { status: 'active', confidence: 0.7 });
        stats.skillsActivated++;
        await store.logWrite({ store: 'procedural', op: 'activate', refId: String(id), actor, summary: `${group.length} supporting episodes` });
      }
    }

    stats.ms = Date.now() - t0;
    const runId = await store.logRun(DREAM_KIND, stats);
    return { skipped: null, stats, runId };
  } finally {
    inFlight = false;
  }
}
