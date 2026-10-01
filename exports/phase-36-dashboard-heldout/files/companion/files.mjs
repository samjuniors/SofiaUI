/**
 * companion/files.mjs — sandboxed daily file skills.
 * Roots default to Desktop/Documents/Downloads/Pictures (or SOPHIA_FILES_ROOTS).
 * Trash is recoverable (files_restore). Every path is resolved + containment-checked.
 */
import { promises as fs } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve, basename, sep } from "node:path";

function defaultRoots() {
  const h = homedir();
  if (platform() === "win32") return [join(h, "Desktop"), join(h, "Documents"), join(h, "Downloads"), join(h, "Pictures")];
  return [join(h, "Desktop"), join(h, "Documents"), join(h, "Downloads"), join(h, "Pictures")];
}

function getRoots(override = []) {
  return override.length ? override.map((r) => resolve(r)) : defaultRoots();
}

function contain(path, roots) {
  const abs = resolve(path);
  const root = roots.find((r) => abs === r || abs.startsWith(r.endsWith(sep) ? r : r + sep));
  if (!root) throw new Error(`Path is outside the sandbox (${roots.length} allowed roots).`);
  return abs;
}

function trashDir() {
  return join(homedir(), ".sophia", "trash");
}

async function walk(dir, depth = 0, out = []) {
  if (depth > 4) return out;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    out.push({ path: p, name: e.name, dir: e.isDirectory() });
    if (e.isDirectory()) await walk(p, depth + 1, out);
  }
  return out;
}

export async function filesAction(action, a = {}, { roots: rootOverride = [] } = {}) {
  const roots = getRoots(rootOverride);
  switch (action) {
    case "files_roots":
      return { roots };
    case "files_list": {
      const dir = contain(a.path || roots[0], roots);
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return { path: dir, entries: entries.filter((e) => !e.name.startsWith(".")).map((e) => ({ name: e.name, dir: e.isDirectory() })) };
    }
    case "files_find": {
      const q = String(a.q ?? "").toLowerCase();
      if (!q) throw new Error("missing q");
      const limit = Math.min(Number(a.limit) || 20, 100);
      const hits = [];
      for (const r of roots) {
        for (const f of await walk(r)) {
          if (f.name.toLowerCase().includes(q)) hits.push({ path: f.path, dir: f.dir });
          if (hits.length >= limit) return { q, hits };
        }
      }
      return { q, hits };
    }
    case "files_read": {
      const file = contain(a.path, roots);
      const st = await fs.stat(file);
      if (st.size > 512 * 1024) throw new Error("File too large to read (>512 KB).");
      const text = await fs.readFile(file, "utf8");
      return { path: file, bytes: st.size, text };
    }
    case "files_open": {
      const file = contain(a.path, roots);
      const { execFile } = await import("node:child_process");
      const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "explorer" : "xdg-open";
      await new Promise((res, rej) => execFile(cmd, [file], (e) => (e ? rej(e) : res())));
      return { opened: file };
    }
    case "files_move": {
      const src = contain(a.from, roots);
      const dst = contain(a.to, roots);
      await fs.rename(src, dst);
      return { from: src, to: dst };
    }
    case "files_trash": {
      const src = contain(a.path, roots);
      const td = trashDir();
      await fs.mkdir(td, { recursive: true });
      const stamp = Date.now();
      const dst = join(td, `${stamp}-${basename(src)}`);
      await fs.rename(src, dst);
      await fs.writeFile(join(td, `${stamp}-${basename(src)}.meta.json`), JSON.stringify({ from: src, ts: stamp }));
      return { trashed: src, recoverable: true, trashPath: dst };
    }
    case "files_restore": {
      const src = contain(a.path, [trashDir()]);
      const meta = JSON.parse(await fs.readFile(src + ".meta.json", "utf8").catch(() => "{}"));
      if (!meta.from) throw new Error("No restore metadata for this item.");
      await fs.rename(src, meta.from);
      await fs.unlink(src + ".meta.json").catch(() => {});
      return { restored: meta.from };
    }
    default: throw new Error(`Unsupported files action ${action}`);
  }
}
