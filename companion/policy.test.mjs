import { test } from "node:test";
import assert from "node:assert/strict";
import { SafetyPolicy, ACTIONS, appAllowed, urlAllowed } from "./policy.mjs";

test("known actions allowed, unknown rejected", () => {
  const p = new SafetyPolicy({});
  assert.equal(p.check("ping").allow, true);
  const bad = p.check("rm_rf_everything");
  assert.equal(bad.allow, false);
  assert.equal(bad.error, "unknown_action");
});

test("destructive words require confirmation until confirm:true", () => {
  const p = new SafetyPolicy({});
  const v1 = p.check("files_trash", { path: "/x/y.txt" });
  assert.equal(v1.allow, false);
  assert.equal(v1.error, "confirmation_required");
  const v2 = p.check("files_trash", { path: "/x/y.txt", confirm: true });
  assert.equal(v2.allow, true);
});

test("always-confirm actions need confirm even with clean args", () => {
  const p = new SafetyPolicy({});
  assert.equal(p.check("whatsapp_send", {}).allow, false);
  assert.equal(p.check("whatsapp_send", { confirm: true }).allow, true);
});

test("kill switch blocks everything except abort/ping", () => {
  const p = new SafetyPolicy({});
  p.abort();
  assert.equal(p.check("click", { x: 1, y: 1 }).allow, false);
  assert.equal(p.check("click", { x: 1, y: 1 }).error, "aborted");
  assert.equal(p.check("ping").allow, true);
  p.resume();
  assert.equal(p.check("click", { x: 1, y: 1 }).allow, true);
});

test("step budget caps mutating actions", () => {
  const p = new SafetyPolicy({ stepBudget: 3 });
  for (let i = 0; i < 3; i++) assert.equal(p.check("type_text", { text: "a" }).allow, true);
  const v = p.check("type_text", { text: "a" });
  assert.equal(v.allow, false);
  assert.equal(v.error, "step_budget_exceeded");
});

test("app + url allowlists", () => {
  assert.equal(appAllowed("linux", "firefox"), true);
  assert.equal(appAllowed("linux", "rm"), false);
  assert.equal(appAllowed("win32", "chrome.exe"), true);
  assert.equal(urlAllowed("https://example.com"), true);
  assert.equal(urlAllowed("file:///etc/passwd"), false);
  assert.equal(urlAllowed("not a url"), false);
});

test("action registry covers the documented surfaces", () => {
  for (const a of ["ping", "voice_info", "tts_local", "stt_local", "store_get", "episodes_add", "files_list", "health_snapshot", "ground_text", "browser_open_read"]) {
    assert.ok(ACTIONS.has(a), `missing action ${a}`);
  }
});
