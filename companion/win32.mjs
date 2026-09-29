/**
 * companion/win32.mjs — persistent native input backend for Windows.
 *
 * WHY THIS EXISTS: every win32 action used to spawn a powershell child
 * (~200-500ms overhead per click/type). This backend drives user32/gdi32
 * directly through koffi (MIT, prebuilt, NAPI) — in-process calls that
 * take microseconds. No per-call spawn, no PowerShell on the hot path.
 *
 * WHY KOFFI (decision record, Sept 2026):
 * - nut.js was evaluated first and REJECTED: `@nut-tree/nut-js` is gone
 *   from the public npm registry (404) and its prebuilt binaries moved
 *   behind a paid subscription — a vendor lock-in Sofia must not take.
 * - A Rust/C# sidecar was rejected: no Windows toolchain here to build
 *   or test the binary, and it would burden the user with one.
 * - koffi is MIT, ships prebuilt win32-x64/arm64 binaries via npm, is
 *   actively maintained, and every FFI pattern used below was verified
 *   on Linux against a scratch C library before shipping.
 *
 * FALLBACK RULE: koffi is an OPTIONAL dependency. When it is missing
 * (or win32.mjs is loaded off-Windows, or SOPHIA_WIN32_NATIVE=0), the
 * daemon transparently uses the legacy PowerShell path in system.mjs.
 * Fallback happens ONLY at load time — a runtime native error is never
 * retried through legacy (that could double-click / double-type).
 *
 * RESIDUAL POWERSHELL (deliberate, none latency-critical): toast
 * notifications, CoreAudio volume (COM), the UIA target-text probe on
 * the LEGACY path only, the UIA tree probe for observe (COM UIA is out
 * of scope for koffi), and the full legacy input path itself.
 *
 * External contract is unchanged: PHYSICAL pixels in, same action names
 * out. Native results add `via: "native"`; legacy results are untouched.
 */
import { execFile } from "node:child_process";
import { platform } from "node:os";
import { writeFile } from "node:fs/promises";

/* ── win32 constants ─────────────────────────────────────────────────────── */

export const INPUT_MOUSE = 0;
export const INPUT_KEYBOARD = 1;
export const INPUT_SIZE = 40; // sizeof(INPUT) on x64: u32 type + pad + 32B union

export const MOUSEEVENTF_MOVE = 0x0001;
export const MOUSEEVENTF_LEFTDOWN = 0x0002;
export const MOUSEEVENTF_LEFTUP = 0x0004;
export const MOUSEEVENTF_RIGHTDOWN = 0x0008;
export const MOUSEEVENTF_RIGHTUP = 0x0010;
export const MOUSEEVENTF_MIDDLEDOWN = 0x0020;
export const MOUSEEVENTF_MIDDLEUP = 0x0040;
export const MOUSEEVENTF_WHEEL = 0x0800;
export const MOUSEEVENTF_VIRTUALDESK = 0x4000;
export const MOUSEEVENTF_ABSOLUTE = 0x8000;
/** Absolute moves span the WHOLE virtual desktop (multi-monitor). */
export const MOUSEEVENTF_ABS_MOVE = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
export const WHEEL_DELTA = 120;

export const KEYEVENTF_EXTENDEDKEY = 0x0001;
export const KEYEVENTF_KEYUP = 0x0002;
export const KEYEVENTF_UNICODE = 0x0004;

export const SM_XVIRTUALSCREEN = 76;
export const SM_YVIRTUALSCREEN = 77;
export const SM_CXVIRTUALSCREEN = 78;
export const SM_CYVIRTUALSCREEN = 79;

export const SW_RESTORE = 9;
export const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
export const SRCCOPY = 0xcc0020;
export const DIB_RGB_COLORS = 0;
export const DPI_AWARENESS_CONTEXT_PER_MONITOR_V2 = -4;

/* ── pure: backend selection ─────────────────────────────────────────────── */

export function nativeDisabledByEnv(env = process.env) {
  return String(env.SOPHIA_WIN32_NATIVE ?? "").trim() === "0";
}

/** 'native' only on win32 with koffi loaded and no kill-switch. Pure. */
export function selectWin32Backend({ platform: plat, nativeDisabled, nativeReady }) {
  if (plat !== "win32") return "unsupported";
  if (nativeDisabled) return "legacy";
  return nativeReady ? "native" : "legacy";
}

/* ── pure: INPUT buffer builders (x64 layout, byte-exact) ──────────────────
 * MOUSEINPUT: type@0 u32, dx@8 i32, dy@12 i32, data@16 u32, flags@20 u32,
 *             time@24 u32, extra@28 u64.
 * KEYBDINPUT: type@0 u32, vk@8 u16, scan@10 u16, flags@12 u32, time@16,
 *             extra@24 u64.
 */

function mouseInput({ dx = 0, dy = 0, data = 0, flags = 0 }) {
  const b = Buffer.alloc(INPUT_SIZE);
  b.writeUInt32LE(INPUT_MOUSE, 0);
  b.writeInt32LE(dx | 0, 8);
  b.writeInt32LE(dy | 0, 12);
  b.writeInt32LE(data | 0, 16);
  b.writeUInt32LE(flags >>> 0, 20);
  return b;
}

function keyInput({ vk = 0, scan = 0, flags = 0 }) {
  const b = Buffer.alloc(INPUT_SIZE);
  b.writeUInt32LE(INPUT_KEYBOARD, 0);
  b.writeUInt16LE(vk & 0xffff, 8);
  b.writeUInt16LE(scan & 0xffff, 10);
  b.writeUInt32LE(flags >>> 0, 12);
  return b;
}

/** Down+up pair for Left/Right/Middle at the CURRENT position. Pure. */
export function clickInputs(button = "Left") {
  const flags = button === "Right"
    ? [MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP]
    : button === "Middle"
      ? [MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP]
      : [MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP];
  return [mouseInput({ flags: flags[0] }), mouseInput({ flags: flags[1] })];
}

/** Single wheel input; lines>0 scrolls UP, lines<0 DOWN. Pure. */
export function wheelInput(lines) {
  const n = Math.max(-20, Math.min(20, Math.round(Number(lines) || 0))) || 1;
  return mouseInput({ data: n * WHEEL_DELTA, flags: MOUSEEVENTF_WHEEL });
}

/** Absolute virtual-desktop move input. Pure. */
export function absMoveInput(x, y) {
  return mouseInput({ dx: x, dy: y, flags: MOUSEEVENTF_ABS_MOVE });
}

/**
 * Unicode typing: one down/up pair per UTF-16 code unit with
 * KEYEVENTF_UNICODE (wVk=0). Surrogate pairs pass through as two
 * units — exactly what SendInput expects. Verbatim: NO SendKeys-style
 * brace escaping needed. Pure.
 */
export function unicodeInputs(text) {
  const s = String(text ?? "");
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const unit = s.charCodeAt(i);
    out.push(keyInput({ vk: 0, scan: unit, flags: KEYEVENTF_UNICODE }));
    out.push(keyInput({ vk: 0, scan: unit, flags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP }));
  }
  return out;
}

/* ── pure: hotkey combo → virtual-key codes ───────────────────────────────── */

const VK_LETTERS = {};
for (let i = 0; i < 26; i++) VK_LETTERS[String.fromCharCode(97 + i)] = 0x41 + i;
const VK_DIGITS = {};
for (let i = 0; i < 10; i++) VK_DIGITS[String(i)] = 0x30 + i;
const VK_FKEYS = {};
for (let n = 1; n <= 24; n++) VK_FKEYS[`f${n}`] = 0x6f + n;

const VK_NAMED = {
  enter: 0x0d, return: 0x0d, tab: 0x09, esc: 0x1b, escape: 0x1b,
  space: 0x20, backspace: 0x08, bs: 0x08,
  left: 0x25, up: 0x26, right: 0x27, down: 0x28,
  insert: 0x2d, ins: 0x2d, delete: 0x2e, del: 0x2e,
  home: 0x24, end: 0x23, pageup: 0x21, pgup: 0x21,
  pagedown: 0x22, pgdn: 0x22,
  capslock: 0x14, numlock: 0x90, scrolllock: 0x91,
  printscreen: 0x2c, prtsc: 0x2c, pause: 0x13, break: 0x13,
};
/** Keys needing KEYEVENTF_EXTENDEDKEY (E0-prefixed scan codes). */
const VK_EXTENDED = new Set([
  0x25, 0x26, 0x27, 0x28, // arrows
  0x24, 0x23, 0x21, 0x22, // home end pgup pgdn
  0x2d, 0x2e,             // insert delete
  0x5b, 0x5c,             // win keys
  0x90, 0x2c,             // numlock, printscreen
]);
const VK_MODIFIERS = {
  ctrl: 0x11, control: 0x11, alt: 0x12, shift: 0x10,
  win: 0x5b, windows: 0x5b, super: 0x5b, meta: 0x5b, cmd: 0x5b, command: 0x5b,
};

/**
 * Parse "ctrl+shift+t" → {mods:[{name,vk}], main:{name,vk,extended}}.
 * A lone "win" taps the Windows key (Start menu, like the legacy keybd
 * path); anything else without a main key throws. Pure.
 */
export function comboToVk(combo) {
  const parts = String(combo ?? "").split("+").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) throw new Error("hotkey: empty combo");
  const mods = [];
  const seen = new Set();
  let main = null;
  for (const p of parts) {
    if (VK_MODIFIERS[p] !== undefined) {
      const vk = VK_MODIFIERS[p];
      if (!seen.has(vk)) { seen.add(vk); mods.push({ name: p, vk }); }
    } else if (main) {
      throw new Error(`hotkey: two main keys in combo "${combo}"`);
    } else {
      const vk = VK_LETTERS[p] ?? VK_DIGITS[p] ?? VK_FKEYS[p] ?? VK_NAMED[p];
      if (vk === undefined) throw new Error(`hotkey: unsupported key "${p}" in combo "${combo}"`);
      main = { name: p, vk };
    }
  }
  if (!main) {
    if (mods.length === 1 && mods[0].vk === 0x5b) {
      main = { name: mods[0].name, vk: 0x5b };
      mods.length = 0;
    } else {
      throw new Error(`hotkey: combo "${combo}" has no main key`);
    }
  }
  return { mods, main: { ...main, extended: VK_EXTENDED.has(main.vk) } };
}

/**
 * Full press sequence: mods down, main down/up, mods up (reverse).
 * `scanFor(vk)` resolves layout-correct scan codes (MapVirtualKeyW).
 * Pure. Sent as ONE SendInput call by the executor.
 */
export function hotkeyInputs(parsed, scanFor = () => 0) {
  const out = [];
  const down = (vk, extended) =>
    keyInput({ vk, scan: scanFor(vk) & 0xffff, flags: extended ? KEYEVENTF_EXTENDEDKEY : 0 });
  const up = (vk, extended) =>
    keyInput({ vk, scan: scanFor(vk) & 0xffff, flags: (extended ? KEYEVENTF_EXTENDEDKEY : 0) | KEYEVENTF_KEYUP });
  for (const m of parsed.mods) out.push(down(m.vk, VK_EXTENDED.has(m.vk)));
  out.push(down(parsed.main.vk, parsed.main.extended));
  out.push(up(parsed.main.vk, parsed.main.extended));
  for (const m of [...parsed.mods].reverse()) out.push(up(m.vk, VK_EXTENDED.has(m.vk)));
  return out;
}

/* ── pure: coordinates + metrics ─────────────────────────────────────────── */

/** Physical pixel → 0–65535 across the VIRTUAL screen. Pure. */
export function absolute65535(x, y, m) {
  const nx = Math.round(((Number(x) - m.offsetX) / m.width) * 65535);
  const ny = Math.round(((Number(y) - m.offsetY) / m.height) * 65535);
  return {
    x: Math.max(0, Math.min(65535, nx)),
    y: Math.max(0, Math.min(65535, ny)),
  };
}

/** GetSystemMetrics values + DPI → DisplayMetrics. Pure. */
export function metricsFromSystemValues({ x, y, w, h, dpi }) {
  const scale = Number(dpi) > 0 ? Number(dpi) / 96 : 1;
  return {
    scaleX: scale, scaleY: scale,
    offsetX: Math.round(Number(x) || 0),
    offsetY: Math.round(Number(y) || 0),
    width: Math.max(1, Math.round(Number(w) || 0)),
    height: Math.max(1, Math.round(Number(h) || 0)),
  };
}

/** Interpolated drag path (excludes start, includes end). Pure. */
export function lerpPath(fromX, fromY, toX, toY, steps = 12) {
  const n = Math.max(1, Math.min(60, Math.round(steps) || 1));
  const pts = [];
  for (let i = 1; i <= n; i++) {
    pts.push([
      Math.round(fromX + ((toX - fromX) * i) / n),
      Math.round(fromY + ((toY - fromY) * i) / n),
    ]);
  }
  return pts;
}

/* ── pure: screenshot encoding ───────────────────────────────────────────── */

/** 40-byte BITMAPINFOHEADER for 32bpp top…bottom-up GetDIBits. Pure. */
export function bitmapInfoHeader(w, h) {
  const b = Buffer.alloc(40);
  b.writeUInt32LE(40, 0);            // biSize
  b.writeInt32LE(w, 4);              // biWidth
  b.writeInt32LE(h, 8);              // biHeight (positive = bottom-up)
  b.writeUInt16LE(1, 12);            // biPlanes
  b.writeUInt16LE(32, 14);           // biBitCount
  b.writeUInt32LE(0, 16);            // biCompression = BI_RGB
  b.writeUInt32LE(w * h * 4, 20);    // biSizeImage
  return b;
}

/** 32bpp BGRA (bottom-up, stride w*4) → .bmp bytes. Pure. */
export function bmpFromBgra32(w, h, bgra) {
  const rowBytes = w * 4;
  const header = Buffer.alloc(54);
  header.write("BM", 0);
  header.writeUInt32LE(54 + rowBytes * h, 2);  // bfSize
  header.writeUInt32LE(54, 10);                // bfOffBits
  bitmapInfoHeader(w, h).copy(header, 14);
  const pixels = Buffer.from(bgra.subarray(0, rowBytes * h));
  return Buffer.concat([header, pixels]);
}

/** Screenshot paths always resolve to .bmp (native encoder writes BMP). Pure. */
export function bmpPath(p) {
  const s = String(p || "");
  if (/\.bmp$/i.test(s)) return s;
  return s.replace(/\.[a-z0-9]+$/i, "") + ".bmp";
}

/* ── pure: window shaping + focus targeting ───────────────────────────────── */

/** Allowlist id → win32 exe basename (mirrors LINUX_APP_BINARIES). */
export const WIN_APP_EXES = {
  explorer: "explorer.exe",
  chrome: "chrome.exe",
  msedge: "msedge.exe",
  notepad: "notepad.exe",
  calc: "calc.exe",
  cmd: "cmd.exe",
  powershell: "powershell.exe",
  winword: "WINWORD.EXE",
  excel: "EXCEL.EXE",
  outlook: "OUTLOOK.EXE",
  spotify: "Spotify.exe",
  whatsapp: "WhatsApp.exe",
  code: "Code.exe",
  vlc: "vlc.exe",
  wmplayer: "wmplayer.exe",
  mspaint: "mspaint.exe",
  snippingtool: "SnippingTool.exe",
  taskmgr: "Taskmgr.exe",
};

/** HWND (BigInt from FFI) → JSON-safe id. Pure. */
export function hwndToId(hwnd) {
  if (hwnd === null || hwnd === undefined) return 0;
  if (typeof hwnd === "bigint") return Number(hwnd);
  return Number(hwnd) || 0;
}

/**
 * Shape one enumerated window for results. Pure.
 * bounds: null when unknown; active: is-foreground flag.
 */
export function shapeWindow({ hwnd, title, pid, bounds, active, minimized }) {
  return {
    hwnd: hwndToId(hwnd),
    title: String(title ?? ""),
    pid: Number(pid) || 0,
    bounds: bounds ? {
      x: Math.round(bounds.x), y: Math.round(bounds.y),
      width: Math.round(bounds.width), height: Math.round(bounds.height),
    } : null,
    active: active === true,
    minimized: minimized === true,
  };
}

/**
 * Pick the window to focus for an app: visible + titled + exe match
 * wins; unminimized and active-window ties preferred. Pure.
 */
export function pickFocusTarget(windows, exeName) {
  const exe = String(exeName || "").toLowerCase();
  const stem = exe.replace(/\.exe$/, "");
  let best = null;
  let bestScore = -1;
  for (const w of windows) {
    if (!w || w.visible === false) continue;
    if (!String(w.title || "")) continue;
    // Exe match is REQUIRED — never focus a stranger window. Minimized
    // and active only break ties between same-app windows.
    const wexe = String(w.exe || "").toLowerCase();
    let score = -1;
    if (exe && wexe === exe) score = 10;
    else if (stem && wexe.includes(stem)) score = 4;
    else continue;
    if (w.minimized === false) score += 2;
    if (w.active === true) score += 1;
    if (score > bestScore) { bestScore = score; best = w; }
  }
  return best;
}

/* ── loader (cached; win32 + koffi only) ──────────────────────────────────── */

const KOFFI_HINT = "Native win32 backend needs the 'koffi' package: run `npm install` inside companion/ (koffi is a free MIT optional dependency with prebuilt Windows binaries). Falling back to PowerShell.";

let loadPromise = null;

async function tryLoad() {
  if (platform() !== "win32") throw new Error("native win32 backend is win32-only");
  if (nativeDisabledByEnv()) throw new Error("SOPHIA_WIN32_NATIVE=0 disables the native backend");
  let koffi;
  try {
    const mod = await import("koffi");
    koffi = mod.default ?? mod;
  } catch {
    throw new Error(KOFFI_HINT);
  }
  const user32 = koffi.load("user32.dll");
  const gdi32 = koffi.load("gdi32.dll");
  const kernel32 = koffi.load("kernel32.dll");

  const POINT = koffi.struct("POINT", { x: "long", y: "long" });
  const RECT = koffi.struct("RECT", { left: "long", top: "long", right: "long", bottom: "long" });
  // Named proto FIRST: the EnumWindows binding below resolves it by name.
  const enumProc = koffi.proto("int __stdcall EnumWindowsProc(void *hwnd, intptr lParam)");

  const F = (lib, sig) => lib.func(sig);
  const ctx = {
    koffi,
    // DPI + metrics (GetDpiForSystem/SetProcessDpiAwarenessContext are
    // absent before Win10 — bound optionally, tolerated as null).
    setDpiAwareness: null,
    getDpiForSystem: null,
    getSystemMetrics: F(user32, "int __stdcall GetSystemMetrics(int nIndex)"),
    // input
    setCursorPos: F(user32, "int __stdcall SetCursorPos(int x, int y)"),
    getCursorPos: F(user32, "int __stdcall GetCursorPos(_Out_ POINT *p)"),
    sendInput: F(user32, "uint __stdcall SendInput(uint n, void *pInputs, int cb)"),
    mapVk: F(user32, "uint __stdcall MapVirtualKeyW(uint vk, uint mapType)"),
    // windows
    getForegroundWindow: F(user32, "void * __stdcall GetForegroundWindow()"),
    setForegroundWindow: F(user32, "int __stdcall SetForegroundWindow(void *h)"),
    isWindowVisible: F(user32, "int __stdcall IsWindowVisible(void *h)"),
    isIconic: F(user32, "int __stdcall IsIconic(void *h)"),
    showWindow: F(user32, "int __stdcall ShowWindow(void *h, int cmd)"),
    getWindowRect: F(user32, "int __stdcall GetWindowRect(void *h, _Out_ RECT *r)"),
    getWindowTextW: F(user32, "int __stdcall GetWindowTextW(void *h, _Out_ void *buf, int nMax)"),
    getWindowThreadProcessId: F(user32, "uint __stdcall GetWindowThreadProcessId(void *h, _Out_ uint32_t *pid)"),
    enumWindows: F(user32, "int __stdcall EnumWindows(EnumWindowsProc *cb, intptr l)"),
    enumProc,
    windowFromPoint: F(user32, "void * __stdcall WindowFromPoint(POINT pt)"),
    // screenshot
    getDC: F(user32, "void * __stdcall GetDC(void *h)"),
    releaseDC: F(user32, "int __stdcall ReleaseDC(void *h, void *hdc)"),
    createCompatibleDC: F(gdi32, "void * __stdcall CreateCompatibleDC(void *hdc)"),
    createCompatibleBitmap: F(gdi32, "void * __stdcall CreateCompatibleBitmap(void *hdc, int w, int h)"),
    selectObject: F(gdi32, "void * __stdcall SelectObject(void *hdc, void *obj)"),
    bitBlt: F(gdi32, "int __stdcall BitBlt(void *dst, int x, int y, int w, int h, void *src, int sx, int sy, uint rop)"),
    getDIBits: F(gdi32, "int __stdcall GetDIBits(void *hdc, void *hbm, uint start, uint lines, _Out_ void *bits, void *bmi, uint usage)"),
    deleteObject: F(gdi32, "int __stdcall DeleteObject(void *o)"),
    deleteDC: F(gdi32, "int __stdcall DeleteDC(void *hdc)"),
    // process exe lookup
    openProcess: F(kernel32, "void * __stdcall OpenProcess(uint access, int inherit, uint pid)"),
    queryExe: F(kernel32, "int __stdcall QueryFullProcessImageNameW(void *h, uint flags, _Out_ void *buf, _Inout_ uint32_t *size)"),
    closeHandle: F(kernel32, "int __stdcall CloseHandle(void *h)"),
    POINT, RECT,
  };
  try {
    ctx.setDpiAwareness = F(user32, "intptr __stdcall SetProcessDpiAwarenessContext(intptr value)");
  } catch { /* pre-1703 Windows: no-op, metrics convert instead */ }
  try {
    ctx.getDpiForSystem = F(user32, "uint __stdcall GetDpiForSystem()");
  } catch { /* pre-1607: assume 96 */ }

  // Awareness FIRST, before any other user32 call, so every coordinate
  // in this process (cursor, windows, screenshots) is PHYSICAL pixels.
  if (ctx.setDpiAwareness) {
    try { ctx.setDpiAwareness(DPI_AWARENESS_CONTEXT_PER_MONITOR_V2); } catch { /* already set */ }
  }
  return ctx;
}

/** Sticky probe: true when the native backend is usable. Never throws. */
export async function win32NativeReady() {
  if (!loadPromise) {
    loadPromise = tryLoad().then(
      (ctx) => ({ ok: true, ctx }),
      (err) => ({ ok: false, error: String(err && err.message || err) }),
    );
  }
  return (await loadPromise).ok;
}

/** The loaded context (call after win32NativeReady()). Internal. */
async function ctxOrThrow() {
  if (!loadPromise) await win32NativeReady();
  const r = await loadPromise;
  if (!r.ok) throw new Error(r.error);
  return r.ctx;
}

/* ── executors (win32 + koffi only) ───────────────────────────────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One SendInput call for N pre-built INPUT buffers. */
async function nativeSend(buffers) {
  const ctx = await ctxOrThrow();
  if (!buffers.length) return { sent: 0 };
  const blob = Buffer.concat(buffers);
  const n = blob.length / INPUT_SIZE;
  const sent = ctx.sendInput(n, blob, INPUT_SIZE);
  if (sent !== n) {
    throw new Error(
      `SendInput delivered ${sent}/${n} events — the foreground app may be elevated ` +
      `(run the daemon as administrator) or a secure desktop is active.`,
    );
  }
  return { sent };
}

async function nativeMove(x, y) {
  const ctx = await ctxOrThrow();
  if (!ctx.setCursorPos(Math.round(x), Math.round(y))) throw new Error("SetCursorPos failed");
  return { moved: { x: Math.round(x), y: Math.round(y) } };
}

async function nativeClick(action) {
  const pairs = action === "double_click" ? [...clickInputs("Left"), ...clickInputs("Left")]
    : action === "right_click" ? clickInputs("Right")
      : clickInputs("Left");
  await nativeSend(pairs);
  return { clicked: action };
}

async function nativeScroll(dy) {
  const lines = Math.max(1, Math.min(20, Math.round(Math.abs(Number(dy) || 3))));
  // Contract: dy > 0 scrolls DOWN (negative wheel delta).
  await nativeSend([wheelInput(Number(dy) > 0 ? -lines : lines)]);
  return { scrolled: Number(dy) };
}

async function nativeType(text) {
  const units = unicodeInputs(text);
  // 200 chars (400 INPUTs) per SendInput call.
  for (let i = 0; i < units.length; i += 400) {
    await nativeSend(units.slice(i, i + 400));
  }
  return { typed: String(text ?? "").length };
}

async function nativeHotkey(combo) {
  const ctx = await ctxOrThrow();
  const parsed = comboToVk(combo);
  const scanFor = (vk) => { try { return ctx.mapVk(vk, 0) >>> 0; } catch { return 0; } };
  await nativeSend(hotkeyInputs(parsed, scanFor));
  return { hotkey: String(combo) };
}

async function nativeDrag(fromX, fromY, toX, toY) {
  const m = await nativeMetrics();
  if (!m.width || !m.height) throw new Error("drag: virtual-screen size unknown");
  await nativeMove(fromX, fromY);
  await nativeSend([mouseInput({ flags: MOUSEEVENTF_LEFTDOWN })]);
  try {
    for (const [x, y] of lerpPath(fromX, fromY, toX, toY, 12)) {
      const q = absolute65535(x, y, m);
      await nativeSend([absMoveInput(q.x, q.y)]);
      await sleep(6);
    }
  } finally {
    await nativeSend([mouseInput({ flags: MOUSEEVENTF_LEFTUP })]);
  }
  return { dragged: true };
}

async function nativeCursor() {
  const ctx = await ctxOrThrow();
  const pt = { x: 0, y: 0 };
  if (!ctx.getCursorPos(pt)) throw new Error("GetCursorPos failed");
  return { x: pt.x, y: pt.y };
}

function readWchar(buf, len) {
  return buf.toString("utf16le", 0, Math.max(0, len) * 2).replace(/\0+$/, "");
}

async function windowText(ctx, hwnd, maxChars = 512) {
  const buf = Buffer.alloc(maxChars * 2);
  let len = 0;
  try { len = ctx.getWindowTextW(hwnd, buf, maxChars); } catch { return ""; }
  return len > 0 ? readWchar(buf, len) : "";
}

async function windowExe(ctx, pid) {
  if (!pid) return "";
  let h = null;
  try {
    h = ctx.openProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if (!h) return "";
    const buf = Buffer.alloc(1024 * 2);
    const size = [1024];
    if (!ctx.queryExe(h, 0, buf, size)) return "";
    const full = readWchar(buf, size[0]);
    return full.split(/[\\/]/).pop() || "";
  } catch {
    return "";
  } finally {
    try { if (h) ctx.closeHandle(h); } catch { /* ignore */ }
  }
}

/** Enumerate top-level windows with title/pid/exe/bounds/flags. */
export async function nativeWindows() {
  const ctx = await ctxOrThrow();
  const hwnds = [];
  const EnumWindows = ctx.enumWindows;
  // Transient callback: collect handles only; query afterwards.
  EnumWindows((hwnd) => { hwnds.push(hwnd); return 1; }, 0);
  let fg = null;
  try { fg = ctx.getForegroundWindow(); } catch { /* ignore */ }
  const out = [];
  for (const hwnd of hwnds) {
    let visible = false, minimized = false, pid = 0;
    try { visible = ctx.isWindowVisible(hwnd) !== 0; } catch { continue; }
    try { minimized = ctx.isIconic(hwnd) !== 0; } catch { /* ignore */ }
    try {
      const cell = [null];
      ctx.getWindowThreadProcessId(hwnd, cell);
      pid = Number(cell[0]) || 0;
    } catch { /* ignore */ }
    const title = await windowText(ctx, hwnd);
    let bounds = null;
    try {
      const r = { left: 0, top: 0, right: 0, bottom: 0 };
      if (ctx.getWindowRect(hwnd, r)) {
        bounds = { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
      }
    } catch { /* ignore */ }
    const exe = await windowExe(ctx, pid);
    out.push({ hwnd, title, pid, exe, bounds, visible, minimized, active: fg !== null && hwnd === fg });
  }
  return out;
}

async function nativeFocusApp(app) {
  const exe = WIN_APP_EXES[String(app || "").toLowerCase().trim()];
  const ctx = await ctxOrThrow();
  for (let attempt = 0; attempt < 3; attempt++) {
    const wins = await nativeWindows();
    const target = pickFocusTarget(wins, exe || String(app || ""));
    if (target) {
      try {
        if (target.minimized) ctx.showWindow(target.hwnd, SW_RESTORE);
        return ctx.setForegroundWindow(target.hwnd) !== 0;
      } catch {
        return false;
      }
    }
    await sleep(250);
  }
  return false;
}

const runCmd = (args) =>
  new Promise((resolve, reject) => execFile("cmd", args, { windowsHide: true }, (err) => (err ? reject(err) : resolve())));

async function nativeOpenApp(app) {
  await runCmd(["/c", "start", String(app)]);
  let focus = false;
  try { focus = await nativeFocusApp(app); } catch { /* launch still counts */ }
  return { opened: String(app), focus };
}

/**
 * Capture the virtual screen to BGRA32 pixels (bottom-up rows, as
 * GetDIBits returns them). Shared by file screenshots and observe shots.
 */
export async function nativeCaptureBgra() {
  const ctx = await ctxOrThrow();
  const m = await nativeMetrics();
  const { width: w, height: h } = m;
  if (w <= 0 || h <= 0 || w * h > 200_000_000) throw new Error(`screenshot: refusing ${w}x${h} capture`);
  const screenDC = ctx.getDC(null);
  if (!screenDC) throw new Error("GetDC failed");
  let memDC = null, hbmp = null, oldObj = null;
  try {
    memDC = ctx.createCompatibleDC(screenDC);
    if (!memDC) throw new Error("CreateCompatibleDC failed");
    hbmp = ctx.createCompatibleBitmap(screenDC, w, h);
    if (!hbmp) throw new Error("CreateCompatibleBitmap failed");
    oldObj = ctx.selectObject(memDC, hbmp);
    if (!ctx.bitBlt(memDC, 0, 0, w, h, screenDC, m.offsetX, m.offsetY, SRCCOPY)) {
      throw new Error("BitBlt failed");
    }
    const bits = Buffer.alloc(w * h * 4);
    const bmi = bitmapInfoHeader(w, h);
    const lines = ctx.getDIBits(memDC, hbmp, 0, h, bits, bmi, DIB_RGB_COLORS);
    if (!lines) throw new Error("GetDIBits failed");
    return { w, h, bgra: bits, metrics: m };
  } finally {
    try { if (memDC && oldObj) ctx.selectObject(memDC, oldObj); } catch { /* ignore */ }
    try { if (hbmp) ctx.deleteObject(hbmp); } catch { /* ignore */ }
    try { if (memDC) ctx.deleteDC(memDC); } catch { /* ignore */ }
    try { ctx.releaseDC(null, screenDC); } catch { /* ignore */ }
  }
}

async function nativeScreenshot(file) {
  const { w, h, bgra } = await nativeCaptureBgra();
  await writeFile(file, bmpFromBgra32(w, h, bgra));
  return { path: file };
}

/** Fast target text for hotkeys: foreground window title. */
export async function nativeFocusedText() {
  const ctx = await ctxOrThrow();
  try {
    const fg = ctx.getForegroundWindow();
    if (!fg) return "";
    return await windowText(ctx, fg, 256);
  } catch {
    return "";
  }
}

/** Fast target text: child control text at the point (native buttons etc). */
export async function nativeTargetText(x, y) {
  const ctx = await ctxOrThrow();
  try {
    const h = ctx.windowFromPoint({ x: Math.round(x), y: Math.round(y) });
    if (!h) return "";
    return await windowText(ctx, h, 256);
  } catch {
    return "";
  }
}

/** Metrics with ZERO spawn: GetSystemMetrics + GetDpiForSystem. */
export async function nativeMetrics() {
  const ctx = await ctxOrThrow();
  let dpi = 96;
  if (ctx.getDpiForSystem) {
    try {
      const d = ctx.getDpiForSystem();
      if (d >= 96 && d <= 576) dpi = d;
    } catch { /* assume 96 */ }
  }
  return metricsFromSystemValues({
    x: ctx.getSystemMetrics(SM_XVIRTUALSCREEN),
    y: ctx.getSystemMetrics(SM_YVIRTUALSCREEN),
    w: ctx.getSystemMetrics(SM_CXVIRTUALSCREEN),
    h: ctx.getSystemMetrics(SM_CYVIRTUALSCREEN),
    dpi,
  });
}

/* ── dispatcher: same action names in, native results out ──────────────────── */

/** Actions the native backend serves (system.mjs checks this set). */
export const NATIVE_ACTIONS = new Set([
  "move_mouse", "click", "double_click", "right_click", "scroll",
  "type_text", "hotkey", "drag", "get_cursor", "get_active_window",
  "screenshot", "open_app",
]);

function num(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got ${JSON.stringify(v)}`);
  return n;
}

export async function nativeSystemAction(action, a = {}) {
  const withVia = (r) => ({ ...r, via: "native" });
  switch (action) {
    case "move_mouse":
      return withVia(await nativeMove(num(a.x, "x"), num(a.y, "y")));
    case "click":
      if (a.x !== undefined) await nativeMove(num(a.x, "x"), num(a.y, "y"));
      return withVia(await nativeClick("click"));
    case "double_click":
      if (a.x !== undefined) await nativeMove(num(a.x, "x"), num(a.y, "y"));
      return withVia(await nativeClick("double_click"));
    case "right_click":
      if (a.x !== undefined) await nativeMove(num(a.x, "x"), num(a.y, "y"));
      return withVia(await nativeClick("right_click"));
    case "scroll":
      return withVia(await nativeScroll(a.dy ?? a.amount ?? 3));
    case "type_text":
      return withVia(await nativeType(String(a.text ?? "")));
    case "hotkey":
      return withVia(await nativeHotkey(String(a.keys ?? a.combo ?? "")));
    case "drag":
      return withVia(await nativeDrag(num(a.fromX, "fromX"), num(a.fromY, "fromY"), num(a.toX, "toX"), num(a.toY, "toY")));
    case "get_cursor":
      return withVia(await nativeCursor());
    case "get_active_window": {
      const wins = await nativeWindows();
      if (a.list === true) {
        return withVia({ windows: wins.map(shapeWindow), count: wins.length });
      }
      const active = wins.find((w) => w.active) || wins.find((w) => w.visible && w.title);
      if (!active) return withVia({ title: "" });
      const shaped = shapeWindow(active);
      return withVia({ title: shaped.title, pid: shaped.pid, bounds: shaped.bounds });
    }
    case "screenshot": {
      if (!a.path) throw new Error("screenshot requires a path");
      return withVia(await nativeScreenshot(bmpPath(a.path)));
    }
    case "open_app":
      return withVia(await nativeOpenApp(String(a.app || "")));
    default:
      throw new Error(`native backend does not serve ${action}`);
  }
}
