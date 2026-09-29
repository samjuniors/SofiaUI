import { test } from "node:test";
import assert from "node:assert/strict";
import { TASKS, CATEGORIES } from "./eval-tasks.mjs";

test("task list is well-formed", () => {
  assert.ok(TASKS.length >= 9);
  const ids = new Set();
  for (const t of TASKS) {
    assert.ok(t.id && t.category && typeof t.run === "function", `task ${t.id} malformed`);
    assert.ok(!ids.has(t.id), `duplicate id ${t.id}`);
    ids.add(t.id);
  }
});

test("covers the safety surface", () => {
  const ids = TASKS.map((t) => t.id);
  for (const must of ["files_sandbox_enforced", "confirmation_gates", "kill_switch_flow", "unknown_action_rejected"]) {
    assert.ok(ids.includes(must), `missing safety task ${must}`);
  }
});

test("browser task is skippable when Chrome is absent", () => {
  assert.ok(TASKS.some((t) => t.skip), "browser task must be skippable");
});

test("categories derive from tasks", () => {
  assert.ok(CATEGORIES.includes("core"));
  assert.ok(CATEGORIES.includes("safety"));
  assert.ok(CATEGORIES.includes("voice"));
});
