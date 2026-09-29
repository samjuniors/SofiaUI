/**
 * scripts/eval-harness.mjs — self-contained OSWorld-style battery.
 * Spawns its own companion on a random port with a fresh data dir + sandbox
 * folder, pairs over WebSocket, runs every task in eval-tasks.mjs, and prints
 * a category scoreboard. Exit code 1 on any failure.
 *
 *   npm run eval
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { WebSocket } from "ws";
import { TASKS, CATEGORIES } from "./eval-tasks.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on("error", reject);
  });
}

async function main() {
  const port = await freePort();
  const token = randomBytes(12).toString("base64url");
  const base = await fs.mkdtemp(join(tmpdir(), "sophia-eval-"));
  const filesRoot = join(base, "sandbox");
  const dataDir = join(base, "data");
  const outsideRoot = join(base, "outside");
  await fs.mkdir(filesRoot, { recursive: true });
  await fs.mkdir(outsideRoot, { recursive: true });
  const outsideFile = join(outsideRoot, "secret.txt");
  await fs.writeFile(outsideFile, "top secret — must stay unreadable");
  await fs.writeFile(join(filesRoot, "eval-note.txt"), "hello from the eval");

  const child = spawn(process.execPath, [join(ROOT, "companion", "server.mjs")], {
    env: {
      ...process.env,
      SOPHIA_COMPANION_PORT: String(port),
      SOPHIA_COMPANION_TOKEN: token,
      SOPHIA_DATA_DIR: dataDir,
      SOPHIA_FILES_ROOTS: filesRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", (d) => process.env.EVAL_DEBUG && process.stderr.write(d));

  // Retry-connect: the banner prints slightly before the socket binds.
  let ws = null;
  for (let attempt = 0; attempt < 12 && !ws; attempt++) {
    try {
      ws = await new Promise((resolve, reject) => {
        const w = new WebSocket(`ws://127.0.0.1:${port}`);
        const t = setTimeout(() => { w.terminate(); reject(new Error("timeout")); }, 900);
        w.on("open", () => { clearTimeout(t); resolve(w); });
        w.on("error", (e) => { clearTimeout(t); reject(e); });
      });
    } catch {
      await sleep(400);
      ws = null;
    }
  }
  if (!ws) { child.kill(); console.error("companion never came up"); process.exit(1); }

  // hello handshake
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("pairing timeout")), 4000);
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === "welcome") { clearTimeout(t); resolve(); }
    });
    ws.send(JSON.stringify({ type: "hello", token }));
  });

  // id-correlated call()
  let nextId = 1;
  const pending = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "result" && pending.has(m.id)) {
      const { resolve } = pending.get(m.id);
      pending.delete(m.id);
      resolve(m);
    }
  });
  const call = (action, args = {}, timeoutMs = 20000) =>
    new Promise((resolve) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: "timeout" }); }, timeoutMs);
      pending.set(id, { resolve: (m) => { clearTimeout(timer); resolve(m); } });
      ws.send(JSON.stringify({ type: "action", id, action, args }));
    });

  const ctx = { call, filesRoot, outsideFile, platform: process.platform, browser: null };

  console.log(`\n  Sofia Companion eval — ${new Date().toISOString()}`);
  console.log("  ────────────────────────────────────────────────────────────────");

  const results = [];
  for (const cat of CATEGORIES) {
    const tasks = TASKS.filter((t) => t.category === cat);
    console.log(`  ${cat}`);
    for (const t of tasks) {
      if (t.skip) {
        console.log(`    ⏭️ ${t.id.padEnd(26)} SKIP  (${typeof t.skip === "string" ? t.skip : "not available here"})`);
        results.push({ ...t, outcome: "skip" });
        continue;
      }
      const t0 = Date.now();
      let res;
      try {
        res = await t.run(ctx);
      } catch (e) {
        res = { pass: false, detail: e?.message || String(e) };
      }
      const ms = Date.now() - t0;
      console.log(`    ${res.pass ? "✅" : "❌"} ${t.id.padEnd(26)} ${res.pass ? "PASS" : "FAIL"}  ${ms}ms${res.detail ? `  (${res.detail})` : ""}`);
      results.push({ ...t, outcome: res.pass ? "pass" : "fail", detail: res.detail });
    }
  }

  ws.close();
  child.kill("SIGTERM");
  await fs.rm(base, { recursive: true, force: true }).catch(() => {});

  const pass = results.filter((r) => r.outcome === "pass").length;
  const failed = results.filter((r) => r.outcome === "fail").length;
  const skip = results.filter((r) => r.outcome === "skip").length;
  const ran = pass + failed;
  console.log("  ────────────────────────────────────────────────────────────────");
  console.log(`  SUCCESS RATE: ${ran ? Math.round((pass / ran) * 100) : 0}%  (${pass} pass · ${failed} fail · ${skip} skip)\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
