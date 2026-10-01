/**
 * companion/episodes.mjs — searchable episodic memory.
 * FTS5 full-text (bm25 ranking) via node:sqlite, JSON-lines fallback.
 * Phase 21: optional embedding column + hybrid search — a query vector adds
 * a cosine-similarity leg fused with keyword hits by RRF. Episodes without
 * vectors stay keyword-only; a vector leg with no stored vectors degrades
 * silently. Stored vectors never leave the daemon (hits are shaped clean).
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";

let db = null;
let jsonlPath = null;

const MAX_DIMS = 4096;
const VECTOR_SCAN_CAP = 2000;
const RRF_K = 60;

/** Test seam — drop the singleton handles so tests can use fresh dirs. */
export function __resetEpisodes() {
  try { db?.close(); } catch { /* already closed */ }
  db = null;
  jsonlPath = null;
}

/** Validated embedding vector, or null (invalid input never throws). */
export function asVector(v) {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_DIMS) return null;
  for (const n of v) {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
  }
  return v;
}

/** Cosine similarity; 0 for dim mismatch or zero vectors. Pure. */
export function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na > 0 && nb > 0 ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/**
 * Reciprocal-rank fuse ranked legs ({key, item} each) into merged items.
 * An id match in both legs outranks either alone. Pure.
 */
export function rrfFuse(legs, limit) {
  const scores = new Map();
  for (const leg of legs) {
    leg.forEach((entry, rank) => {
      const prev = scores.get(entry.key);
      const add = 1 / (RRF_K + rank);
      if (prev) prev.score += add;
      else scores.set(entry.key, { score: add, item: entry.item });
    });
  }
  return [...scores.values()]
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((e) => e.item);
}

async function init(dataDir) {
  if (db || jsonlPath) return;
  jsonlPath = join(dataDir, "episodes.jsonl");
  try {
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(join(dataDir, "episodes.sqlite"));
    db.exec(`CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, role TEXT, text TEXT, meta TEXT, embedding TEXT);`);
    try {
      const cols = db.prepare("PRAGMA table_info(episodes)").all();
      if (!cols.some((c) => c.name === "embedding")) {
        db.exec("ALTER TABLE episodes ADD COLUMN embedding TEXT");
      }
    } catch { /* best-effort; vector leg stays empty on old DBs */ }
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(text, content='episodes', content_rowid='id');`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS episodes_ai AFTER INSERT ON episodes BEGIN
      INSERT INTO episodes_fts(rowid, text) VALUES (new.id, new.text); END;`);
  } catch {
    db = null;
  }
}

export async function episodesAction(action, a = {}, dataDir) {
  await init(dataDir);
  switch (action) {
    case "episodes_add": {
      const text = String(a.text ?? "").trim();
      if (!text) throw new Error("missing text");
      const role = String(a.role ?? "note");
      const meta = a.meta ? JSON.stringify(a.meta) : "{}";
      const emb = asVector(a.embedding);
      if (db) {
        const ts = Date.now();
        const r = db.prepare("INSERT INTO episodes (ts, role, text, meta, embedding) VALUES (?, ?, ?, ?, ?)")
          .run(ts, role, text, meta, emb ? JSON.stringify(emb) : null);
        return { id: Number(r.lastInsertRowid), ts, engine: "fts5" };
      }
      const line = JSON.stringify({ ts: Date.now(), role, text, meta: a.meta ?? {}, ...(emb ? { embedding: emb } : {}) });
      await fs.appendFile(jsonlPath, line + "\n");
      return { ts: Date.now(), engine: "jsonl" };
    }
    case "episodes_search": {
      const q = String(a.q ?? "").trim();
      if (!q) throw new Error("missing q");
      const limit = Math.min(Number(a.limit) || 8, 50);
      const pool = Math.min(50, Math.max(limit * 2, 10));
      const vec = asVector(a.vector);
      if (db) {
        const rows = db.prepare(
          `SELECT e.id, e.ts, e.role, e.text, bm25(episodes_fts) AS rank
           FROM episodes_fts JOIN episodes e ON e.id = episodes_fts.rowid
           WHERE episodes_fts MATCH ? ORDER BY rank LIMIT ?`
        ).all(q, pool);
        const kwLeg = rows.map((r) => ({ key: `id:${r.id}`, item: { id: r.id, ts: r.ts, role: r.role, text: r.text } }));
        let hybrid = false;
        let hits = kwLeg.slice(0, limit).map((e) => e.item);
        if (vec) {
          const scanned = db.prepare(
            "SELECT id, ts, role, text, embedding FROM episodes WHERE embedding IS NOT NULL ORDER BY id DESC LIMIT ?"
          ).all(VECTOR_SCAN_CAP);
          const scored = [];
          for (const r of scanned) {
            let parsed = null;
            try { parsed = JSON.parse(r.embedding); } catch { continue; }
            if (!Array.isArray(parsed) || parsed.length !== vec.length) continue;
            scored.push({
              key: `id:${r.id}`,
              item: { id: r.id, ts: r.ts, role: r.role, text: r.text },
              sim: cosineSim(vec, parsed),
            });
          }
          scored.sort((x, y) => y.sim - x.sim);
          const vecLeg = scored.slice(0, pool);
          if (vecLeg.length > 0) {
            hybrid = true;
            hits = rrfFuse([kwLeg, vecLeg], limit);
          }
        }
        return { q, engine: "fts5", hybrid, hits };
      }
      let lines = [];
      try { lines = (await fs.readFile(jsonlPath, "utf8")).trim().split("\n"); } catch { /* empty */ }
      const parsed = lines.filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
      const shape = (e) => ({ ts: e.ts, role: e.role, text: e.text, ...(e.meta ? { meta: e.meta } : {}) });
      const terms = q.toLowerCase().split(/\s+/);
      const kwLeg = [];
      parsed.forEach((e, i) => {
        if (terms.some((t) => (e.text || "").toLowerCase().includes(t))) {
          kwLeg.unshift({ key: `j:${i}`, item: shape(e) });
        }
      });
      let hybrid = false;
      let hits = kwLeg.slice(0, limit).map((e) => e.item);
      if (vec) {
        const scored = [];
        parsed.forEach((e, i) => {
          const emb = asVector(e.embedding);
          if (!emb || emb.length !== vec.length) return;
          scored.push({ key: `j:${i}`, item: shape(e), sim: cosineSim(vec, emb) });
        });
        scored.sort((x, y) => y.sim - x.sim);
        const vecLeg = scored.slice(0, pool);
        if (vecLeg.length > 0) {
          hybrid = true;
          hits = rrfFuse([kwLeg.slice(0, pool), vecLeg], limit);
        }
      }
      return { q, engine: "jsonl", hybrid, hits };
    }
    case "episodes_recent": {
      const limit = Math.min(Number(a.limit) || 8, 50);
      if (db) {
        const rows = db.prepare("SELECT id, ts, role, text FROM episodes ORDER BY id DESC LIMIT ?").all(limit);
        return { engine: "fts5", episodes: rows };
      }
      let lines = [];
      try { lines = (await fs.readFile(jsonlPath, "utf8")).trim().split("\n"); } catch { /* empty */ }
      return {
        engine: "jsonl",
        episodes: lines.slice(-limit).reverse().map((l) => {
          const e = JSON.parse(l);
          const { embedding: _drop, ...rest } = e;
          void _drop;
          return rest;
        }),
      };
    }
    default: throw new Error(`Unsupported episodes action ${action}`);
  }
}
