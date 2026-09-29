/**
 * companion/episodes.mjs — searchable episodic memory.
 * FTS5 full-text (bm25 ranking) via node:sqlite, JSON-lines fallback.
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";

let db = null;
let jsonlPath = null;

async function init(dataDir) {
  if (db || jsonlPath) return;
  jsonlPath = join(dataDir, "episodes.jsonl");
  try {
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(join(dataDir, "episodes.sqlite"));
    db.exec(`CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, role TEXT, text TEXT, meta TEXT);`);
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
      if (db) {
        const ts = Date.now();
        const r = db.prepare("INSERT INTO episodes (ts, role, text, meta) VALUES (?, ?, ?, ?)").run(ts, role, text, meta);
        return { id: Number(r.lastInsertRowid), ts, engine: "fts5" };
      }
      const line = JSON.stringify({ ts: Date.now(), role, text, meta: a.meta ?? {} });
      await fs.appendFile(jsonlPath, line + "\n");
      return { ts: Date.now(), engine: "jsonl" };
    }
    case "episodes_search": {
      const q = String(a.q ?? "").trim();
      if (!q) throw new Error("missing q");
      const limit = Math.min(Number(a.limit) || 8, 50);
      if (db) {
        const rows = db.prepare(
          `SELECT e.id, e.ts, e.role, e.text, bm25(episodes_fts) AS rank
           FROM episodes_fts JOIN episodes e ON e.id = episodes_fts.rowid
           WHERE episodes_fts MATCH ? ORDER BY rank LIMIT ?`
        ).all(q, limit);
        return { q, engine: "fts5", hits: rows.map((r) => ({ id: r.id, ts: r.ts, role: r.role, text: r.text })) };
      }
      let lines = [];
      try { lines = (await fs.readFile(jsonlPath, "utf8")).trim().split("\n"); } catch { /* empty */ }
      const terms = q.toLowerCase().split(/\s+/);
      const hits = lines.map((l) => JSON.parse(l))
        .filter((e) => terms.some((t) => (e.text || "").toLowerCase().includes(t)))
        .slice(-limit).reverse();
      return { q, engine: "jsonl", hits };
    }
    case "episodes_recent": {
      const limit = Math.min(Number(a.limit) || 8, 50);
      if (db) {
        const rows = db.prepare("SELECT id, ts, role, text FROM episodes ORDER BY id DESC LIMIT ?").all(limit);
        return { engine: "fts5", episodes: rows };
      }
      let lines = [];
      try { lines = (await fs.readFile(jsonlPath, "utf8")).trim().split("\n"); } catch { /* empty */ }
      return { engine: "jsonl", episodes: lines.slice(-limit).reverse().map((l) => JSON.parse(l)) };
    }
    default: throw new Error(`Unsupported episodes action ${action}`);
  }
}
