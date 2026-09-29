import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INPUT_SIZE, MOUSEEVENTF_ABS_MOVE, WHEEL_DELTA,
  KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
  selectWin32Backend, nativeDisabledByEnv,
  clickInputs, wheelInput, absMoveInput, unicodeInputs,
  comboToVk, hotkeyInputs,
  absolute65535, metricsFromSystemValues, lerpPath,
  bitmapInfoHeader, bmpFromBgra32, bmpPath,
  WIN_APP_EXES, hwndToId, shapeWindow, pickFocusTarget,
  NATIVE_ACTIONS,
} from "./win32.mjs";
import { sendKeysFor } from "./system.mjs";
import { APP_ALLOWLIST } from "./policy.mjs";

let koffi = null;
try {
  koffi = (await import("koffi")).default ?? null;
} catch { koffi = null; }

/* ── backend selection ───────────────────────────────────────────────────── */

test("native only on win32 with koffi and no kill-switch", () => {
  const sel = (platform, nativeDisabled, nativeReady) =>
    selectWin32Backend({ platform, nativeDisabled, nativeReady });
  assert.equal(sel("win32", false, true), "native");
  assert.equal(sel("win32", false, false), "legacy");
  assert.equal(sel("win32", true, true), "legacy");
  assert.equal(sel("linux", false, true), "unsupported");
  assert.equal(sel("darwin", false, true), "unsupported");
  assert.equal(nativeDisabledByEnv({ SOPHIA_WIN32_NATIVE: "0" }), true);
  assert.equal(nativeDisabledByEnv({}), false);
});

test("native serves the input + window + screenshot surface", () => {
  for (const a of ["move_mouse", "click", "double_click", "right_click", "scroll",
    "type_text", "hotkey", "drag", "get_cursor", "get_active_window",
    "screenshot", "open_app"]) {
    assert.ok(NATIVE_ACTIONS.has(a), `native must serve ${a}`);
  }
  assert.ok(!NATIVE_ACTIONS.has("set_volume"), "volume stays on PowerShell (COM)");
  assert.ok(!NATIVE_ACTIONS.has("notify"), "notify stays on PowerShell (toast)");
});

/* ── INPUT buffers (x64 layout, byte-exact) ───────────────────────────────── */

test("click pairs: down/up flags at the right offsets", () => {
  assert.equal(INPUT_SIZE, 40);
  const [down, up] = clickInputs("Left");
  assert.equal(down.length, 40);
  assert.equal(down.readUInt32LE(0), 0, "INPUT_MOUSE");
  assert.equal(down.readUInt32LE(20), 0x0002, "LEFTDOWN");
  assert.equal(up.readUInt32LE(20), 0x0004, "LEFTUP");
  const [rdown, rup] = clickInputs("Right");
  assert.equal(rdown.readUInt32LE(20), 0x0008);
  assert.equal(rup.readUInt32LE(20), 0x0010);
  const [mdown, mup] = clickInputs("Middle");
  assert.equal(mdown.readUInt32LE(20), 0x0020);
  assert.equal(mup.readUInt32LE(20), 0x0040);
});

test("wheel honors direction + magnitude; absolute spans the virtual desk", () => {
  assert.equal(WHEEL_DELTA, 120);
  const down = wheelInput(-3);
  assert.equal(down.readUInt32LE(20), 0x0800);
  assert.equal(down.readInt32LE(16), -360);
  const up = wheelInput(2);
  assert.equal(up.readInt32LE(16), 240);
  assert.equal(wheelInput(99).readInt32LE(16), 2400, "clamped to 20 lines");
  assert.equal(MOUSEEVENTF_ABS_MOVE, 0xc001, "MOVE|ABSOLUTE|VIRTUALDESK");
  const mv = absMoveInput(100, 200);
  assert.equal(mv.readInt32LE(8), 100);
  assert.equal(mv.readInt32LE(12), 200);
  assert.equal(mv.readUInt32LE(20), 0xc001);
});

test("unicode typing is verbatim UTF-16 units (no SendKeys escaping)", () => {
  const units = unicodeInputs("A€");
  assert.equal(units.length, 4);
  assert.equal(units[0].readUInt32LE(0), 1, "INPUT_KEYBOARD");
  assert.equal(units[0].readUInt16LE(8), 0, "wVk=0 for unicode");
  assert.equal(units[0].readUInt16LE(10), 0x41);
  assert.equal(units[0].readUInt32LE(12), KEYEVENTF_UNICODE);
  assert.equal(units[1].readUInt32LE(12), KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
  assert.equal(units[2].readUInt16LE(10), 0x20ac);
  // braces pass through untouched (SendKeys would need { { } })
  const braces = unicodeInputs("{}");
  assert.equal(braces[0].readUInt16LE(10), 0x7b);
  // astral chars go as surrogate units, exactly as SendInput expects
  const emoji = unicodeInputs("😀");
  assert.equal(emoji.length, 4);
  assert.equal(emoji[0].readUInt16LE(10), 0xd83d);
  assert.equal(emoji[2].readUInt16LE(10), 0xde00);
  assert.deepEqual(unicodeInputs(""), []);
});

/* ── hotkey combos ───────────────────────────────────────────────────────── */

test("comboToVk parses modifiers + main into virtual-key codes", () => {
  let c = comboToVk("ctrl+shift+t");
  assert.deepEqual(c.mods.map((m) => m.vk), [0x11, 0x10]);
  assert.equal(c.main.vk, 0x54);
  assert.equal(c.main.extended, false);
  c = comboToVk("win+e");
  assert.deepEqual(c.mods.map((m) => m.vk), [0x5b]);
  assert.equal(c.main.vk, 0x45);
  c = comboToVk("win");
  assert.deepEqual(c.mods, []);
  assert.equal(c.main.vk, 0x5b, "lone win taps Start");
  c = comboToVk("alt+F4");
  assert.equal(c.mods[0].vk, 0x12);
  assert.equal(c.main.vk, 0x73);
  assert.equal(comboToVk("left").main.extended, true);
  assert.equal(comboToVk("home").main.extended, true);
  assert.equal(comboToVk("delete").main.extended, true);
  assert.equal(comboToVk("f24").main.vk, 0x87);
  assert.equal(comboToVk("5").main.vk, 0x35);
  assert.throws(() => comboToVk(""), /empty combo/);
  assert.throws(() => comboToVk("ctrl"), /no main key/);
  assert.throws(() => comboToVk("ctrl+shift"), /no main key/);
  assert.throws(() => comboToVk("ctrl+c+v"), /two main keys/);
  assert.throws(() => comboToVk("ctrl+frobnicate"), /unsupported key/);
});

test("hotkeyInputs orders mods-down, main tap, mods-up with scans", () => {
  const seq = hotkeyInputs(comboToVk("ctrl+shift+t"), () => 0x1e);
  assert.equal(seq.length, 6);
  const vks = seq.map((b) => b.readUInt16LE(8));
  assert.deepEqual(vks, [0x11, 0x10, 0x54, 0x54, 0x10, 0x11]);
  for (const b of seq) assert.equal(b.readUInt16LE(10), 0x1e, "scan threaded");
  assert.equal(seq[2].readUInt32LE(12) & KEYEVENTF_KEYUP, 0, "main down");
  assert.notEqual(seq[3].readUInt32LE(12) & KEYEVENTF_KEYUP, 0, "main up");
  const win = hotkeyInputs(comboToVk("win+e"), () => 0);
  assert.notEqual(win[0].readUInt32LE(12) & KEYEVENTF_EXTENDEDKEY, 0, "win mod is extended");
});

test("native combos cover the SendKeys combo surface", () => {
  const combos = ["enter", "tab", "esc", "space", "up", "down", "left", "right",
    "home", "end", "pageup", "pagedown", "insert", "delete", "backspace",
    "f1", "f12", "f24", "a", "z", "0", "9", "ctrl+c", "ctrl+shift+t",
    "alt+F4", "ctrl+alt+delete", "shift+tab", "ctrl+enter"];
  for (const combo of combos) {
    sendKeysFor(combo); // legacy accepts…
    comboToVk(combo);   // …so native must too
  }
  // win-combos bypass SendKeys (keybd path) but MUST work natively
  for (const combo of ["win", "win+e", "win+r", "win+shift+s"]) {
    assert.throws(() => sendKeysFor(combo), /keybd path/);
    comboToVk(combo);
  }
});

/* ── coordinates + metrics ───────────────────────────────────────────────── */

test("absolute65535 spans negative-origin virtual screens", () => {
  const m = { offsetX: -1920, offsetY: 0, width: 3840, height: 1080 };
  assert.deepEqual(absolute65535(-1920, 0, m), { x: 0, y: 0 });
  assert.deepEqual(absolute65535(1920, 1080, m), { x: 65535, y: 65535 });
  assert.deepEqual(absolute65535(0, 540, m), { x: 32768, y: 32768 });
});

test("system values + dpi become metrics", () => {
  assert.deepEqual(metricsFromSystemValues({ x: -1920, y: 0, w: 3840, h: 1080, dpi: 144 }),
    { scaleX: 1.5, scaleY: 1.5, offsetX: -1920, offsetY: 0, width: 3840, height: 1080 });
  assert.equal(metricsFromSystemValues({ x: 0, y: 0, w: 100, h: 100, dpi: 0 }).scaleX, 1);
});

test("lerpPath walks from→to", () => {
  assert.deepEqual(lerpPath(0, 0, 10, 0, 2), [[5, 0], [10, 0]]);
  assert.equal(lerpPath(0, 0, 5, 5, 12).length, 12);
});

/* ── screenshot encoding ─────────────────────────────────────────────────── */

test("BMP writer is byte-exact", () => {
  const hdr = bitmapInfoHeader(2, 2);
  assert.equal(hdr.length, 40);
  assert.equal(hdr.readUInt32LE(0), 40);
  assert.equal(hdr.readInt32LE(4), 2);
  assert.equal(hdr.readInt32LE(8), 2);
  assert.equal(hdr.readUInt16LE(14), 32);
  // bottom-up rows: blue row then red row
  const px = Buffer.from([
    0xff, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0xff,
    0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0xff, 0xff,
  ]);
  const bmp = bmpFromBgra32(2, 2, px);
  assert.equal(bmp.length, 70);
  assert.equal(bmp.subarray(0, 2).toString(), "BM");
  assert.equal(bmp.readUInt32LE(2), 70);
  assert.equal(bmp.readUInt32LE(10), 54);
  assert.equal(bmp.readInt32LE(18), 2);
  assert.deepEqual([...bmp.subarray(54)], [...px], "pixel bytes pass through in order");
});

test("bmpPath forces .bmp", () => {
  assert.equal(bmpPath("/tmp/x.bmp"), "/tmp/x.bmp");
  assert.equal(bmpPath("/tmp/x.png"), "/tmp/x.bmp");
  assert.equal(bmpPath("/tmp/x"), "/tmp/x.bmp");
});

/* ── windows ─────────────────────────────────────────────────────────────── */

test("every win32 allowlist id maps to an exe", () => {
  for (const id of APP_ALLOWLIST.win32) {
    assert.ok(WIN_APP_EXES[id], `no exe mapped for ${id}`);
    assert.match(WIN_APP_EXES[id], /\.exe$/i);
  }
});

test("hwnd shaping is JSON-safe", () => {
  assert.equal(hwndToId(0x1234n), 0x1234);
  assert.equal(hwndToId(null), 0);
  assert.equal(hwndToId(7), 7);
  const s = shapeWindow({ hwnd: 99n, title: "  Hi ", pid: 12, bounds: { x: 1, y: 2, width: 3, height: 4 }, active: true });
  assert.deepEqual(s, { hwnd: 99, title: "  Hi ", pid: 12, bounds: { x: 1, y: 2, width: 3, height: 4 }, active: true, minimized: false });
  assert.equal(shapeWindow({}).bounds, null);
});

test("pickFocusTarget prefers visible titled exe matches", () => {
  const wins = [
    { hwnd: 1n, title: "", exe: "notepad.exe", visible: true },
    { hwnd: 2n, title: "Hidden", exe: "notepad.exe", visible: false },
    { hwnd: 3n, title: "Untitled - Notepad", exe: "notepad.exe", visible: true, minimized: true },
    { hwnd: 4n, title: "Notes.txt - Notepad", exe: "notepad.exe", visible: true, minimized: false },
  ];
  assert.equal(pickFocusTarget(wins, "notepad.exe").hwnd, 4n);
  assert.equal(pickFocusTarget(wins, "calc.exe"), null);
  assert.equal(pickFocusTarget([], "notepad.exe"), null);
});

/* ── FFI layout parity (runs only where koffi is installed) ──────────────── */

test("koffi struct parity for INPUT (skips without koffi)", (t) => {
  if (!koffi) { t.skip("koffi not installed"); return; }
  const MI = koffi.struct("MI", { dx: "int32_t", dy: "int32_t", mouseData: "uint32_t", dwFlags: "uint32_t", time: "uint32_t", dwExtraInfo: "uintptr_t" });
  const KI = koffi.struct("KI", { wVk: "uint16_t", wScan: "uint16_t", dwFlags: "uint32_t", time: "uint32_t", dwExtraInfo: "uintptr_t" });
  const U = koffi.union({ mi: MI, ki: KI });
  const INPUT = koffi.struct("INPUT", { type: "uint32_t", u: U });
  assert.equal(koffi.sizeof(INPUT), INPUT_SIZE);
  assert.equal(koffi.offsetof(INPUT, "u"), 8);
  assert.equal(koffi.offsetof(MI, "dwFlags"), 12);
  assert.equal(koffi.offsetof(KI, "wScan"), 2);
  // my hand-built buffers decode through koffi's own layout
  const [down] = clickInputs("Left");
  const back = koffi.decode(down, INPUT);
  assert.equal(back.type, 0);
  const [key] = unicodeInputs("A");
  const kb = koffi.decode(key, INPUT);
  assert.equal(kb.type, 1);
});
