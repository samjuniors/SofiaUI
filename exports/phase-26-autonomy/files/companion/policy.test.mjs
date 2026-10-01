import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SafetyPolicy, ACTIONS, appAllowed, urlAllowed, classifyRisk,
  tokenize, RISK_WORDS, RISKY_TARGET_WORDS,
} from "./policy.mjs";
import {
  LINUX_APP_BINARIES, linuxAppBinary, launchLinuxApp,
  sendKeysFor, isWinCombo, metricsFromEnv, toBackend, toPhysical, winAbsolute,
  parseWinMetricsJson, parseXftDpi, parseDisplayGeometry, WIN_DPI_PREAMBLE,
  uiaTargetScript, darwinTargetScript, interpolatePath, winDragScript,
  darwinDragArgs, darwinScrollScript, darwinWarpScript, darwinQuartzClickScript,
  windowsVolumeScript, windowsGetVolumeScript,
} from "./system.mjs";
import { APP_ALLOWLIST } from "./policy.mjs";

/* ── baseline ─────────────────────────────────────────────────────────────── */

test("known actions allowed, unknown rejected", () => {
  const p = new SafetyPolicy({});
  assert.equal(p.check("ping").allow, true);
  const bad = p.check("rm_rf_everything");
  assert.equal(bad.allow, false);
  assert.equal(bad.error, "unknown_action");
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

test("url allowlist", () => {
  assert.equal(urlAllowed("https://example.com"), true);
  assert.equal(urlAllowed("file:///etc/passwd"), false);
  assert.equal(urlAllowed("not a url"), false);
});

test("action registry covers the documented surfaces", () => {
  for (const a of ["ping", "voice_info", "tts_local", "stt_local", "store_get", "episodes_add", "files_list", "health_snapshot", "ground_text", "ground_ocr", "observe", "browser_open_read"]) {
    assert.ok(ACTIONS.has(a), `missing action ${a}`);
  }
});

/* ── item 1: exact-match app allowlist + linux spawn map ──────────────────── */

test("item1: appAllowed is exact-match only (no substring)", () => {
  assert.equal(appAllowed("linux", "firefox"), true);
  assert.equal(appAllowed("win32", "chrome.exe"), true);
  assert.equal(appAllowed("darwin", "Safari.APP"), true);
  // substring / lookalike attacks rejected
  assert.equal(appAllowed("linux", "my-firefox-evil"), false);
  assert.equal(appAllowed("linux", "firefox-stealer"), false);
  assert.equal(appAllowed("win32", "notepad2"), false);
  assert.equal(appAllowed("win32", "my-chrome-evil.exe"), false);
  assert.equal(appAllowed("linux", "rm"), false);
  assert.equal(appAllowed("linux", ""), false);
  assert.equal(appAllowed("linux", null), false);
  assert.equal(appAllowed("haiku", "firefox"), false);
});

test("item1: every linux allowlist id maps to a binary", () => {
  for (const id of APP_ALLOWLIST.linux) {
    assert.ok(LINUX_APP_BINARIES[id], `no binary mapped for ${id}`);
    assert.equal(linuxAppBinary(id), LINUX_APP_BINARIES[id]);
  }
  assert.equal(LINUX_APP_BINARIES.files, "nautilus");
  assert.throws(() => linuxAppBinary("rm"), /no mapped Linux binary/);
  assert.throws(() => linuxAppBinary("my-firefox-evil"), /no mapped Linux binary/);
});

test("item1: linux launch is detached spawn, never sh -c", () => {
  const calls = [];
  const fakeSpawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { pid: 4242, unref() { calls.push({ unref: true }); } };
  };
  const r = launchLinuxApp("firefox", fakeSpawn);
  assert.equal(r.pid, 4242);
  assert.deepEqual(calls[0], { cmd: "firefox", args: [], opts: { detached: true, stdio: "ignore" } });
  assert.deepEqual(calls[1], { unref: true });
  assert.throws(() => launchLinuxApp("rm -rf ~", fakeSpawn), /no mapped Linux binary/);
  assert.equal(calls.length, 2, "unmapped app must never reach spawn");
});

/* ── item 2: windows hotkey SendKeys ───────────────────────────────────────── */

test("item2: ctrl+shift+t parses to ^+t; all modifiers replaced", () => {
  assert.equal(sendKeysFor("ctrl+shift+t"), "^+t");
  assert.equal(sendKeysFor("ctrl+c"), "^c");
  assert.equal(sendKeysFor("alt+F4"), "%{F4}");
  assert.equal(sendKeysFor("shift+tab"), "+{TAB}");
  assert.equal(sendKeysFor("ctrl+alt+delete"), "^%{DELETE}");
  assert.equal(sendKeysFor("ctrl+shift+alt+x"), "^+%x");
  assert.equal(sendKeysFor("ctrl+enter"), "^{ENTER}");
  assert.equal(sendKeysFor("Ctrl+Shift+T"), "^+t", "case-insensitive");
  assert.equal(sendKeysFor("ctrl+ctrl+x"), "^x", "duplicate modifiers deduped");
});

test("item2: special keys map to braces; win combos route to keybd", () => {
  assert.equal(sendKeysFor("enter"), "{ENTER}");
  assert.equal(sendKeysFor("tab"), "{TAB}");
  assert.equal(sendKeysFor("esc"), "{ESCAPE}");
  assert.equal(sendKeysFor("escape"), "{ESCAPE}");
  assert.equal(sendKeysFor("space"), " ");
  assert.equal(sendKeysFor("up"), "{UP}");
  assert.equal(sendKeysFor("f1"), "{F1}");
  assert.equal(sendKeysFor("f12"), "{F12}");
  assert.equal(sendKeysFor("f24"), "{F24}");
  assert.equal(sendKeysFor("a"), "a");
  assert.equal(sendKeysFor("5"), "5");
  assert.throws(() => sendKeysFor("win+e"), /keybd path/);
  assert.throws(() => sendKeysFor("win"), /keybd path/);
  assert.equal(isWinCombo("win+e"), true);
  assert.equal(isWinCombo("ctrl+c"), false);
  assert.throws(() => sendKeysFor("ctrl+frobnicate"), /unsupported key/);
  assert.throws(() => sendKeysFor("ctrl+c+v"), /two main keys/);
  assert.throws(() => sendKeysFor("ctrl"), /no main key/);
  assert.throws(() => sendKeysFor(""), /empty combo/);
});

/* ── item 3: risk classifier ───────────────────────────────────────────────── */

test("item3: word boundaries — sender clean, send risky", () => {
  assert.ok(RISK_WORDS.has("send") && RISKY_TARGET_WORDS.has("submit"));
  assert.deepEqual(tokenize("Send the invoice!"), ["send", "the", "invoice"]);
  let r = classifyRisk("type_text", { text: "email the sender my report" });
  assert.equal(r.risky, false, "sender must not match send");
  r = classifyRisk("type_text", { text: "send the invoice" });
  assert.equal(r.risky, true);
  assert.equal(r.word, "send");
  r = classifyRisk("type_text", { text: "please REMOVE all files" });
  assert.equal(r.risky, true);
  assert.equal(r.word, "remove");
  r = classifyRisk("type_text", { text: "time to force quit this" });
  assert.equal(r.risky, true, "multi-word phrase matches");
  r = classifyRisk("type_text", { text: "shut down the laptop" });
  assert.equal(r.risky, true);
  r = classifyRisk("type_text", { text: "restarting is fun" });
  assert.equal(r.risky, false, "restarting is not the word restart");
  r = classifyRisk("files_trash", { path: "/x/y.txt" });
  assert.equal(r.risky, true, "ALWAYS_CONFIRM still risky");
});

test("item3: click/hotkey targets — OCR/UIA text gates Send/Pay/Delete/Submit/Buy", () => {
  for (const w of ["Send", "PAY", "delete", "Submit", "buy"]) {
    const r = classifyRisk("click", { x: 10, y: 10 }, { targetText: `button: ${w} now` });
    assert.equal(r.risky, true, `${w} target must be risky`);
    assert.equal(r.word, w.toLowerCase());
  }
  const clean = classifyRisk("click", { x: 10, y: 10 }, { targetText: "button: Cancel" });
  assert.equal(clean.risky, false);
  const sender = classifyRisk("click", { x: 10, y: 10 }, { targetText: "label: sender name" });
  assert.equal(sender.risky, false, "target word boundaries too");
  const hotkey = classifyRisk("hotkey", { keys: "enter" }, { targetText: "focused: Pay invoice" });
  assert.equal(hotkey.risky, true);
  // confirmation fields never feed the classifier
  const spoof = classifyRisk("click", { confirm: "send pay delete" });
  assert.equal(spoof.risky, false);
});

test("item3: check() consumes daemon targetText, not model args", () => {
  const p = new SafetyPolicy({});
  const v = p.check("click", { x: 1, y: 1 }, { targetText: "Send" });
  assert.equal(v.allow, false);
  assert.equal(v.error, "confirmation_required");
  assert.match(v.detail, /target under cursor/);
  const ok = p.check("click", { x: 1, y: 1 }, { targetText: "Cancel" });
  assert.equal(ok.allow, true);
});

/* ── item 4: one-time confirmation ids ─────────────────────────────────────── */

test("item4: confirm:true from the model is ignored", () => {
  const p = new SafetyPolicy({});
  const v1 = p.check("files_trash", { path: "/x/y.txt" });
  assert.equal(v1.allow, false);
  assert.equal(v1.error, "confirmation_required");
  assert.ok(v1.confirmation_id, "daemon issues an id");
  const v2 = p.check("files_trash", { path: "/x/y.txt", confirm: true });
  assert.equal(v2.allow, false, "confirm:true must not grant access");
  assert.equal(v2.error, "confirmation_required");
});

test("item4: approve + redeem allows exactly once", () => {
  const p = new SafetyPolicy({});
  const v = p.check("whatsapp_send", { to: "mum", text: "hi" });
  const id = v.confirmation_id;
  assert.match(id, /^[0-9a-f]{32}$/);
  // unapproved id: retry still gated (and consumes nothing — new id issued)
  const early = p.check("whatsapp_send", { to: "mum", text: "hi", confirmation_id: id });
  assert.equal(early.allow, false);
  // UI/voice-confirm handler approves…
  const ap = p.approve(id);
  assert.equal(ap.ok, true);
  assert.equal(ap.action, "whatsapp_send");
  assert.equal(p.approve("nope").ok, false);
  // …then the retried action runs once…
  const run = p.check("whatsapp_send", { to: "mum", text: "hi", confirmation_id: id });
  assert.equal(run.allow, true);
  // …and the id is spent.
  const again = p.check("whatsapp_send", { to: "mum", text: "hi", confirmation_id: id });
  assert.equal(again.allow, false);
  assert.equal(again.error, "confirmation_required");
});

test("item4: id is bound to the exact action+args, and expires", () => {
  const p = new SafetyPolicy({});
  const v = p.check("files_trash", { path: "/a.txt" });
  p.approve(v.confirmation_id);
  // tampered args
  const tampered = p.check("files_trash", { path: "/b.txt", confirmation_id: v.confirmation_id });
  assert.equal(tampered.allow, false);
  // wrong action needs its own id (first id was consumed by the attempt)
  const v2 = p.check("files_trash", { path: "/a.txt" });
  p.approve(v2.confirmation_id);
  const wrong = p.check("whatsapp_send", { text: "hi", confirmation_id: v2.confirmation_id });
  assert.equal(wrong.allow, false);
  assert.equal(wrong.error, "confirmation_required");

  const exp = new SafetyPolicy({ confirmTtlMs: -1 });
  const ve = exp.check("files_trash", { path: "/a.txt" });
  assert.equal(exp.approve(ve.confirmation_id).ok, false, "expired ids cannot be approved");
});

test("item4: always-confirm actions need the id flow even with clean args", () => {
  const p = new SafetyPolicy({});
  const v = p.check("whatsapp_send", {});
  assert.equal(v.allow, false);
  p.approve(v.confirmation_id);
  assert.equal(p.check("whatsapp_send", { confirmation_id: v.confirmation_id }).allow, true);
});

/* ── item 5: DPI + virtual-screen offsets ──────────────────────────────────── */

test("item5: env overrides parse; identity when unset", () => {
  assert.equal(metricsFromEnv({}), null);
  assert.deepEqual(metricsFromEnv({ SOPHIA_DPI_SCALE: "2" }), { scaleX: 2, scaleY: 2, offsetX: 0, offsetY: 0 });
  assert.deepEqual(metricsFromEnv({ SOPHIA_DPI_SCALE: "1.5,2", SOPHIA_SCREEN_OFFSET: "-1920,0" }),
    { scaleX: 1.5, scaleY: 2, offsetX: -1920, offsetY: 0 });
  assert.equal(metricsFromEnv({ SOPHIA_SCREEN_OFFSET: "nope" }), null);
});

test("item5: physical <-> backend round-trips with scale + offset", () => {
  const m = { scaleX: 2, scaleY: 2, offsetX: -1920, offsetY: 0 };
  assert.deepEqual(toBackend(100, 200, m), { x: 1010, y: 100 });
  assert.deepEqual(toPhysical(1010, 100, m), { x: 100, y: 200 });
  const id = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
  assert.deepEqual(toBackend(7, 9, id), { x: 7, y: 9 });
});

test("item5: ABSOLUTE normalization spans the virtual screen", () => {
  // second monitor left of primary: origin -1920, total width 3840
  const m = { scaleX: 1, scaleY: 1, offsetX: -1920, offsetY: 0, width: 3840, height: 1080 };
  assert.deepEqual(winAbsolute(-1920, 0, m), { x: 0, y: 0 });
  assert.deepEqual(winAbsolute(1920, 1080, m), { x: 65535, y: 65535 });
  assert.deepEqual(winAbsolute(0, 540, m), { x: 32768, y: 32768 });
  // clamped, never out of range
  const oob = winAbsolute(-9999, 9999, m);
  assert.equal(oob.x, 0);
  assert.equal(oob.y, 65535);
});

test("item5: metric probe parsers", () => {
  assert.deepEqual(parseWinMetricsJson(JSON.stringify({ x: -1920, y: 0, w: 3840, h: 1080, dpi: 144 })),
    { scaleX: 1.5, scaleY: 1.5, offsetX: -1920, offsetY: 0, width: 3840, height: 1080 });
  assert.equal(parseWinMetricsJson(JSON.stringify({ x: 0, y: 0, w: 100, h: 100 })).scaleX, 1);
  assert.equal(parseXftDpi("Xft.dpi:\t192\nfoo: 1"), 2);
  assert.equal(parseXftDpi("nothing here"), 1);
  assert.deepEqual(parseDisplayGeometry("3440 1440\n"), { width: 3440, height: 1440 });
  assert.deepEqual(parseDisplayGeometry("garbage"), { width: 0, height: 0 });
});

test("item5: win32 runs DPI-aware", () => {
  assert.match(WIN_DPI_PREAMBLE, /SetProcessDpiAwarenessContext/);
});

/* ── item 6: drag / scroll / volume ────────────────────────────────────────── */

test("item6: drag path interpolation", () => {
  assert.deepEqual(interpolatePath(0, 0, 10, 0, 2), [[5, 0], [10, 0]]);
  const pts = interpolatePath(0, 0, 0, 0, 5);
  assert.equal(pts.length, 5);
  assert.deepEqual(pts[4], [0, 0]);
});

test("item6: win32 drag script presses, steps absolute, releases", () => {
  const m = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, width: 1920, height: 1080 };
  const s = winDragScript({ x: 0, y: 0 }, { x: 1920, y: 1080 }, m, 2);
  assert.match(s, /\[Win32\.Mouse\]::mouse_event\(0x0002/, "LEFTDOWN");
  assert.match(s, /\[Win32\.Mouse\]::mouse_event\(0x0004/, "LEFTUP last");
  assert.ok(s.indexOf("0x0002") < s.lastIndexOf("0x0004"));
  assert.match(s, /0x8001,0,0/, "starts at from corner");
  assert.match(s, /0x8001,65535,65535/, "ends at to corner");
  assert.match(s, /mouse_event\(uint f,int x,int y,int d,int i\)/, "user32 import");
});

test("item6: darwin drag args + fixed quartz scroll", () => {
  assert.deepEqual(darwinDragArgs(10, 20, 30, 40), ["m:10,20", "dd:.", "m:30,40", "du:."]);
  const down = darwinScrollScript(3);
  assert.match(down, /CGEventCreateScrollWheelEvent/);
  assert.match(down, /, -3\)\)\)$/, "dy>0 scrolls down (negative wheel)");
  assert.match(darwinScrollScript(-2), /, 2\)\)\)$/, "dy<0 scrolls up");
  assert.match(darwinWarpScript(5, 6), /CGWarpMouseCursorPosition\(\{5, 6\}\)/);
  const rc = darwinQuartzClickScript("Right", 1);
  assert.match(rc, /CGEventCreateMouseEvent\(missing value, 3, loc, 0\)/);
  assert.match(rc, /CGEventCreateMouseEvent\(missing value, 4, loc, 0\)/);
});

test("item6: real windows volume via CoreAudio, no SendKeys fallback", () => {
  const s = windowsVolumeScript(50);
  assert.match(s, /SetMasterVolumeLevelScalar/);
  assert.match(s, /\[Vol\]::Set\(0\.5\)/);
  assert.match(s, /GetDefaultAudioEndpoint\(0, 0/);
  assert.ok(!s.includes("SendKeys"), "no mute-key fallback");
  assert.match(windowsVolumeScript(0), /\[Vol\]::Set\(0\)/);
  assert.match(windowsVolumeScript(100), /\[Vol\]::Set\(1\)/);
  assert.match(windowsVolumeScript(999), /\[Vol\]::Set\(1\)/, "clamped");
  const g = windowsGetVolumeScript();
  assert.match(g, /GetMasterVolumeLevelScalar/);
  assert.match(g, /\[Vol\]::Get\(\)\*100/);
});

test("item6: target-text builders (UIA point vs focused)", () => {
  const at = uiaTargetScript(100, 200);
  assert.match(at, /UIAutomationClient/);
  assert.match(at, /FromPoint\(\(New-Object System\.Windows\.Point\(100, 200\)\)\)/);
  assert.match(at, /\.Current\.Name/);
  assert.match(uiaTargetScript(), /FocusedElement/);
  assert.match(darwinTargetScript(), /frontmost is true/);
});

/* ── receipts (Phase 22) ────────────────────────────────────────────────── */

test("actions_recent is a known, read-only, never-gated action", async () => {
  const { summarizeAction } = await import("./policy.mjs");
  assert.equal(ACTIONS.has("actions_recent"), true);
  const p = new SafetyPolicy({});
  assert.equal(p.check("actions_recent", { limit: 5 }).allow, true);
  assert.equal(p.isMutating("actions_recent"), false);
  assert.equal(typeof summarizeAction, "function");
});

test("summarizeAction narrates without leaking content", async () => {
  const { summarizeAction } = await import("./policy.mjs");
  const typed = summarizeAction("type_text", { text: "s3cr3t-password" }, null, true);
  assert.match(typed.detail, /15 chars/);
  assert.ok(!typed.detail.includes("s3cr3t"), "typed content must never reach the log");
  assert.equal(typed.undo, undefined);
  assert.equal(summarizeAction("click", { x: 640.4, y: 380 }, null, true).detail, "click (640, 380)");
  assert.equal(summarizeAction("hotkey", { keys: "ctrl+s" }, null, true).detail, "hotkey ctrl+s");
  assert.equal(summarizeAction("open_app", { app: "vlc" }, null, true).detail, "opened vlc");
  assert.equal(summarizeAction("drag", { fromX: 0, fromY: 0, toX: 9, toY: 9 }, null, true).detail, "drag (0, 0) → (9, 9)");
});

test("summarizeAction attaches undo only to reversible file ops", async () => {
  const { summarizeAction } = await import("./policy.mjs");
  const trash = summarizeAction("files_trash", { path: "/docs/n.txt" }, { trashPath: "/trash/1-n.txt" }, true);
  assert.equal(trash.detail, "trashed n.txt");
  assert.deepEqual(trash.undo, { action: "files_restore", args: { path: "/trash/1-n.txt" } });
  const move = summarizeAction("files_move", { from: "/a", to: "/b" }, { from: "/a", to: "/b" }, true);
  assert.deepEqual(move.undo, { action: "files_move", args: { from: "/b", to: "/a" } });
  const restore = summarizeAction("files_restore", { path: "/trash/1" }, { restored: "/docs/n.txt" }, true);
  assert.deepEqual(restore.undo, { action: "files_trash", args: { path: "/docs/n.txt" } });
  // Failed ops carry no undo (nothing happened).
  assert.equal(summarizeAction("files_trash", { path: "/x" }, null, false).undo, undefined);
  assert.equal(summarizeAction("click", { x: 1, y: 1 }, null, true).undo, undefined);
});

test("readRecent returns newest-first receipts and skips corrupt lines", async () => {
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "sophia-receipts-"));
  const p = new SafetyPolicy({ logDir: dir });
  await p.log({ action: "click", ok: true, detail: "click (1, 1)" });
  await p.log({ action: "files_trash", ok: true, detail: "trashed n.txt", undo: { action: "files_restore", args: { path: "/t/1" } } });
  await writeFile(join(dir, "actions.log.jsonl"), "not-json{{{\n", { flag: "a" });
  const recent = await p.readRecent(10);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].action, "files_trash");
  assert.deepEqual(recent[0].undo, { action: "files_restore", args: { path: "/t/1" } });
  assert.equal(recent[1].action, "click");
  assert.ok(recent[0].ts >= recent[1].ts);
  assert.deepEqual((await p.readRecent(1)).map((r) => r.action), ["files_trash"]);
});

test("readRecent on a missing log returns []", async () => {
  const p = new SafetyPolicy({});
  assert.deepEqual(await p.readRecent(5), []);
  const q = new SafetyPolicy({ logDir: "/nonexistent-sophia-dir-xyz" });
  assert.deepEqual(await q.readRecent(5), []);
});

test('memory writes are never confirmation-gated (content is data)', () => {
  for (const [action, args] of [
    ['memory_episode_add', { text: 'restart the printer and delete the temp files' }],
    ['memory_fact_add', { text: 'user pays rent on the 1st', source: 'user' }],
    ['memory_working_put', { goal: 'shut down the staging server' }],
    ['memory_delete', { store: 'semantic', id: 1 }],
    ['episodes_add', { text: 'force quit the frozen app' }],
    ['store_put', { key: 'k', value: { a: 'send the invoice' } }],
  ]) {
    assert.equal(classifyRisk(action, args).risky, false, `${action} must not gate`);
  }
  // …while real instructions still gate.
  assert.equal(classifyRisk('type_text', { text: 'restart the printer' }).risky, true);
});

test('credential USE gates; vault storage and diary stay clean', () => {
  assert.equal(classifyRisk('store_get', { key: 'github-token' }).risky, true);
  assert.equal(classifyRisk('type_text', { text: 'my password is x' }).risky, true);
  assert.equal(classifyRisk('browser_type', { text: 'paste secret' }).risky, true);
  assert.equal(classifyRisk('store_get', { key: 'prefs' }).risky, false);
  assert.equal(classifyRisk('store_put', { key: 'k', value: { secret: 'x' } }).risky, false);
  assert.equal(classifyRisk('episodes_add', { text: 'rotated the token' }).risky, false);
  assert.equal(classifyRisk('memory_fact_add', { text: 'token expires', source: 'user' }).risky, false);
});
