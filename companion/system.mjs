/**
 * companion/system.mjs — computer control backends per OS.
 *   darwin → osascript / cliclick
 *   win32  → native koffi backend (./win32.mjs), PowerShell legacy fallback
 *   linux  → xdotool
 * Nothing is ever built into a shell string; everything goes through execFile
 * arg arrays. The daemon's EXTERNAL coordinate contract is PHYSICAL screen
 * pixels; each backend converts at its boundary (see DisplayMetrics).
 */
import { execFile, spawn } from "node:child_process";
import { platform } from "node:os";
import { win32NativeReady, nativeSystemAction, NATIVE_ACTIONS, nativeTargetText, nativeFocusedText, nativeMetrics } from "./win32.mjs";
import { observeAction } from "./observe.mjs";

const run = (cmd, args, timeout = 15000) =>
  new Promise((resolve, reject) => execFile(cmd, args, { timeout, maxBuffer: 10e6, windowsHide: true }, (err, out) => (err ? reject(err) : resolve(String(out)))));

const esc = (s) => String(s).replace(/["\\]/g, "\\$&");

async function xdotool(args) { return run("xdotool", args); }
async function osascript(script) { return run("osascript", ["-e", script]); }
async function powershell(cmd) { return run("powershell", ["-NoProfile", "-Command", cmd]); }

/**
 * Every win32 snippet runs through this preamble so the short-lived
 * powershell process is per-monitor-V2 DPI aware: Cursor.Position,
 * GetCursorPos, UIA FromPoint and VirtualScreen then all speak PHYSICAL
 * pixels, matching the daemon's external contract. (Without it an
 * unaware process sees DPI-virtualized logical coords and clicks land
 * in the wrong place on scaled displays.) try/catch: pre-1703 Windows
 * has no SetProcessDpiAwarenessContext and falls back to unaware.
 */
export const WIN_DPI_PREAMBLE = `try{Add-Type -Namespace Win32 -Name Dpi -MemberDefinition '[DllImport("user32.dll")]public static extern System.IntPtr SetProcessDpiAwarenessContext(System.IntPtr v);' -ErrorAction Stop;[Win32.Dpi]::SetProcessDpiAwarenessContext([System.IntPtr](-4))}catch{}`;
async function ps(cmd) { return powershell(WIN_DPI_PREAMBLE + cmd); }

/* ── item 1: linux app launch (no shell, detached spawn) ─────────────────── */

/**
 * Allowlist id → Linux binary. Every APP_ALLOWLIST.linux entry MUST have
 * a row here (enforced by test); unknown ids throw instead of reaching
 * any shell.
 */
export const LINUX_APP_BINARIES = {
  "nautilus": "nautilus",
  "files": "nautilus", // GNOME Files
  "chrome": "google-chrome",
  "chromium": "chromium",
  "firefox": "firefox",
  "gnome-terminal": "gnome-terminal",
  "konsole": "konsole",
  "gedit": "gedit",
  "calc": "gnome-calculator",
  "code": "code",
  "vlc": "vlc",
  "spotify": "spotify",
};

export function linuxAppBinary(app) {
  const bin = LINUX_APP_BINARIES[String(app || "").toLowerCase().trim()];
  if (!bin) throw new Error(`App "${app}" has no mapped Linux binary.`);
  return bin;
}

/**
 * Launch a linux GUI app detached (survives the daemon). `spawnFn` is
 * injectable for tests; the real `spawn` is the default.
 */
export function launchLinuxApp(app, spawnFn = spawn) {
  const bin = linuxAppBinary(app);
  const child = spawnFn(bin, [], { detached: true, stdio: "ignore" });
  if (child && typeof child.unref === "function") child.unref();
  return { opened: String(app), pid: child && child.pid ? child.pid : -1 };
}

/* ── item 2: windows hotkey → SendKeys ─────────────────────────────────────── */

const SENDKEYS_MODIFIERS = { ctrl: "^", control: "^", alt: "%", shift: "+" };
const SENDKEYS_KEYS = {
  enter: "{ENTER}", return: "{ENTER}", tab: "{TAB}",
  esc: "{ESCAPE}", escape: "{ESCAPE}", space: " ",
  up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}",
  home: "{HOME}", end: "{END}", pageup: "{PGUP}", pgup: "{PGUP}",
  pagedown: "{PGDN}", pgdn: "{PGDN}", insert: "{INSERT}", ins: "{INSERT}",
  delete: "{DELETE}", del: "{DELETE}", backspace: "{BACKSPACE}", bs: "{BACKSPACE}",
  printscreen: "{PRTSC}", prtsc: "{PRTSC}", pause: "{BREAK}",
  numlock: "{NUMLOCK}", scrolllock: "{SCROLLLOCK}", capslock: "{CAPSLOCK}",
};
const WIN_KEY_NAMES = new Set(["win", "windows", "super", "meta", "cmd", "command"]);

function sendKeysKey(p, combo) {
  if (SENDKEYS_KEYS[p]) return SENDKEYS_KEYS[p];
  const f = p.match(/^f(\d{1,2})$/);
  if (f && Number(f[1]) >= 1 && Number(f[1]) <= 24) return `{F${Number(f[1])}}`;
  if (/^[a-z0-9]$/.test(p)) return p;
  if (/^[+^%~(){}[\]]$/.test(p)) return `{${p}}`;
  throw new Error(`hotkey: unsupported key "${p}" in combo "${combo}"`);
}

/**
 * Parse "ctrl+shift+t" into modifiers + key and emit the SendKeys string
 * ("^+t"). ALL modifiers are replaced (the old code only replaced the
 * first). enter/tab/esc/arrows/f-keys map to {ENTER} etc. Win-key combos
 * throw: SendKeys cannot emit the Windows key, so the caller must route
 * those through pressWinCombo (keybd_event) instead.
 */
export function sendKeysFor(combo) {
  const parts = String(combo ?? "").split("+").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) throw new Error("hotkey: empty combo");
  let mods = "";
  let main = "";
  for (const p of parts) {
    if (WIN_KEY_NAMES.has(p)) {
      throw new Error(`hotkey: win-key combos ("${combo}") use the keybd path, not SendKeys`);
    } else if (SENDKEYS_MODIFIERS[p]) {
      const m = SENDKEYS_MODIFIERS[p];
      if (!mods.includes(m)) mods += m;
    } else if (main) {
      throw new Error(`hotkey: two main keys in combo "${combo}"`);
    } else {
      main = sendKeysKey(p, combo);
    }
  }
  if (!main) throw new Error(`hotkey: combo "${combo}" has no main key`);
  return mods + main;
}

/** True when the combo needs the keybd path (contains a win key). */
export function isWinCombo(combo) {
  return String(combo ?? "").split("+").map((s) => s.trim().toLowerCase()).some((p) => WIN_KEY_NAMES.has(p));
}

const WIN_VK = { win: 0x5b, ctrl: 0x11, alt: 0x12, shift: 0x10, esc: 0x1b, tab: 0x09, enter: 0x0d, space: 0x20, left: 0x25, up: 0x26, right: 0x27, down: 0x28, delete: 0x2e };
function vkFor(key) {
  const k = key.trim().toLowerCase();
  if (k === "windows" || k === "super" || k === "meta" || k === "cmd" || k === "command") return WIN_VK.win;
  if (k === "control") return WIN_VK.ctrl;
  if (WIN_VK[k]) return WIN_VK[k];
  if (/^[a-z0-9]$/.test(k)) return k.toUpperCase().charCodeAt(0);
  const f = k.match(/^f(\d{1,2})$/);
  if (f && Number(f[1]) >= 1 && Number(f[1]) <= 24) return 0x6f + Number(f[1]);
  throw new Error(`Unsupported key in win combo: ${key}`);
}
/**
 * SendKeys cannot emit the Windows key, so win-combos ("win", "win+e",
 * "win+r") go through keybd_event — press in order, release in reverse.
 */
async function pressWinCombo(keys) {
  const codes = String(keys).split("+").map((k) => k.trim()).filter(Boolean).map(vkFor);
  const downs = codes.map((c) => `[Win32.Kbd]::keybd_event(${c},0,0,0);Start-Sleep -Milliseconds 30`).join("");
  const ups = [...codes].reverse().map((c) => `[Win32.Kbd]::keybd_event(${c},0,2,0)`).join("");
  await ps(`Add-Type -Namespace Win32 -Name Kbd -MemberDefinition '[DllImport("user32.dll")]public static extern void keybd_event(byte v,int s,uint f,int i);' -ErrorAction Stop;${downs}${ups}`);
}

/* ── item 5: DPI awareness + virtual-screen offsets ──────────────────────────
 *
 * External contract: PHYSICAL pixels everywhere (model coords, OCR boxes,
 * get_cursor). DisplayMetrics describes the backend space so each backend
 * converts at its boundary:
 *   backendPoint = (physical - offset) / scale        (darwin points)
 *   physical     = backendPoint * scale + offset
 * win32 runs DPI-aware (preamble) so its backend space IS physical and
 * scale is 1 in practice; the offsets still matter for ABSOLUTE mouse
 * normalization on multi-monitor rigs (negative virtual-screen origins).
 */

/** Parse SOPHIA_DPI_SCALE ("2" or "1.5,1.5") + SOPHIA_SCREEN_OFFSET ("-1920,0"). */
export function metricsFromEnv(env = process.env) {
  const s = String(env.SOPHIA_DPI_SCALE ?? "").trim();
  const o = String(env.SOPHIA_SCREEN_OFFSET ?? "").trim();
  if (!s && !o) return null;
  const nums = (t) => t.split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n));
  const ss = s ? nums(s) : [1];
  const oo = o ? nums(o) : [0, 0];
  if ((s && ss.length === 0) || (o && oo.length !== 2)) return null;
  return {
    scaleX: ss[0] > 0 ? ss[0] : 1,
    scaleY: (ss[1] ?? ss[0]) > 0 ? (ss[1] ?? ss[0]) : 1,
    offsetX: Math.round(oo[0] ?? 0),
    offsetY: Math.round(oo[1] ?? 0),
  };
}

/** Physical (external) → backend point. Pure. */
export function toBackend(x, y, m) {
  return {
    x: Math.round((Number(x) - m.offsetX) / (m.scaleX || 1)),
    y: Math.round((Number(y) - m.offsetY) / (m.scaleY || 1)),
  };
}

/** Backend point → physical (external). Pure. */
export function toPhysical(x, y, m) {
  return {
    x: Math.round(m.offsetX + Number(x) * (m.scaleX || 1)),
    y: Math.round(m.offsetY + Number(y) * (m.scaleY || 1)),
  };
}

/**
 * Physical pixel → win32 MOUSEEVENTF_ABSOLUTE 0–65535 across the VIRTUAL
 * screen (offsets included, so negative-origin multi-monitor rigs work).
 * Pure. `m` needs offsetX/offsetY/width/height in physical pixels.
 */
export function winAbsolute(x, y, m) {
  const nx = Math.round(((Number(x) - m.offsetX) / m.width) * 65535);
  const ny = Math.round(((Number(y) - m.offsetY) / m.height) * 65535);
  return {
    x: Math.max(0, Math.min(65535, nx)),
    y: Math.max(0, Math.min(65535, ny)),
  };
}

/** Parse the win32 metrics probe JSON. Pure. */
export function parseWinMetricsJson(text) {
  const j = JSON.parse(String(text));
  const dpi = Number(j.dpi) > 0 ? Number(j.dpi) : 96;
  return {
    scaleX: dpi / 96,
    scaleY: dpi / 96,
    offsetX: Math.round(Number(j.x) || 0),
    offsetY: Math.round(Number(j.y) || 0),
    width: Math.max(1, Math.round(Number(j.w) || 0)),
    height: Math.max(1, Math.round(Number(j.h) || 0)),
  };
}

/** Parse `xrdb -query` for Xft.dpi. Pure. */
export function parseXftDpi(text) {
  const m = String(text).match(/Xft\.dpi:\s*([\d.]+)/);
  const dpi = m ? Number(m[1]) : NaN;
  return Number.isFinite(dpi) && dpi > 0 ? dpi / 96 : 1;
}

/** Parse `xdotool getdisplaygeometry` ("W H"). Pure. */
export function parseDisplayGeometry(text) {
  const m = String(text).trim().match(/^(\d+)\s+(\d+)$/);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 0, height: 0 };
}

const IDENTITY_METRICS = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, width: 0, height: 0 };
let metricsCache = null;
/** Test seam — drop the cached metrics. */
export function _resetMetricsCache() { metricsCache = null; }

async function queryDisplayMetrics() {
  const p = platform();
  if (p === "win32") {
    // Native path: GetSystemMetrics + GetDpiForSystem, zero spawn.
    if (await win32NativeReady()) return nativeMetrics();
    const out = await ps(`Add-Type -AssemblyName System.Windows.Forms,System.Drawing;$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;$g=[System.Drawing.Graphics]::FromHwnd([System.IntPtr]::Zero);$o=@{x=$b.X;y=$b.Y;w=$b.Width;h=$b.Height;dpi=$g.DpiX};$g.Dispose();$o|ConvertTo-Json -Compress`);
    return parseWinMetricsJson(out);
  }
  if (p === "darwin") {
    let scale = 1;
    try {
      const out = await osascript(`use framework "AppKit"\nreturn (current application's NSScreen's mainScreen's backingScaleFactor()) as real`);
      const n = Number(out.trim());
      if (Number.isFinite(n) && n > 0) scale = n;
    } catch { /* fall through with scale 1 */ }
    return { ...IDENTITY_METRICS, scaleX: scale, scaleY: scale };
  }
  // linux: identity geometry; honour Xft.dpi / GDK_SCALE for toolkit scaling.
  let scale = Number(process.env.GDK_SCALE) > 0 ? Number(process.env.GDK_SCALE) : 0;
  if (!scale) {
    try { scale = parseXftDpi(await run("xrdb", ["-query"], 3000)); } catch { scale = 1; }
  }
  let size = { width: 0, height: 0 };
  try { size = parseDisplayGeometry(await xdotool(["getdisplaygeometry"])); } catch { /* unknown */ }
  return { ...IDENTITY_METRICS, scaleX: scale, scaleY: scale, ...size };
}

/**
 * Cached display metrics. Env overrides (SOPHIA_DPI_SCALE /
 * SOPHIA_SCREEN_OFFSET) win; any probe failure degrades to identity.
 */
export async function getDisplayMetrics() {
  const envM = metricsFromEnv();
  if (envM) return { ...IDENTITY_METRICS, ...envM };
  if (metricsCache) return metricsCache;
  try {
    metricsCache = await queryDisplayMetrics();
  } catch {
    metricsCache = { ...IDENTITY_METRICS };
  }
  return metricsCache;
}

/* ── item 3: read the text under a click/hotkey target ─────────────────────── */

/**
 * PowerShell that reads the UIA AutomationElement name at a point
 * (click target) or the focused element (hotkey target). Pure builder.
 */
export function uiaTargetScript(x, y) {
  const hasPoint = x !== undefined && y !== undefined && x !== null && y !== null;
  const target = hasPoint
    ? `[System.Windows.Automation.AutomationElement]::FromPoint((New-Object System.Windows.Point(${Number(x)}, ${Number(y)})))`
    : `[System.Windows.Automation.AutomationElement]::FocusedElement`;
  return `Add-Type -AssemblyName UIAutomationClient,WindowsBase;try{${target}.Current.Name}catch{""}`;
}

/** AppleScript returning "frontApp | frontWindow" (hotkey target on darwin). */
export function darwinTargetScript() {
  return `try
  tell application "System Events" to set p to first application process whose frontmost is true
  try
    return (name of p) & " | " & (name of front window of p)
  on error
    return name of p
  end try
on error
  return ""
end try`;
}

/**
 * Daemon-read text describing the action target: UIA element name under
 * the point on win32 (or the focused element for hotkeys), frontmost
 * app/window elsewhere. Best-effort: "" on any failure. NEVER fed by
 * the model — the daemon calls this itself before policy.check.
 */
export async function targetTextAt(x, y) {
  const p = platform();
  try {
    if (p === "win32") {
      // Native path: control/foreground text (<1ms, no spawn). Legacy
      // path keeps the slower UIA probe (reads custom-drawn UI).
      if (await win32NativeReady()) {
        if (x !== undefined && y !== undefined) return await nativeTargetText(x, y);
        return await nativeFocusedText();
      }
      const out = await ps(uiaTargetScript(x, y));
      return out.trim();
    }
    if (p === "darwin") {
      return (await osascript(darwinTargetScript())).trim();
    }
    const out = await xdotool(["getactivewindow", "getwindowname"]);
    return out.trim();
  } catch {
    return "";
  }
}

/* ── item 6: drag / scroll / volume builders (pure, tested) ────────────────── */

/** Interpolated path from→to in `steps` segments (excludes start, includes end). */
export function interpolatePath(fromX, fromY, toX, toY, steps = 12) {
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

/** win32 drag snippet: absolute move to `from`, LEFTDOWN, stepped moves, LEFTUP. */
export function winDragScript(from, to, m, steps = 12) {
  const a = winAbsolute(from.x, from.y, m);
  const moves = interpolatePath(from.x, from.y, to.x, to.y, steps)
    .map(([x, y]) => { const q = winAbsolute(x, y, m); return `[Win32.Mouse]::mouse_event(0x8001,${q.x},${q.y},0,0);Start-Sleep -Milliseconds 8`; })
    .join("");
  return `Add-Type -Namespace Win32 -Name Mouse -MemberDefinition '[DllImport("user32.dll")]public static extern void mouse_event(uint f,int x,int y,int d,int i);' -ErrorAction Stop;[Win32.Mouse]::mouse_event(0x8001,${a.x},${a.y},0,0);Start-Sleep -Milliseconds 30;[Win32.Mouse]::mouse_event(0x0002,0,0,0,0);${moves}[Win32.Mouse]::mouse_event(0x0004,0,0,0,0)`;
}

/** darwin drag args for cliclick (caller converts physical→points first). */
export function darwinDragArgs(fromX, fromY, toX, toY) {
  return [
    `m:${Math.round(fromX)},${Math.round(fromY)}`,
    "dd:.",
    `m:${Math.round(toX)},${Math.round(toY)}`,
    "du:.",
  ];
}

/**
 * darwin scroll via Quartz CGEventCreateScrollWheelEvent. Contract: dy > 0
 * scrolls DOWN (matches xdotool button 5 and win32 negative WHEEL delta),
 * so the wheel value is negated for positive dy.
 */
export function darwinScrollScript(dy) {
  const lines = Math.max(1, Math.min(10, Math.round(Math.abs(Number(dy) || 3))));
  const wheel = Number(dy) > 0 ? -lines : lines;
  return `use framework "Quartz"\ncurrent application's CGEventPost(0, (current application's CGEventCreateScrollWheelEvent(missing value, 0, 1, ${wheel})))`;
}

/** darwin mouse-move fallback (no cliclick): Quartz cursor warp. Points in. */
export function darwinWarpScript(x, y) {
  return `use framework "Quartz"\ncurrent application's CGWarpMouseCursorPosition({${Math.round(x)}, ${Math.round(y)}})`;
}

/**
 * darwin click fallback (no cliclick): Quartz down/up at the CURRENT
 * position (caller moves first). button: "Left"|"Right"; kinds 1/2/3/4.
 */
export function darwinQuartzClickScript(button = "Left", clicks = 1) {
  const down = button === "Right" ? 3 : 1;
  const up = button === "Right" ? 4 : 2;
  const pairs = [];
  for (let i = 0; i < Math.max(1, Math.min(3, Math.round(clicks) || 1)); i++) {
    pairs.push(`set dn to current application's CGEventCreateMouseEvent(missing value, ${down}, loc, 0)`);
    pairs.push(`current application's CGEventPost(0, dn)`);
    pairs.push(`delay 0.05`);
    pairs.push(`set up to current application's CGEventCreateMouseEvent(missing value, ${up}, loc, 0)`);
    pairs.push(`current application's CGEventPost(0, up)`);
  }
  return `use framework "Quartz"\nset loc to current application's CGEventGetLocation(current application's CGEventCreate(missing value))\n${pairs.join("\n")}`;
}

/**
 * REAL win32 set_volume via Core Audio (IAudioEndpointVolume), not the
 * mute-key fallback. Inline C# does MMDeviceEnumerator →
 * GetDefaultAudioEndpoint(eRender, eConsole) → Activate →
 * SetMasterVolumeLevelScalar. level 0–100.
 */
export function windowsVolumeScript(level) {
  const clamped = Math.max(0, Math.min(100, Math.round(Number(level) || 0)));
  return `${WIN_COREAUDIO_CLASS}[Vol]::Set(${clamped / 100})`;
}

/** Companion getter via GetMasterVolumeLevelScalar → prints 0–100. */
export function windowsGetVolumeScript() {
  return `${WIN_COREAUDIO_CLASS}[Math]::Round(([Vol]::Get()*100))`;
}

const WIN_COREAUDIO_CLASS = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int _0(); int _1(); int _2(); int _3();
  int SetMasterVolumeLevelScalar(float level, Guid ctx);
  int _5();
  int GetMasterVolumeLevelScalar(out float level);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int clsCtx, IntPtr act, [MarshalAs(UnmanagedType.IUnknown)] out object obj);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB636B976"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int _0();
  [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice dev);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDevEnum {}
public class Vol {
  static object Ep() {
    var e = (IMMDeviceEnumerator)(new MMDevEnum());
    IMMDevice d; e.GetDefaultAudioEndpoint(0, 0, out d);
    Guid g = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
    object o; d.Activate(ref g, 23, IntPtr.Zero, out o); return o;
  }
  public static void Set(float l) { ((IAudioEndpointVolume)Ep()).SetMasterVolumeLevelScalar(l, Guid.Empty); }
  public static float Get() { float l; ((IAudioEndpointVolume)Ep()).GetMasterVolumeLevelScalar(out l); return l; }
}
'@;
`;

/* ── main dispatch ─────────────────────────────────────────────────────────── */

function num2(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got ${JSON.stringify(v)}`);
  return n;
}

export async function systemAction(action, a = {}) {
  const p = platform();

  // Persistent native backend (win32 + koffi): zero-spawn input with the
  // same action names. The PowerShell branches below stay as the
  // load-time fallback (see win32.mjs fallback rule).
  if (p === "win32" && NATIVE_ACTIONS.has(action) && (await win32NativeReady())) {
    return nativeSystemAction(action, a);
  }

  switch (action) {
    case "open_url": {
      if (p === "darwin") await osascript(`open location "${esc(a.url)}"`);
      else if (p === "win32") await run("cmd", ["/c", "start", "", a.url]);
      else await run("xdg-open", [a.url]);
      return { opened: a.url };
    }

    case "open_app": {
      const app = String(a.app || "");
      if (p === "darwin") await osascript(`tell application "${esc(app)}" to activate`);
      else if (p === "win32") await run("cmd", ["/c", "start", app]);
      else return launchLinuxApp(app);
      return { opened: app };
    }

    case "notify": {
      const title = String(a.title || "Sofia");
      const body = String(a.text || "");
      if (p === "darwin") await osascript(`display notification "${esc(body)}" with title "${esc(title)}"`);
      else if (p === "win32") await ps(`Add-Type -AssemblyName System.Windows.Forms;$n=New-Object System.Windows.Forms.NotifyIcon;$n.Icon=[System.Drawing.SystemIcons]::Information;$n.Visible=$true;$n.ShowBalloonTip(4000,'${esc(title)}','${esc(body)}',[System.Windows.Forms.ToolTipIcon]::Info);Start-Sleep 4;$n.Dispose()`);
      else await run("notify-send", [title, body]).catch(() => {});
      return { notified: true };
    }

    case "screenshot": {
      const file = a.path || "";
      if (p === "darwin") { await run("screencapture", ["-x", file]); return { path: file }; }
      if (p === "win32") {
        await ps(`Add-Type -AssemblyName System.Windows.Forms,System.Drawing;$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height;$g=[System.Drawing.Graphics]::FromImage($bmp);$g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size);$bmp.Save('${esc(file)}');$g.Dispose();$bmp.Dispose()`);
        return { path: file };
      }
      // linux: try common tools (`import` needs -window root or it waits for a click)
      for (const [cmd, args] of [["gnome-screenshot", ["-f", file]], ["scrot", [file]], ["import", ["-window", "root", file]]]) {
        try { await run(cmd, args); return { path: file }; } catch { /* next */ }
      }
      throw new Error("No screenshot tool found (install gnome-screenshot or scrot).");
    }

    case "observe": {
      // One-call perception: screenshot + active window + UI tree.
      // Metrics ride along for the darwin AX points→physical conversion.
      return observeAction(a, { metrics: await getDisplayMetrics() });
    }

    case "get_cursor": {
      if (p === "linux") {
        const out = await xdotool(["getmouselocation"]);
        const m = out.match(/x:(\d+) y:(\d+)/);
        return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: -1, y: -1 };
      }
      if (p === "darwin") {
        // System Events reports POINTS — convert to physical for the contract.
        const out = await osascript('tell application "System Events" to return position of the mouse');
        const [x, y] = out.trim().split(", ").map(Number);
        return toPhysical(x, y, await getDisplayMetrics());
      }
      const out = await ps("[System.Windows.Forms.Cursor]::Position | ConvertTo-Json -Compress");
      const j = JSON.parse(out);
      return { x: j.X, y: j.Y };
    }

    case "move_mouse": {
      const x = num2(a.x, "x"), y = num2(a.y, "y");
      if (p === "linux") await xdotool(["mousemove", String(x), String(y)]);
      else if (p === "darwin") {
        // cliclick/osascript take POINTS — convert physical→points.
        const pt = toBackend(x, y, await getDisplayMetrics());
        await run("cliclick", [`m:${pt.x},${pt.y}`]).catch(() => osascript(darwinWarpScript(pt.x, pt.y)));
      }
      else await ps(`[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x},${y})`);
      return { moved: { x, y } };
    }

    case "click": case "double_click": case "right_click": {
      if (a.x !== undefined) await systemAction("move_mouse", a);
      if (p === "linux") {
        const btn = action === "right_click" ? "3" : "1";
        await xdotool(["click", action === "double_click" ? "--repeat 2 --delay 60" : "", btn].filter(Boolean));
      } else if (p === "darwin") {
        const arg = action === "right_click" ? "rc:." : action === "double_click" ? "dc:." : "c:.";
        await run("cliclick", [arg]).catch(() =>
          osascript(darwinQuartzClickScript(action === "right_click" ? "Right" : "Left", action === "double_click" ? 2 : 1)));
      } else {
        const btn = action === "right_click" ? "Right" : "Left";
        const clicks = action === "double_click" ? 2 : 1;
        await ps(`Add-Type -Namespace Win32 -Name Mouse -MemberDefinition '[DllImport("user32.dll")]public static extern void mouse_event(uint f,int x,int y,int d,int i);' -ErrorAction Stop;$dn=0x0002;$up=0x0004;${btn === "Right" ? "$dn=0x0008;$up=0x0010;" : ""}for($i=0;$i -lt ${clicks};$i++){[Win32.Mouse]::mouse_event($dn,0,0,0,0);[Win32.Mouse]::mouse_event($up,0,0,0,0)}`);
      }
      return { clicked: action };
    }

    case "scroll": {
      const dy = Number(a.dy ?? a.amount ?? 3);
      if (p === "linux") await xdotool(["click", dy > 0 ? "5" : "4"]);
      else if (p === "darwin") {
        // Real wheel events via Quartz; arrow-key fallback without them.
        await osascript(darwinScrollScript(dy)).catch(() =>
          osascript(`tell application "System Events" to key code ${dy > 0 ? 125 : 126}`));
      }
      else await ps(`Add-Type -Namespace Win32 -Name Wheel -MemberDefinition '[DllImport("user32.dll")]public static extern void mouse_event(uint f,int x,int y,int d,int i);' -ErrorAction Stop;[Win32.Wheel]::mouse_event(0x0800,0,0,${dy > 0 ? -120 : 120},0)`);
      return { scrolled: dy };
    }

    case "type_text": {
      const text = String(a.text ?? "");
      if (p === "linux") await xdotool(["type", "--clearmodifiers", "--delay", "12", text]);
      else if (p === "darwin") await osascript(`tell application "System Events" to keystroke "${esc(text)}"`);
      else await ps(`Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait('${text.replace(/'/g, "''").replace(/[+^%~(){}[\]]/g, "{$&")}')`);
      return { typed: text.length };
    }

    case "hotkey": {
      const keys = String(a.keys ?? a.combo ?? "");
      if (p === "linux") await xdotool(["key", keys.toLowerCase().replace(/\+/g, "+")]);
      else if (p === "darwin") {
        const parts = keys.toLowerCase().split("+");
        const main = parts.pop();
        const mods = parts.length ? ` using {${parts.map((m) => `${m} down`).join(", ")}}` : "";
        await osascript(`tell application "System Events" to keystroke "${main}"${mods}`);
      } else if (isWinCombo(keys)) await pressWinCombo(keys);
      else await ps(`Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait('${sendKeysFor(keys).replace(/'/g, "''")}')`);
      return { hotkey: keys };
    }

    case "drag": {
      const fromX = num2(a.fromX, "fromX"), fromY = num2(a.fromY, "fromY");
      const toX = num2(a.toX, "toX"), toY = num2(a.toY, "toY");
      if (p === "linux") {
        await xdotool(["mousemove", String(fromX), String(fromY), "mousedown", "1", "mousemove", String(toX), String(toY), "mouseup", "1"]);
      } else if (p === "win32") {
        const m = await getDisplayMetrics();
        if (!m.width || !m.height) throw new Error("drag: virtual-screen size unknown; cannot normalize ABSOLUTE coords.");
        await ps(winDragScript({ x: fromX, y: fromY }, { x: toX, y: toY }, m));
      } else {
        // darwin: cliclick drag-down / move / drag-up (points).
        const m = await getDisplayMetrics();
        const f = toBackend(fromX, fromY, m), t = toBackend(toX, toY, m);
        try {
          await run("cliclick", darwinDragArgs(f.x, f.y, t.x, t.y));
        } catch {
          throw new Error("drag on macOS needs cliclick (brew install cliclick) for press-and-hold.");
        }
      }
      return { dragged: true };
    }

    case "get_active_window": {
      if (p === "linux") { const out = await xdotool(["getactivewindow", "getwindowname"]); return { title: out.trim() }; }
      if (p === "darwin") { const out = await osascript('tell application "System Events" to get name of first application process whose frontmost is true'); return { title: out.trim() }; }
      const out = await ps(`Add-Type -Namespace Win32 -Name Fg -MemberDefinition '[DllImport("user32.dll")]public static extern System.IntPtr GetForegroundWindow();' -ErrorAction Stop;(Get-Process | Where-Object {$_.MainWindowHandle -eq [Win32.Fg]::GetForegroundWindow()}).MainWindowTitle`);
      return { title: out.trim() };
    }

    case "set_volume": {
      const level = Math.max(0, Math.min(100, Number(a.level ?? 50)));
      if (p === "darwin") await osascript(`set volume output volume ${level}`);
      else if (p === "win32") await ps(windowsVolumeScript(level));
      else await run("amixer", ["sset", "Master", `${level}%`]).catch(() => run("pactl", ["set-sink-volume", "@DEFAULT_SINK@", `${level}%`]));
      return { level };
    }

    case "get_volume": {
      if (p === "darwin") { const out = await osascript("output volume of (get volume settings)"); return { level: Number(out.trim()) }; }
      if (p === "linux") { const out = await run("amixer", ["sget", "Master"]).catch(() => ""); const m = out.match(/\[(\d+)%\]/); return { level: m ? Number(m[1]) : -1 }; }
      try {
        const out = await ps(windowsGetVolumeScript());
        const n = Number(out.trim());
        return { level: Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : -1 };
      } catch { return { level: -1 }; }
    }

    default: throw new Error(`Unsupported system action ${action}`);
  }
}
