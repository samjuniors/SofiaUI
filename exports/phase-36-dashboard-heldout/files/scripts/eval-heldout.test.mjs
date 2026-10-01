import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TASKS, CATEGORIES } from "./eval-heldout.mjs";
import { TASKS as MAIN_TASKS } from "./eval-tasks.mjs";
import { FORBIDDEN, isHeldoutEval } from "./self-improve.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

test("frozen at exactly 30 marked tasks", () => {
  assert.equal(TASKS.length, 30);
  const ids = new Set();
  for (const t of TASKS) {
    assert.ok(t.id.startsWith("heldout_"), `id ${t.id} must start heldout_`);
    assert.equal(t.heldout, true, `${t.id} must carry heldout:true`);
    assert.ok(String(t.category).startsWith("heldout:"), `${t.id} must live in a heldout: category`);
    assert.equal(typeof t.run, "function", `${t.id} needs run()`);
    assert.equal(t.skip, undefined, `${t.id} must never skip — the frozen set runs everywhere`);
    assert.ok(!ids.has(t.id), `duplicate id ${t.id}`);
    ids.add(t.id);
  }
  assert.deepEqual(CATEGORIES, [...new Set(TASKS.map((t) => t.category))]);
});

test("disjoint from the main battery", () => {
  const main = new Set(MAIN_TASKS.map((t) => t.id));
  for (const t of TASKS) assert.ok(!main.has(t.id), `${t.id} collides with the main battery`);
  for (const risky of ["confirmation_gates", "kill_switch_flow", "store_roundtrip"]) {
    assert.ok(!TASKS.some((t) => t.id.includes(risky)), `held-out must not clone ${risky}`);
  }
});

test("baseline mirrors the frozen set, all passing", () => {
  const bl = JSON.parse(read("scripts/eval-heldout.baseline.json"));
  assert.equal(bl.passRate, 100);
  assert.deepEqual(Object.keys(bl.tasks).sort(), TASKS.map((t) => t.id).sort());
  for (const [id, want] of Object.entries(bl.tasks)) assert.equal(want, "pass", `${id} must baseline at pass`);
});

test("harness keeps heldout out of all/core/desktop", () => {
  const src = read("scripts/eval-harness.mjs");
  assert.ok(src.includes('"heldout"'), "harness must accept --suite=heldout");
  assert.ok(src.includes("eval-heldout-report.json"), "heldout must report to its own file");
  // The fall-through 'all' branch runs exactly core + desktop.
  const allBranch = src.slice(src.indexOf(': args.suite === "heldout"'));
  assert.ok(allBranch.includes("HELDOUT_TASKS"), "heldout suite must run the frozen tasks");
  const elseIdx = src.indexOf(": [", src.indexOf('args.suite === "heldout"'));
  const elseBranch = src.slice(elseIdx, src.indexOf("];", elseIdx));
  assert.ok(!elseBranch.includes("HELDOUT"), "'all' must not leak held-out tasks");
});

test("self-improve can neither modify nor read held-out data", () => {
  for (const f of ["scripts/eval-heldout.mjs", "scripts/eval-heldout.baseline.json", "scripts/eval-heldout.test.mjs"]) {
    assert.ok(FORBIDDEN.some((re) => re.test(f)), `${f} must be a forbidden path`);
  }
  assert.equal(isHeldoutEval("public/eval-heldout-report.json", null), true);
  assert.equal(isHeldoutEval("eval.json", { suite: "heldout", results: [] }), true);
  assert.equal(isHeldoutEval("eval.json", { suite: "core", results: [{ id: "heldout_x", outcome: "fail" }] }), true);
  assert.equal(isHeldoutEval("eval.json", { suite: "core", results: [{ id: "ping", category: "heldout:core", outcome: "fail" }] }), true);
  assert.equal(isHeldoutEval("eval.json", { suite: "core", results: [{ id: "ping", heldout: true, outcome: "fail" }] }), true);
  // …while the main battery still flows through.
  assert.equal(isHeldoutEval("eval.json", { suite: "core", results: [{ id: "ping", category: "core", outcome: "fail" }] }), false);
  assert.equal(isHeldoutEval("eval.json", { suite: "all", results: [] }), false);
});

test("tasks are daemon-backed and deterministic (no LLM, no network, no skips)", () => {
  const src = read("scripts/eval-heldout.mjs");
  assert.ok(!src.includes("fetch("), "no network fetches");
  assert.ok(!src.includes("11434"), "no Ollama calls");
  assert.ok(!src.includes("Math.random"), "no randomness");
  assert.ok(src.includes("ctx.call("), "tasks must call the daemon");
});
