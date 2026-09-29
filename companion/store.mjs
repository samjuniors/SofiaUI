/**
 * companion/store.mjs — durable key/value memory (SQLite via node:sqlite,
 * JSON fallback). Sophia uses it to persist Memory & Soul across browser resets.
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";

let db = null;
let jsonPath = null;

async function init(dataDir) {
  if (db || jsonPath) return;
  jsonPath = join(dataDir, "store.json");
  try {
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(join(dataDir, "store.sqlite"));
    db.exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)");
  } catch {
    db = null; // JSON fallback
  }
}

async function readJson() {
  try { return JSON.parse(await fs.readFile(jsonPath, "utf8")); } catch { return {}; }
}

export async function storeAction(action, a = {}, dataDir) {
  await init(dataDir);
  switch (action) {
    case "store_get": {
      const key = String(a.key ?? "");
      if (!key) throw new Error("missing key");
      if (db) {
        const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key);
        return { key, value: row ? JSON.parse(row.value) : null, found: Boolean(row) };
      }
      const all = await readJson();
      return { key, value: all[key] ?? null, found: key in all };
    }
    case "store_put": {
      const key = String(a.key ?? "");
      if (!key) throw new Error("missing key");
      const value = a.value === undefined ? null : a.value;
      if (db) {
        db.prepare("INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
          .run(key, JSON.stringify(value), Date.now());
      } else {
        const all = await readJson();
        all[key] = value;
        await fs.writeFile(jsonPath, JSON.stringify(all, null, 2));
      }
      return { key, ok: true };
    }
    case "store_keys": {
      if (db) {
        const rows = db.prepare("SELECT key, updated_at FROM kv ORDER BY updated_at DESC").all();
        return { keys: rows.map((r) => ({ key: r.key, updatedAt: r.updated_at })) };
      }
      const all = await readJson();
      return { keys: Object.keys(all).map((key) => ({ key })) };
    }
    case "store_delete": {
      const key = String(a.key ?? "");
      if (db) db.prepare("DELETE FROM kv WHERE key = ?").run(key);
      else {
        const all = await readJson();
        delete all[key];
        await fs.writeFile(jsonPath, JSON.stringify(all, null, 2));
      }
      return { key, ok: true };
    }
    default: throw new Error(`Unsupported store action ${action}`);
  }
}
