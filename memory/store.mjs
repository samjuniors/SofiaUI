/**
 * memory/store.mjs — Phase 24: persistence for the 4 memory stores.
 * node:sqlite when available (memory.sqlite + FTS5), JSON fallback
 * (memory.json) otherwise. Explicit handles (no singletons) so tests and
 * the daemon can hold separate stores; every mutation is mirrored to the
 * writes log by the caller (actions layer), not here.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export const VECTOR_SCAN_CAP = 2000;

const FACT_COLS = 'id, ts, updated_at, text, subject, source, source_trust, confidence, premises, status, superseded_by, pinned, access_count, last_access, embedding';
const EP_COLS = 'id, ts, session_id, kind, text, outcome, summary, importance, use_count, last_used, shots, embedding';
const SKILL_COLS = 'id, ts, updated_at, name, trigger, steps, source_episodes, success_count, use_count, confidence, status';

function emptyDoc() {
  return { facts: [], episodes: [], skills: [], working: {}, sessions: {}, writes: [], runs: [], seq: { fact: 1, episode: 1, skill: 1, write: 1, run: 1 } };
}

function shapeFact(r, withEmbedding) {
  const premises = (() => { try { return JSON.parse(r.premises || '[]'); } catch { return []; } })();
  const out = {
    id: r.id, ts: r.ts, updatedAt: r.updated_at, text: r.text, subject: r.subject ?? null,
    source: r.source, sourceTrust: r.source_trust, confidence: r.confidence, premises,
    status: r.status, supersededBy: r.superseded_by ?? null, pinned: r.pinned === 1,
    accessCount: r.access_count ?? 0, lastAccess: r.last_access ?? null,
  };
  if (withEmbedding && r.embedding) {
    try { out.embedding = JSON.parse(r.embedding); } catch { /* corrupt vector reads as absent */ }
  }
  return out;
}

function shapeEpisode(r, withEmbedding) {
  let shots = [];
  try { shots = JSON.parse(r.shots || '[]'); } catch { /* keep empty */ }
  const out = {
    id: r.id, ts: r.ts, sessionId: r.session_id, kind: r.kind, text: r.text,
    outcome: r.outcome, summary: r.summary ?? null, importance: r.importance,
    useCount: r.use_count ?? 0, lastUsed: r.last_used ?? null, shots,
  };
  if (withEmbedding && r.embedding) {
    try { out.embedding = JSON.parse(r.embedding); } catch { /* absent */ }
  }
  return out;
}

function shapeSkill(r) {
  const j = (v, fb) => { try { return JSON.parse(v); } catch { return fb; } };
  return {
    id: r.id, ts: r.ts, updatedAt: r.updated_at, name: r.name, trigger: r.trigger,
    steps: typeof r.steps === 'object' && r.steps !== null ? r.steps : j(r.steps, {}),
    sourceEpisodes: Array.isArray(r.source_episodes) ? r.source_episodes : j(r.source_episodes, []),
    successCount: r.success_count ?? 0, useCount: r.use_count ?? 0,
    confidence: r.confidence ?? 0.5, status: r.status,
  };
}

export function createMemoryStore(dataDir) {
  let db = null;
  let doc = null;
  let engine = 'jsonl';
  const jsonPath = join(dataDir, 'memory.json');
  let ready = null;

  async function persist() {
    if (doc) await fs.writeFile(jsonPath, JSON.stringify(doc));
  }

  async function init() {
    if (ready) return ready;
    ready = (async () => {
      try {
        const { DatabaseSync } = await import('node:sqlite');
        db = new DatabaseSync(join(dataDir, 'memory.sqlite'));
        db.exec(`CREATE TABLE IF NOT EXISTS facts (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, updated_at INTEGER,
          text TEXT, subject TEXT, source TEXT, source_trust TEXT, confidence REAL, premises TEXT, status TEXT DEFAULT 'active',
          superseded_by INTEGER, pinned INTEGER DEFAULT 0, access_count INTEGER DEFAULT 0, last_access INTEGER, embedding TEXT)`);
        db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(text, subject, content='facts', content_rowid='id')`);
        db.exec(`CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN INSERT INTO facts_fts(rowid, text, subject) VALUES (new.id, new.text, new.subject); END`);
        db.exec(`CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON facts BEGIN INSERT INTO facts_fts(facts_fts, rowid, text, subject) VALUES ('delete', old.id, old.text, old.subject); INSERT INTO facts_fts(rowid, text, subject) VALUES (new.id, new.text, new.subject); END`);
        db.exec(`CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN INSERT INTO facts_fts(facts_fts, rowid, text, subject) VALUES ('delete', old.id, old.text, old.subject); END`);
        db.exec(`CREATE TABLE IF NOT EXISTS episodes (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, session_id TEXT, kind TEXT,
          text TEXT, outcome TEXT, summary TEXT, importance REAL, use_count INTEGER DEFAULT 0, last_used INTEGER, shots TEXT, embedding TEXT)`);
        db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS episodes_mem_fts USING fts5(text, content='episodes', content_rowid='id')`);
        db.exec(`CREATE TRIGGER IF NOT EXISTS mepisodes_ai AFTER INSERT ON episodes BEGIN INSERT INTO episodes_mem_fts(rowid, text) VALUES (new.id, new.text); END`);
        db.exec(`CREATE TRIGGER IF NOT EXISTS mepisodes_ad AFTER DELETE ON episodes BEGIN INSERT INTO episodes_mem_fts(episodes_mem_fts, rowid, text) VALUES ('delete', old.id, old.text); END`);
        db.exec(`CREATE TABLE IF NOT EXISTS skills (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, updated_at INTEGER, name TEXT,
          trigger TEXT, steps TEXT, source_episodes TEXT, success_count INTEGER DEFAULT 0, use_count INTEGER DEFAULT 0, confidence REAL DEFAULT 0.5, status TEXT DEFAULT 'candidate')`);
        db.exec(`CREATE TABLE IF NOT EXISTS working (session_id TEXT PRIMARY KEY, updated_at INTEGER, goal TEXT, plan TEXT, scratchpad TEXT, entities TEXT)`);
        db.exec(`CREATE TABLE IF NOT EXISTS sessions (session_id TEXT PRIMARY KEY, started_ts INTEGER, last_ts INTEGER, episode_count INTEGER DEFAULT 0, summary TEXT)`);
        db.exec(`CREATE TABLE IF NOT EXISTS writes (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, store TEXT, op TEXT, ref_id TEXT, actor TEXT, summary TEXT)`);
        db.exec(`CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, kind TEXT, stats TEXT)`);
        engine = 'fts5';
      } catch {
        db = null;
        try {
          doc = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
          for (const [k, v] of Object.entries(emptyDoc())) if (!(k in doc)) doc[k] = v;
        } catch {
          doc = emptyDoc();
        }
        engine = 'jsonl';
      }
    })();
    return ready;
  }

  const jid = (kind) => String(doc.seq[kind]++);

  // ─── facts ────────────────────────────────────────────────────────────
  async function insertFact(f) {
    await init();
    const now = Date.now();
    if (db) {
      const r = db.prepare(`INSERT INTO facts (ts, updated_at, text, subject, source, source_trust, confidence, premises, status, pinned, access_count, embedding)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, ?)`).run(now, now, f.text, f.subject, f.source, f.sourceTrust, f.confidence,
        JSON.stringify(f.premises), f.pinned ? 1 : 0, f.embedding ? JSON.stringify(f.embedding) : null);
      return Number(r.lastInsertRowid);
    }
    const id = Number(jid('fact'));
    doc.facts.push({ id, ts: now, updated_at: now, text: f.text, subject: f.subject, source: f.source, source_trust: f.sourceTrust,
      confidence: f.confidence, premises: JSON.stringify(f.premises), status: 'active', superseded_by: null, pinned: f.pinned ? 1 : 0,
      access_count: 0, last_access: null, embedding: f.embedding ? JSON.stringify(f.embedding) : null });
    await persist();
    return id;
  }

  async function getFact(id) {
    await init();
    const row = db ? db.prepare(`SELECT ${FACT_COLS} FROM facts WHERE id = ?`).get(id) : doc.facts.find((r) => r.id === id);
    return row ? shapeFact(row, false) : null;
  }

  async function listFacts({ status = 'active', q = '', limit = 20, offset = 0 } = {}) {
    await init();
    const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const off = Math.max(Number(offset) || 0, 0);
    if (db) {
      if (q.trim()) {
        const rows = db.prepare(`SELECT f.${FACT_COLS.replaceAll('embedding', 'NULL AS embedding')} FROM facts_fts JOIN facts f ON f.id = facts_fts.rowid
          WHERE facts_fts MATCH ? AND f.status = ? ORDER BY rank LIMIT ? OFFSET ?`).all(q, status, lim, off);
        return rows.map((r) => shapeFact(r, false));
      }
      const rows = db.prepare(`SELECT ${FACT_COLS} FROM facts WHERE status = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(status, lim, off);
      return rows.map((r) => shapeFact(r, false));
    }
    let rows = doc.facts.filter((r) => r.status === status);
    if (q.trim()) {
      const needle = q.toLowerCase();
      rows = rows.filter((r) => (r.text || '').toLowerCase().includes(needle) || (r.subject || '').toLowerCase().includes(needle));
    }
    rows.sort((a, b) => b.updated_at - a.updated_at);
    return rows.slice(off, off + lim).map((r) => shapeFact(r, false));
  }

  async function updateFact(id, patch) {
    await init();
    const allowed = ['text', 'subject', 'source', 'source_trust', 'confidence', 'premises', 'status', 'superseded_by', 'pinned', 'embedding', 'touch_access'];
    const sets = [];
    const vals = [];
    for (const k of allowed) {
      if (!(k in patch)) continue;
      if (k === 'touch_access') {
        sets.push('access_count = access_count + 1', 'last_access = ?');
        vals.push(Date.now());
        continue;
      }
      sets.push(`${k} = ?`);
      vals.push(patch[k]);
    }
    if (!sets.length) return false;
    sets.push('updated_at = ?');
    vals.push(Date.now());
    if (db) {
      const r = db.prepare(`UPDATE facts SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
      return r.changes > 0;
    }
    const row = doc.facts.find((x) => x.id === id);
    if (!row) return false;
    if ('touch_access' in patch) { row.access_count = (row.access_count ?? 0) + 1; row.last_access = Date.now(); }
    for (const k of allowed) {
      if (k === 'touch_access' || !(k in patch)) continue;
      row[k] = patch[k];
    }
    row.updated_at = Date.now();
    await persist();
    return true;
  }

  async function deleteFact(id) {
    await init();
    if (db) return db.prepare('DELETE FROM facts WHERE id = ?').run(id).changes > 0;
    const i = doc.facts.findIndex((r) => r.id === id);
    if (i < 0) return false;
    doc.facts.splice(i, 1);
    await persist();
    return true;
  }

  /**
   * Full fact scan for retrieval vector legs + consolidation. Capped.
   * Retrieval passes active-only; consolidation includes flagged rows so a
   * fresh observation can corroborate (and rescue) them.
   */
  async function scanFacts(withEmbedding, includeFlagged = false) {
    await init();
    const where = includeFlagged ? "WHERE status IN ('active','flagged')" : "WHERE status = 'active'";
    const rows = db
      ? db.prepare(`SELECT ${FACT_COLS} FROM facts ${where} ORDER BY id DESC LIMIT ?`).all(VECTOR_SCAN_CAP)
      : [...doc.facts].filter((r) => r.status === 'active' || (includeFlagged && r.status === 'flagged')).sort((a, b) => b.id - a.id).slice(0, VECTOR_SCAN_CAP);
    return rows.map((r) => shapeFact(r, withEmbedding));
  }

  async function searchFacts(q, pool) {
    await init();
    const p = Math.min(Math.max(Number(pool) || 10, 1), 50);
    if (db) {
      try {
        return db.prepare(`SELECT f.id, bm25(facts_fts) AS rank FROM facts_fts JOIN facts f ON f.id = facts_fts.rowid
          WHERE facts_fts MATCH ? AND f.status = 'active' ORDER BY rank LIMIT ?`).all(q, p).map((r) => ({ id: r.id, rank: r.rank }));
      } catch {
        return [];
      }
    }
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = [];
    for (const r of doc.facts) {
      if (r.status !== 'active') continue;
      const hay = `${r.text} ${r.subject ?? ''}`.toLowerCase();
      const hits = terms.filter((t) => hay.includes(t)).length;
      if (hits > 0) scored.push({ id: r.id, rank: -hits });
    }
    scored.sort((a, b) => a.rank - b.rank);
    return scored.slice(0, p);
  }

  // ─── episodes ─────────────────────────────────────────────────────────
  async function insertEpisode(e) {
    await init();
    const now = Date.now();
    let id;
    if (db) {
      const r = db.prepare(`INSERT INTO episodes (ts, session_id, kind, text, outcome, summary, importance, use_count, shots, embedding)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(now, e.sessionId, e.kind, e.text, e.outcome, e.summary, e.importance,
        JSON.stringify(e.shots), e.embedding ? JSON.stringify(e.embedding) : null);
      id = Number(r.lastInsertRowid);
      db.prepare(`INSERT INTO sessions (session_id, started_ts, last_ts, episode_count) VALUES (?, ?, ?, 1)
        ON CONFLICT(session_id) DO UPDATE SET last_ts = excluded.last_ts, episode_count = episode_count + 1`).run(e.sessionId, now, now);
    } else {
      id = Number(jid('episode'));
      doc.episodes.push({ id, ts: now, session_id: e.sessionId, kind: e.kind, text: e.text, outcome: e.outcome,
        summary: e.summary, importance: e.importance, use_count: 0, last_used: null, shots: JSON.stringify(e.shots),
        embedding: e.embedding ? JSON.stringify(e.embedding) : null });
      const s = doc.sessions[e.sessionId] ?? { session_id: e.sessionId, started_ts: now, last_ts: now, episode_count: 0, summary: null };
      s.last_ts = now;
      s.episode_count = (s.episode_count ?? 0) + 1;
      doc.sessions[e.sessionId] = s;
      await persist();
    }
    return id;
  }

  async function getEpisode(id) {
    await init();
    const row = db ? db.prepare(`SELECT ${EP_COLS} FROM episodes WHERE id = ?`).get(id) : doc.episodes.find((r) => r.id === id);
    return row ? shapeEpisode(row, false) : null;
  }

  async function listEpisodes({ sessionId = '', kind = '', limit = 20, offset = 0 } = {}) {
    await init();
    const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const off = Math.max(Number(offset) || 0, 0);
    if (db) {
      const conds = [];
      const vals = [];
      if (sessionId) { conds.push('session_id = ?'); vals.push(sessionId); }
      if (kind) { conds.push('kind = ?'); vals.push(kind); }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      return db.prepare(`SELECT ${EP_COLS} FROM episodes ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...vals, lim, off)
        .map((r) => shapeEpisode(r, false));
    }
    let rows = doc.episodes;
    if (sessionId) rows = rows.filter((r) => r.session_id === sessionId);
    if (kind) rows = rows.filter((r) => r.kind === kind);
    rows = [...rows].sort((a, b) => b.id - a.id);
    return rows.slice(off, off + lim).map((r) => shapeEpisode(r, false));
  }

  async function updateEpisode(id, patch) {
    await init();
    const allowed = ['text', 'outcome', 'summary', 'importance', 'shots', 'embedding', 'touch_use'];
    if (db) {
      const sets = [];
      const vals = [];
      for (const k of allowed) {
        if (!(k in patch)) continue;
        if (k === 'touch_use') { sets.push('use_count = use_count + 1', 'last_used = ?'); vals.push(Date.now()); continue; }
        sets.push(`${k} = ?`);
        vals.push(patch[k]);
      }
      if (!sets.length) return false;
      const r = db.prepare(`UPDATE episodes SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
      return r.changes > 0;
    }
    const row = doc.episodes.find((x) => x.id === id);
    if (!row) return false;
    if ('touch_use' in patch) { row.use_count = (row.use_count ?? 0) + 1; row.last_used = Date.now(); }
    for (const k of allowed) {
      if (k === 'touch_use' || !(k in patch)) continue;
      row[k] = patch[k];
    }
    await persist();
    return true;
  }

  async function deleteEpisode(id) {
    await init();
    if (db) return db.prepare('DELETE FROM episodes WHERE id = ?').run(id).changes > 0;
    const i = doc.episodes.findIndex((r) => r.id === id);
    if (i < 0) return false;
    doc.episodes.splice(i, 1);
    await persist();
    return true;
  }

  async function scanEpisodes(withEmbedding) {
    await init();
    const rows = db
      ? db.prepare(`SELECT ${EP_COLS} FROM episodes ORDER BY id DESC LIMIT ?`).all(VECTOR_SCAN_CAP)
      : [...doc.episodes].sort((a, b) => b.id - a.id).slice(0, VECTOR_SCAN_CAP);
    return rows.map((r) => shapeEpisode(r, withEmbedding));
  }

  async function searchEpisodes(q, pool) {
    await init();
    const p = Math.min(Math.max(Number(pool) || 10, 1), 50);
    if (db) {
      try {
        return db.prepare(`SELECT e.id, bm25(episodes_mem_fts) AS rank FROM episodes_mem_fts JOIN episodes e ON e.id = episodes_mem_fts.rowid
          WHERE episodes_mem_fts MATCH ? ORDER BY rank LIMIT ?`).all(q, p).map((r) => ({ id: r.id, rank: r.rank }));
      } catch {
        return [];
      }
    }
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = [];
    for (const r of doc.episodes) {
      const hay = (r.text || '').toLowerCase();
      const hits = terms.filter((t) => hay.includes(t)).length;
      if (hits > 0) scored.push({ id: r.id, rank: -hits });
    }
    scored.sort((a, b) => a.rank - b.rank);
    return scored.slice(0, p);
  }

  // ─── skills ───────────────────────────────────────────────────────────
  async function insertSkill(s) {
    await init();
    const now = Date.now();
    const conf = Math.min(0.9, 0.4 + 0.1 * Math.min(s.successCount, 5));
    if (db) {
      const r = db.prepare(`INSERT INTO skills (ts, updated_at, name, trigger, steps, source_episodes, success_count, use_count, confidence, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate')`).run(now, now, s.name, s.trigger, JSON.stringify(s.steps),
        JSON.stringify(s.sourceEpisodes), s.successCount, s.useCount, conf);
      return Number(r.lastInsertRowid);
    }
    const id = Number(jid('skill'));
    doc.skills.push({ id, ts: now, updated_at: now, name: s.name, trigger: s.trigger, steps: JSON.stringify(s.steps),
      source_episodes: JSON.stringify(s.sourceEpisodes), success_count: s.successCount, use_count: s.useCount, confidence: conf, status: 'candidate' });
    await persist();
    return id;
  }

  async function getSkill(id) {
    await init();
    const row = db ? db.prepare(`SELECT ${SKILL_COLS} FROM skills WHERE id = ?`).get(id) : doc.skills.find((r) => r.id === id);
    return row ? shapeSkill(row) : null;
  }

  async function listSkills({ status = '', limit = 20, offset = 0 } = {}) {
    await init();
    const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const off = Math.max(Number(offset) || 0, 0);
    if (db) {
      const rows = status
        ? db.prepare(`SELECT ${SKILL_COLS} FROM skills WHERE status = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(status, lim, off)
        : db.prepare(`SELECT ${SKILL_COLS} FROM skills ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(lim, off);
      return rows.map(shapeSkill);
    }
    let rows = doc.skills;
    if (status) rows = rows.filter((r) => r.status === status);
    rows = [...rows].sort((a, b) => b.updated_at - a.updated_at);
    return rows.slice(off, off + lim).map(shapeSkill);
  }

  async function updateSkill(id, patch) {
    await init();
    const allowed = ['name', 'trigger', 'steps', 'source_episodes', 'success_count', 'use_count', 'confidence', 'status'];
    if (db) {
      const sets = [];
      const vals = [];
      for (const k of allowed) {
        if (!(k in patch)) continue;
        sets.push(`${k} = ?`);
        vals.push(patch[k]);
      }
      if (!sets.length) return false;
      sets.push('updated_at = ?');
      vals.push(Date.now());
      return db.prepare(`UPDATE skills SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id).changes > 0;
    }
    const row = doc.skills.find((x) => x.id === id);
    if (!row) return false;
    for (const k of allowed) {
      if (!(k in patch)) continue;
      row[k] = patch[k];
    }
    row.updated_at = Date.now();
    await persist();
    return true;
  }

  async function deleteSkill(id) {
    await init();
    if (db) return db.prepare('DELETE FROM skills WHERE id = ?').run(id).changes > 0;
    const i = doc.skills.findIndex((r) => r.id === id);
    if (i < 0) return false;
    doc.skills.splice(i, 1);
    await persist();
    return true;
  }

  async function allSkills() {
    await init();
    const rows = db ? db.prepare(`SELECT ${SKILL_COLS} FROM skills`).all() : doc.skills;
    return rows.map(shapeSkill);
  }

  // ─── working + sessions ───────────────────────────────────────────────
  async function putWorking(w) {
    await init();
    const now = Date.now();
    const ent = JSON.stringify(w.entities);
    if (db) {
      db.prepare(`INSERT INTO working (session_id, updated_at, goal, plan, scratchpad, entities) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET updated_at = excluded.updated_at, goal = excluded.goal, plan = excluded.plan,
        scratchpad = excluded.scratchpad, entities = excluded.entities`).run(w.sessionId, now, w.goal, w.plan, w.scratchpad, ent);
    } else {
      doc.working[w.sessionId] = { session_id: w.sessionId, updated_at: now, goal: w.goal, plan: w.plan, scratchpad: w.scratchpad, entities: ent };
      await persist();
    }
    return { sessionId: w.sessionId, updatedAt: now };
  }

  async function getWorking(sessionId) {
    await init();
    const row = db
      ? db.prepare('SELECT session_id, updated_at, goal, plan, scratchpad, entities FROM working WHERE session_id = ?').get(sessionId)
      : doc.working[sessionId];
    if (!row) return null;
    let entities = [];
    try { entities = JSON.parse(row.entities || '[]'); } catch { /* keep empty */ }
    return { sessionId: row.session_id, updatedAt: row.updated_at, goal: row.goal ?? null, plan: row.plan ?? null, scratchpad: row.scratchpad ?? null, entities };
  }

  async function deleteWorking(sessionId) {
    await init();
    if (db) return db.prepare('DELETE FROM working WHERE session_id = ?').run(sessionId).changes > 0;
    if (!(sessionId in doc.working)) return false;
    delete doc.working[sessionId];
    await persist();
    return true;
  }

  async function getSession(sessionId) {
    await init();
    const row = db
      ? db.prepare('SELECT session_id, started_ts, last_ts, episode_count, summary FROM sessions WHERE session_id = ?').get(sessionId)
      : doc.sessions[sessionId];
    if (!row) return null;
    return { sessionId: row.session_id, startedTs: row.started_ts, lastTs: row.last_ts, episodeCount: row.episode_count ?? 0, summary: row.summary ?? null };
  }

  async function allWorking() {
    await init();
    const rows = db
      ? db.prepare('SELECT session_id, updated_at, goal, plan, scratchpad, entities FROM working ORDER BY updated_at DESC LIMIT 50').all()
      : Object.values(doc.working).sort((a, b) => b.updated_at - a.updated_at).slice(0, 50);
    return rows.map((row) => {
      let entities = [];
      try { entities = JSON.parse(row.entities || '[]'); } catch { /* keep empty */ }
      return { sessionId: row.session_id, updatedAt: row.updated_at, goal: row.goal ?? null, plan: row.plan ?? null, scratchpad: row.scratchpad ?? null, entities };
    });
  }

  async function allSessions() {
    await init();
    const rows = db
      ? db.prepare('SELECT session_id, started_ts, last_ts, episode_count, summary FROM sessions ORDER BY last_ts DESC LIMIT 50').all()
      : Object.values(doc.sessions).sort((a, b) => b.last_ts - a.last_ts).slice(0, 50);
    return rows.map((row) => ({ sessionId: row.session_id, startedTs: row.started_ts, lastTs: row.last_ts, episodeCount: row.episode_count ?? 0, summary: row.summary ?? null }));
  }

  async function setSessionSummary(sessionId, summary) {
    await init();
    if (db) return db.prepare('UPDATE sessions SET summary = ? WHERE session_id = ?').run(summary, sessionId).changes > 0;
    const s = doc.sessions[sessionId];
    if (!s) return false;
    s.summary = summary;
    await persist();
    return true;
  }

  async function sessionsNeedingSummary(olderThanMs, limit = 10) {
    await init();
    const cutoff = Date.now() - olderThanMs;
    const lim = Math.min(Math.max(Number(limit) || 10, 1), 50);
    if (db) {
      return db.prepare('SELECT session_id, started_ts, last_ts, episode_count, summary FROM sessions WHERE summary IS NULL AND last_ts < ? AND episode_count > 0 ORDER BY last_ts ASC LIMIT ?')
        .all(cutoff, lim).map((r) => ({ sessionId: r.session_id, startedTs: r.started_ts, lastTs: r.last_ts, episodeCount: r.episode_count ?? 0, summary: null }));
    }
    return Object.values(doc.sessions)
      .filter((s) => !s.summary && s.last_ts < cutoff && (s.episode_count ?? 0) > 0)
      .sort((a, b) => a.last_ts - b.last_ts).slice(0, lim)
      .map((s) => ({ sessionId: s.session_id, startedTs: s.started_ts, lastTs: s.last_ts, episodeCount: s.episode_count ?? 0, summary: null }));
  }

  // ─── writes log + runs ────────────────────────────────────────────────
  async function logWrite({ store, op, refId = '', actor = 'agent', summary = '' }) {
    await init();
    const now = Date.now();
    if (db) {
      db.prepare('INSERT INTO writes (ts, store, op, ref_id, actor, summary) VALUES (?, ?, ?, ?, ?, ?)')
        .run(now, String(store), String(op), String(refId), String(actor), String(summary).slice(0, 160));
    } else {
      doc.writes.push({ id: Number(jid('write')), ts: now, store: String(store), op: String(op), ref_id: String(refId), actor: String(actor), summary: String(summary).slice(0, 160) });
      if (doc.writes.length > 2000) doc.writes = doc.writes.slice(-2000);
      await persist();
    }
  }

  async function recentWrites(limit = 30) {
    await init();
    const lim = Math.min(Math.max(Number(limit) || 30, 1), 100);
    if (db) {
      return db.prepare('SELECT id, ts, store, op, ref_id, actor, summary FROM writes ORDER BY id DESC LIMIT ?').all(lim)
        .map((r) => ({ id: r.id, ts: r.ts, store: r.store, op: r.op, refId: r.ref_id, actor: r.actor, summary: r.summary }));
    }
    return [...doc.writes].sort((a, b) => b.id - a.id).slice(0, lim)
      .map((r) => ({ id: r.id, ts: r.ts, store: r.store, op: r.op, refId: r.ref_id, actor: r.actor, summary: r.summary }));
  }

  async function logRun(kind, stats) {
    await init();
    const now = Date.now();
    const s = JSON.stringify(stats ?? {});
    if (db) {
      const r = db.prepare('INSERT INTO runs (ts, kind, stats) VALUES (?, ?, ?)').run(now, String(kind), s);
      return Number(r.lastInsertRowid);
    }
    const id = Number(jid('run'));
    doc.runs.push({ id, ts: now, kind: String(kind), stats: s });
    await persist();
    return id;
  }

  async function lastRun(kind) {
    await init();
    if (db) {
      const r = db.prepare('SELECT id, ts, kind, stats FROM runs WHERE kind = ? ORDER BY id DESC LIMIT 1').get(kind);
      if (!r) return null;
      let stats = {};
      try { stats = JSON.parse(r.stats); } catch { /* keep empty */ }
      return { id: r.id, ts: r.ts, kind: r.kind, stats };
    }
    const rows = doc.runs.filter((r) => r.kind === kind).sort((a, b) => b.id - a.id);
    if (!rows.length) return null;
    let stats = {};
    try { stats = JSON.parse(rows[0].stats); } catch { /* keep empty */ }
    return { id: rows[0].id, ts: rows[0].ts, kind: rows[0].kind, stats };
  }

  /** Rows changed since ts (for the consolidation min-delta heuristic). */
  async function changedSince(ts) {
    await init();
    if (db) {
      const f = db.prepare('SELECT COUNT(*) AS n FROM facts WHERE updated_at > ?').get(ts).n;
      const e = db.prepare('SELECT COUNT(*) AS n FROM episodes WHERE ts > ?').get(ts).n;
      return f + e;
    }
    return doc.facts.filter((r) => r.updated_at > ts).length + doc.episodes.filter((r) => r.ts > ts).length;
  }

  async function counts() {
    await init();
    if (db) {
      const one = (t, w = '') => db.prepare(`SELECT COUNT(*) AS n FROM ${t} ${w}`).get().n;
      return {
        facts: one('facts', "WHERE status = 'active'"), factsFlagged: one('facts', "WHERE status = 'flagged'"),
        episodes: one('episodes'), skills: one('skills'), working: one('working'), sessions: one('sessions'), writes: one('writes'),
      };
    }
    return {
      facts: doc.facts.filter((r) => r.status === 'active').length,
      factsFlagged: doc.facts.filter((r) => r.status === 'flagged').length,
      episodes: doc.episodes.length, skills: doc.skills.length,
      working: Object.keys(doc.working).length, sessions: Object.keys(doc.sessions).length, writes: doc.writes.length,
    };
  }

  function close() {
    try { db?.close(); } catch { /* already closed */ }
    db = null;
  }

  return {
    engine: () => engine,
    close,
    insertFact, getFact, listFacts, updateFact, deleteFact, scanFacts, searchFacts,
    insertEpisode, getEpisode, listEpisodes, updateEpisode, deleteEpisode, scanEpisodes, searchEpisodes,
    insertSkill, getSkill, listSkills, updateSkill, deleteSkill, allSkills,
    putWorking, getWorking, deleteWorking, getSession, setSessionSummary, sessionsNeedingSummary, allWorking, allSessions,
    logWrite, recentWrites, logRun, lastRun, changedSince, counts,
  };
}
