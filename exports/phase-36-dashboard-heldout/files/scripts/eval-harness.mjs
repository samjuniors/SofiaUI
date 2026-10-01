/**
 * scripts/eval-harness.mjs — self-contained OSWorld-style battery.
 * Spawns its own companion on a random port with a fresh data dir + sandbox
 * folder, pairs over WebSocket, runs the core tasks (eval-tasks.mjs) and/or
 * the real-desktop tasks (eval-desktop.mjs), and prints a category
 * scoreboard with steps / time / cost per task. Exit code 1 on any failure
 * or any regression below --baseline.
 *
 *   npm run eval                                    # both suites (desktop skips off-Windows)
 *   npm run eval -- --suite=core                    # daemon battery only
 *   npm run eval -- --suite=desktop                 # desktop battery only (needs EVAL_DESKTOP=1 on Windows)
 *   npm run eval:heldout                            # FROZEN held-out battery (self-improve can never see it)
 *   npm run eval -- --json=results.json --markdown=$GITHUB_STEP_SUMMARY
 *   npm run eval -- --baseline=scripts/eval-baseline.json   # release gate
 *
 * Task ctx: ctx.call(action, args, timeoutMs?) → {ok, result, error, detail,
 *   confirmation_id}; ctx.confirm(id) redeems a daemon confirmation (the
 *   UI/voice-confirm handler role); ctx.spend(usd, label) records LLM spend
 *   (deterministic runs stay $0); ctx.filesRoot / ctx.outsideFile / browser.
 */
import { spawn } from "node:child_process";
import { aggregateByApp } from "./eval-apps.mjs";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { WebSocket } from "ws";
import { TASKS, CATEGORIES } from "./eval-tasks.mjs";
import { DESKTOP_TASKS, DESKTOP_CATEGORIES } from "./eval-desktop.mjs";
import { TASKS as HELDOUT_TASKS, CATEGORIES as HELDOUT_CATEGORIES } from "./eval-heldout.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const out = { suite: "all", json: null, markdown: null, baseline: null, report: join(ROOT, "public", "eval-report.json") };
  for (const a of argv) {
    if (a.startsWith("--suite=")) out.suite = a.slice(8);
    else if (a.startsWith("--json=")) out.json = a.slice(7);
    else if (a === "--json") out.json = "eval-results.json";
    else if (a.startsWith("--markdown=")) out.markdown = a.slice(11);
    else if (a === "--markdown") out.markdown = "eval-results.md";
    else if (a.startsWith("--baseline=")) out.baseline = a.slice(11);
    else if (a === "--baseline") out.baseline = join(ROOT, "scripts", "eval-baseline.json");
    else if (a.startsWith("--report=")) out.report = a.slice(9);
    else if (a === "--no-report") out.report = null;
  }
  if (!["all", "core", "desktop", "heldout"].includes(out.suite)) {
    console.error(`unknown --suite=${out.suite} (want all|core|desktop|heldout)`);
    process.exit(2);
  }
  // The held-out battery reports separately — never into eval-report.json,
  // which the self-improvement loop is allowed to read.
  if (out.suite === "heldout" && !argv.some((a) => a.startsWith("--report") || a === "--no-report")) {
    out.report = join(ROOT, "public", "eval-heldout-report.json");
  }
  return out;
}

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
    if ((m.type === "result" || m.type === "confirmed") && pending.has(m.id)) {
      const { resolve } = pending.get(m.id);
      pending.delete(m.id);
      resolve(m);
    }
  });
  const send = (msg, timeoutMs = 20000) =>
    new Promise((resolve) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: "timeout" }); }, timeoutMs);
      pending.set(id, { resolve: (m) => { clearTimeout(timer); resolve(m); } });
      ws.send(JSON.stringify({ ...msg, id }));
    });
  const call = (action, args = {}, timeoutMs = 20000) => send({ type: "action", action, args }, timeoutMs);
  // UI/voice-confirm handler role: redeem a daemon-issued confirmation id.
  const confirm = (confirmation_id, timeoutMs = 20000) =>
    send({ type: "confirm", confirmation_id }, timeoutMs);
  let spent = 0; // reset per task; tasks record LLM spend here ($0 when deterministic)
  const spend = (usd, _label) => { spent += Number(usd) || 0; };

  const ctx = { call, confirm, spend, filesRoot, outsideFile, platform: process.platform, browser: null, port };
  const args = parseArgs(process.argv.slice(2));
  const suites =
    args.suite === "core"
      ? [{ cats: CATEGORIES, tasks: TASKS }]
      : args.suite === "desktop"
        ? [{ cats: DESKTOP_CATEGORIES, tasks: DESKTOP_TASKS }]
        : args.suite === "heldout"
          ? [{ cats: HELDOUT_CATEGORIES, tasks: HELDOUT_TASKS }]
          : [
            { cats: CATEGORIES, tasks: TASKS },
            { cats: DESKTOP_CATEGORIES, tasks: DESKTOP_TASKS },
          ];

  console.log(`\n  Sofia Companion eval (${args.suite}) — ${new Date().toISOString()}`);
  console.log("  ────────────────────────────────────────────────────────────────");

  const startedAt = new Date().toISOString();
  const results = [];
  for (const { cats, tasks } of suites) {
    for (const cat of cats) {
      const inCat = tasks.filter((t) => t.category === cat);
      if (!inCat.length) continue;
      console.log(`  ${cat}`);
      for (const t of inCat) {
        if (t.skip) {
          console.log(`    ⏭️ ${t.id.padEnd(26)} SKIP  (${typeof t.skip === "string" ? t.skip : "not available here"})`);
          results.push({ id: t.id, category: t.category, outcome: "skip", detail: t.skip, ms: 0, steps: null, costUsd: 0 });
          continue;
        }
        spent = 0;
        const t0 = Date.now();
        let res;
        try {
          res = await t.run(ctx);
        } catch (e) {
          res = { pass: false, detail: e?.message || String(e) };
        }
        const ms = Date.now() - t0;
        const steps = Number.isInteger(res.steps) ? res.steps : null;
        const costUsd = typeof res.costUsd === "number" ? res.costUsd : spent;
        const meta = `${steps != null ? ` steps=${steps}` : ""} $${costUsd.toFixed(costUsd < 1 ? 4 : 2)}`;
        console.log(`    ${res.pass ? "✅" : "❌"} ${t.id.padEnd(26)} ${res.pass ? "PASS" : "FAIL"}  ${ms}ms${meta}${res.detail ? `  (${res.detail})` : ""}`);
        results.push({ id: t.id, category: t.category, outcome: res.pass ? "pass" : "fail", detail: res.detail, ms, steps, costUsd });
      }
    }
  }

  ws.close();
  child.kill("SIGTERM");
  await fs.rm(base, { recursive: true, force: true }).catch(() => {});

  const pass = results.filter((r) => r.outcome === "pass").length;
  const failed = results.filter((r) => r.outcome === "fail").length;
  const skip = results.filter((r) => r.outcome === "skip").length;
  const ran = pass + failed;
  const passRate = ran ? Math.round((pass / ran) * 100) : 0;
  const totalMs = results.reduce((a, r) => a + r.ms, 0);
  const totalCost = results.reduce((a, r) => a + r.costUsd, 0);
  console.log("  ────────────────────────────────────────────────────────────────");
  console.log(`  SUCCESS RATE: ${passRate}%  (${pass} pass · ${failed} fail · ${skip} skip · ${Math.round(totalMs / 100) / 10}s · $${totalCost.toFixed(4)})`);

  // Baseline gate: tasks that passed in the checked-in baseline must still
  // pass (skips warn but don't fail — a suite can legitimately not run).
  let regressions = [];
  if (args.baseline) {
    try {
      const bl = JSON.parse(await fs.readFile(args.baseline, "utf8"));
      const expected = bl.tasks ?? {};
      for (const r of results) {
        if (expected[r.id] === "pass" && r.outcome === "fail") {
          regressions.push(r.id);
        }
      }
      if (typeof bl.passRate === "number" && ran > 0 && passRate < bl.passRate) {
        console.log(`  BASELINE: pass rate ${passRate}% below baseline ${bl.passRate}%`);
      }
      if (regressions.length) {
        console.log(`  BASELINE REGRESSIONS: ${regressions.join(", ")}`);
      } else {
        console.log("  BASELINE: no regressions");
      }
    } catch (e) {
      console.log(`  BASELINE: unreadable (${e?.message}) — failing closed`);
      regressions = ["<baseline-unreadable>"];
    }
  }

  const summary = {
    startedAt,
    suite: args.suite,
    platform: process.platform,
    pass, failed, skip, ran, passRate, totalMs, totalCostUsd: totalCost,
    regressions,
  };
  if (args.json) {
    await fs.writeFile(args.json, JSON.stringify({ ...summary, results }, null, 2));
    console.log(`  wrote ${args.json}`);
  }
  if (args.report) {
    // Per-app reliability report for the Diagnostics card (Phase 30).
    // Skipped-only apps carry rate null ("not run here"), never 0%.
    const { apps, failures } = aggregateByApp(results);
    const report = {
      generatedAt: startedAt,
      suite: args.suite,
      platform: process.platform,
      summary: { pass, failed, skip, ran, passRate },
      apps,
      failures,
    };
    await fs.writeFile(args.report, JSON.stringify(report, null, 2));
    console.log(`  reliability: ${args.report}`);
  }
  if (args.markdown) {
    const rows = results
      .map((r) => `| ${r.id} | ${r.category} | ${r.outcome} | ${r.ms} | ${r.steps ?? "—"} | $${r.costUsd.toFixed(4)} | ${(r.detail ?? "").toString().replace(/\|/g, "\\|").slice(0, 160)} |`)
      .join("\n");
    const md =
      `# Sofia eval (${args.suite}) — ${startedAt}\n\n` +
      `**${passRate}%** — ${pass} pass · ${failed} fail · ${skip} skip · ${Math.round(totalMs / 100) / 10}s · $${totalCost.toFixed(4)}\n\n` +
      `| task | category | outcome | ms | steps | cost | detail |\n|---|---|---|---|---|---|---|\n${rows}\n`;
    await fs.writeFile(args.markdown, md);
    console.log(`  wrote ${args.markdown}`);
  }
  console.log("");
  process.exit(failed || regressions.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
