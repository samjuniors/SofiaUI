/**
 * companion/observe.mjs — Phase 18: one-call screen observation.
 *
 *   observe {} → {
 *     screenshot_b64: string | null,   // PNG, longest edge ≤ 1568px
 *     mime: "image/png" | null,
 *     scale: number | null,            // shot_px = physical_px * scale (≤ 1)
 *     shot: { width, height } | null,  // screenshot dims (model coord space)
 *     screen: { width, height, offsetX, offsetY } | null,  // physical px
 *     active_window: { title, pid | null, app | null, bounds | null },
 *     ui_tree: [{ id, name, role, bounds | null, enabled, value?, depth }],
 *     tree_source: "uia" | "ax" | "unsupported" | "failed",
 *     notes: string[],                 // one line per degraded part
 *   }
 *
 * Every bound in ui_tree / active_window is PHYSICAL pixels (the daemon's
 * external contract); only the screenshot is downscaled, and `scale` maps
 * the model's screenshot-space coordinates back. The tree is flattened in
 * walk order with per-call ids (e1..eN) the model references as targets.
 *
 * PARTIAL SUCCESS: each part (shot, window, tree) is captured
 * independently — any subset may fail and the rest still ships, with a
 * note explaining each gap. Only when ALL parts fail does observe throw
 * (the server turns that into action_failed + hint).
 *
 * Backends: win32 native (koffi pixels → pure-JS PNG, zero spawn) or
 * legacy PowerShell (System.Drawing PNG → base64, one spawn); UIA tree
 * always via PowerShell (COM UIA is out of scope for koffi). darwin via
 * screencapture + sips + an AX walk in osascript. linux via
 * gnome-screenshot/scrot (+ ImageMagick resize when present) and xdotool;
 * no UI tree (no UIA/AX bridge) — tree_source "unsupported".
 */

import { execFile } from "node:child_process";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { win32NativeReady, nativeCaptureBgra, nativeWindows } from "./win32.mjs";

/** Longest screenshot edge, px. Models see at most this. */
export const OBSERVE_MAX_EDGE = 1568;
/** Max UI tree nodes shipped per observe. */
export const OBSERVE_MAX_NODES = 150;
/** Max tree walk depth (root window = 0). */
export const OBSERVE_MAX_DEPTH = 7;
/** Max chars per tree name/value (prompt budget). */
export const OBSERVE_MAX_TEXT = 80;

function run(cmd, args, timeout = 15000) {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout, maxBuffer: 20e6, windowsHide: true }, (err, out) =>
      (err ? reject(err) : resolve(String(out)))));
}

function tmpName(ext) {
  return join(tmpdir(), `sophia-obs-${process.pid}-${randomBytes(4).toString("hex")}.${ext}`);
}

/* ── pure: shot geometry ─────────────────────────────────────────────────── */

/**
 * Physical dims → downscaled shot dims + scale. Never upscales. Pure.
 */
export function shotSizeFor(physW, physH, maxEdge = OBSERVE_MAX_EDGE) {
  const w = Math.max(1, Math.round(Number(physW) || 0));
  const h = Math.max(1, Math.round(Number(physH) || 0));
  const edge = Math.max(w, h);
  const scale = edge > maxEdge ? maxEdge / edge : 1;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}

/* ── pure: pixels (box downscale + minimal PNG writer) ───────────────────── */

/**
 * Area-average BGRA32 src into an RGB24 buffer of dst size. Pure.
 * src is read as rows of srcW BGRA pixels; dstW/dstH must be ≥ 1.
 */
export function downscaleBgra32(src, srcW, srcH, dstW, dstH) {
  const out = Buffer.alloc(dstW * dstH * 3);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;
  for (let dy = 0; dy < dstH; dy++) {
    const y0 = Math.floor(dy * yRatio);
    const y1 = Math.min(srcH, Math.max(y0 + 1, Math.floor((dy + 1) * yRatio)));
    for (let dx = 0; dx < dstW; dx++) {
      const x0 = Math.floor(dx * xRatio);
      const x1 = Math.min(srcW, Math.max(x0 + 1, Math.floor((dx + 1) * xRatio)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const o = (sy * srcW + sx) * 4;
          b += src[o]; g += src[o + 1]; r += src[o + 2]; n++;
        }
      }
      const p = (dy * dstW + dx) * 3;
      out[p] = Math.round(r / n); out[p + 1] = Math.round(g / n); out[p + 2] = Math.round(b / n);
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (ISO 3309). Pure. */
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/**
 * Minimal PNG encoder: 8-bit RGB, filter 0, single IDAT. Pure.
 * (zlib does the real work; this just frames it.)
 */
export function pngFromRgb24(w, h, rgb) {
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    rgb.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Read dims from a PNG header (bytes 16–24). Pure. Null unless it parses. */
export function parsePngDims(buf) {
  try {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    if (b.length < 24) return null;
    if (b[0] !== 137 || b[1] !== 80 || b[2] !== 78 || b[3] !== 71) return null;
    if (b.subarray(12, 16).toString("ascii") !== "IHDR") return null;
    const w = b.readUInt32BE(16);
    const h = b.readUInt32BE(20);
    if (!w || !h || w > 100000 || h > 100000) return null;
    return { width: w, height: h };
  } catch {
    return null;
  }
}

/**
 * Native pixels → observe shot fields. Composes size + downscale + PNG.
 * Pure (the capture itself lives in win32.mjs).
 */
export function shotFromBgra32(bgra, w, h, maxEdge = OBSERVE_MAX_EDGE) {
  const s = shotSizeFor(w, h, maxEdge);
  const rgb = downscaleBgra32(bgra, w, h, s.width, s.height);
  return {
    b64: pngFromRgb24(s.width, s.height, rgb).toString("base64"),
    mime: "image/png",
    scale: s.scale,
    shot: { width: s.width, height: s.height },
  };
}

/* ── win32: legacy screenshot script (System.Drawing → PNG → base64) ─────── */

/**
 * One powershell spawn: capture the virtual screen, downscale to maxEdge,
 * emit PNG base64 + geometry as a single JSON line. Pure builder.
 */
export function winShotScript(maxEdge = OBSERVE_MAX_EDGE) {
  const edge = Math.max(64, Math.round(Number(maxEdge) || OBSERVE_MAX_EDGE));
  return `Add-Type -AssemblyName System.Windows.Forms,System.Drawing;$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height;$g=[System.Drawing.Graphics]::FromImage($bmp);$g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size);$sc=[Math]::Min(1,${edge}/[Math]::Max($b.Width,$b.Height));$sw=[Math]::Max(1,[int]($b.Width*$sc));$sh=[Math]::Max(1,[int]($b.Height*$sc));$small=New-Object System.Drawing.Bitmap $sw,$sh;$g2=[System.Drawing.Graphics]::FromImage($small);$g2.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic;$g2.DrawImage($bmp,0,0,$sw,$sh);$ms=New-Object System.IO.MemoryStream;$small.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png);$g.Dispose();$g2.Dispose();$bmp.Dispose();$small.Dispose();@{b64=[Convert]::ToBase64String($ms.ToArray());mime='image/png';shotW=$sw;shotH=$sh;physW=$b.Width;physH=$b.Height;offX=$b.X;offY=$b.Y}|ConvertTo-Json -Compress`;
}

/**
 * Parse the legacy shot JSON. Recomputes scale from dims (exact mapping
 * for the loop) instead of trusting the float. Pure. Throws on garbage.
 */
export function parseWinShot(text) {
  let j;
  try {
    j = JSON.parse(String(text));
  } catch {
    throw new Error("win shot: not JSON");
  }
  const b64 = typeof j.b64 === "string" ? j.b64 : "";
  const shotW = Math.round(Number(j.shotW) || 0);
  const shotH = Math.round(Number(j.shotH) || 0);
  const physW = Math.round(Number(j.physW) || 0);
  const physH = Math.round(Number(j.physH) || 0);
  if (b64.length < 100 || shotW < 1 || shotH < 1 || physW < 1 || physH < 1) {
    throw new Error("win shot: missing pixels or geometry");
  }
  return {
    b64,
    mime: "image/png",
    scale: shotW / physW,
    shot: { width: shotW, height: shotH },
    screen: {
      width: physW,
      height: physH,
      offsetX: Math.round(Number(j.offX) || 0),
      offsetY: Math.round(Number(j.offY) || 0),
    },
  };
}

/* ── win32: UIA tree script ──────────────────────────────────────────────── */

/**
 * Walk the FOREGROUND window with UIA (ControlViewWalker), depth-first,
 * emitting {window, nodes[]} as JSON. A node ships when it has a name, a
 * value, an interactive control type, or sits at depth ≤ 1 (chrome
 * context); children of skipped nodes are still walked. Bounds are raw
 * UIA rects — UIA always speaks physical pixels. Pure builder.
 */
export function uiaTreeScript(maxNodes = OBSERVE_MAX_NODES, maxDepth = OBSERVE_MAX_DEPTH) {
  const maxN = Math.max(10, Math.min(500, Math.round(Number(maxNodes) || OBSERVE_MAX_NODES)));
  const maxD = Math.max(1, Math.min(12, Math.round(Number(maxDepth) || OBSERVE_MAX_DEPTH)));
  return `Add-Type -AssemblyName UIAutomationClient,WindowsBase;$ErrorActionPreference='Stop';$maxN=${maxN};$maxD=${maxD};Add-Type -Namespace Win32 -Name Fg -MemberDefinition '[DllImport("user32.dll")]public static extern System.IntPtr GetForegroundWindow();' -ErrorAction Stop;$h=[Win32.Fg]::GetForegroundWindow();$root=$null;if($h -ne 0){try{$root=[System.Windows.Automation.AutomationElement]::FromHandle($h)}catch{}};if($root -eq $null){$root=[System.Windows.Automation.AutomationElement]::RootElement};$wk=[System.Windows.Automation.TreeWalker]::ControlViewWalker;$nodes=New-Object System.Collections.Generic.List[object];$keep=@('Button','Hyperlink','MenuItem','TabItem','ListItem','TreeItem','CheckBox','RadioButton','Edit','Document','ComboBox','SplitButton');function R($r){if($r -eq $null){return $null}[double]$x=$r.X;[double]$y=$r.Y;[double]$w=$r.Width;[double]$hh=$r.Height;if([double]::IsNaN($x)-or[double]::IsNaN($y)-or$w-le 0-or$hh-le 0){return $null}return @([int]$x,[int]$y,[int]$w,[int]$hh)};function V($el){try{$p=$el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern);if($p -ne $null){$s=[string]$p.Current.Value;if($s -ne ''){return $s}}}catch{};try{$t=$el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern);if($t -ne $null){return [string]$t.Current.ToggleState}}catch{};return ''};function W($el,$d){if($nodes.Count -ge $maxN -or $d -gt $maxD){return}try{$nm=[string]$el.Current.Name}catch{$nm=''};try{$tp=[string]$el.Current.ControlType.ProgrammaticName}catch{$tp=''};$tp=$tp -replace '^ControlType\\.','';try{$en=[bool]$el.Current.IsEnabled}catch{$en=$true};$rc=$null;try{$rc=R($el.Current.BoundingRectangle)}catch{};$vl=V($el);if($nm -ne '' -or $vl -ne '' -or $keep -contains $tp -or $d -le 1){$nodes.Add([pscustomobject]@{n=$nm;t=$tp;r=$rc;e=$en;v=$vl;d=$d})};if($d -ge $maxD -or $nodes.Count -ge $maxN){return};try{$c=$wk.GetFirstChild($el)}catch{$c=$null};while($c -ne $null -and $nodes.Count -lt $maxN){W $c ($d+1);try{$c=$wk.GetNextSibling($c)}catch{$c=$null}}};W $root 0;$win=@{title='';pid=0;app='';x=0;y=0;width=0;height=0};try{$win.title=[string]$root.Current.Name}catch{};try{$win.pid=[int]$root.Current.ProcessId}catch{};if($win.pid -gt 0){try{$win.app=[string](Get-Process -Id $win.pid -ErrorAction Stop).ProcessName}catch{}};try{$wr=R($root.Current.BoundingRectangle);if($wr -ne $null){$win.x=$wr[0];$win.y=$wr[1];$win.width=$wr[2];$win.height=$wr[3]}}catch{};@{window=$win;nodes=$nodes}|ConvertTo-Json -Compress -Depth 4`;
}

function rectOfArr(r) {
  if (!Array.isArray(r) || r.length < 4) return null;
  const [x, y, w, h] = r.map(Number);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  if (w <= 0 || h <= 0) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
}

/**
 * Parse UIA script output into {window, nodes} with e-ids. Total: garbage
 * in → {window: null, nodes: []} (the executor notes the failure). Pure.
 */
export function parseUiaTree(text, cap = OBSERVE_MAX_NODES) {
  const empty = { window: null, nodes: [] };
  let j;
  try {
    j = JSON.parse(String(text));
  } catch {
    return empty;
  }
  if (!j || typeof j !== "object") return empty;
  const w = j.window && typeof j.window === "object" ? j.window : null;
  const window = w
    ? {
        title: String(w.title ?? ""),
        pid: Number.isFinite(Number(w.pid)) && Number(w.pid) > 0 ? Math.round(Number(w.pid)) : null,
        app: w.app ? String(w.app) : null,
        bounds:
          Number(w.width) > 0 && Number(w.height) > 0
            ? {
                x: Math.round(Number(w.x) || 0),
                y: Math.round(Number(w.y) || 0),
                width: Math.round(Number(w.width) || 0),
                height: Math.round(Number(w.height) || 0),
              }
            : null,
      }
    : null;
  const raw = Array.isArray(j.nodes) ? j.nodes : [];
  const nodes = raw.slice(0, Math.max(0, cap)).map((n, i) => ({
    id: `e${i + 1}`,
    name: String(n?.n ?? "").slice(0, OBSERVE_MAX_TEXT),
    role: (String(n?.t ?? "").slice(0, 40) || "Unknown"),
    bounds: rectOfArr(n?.r),
    enabled: n?.e !== false,
    ...(n?.v ? { value: String(n.v).slice(0, OBSERVE_MAX_TEXT) } : {}),
    depth: Math.max(0, Math.min(99, Math.round(Number(n?.d) || 0))),
  }));
  return { window, nodes };
}

/* ── darwin: AX tree script ──────────────────────────────────────────────── */

/**
 * osascript AX walk of the front window. Emits tab-separated lines:
 *   SOPHIA-WINDOW <app> <pid> <title> <x> <y> <w> <h>   (POINTS)
 *   SOPHIA-NODE <depth> <role> <name> <value> <x> <y> <w> <h> <enabled>
 * Coordinates are AppKit points — the parser scales them to physical.
 * Pure builder.
 */
export function darwinAxScript(maxNodes = 120, maxDepth = 6) {
  const maxN = Math.max(10, Math.min(500, Math.round(Number(maxNodes) || 120)));
  const maxD = Math.max(1, Math.min(12, Math.round(Number(maxDepth) || 6)));
  return `global gOut, gN
on clean(t)
  set AppleScript's text item delimiters to {tab, return, linefeed}
  set parts to text items of (t as string)
  set AppleScript's text item delimiters to {" "}
  return (parts as string)
end clean
on run
  set gOut to {}
  set gN to 0
  tell application "System Events"
    try
      set p to first application process whose frontmost is true
    on error
      return "SOPHIA-WINDOW" & tab & "" & tab & "0" & tab & "" & tab & "0" & tab & "0" & tab & "0" & tab & "0"
    end try
    set appName to my clean(name of p)
    set pidV to 0
    try
      set pidV to unix id of p
    end try
    set wTitle to ""
    set wx to 0
    set wy to 0
    set ww to 0
    set wh to 0
    try
      set fw to front window of p
      set wTitle to my clean(name of fw)
      set pos to position of fw
      set sz to size of fw
      set wx to item 1 of pos
      set wy to item 2 of pos
      set ww to item 1 of sz
      set wh to item 2 of sz
      my walk(fw, 0)
    end try
    set end of gOut to ("SOPHIA-WINDOW" & tab & appName & tab & pidV & tab & wTitle & tab & wx & tab & wy & tab & ww & tab & wh)
  end tell
  set AppleScript's text item delimiters to {return}
  return (gOut as string)
end run
on walk(e, d)
  global gOut, gN
  if gN ≥ ${maxN} or d > ${maxD} then return
  tell application "System Events"
    try
      set r to my clean(class of e as string)
      set nm to ""
      try
        set nm to my clean(name of e)
      end try
      set vv to ""
      try
        set vv to my clean(value of e)
      end try
      set en to true
      try
        set en to (value of attribute "AXEnabled" of e)
      end try
      set px to 0
      set py to 0
      set pw to 0
      set ph to 0
      try
        set pos to position of e
        set sz to size of e
        set px to item 1 of pos
        set py to item 2 of pos
        set pw to item 1 of sz
        set ph to item 2 of sz
      end try
      if nm ≠ "" or vv ≠ "" or d ≤ 1 or r is in {"button", "checkbox", "radio button", "text field", "text area", "combo box", "pop up button", "menu item", "menu button", "link", "tab group", "scroll bar", "slider"} then
        set end of gOut to ("SOPHIA-NODE" & tab & d & tab & r & tab & nm & tab & vv & tab & px & tab & py & tab & pw & tab & ph & tab & en)
        set gN to gN + 1
      end if
      if d < ${maxD} and gN < ${maxN} then
        repeat with c in (UI elements of e)
          my walk(c, d + 1)
        end repeat
      end if
    end try
  end tell
end walk`;
}

/** AppleScript class names → UIA-ish roles. Pure. */
export function axRoleToUiRole(role) {
  const map = {
    "button": "Button",
    "checkbox": "CheckBox",
    "radio button": "RadioButton",
    "static text": "Text",
    "text field": "Edit",
    "text area": "Document",
    "combo box": "ComboBox",
    "pop up button": "ComboBox",
    "menu item": "MenuItem",
    "menu button": "Button",
    "menu": "Menu",
    "link": "Hyperlink",
    "image": "Image",
    "tab group": "Tab",
    "scroll area": "Pane",
    "scroll bar": "ScrollBar",
    "slider": "Slider",
    "window": "Window",
    "sheet": "Window",
    "drawer": "Pane",
    "splitter": "Separator",
    "outline": "Tree",
    "table": "Table",
    "list": "List",
    "toolbar": "ToolBar",
  };
  const k = String(role ?? "").trim().toLowerCase();
  if (map[k]) return map[k];
  const pretty = k.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join("");
  return (pretty || "Unknown").slice(0, 40);
}

/**
 * Parse AX script output. Points → physical via `scale` (backing factor).
 * Total: garbage in → {window: null, nodes: []}. Pure.
 */
export function parseAxTree(text, scale = 1, cap = OBSERVE_MAX_NODES) {
  const s = Number(scale) > 0 ? Number(scale) : 1;
  const toPhys = (v) => Math.round(Number(v) * s);
  let window = null;
  const nodes = [];
  for (const line of String(text ?? "").split("\n")) {
    const cells = line.split("\t");
    if (cells[0] === "SOPHIA-WINDOW") {
      const [, app, pid, title, x, y, w, h] = cells;
      const bw = toPhys(w);
      const bh = toPhys(h);
      window = {
        title: String(title ?? ""),
        pid: Number.isFinite(Number(pid)) && Number(pid) > 0 ? Math.round(Number(pid)) : null,
        app: app ? String(app) : null,
        bounds:
          bw > 0 && bh > 0
            ? { x: toPhys(x), y: toPhys(y), width: bw, height: bh }
            : null,
      };
    } else if (cells[0] === "SOPHIA-NODE" && nodes.length < cap) {
      const [, depth, role, name, value, x, y, w, h, enabled] = cells;
      const bw = toPhys(w);
      const bh = toPhys(h);
      nodes.push({
        id: `e${nodes.length + 1}`,
        name: String(name ?? "").slice(0, OBSERVE_MAX_TEXT),
        role: axRoleToUiRole(role),
        bounds:
          bw > 0 && bh > 0
            ? { x: toPhys(x), y: toPhys(y), width: bw, height: bh }
            : null,
        enabled: String(enabled ?? "").trim().toLowerCase() !== "false",
        ...(value ? { value: String(value).slice(0, OBSERVE_MAX_TEXT) } : {}),
        depth: Math.max(0, Math.min(99, Math.round(Number(depth) || 0))),
      });
    }
  }
  return { window, nodes };
}

/* ── linux: shot tools ───────────────────────────────────────────────────── */

export const LINUX_SHOT_TOOLS = [
  { cmd: "gnome-screenshot", args: (f) => ["-f", f] },
  { cmd: "scrot", args: (f) => [f] },
  { cmd: "import", args: (f) => ["-window", "root", f] },
];
export const LINUX_TREE_NOTE = "unsupported on linux (no UIA/AX bridge)";

/** ImageMagick resize to maxEdge (longest side), PNG out. Pure. */
export function linuxResizeArgs(inFile, outFile, maxEdge = OBSERVE_MAX_EDGE) {
  const edge = Math.max(64, Math.round(Number(maxEdge) || OBSERVE_MAX_EDGE));
  return [inFile, "-resize", `${edge}x${edge}>`, outFile];
}

/** Parse `xdotool getwindowgeometry` (Position + Geometry lines). Pure. */
export function parseXGeometry(text) {
  const pos = String(text).match(/Position:\s*(-?\d+)\s*,\s*(-?\d+)/);
  const geo = String(text).match(/Geometry:\s*(\d+)x(\d+)/);
  if (!pos || !geo) return null;
  return {
    x: Number(pos[1]),
    y: Number(pos[2]),
    width: Number(geo[1]),
    height: Number(geo[2]),
  };
}

/* ── executors ───────────────────────────────────────────────────────────── */

function settled(promise) {
  return promise.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );
}

function errText(err) {
  const m = err && (err.message || err);
  return String(m).split("\n")[0].slice(0, 200);
}

function shapeObserve({ shot, window, nodes, treeSource, notes }) {
  return {
    screenshot_b64: shot ? shot.b64 : null,
    mime: shot ? shot.mime : null,
    scale: shot ? shot.scale : null,
    shot: shot ? shot.shot : null,
    screen: shot ? shot.screen : null,
    active_window: window || { title: "", pid: null, app: null, bounds: null },
    ui_tree: nodes,
    tree_source: treeSource,
    notes,
  };
}

async function observeWindows(d, notes) {
  const useNative = await d.native.ready().catch(() => false);
  const treeJob = (async () => {
    const out = await d.run("powershell", ["-NoProfile", "-Command", uiaTreeScript()]);
    return parseUiaTree(out);
  })();
  let shotR;
  let treeR;
  let winR;
  if (useNative) {
    const shotJob = (async () => {
      const cap = await d.native.capture();
      const s = shotFromBgra32(cap.bgra, cap.w, cap.h);
      return {
        ...s,
        screen: {
          width: cap.w,
          height: cap.h,
          offsetX: cap.metrics.offsetX,
          offsetY: cap.metrics.offsetY,
        },
      };
    })();
    const winJob = (async () => {
      const wins = await d.native.windows();
      const active = wins.find((w) => w.active) || wins.find((w) => w.visible && w.title);
      if (!active) return null;
      return {
        title: String(active.title || ""),
        pid: Number.isFinite(Number(active.pid)) && Number(active.pid) > 0 ? Number(active.pid) : null,
        app: active.exe ? String(active.exe) : null,
        bounds: active.bounds && active.bounds.width > 0 && active.bounds.height > 0 ? { ...active.bounds } : null,
      };
    })();
    [shotR, treeR, winR] = await Promise.all([settled(shotJob), settled(treeJob), settled(winJob)]);
  } else {
    const shotJob = (async () => {
      const out = await d.run("powershell", ["-NoProfile", "-Command", winShotScript()]);
      return parseWinShot(out);
    })();
    [shotR, treeR] = await Promise.all([settled(shotJob), settled(treeJob)]);
    // Legacy: the foreground window rides the same UIA probe (no extra spawn).
    winR = treeR.ok && treeR.value.window
      ? { ok: true, value: treeR.value.window }
      : { ok: false, error: new Error("same UIA probe failed") };
  }
  const shot = shotR.ok ? shotR.value : null;
  if (!shot) notes.push(`screenshot: ${errText(shotR.error)}`);
  const tree = treeR.ok ? treeR.value : { window: null, nodes: [] };
  if (!treeR.ok) notes.push(`ui_tree: ${errText(treeR.error)}`);
  const window = winR.ok ? winR.value : null;
  if (!window) notes.push(`active_window: ${errText(winR.error)}`);
  if (!shot && !window && tree.nodes.length === 0) {
    throw new Error(`observe: ${notes.join("; ")}`);
  }
  return shapeObserve({
    shot,
    window,
    nodes: tree.nodes,
    treeSource: treeR.ok ? "uia" : "failed",
    notes,
  });
}

async function observeDarwin(d, notes) {
  const scale = Number(d.metrics?.scaleX) > 0 ? Number(d.metrics.scaleX) : 1;
  const shotJob = (async () => {
    const tmp = d.tmpName("png");
    try {
      await d.run("screencapture", ["-x", "-t", "png", tmp]);
      const physDims = parsePngDims(await d.readFile(tmp));
      if (!physDims) throw new Error("screencapture produced no PNG");
      await d.run("sips", ["-Z", String(OBSERVE_MAX_EDGE), tmp]);
      const buf = await d.readFile(tmp);
      const shotDims = parsePngDims(buf);
      if (!shotDims) throw new Error("sips produced no PNG");
      return {
        b64: buf.toString("base64"),
        mime: "image/png",
        scale: shotDims.width / physDims.width,
        shot: shotDims,
        screen: { width: physDims.width, height: physDims.height, offsetX: 0, offsetY: 0 },
      };
    } finally {
      await d.unlink(tmp);
    }
  })();
  const treeJob = (async () => {
    const out = await d.run("osascript", ["-e", darwinAxScript()]);
    return parseAxTree(out, scale);
  })();
  const [shotR, treeR] = await Promise.all([settled(shotJob), settled(treeJob)]);
  const shot = shotR.ok ? shotR.value : null;
  if (!shot) notes.push(`screenshot: ${errText(shotR.error)}`);
  const tree = treeR.ok ? treeR.value : { window: null, nodes: [] };
  if (!treeR.ok) notes.push(`ui_tree: ${errText(treeR.error)}`);
  const window = tree.window;
  if (!window) notes.push("active_window: same AX probe returned no window");
  if (!shot && !window && tree.nodes.length === 0) throw new Error(`observe: ${notes.join("; ")}`);
  return shapeObserve({ shot, window, nodes: tree.nodes, treeSource: treeR.ok ? "ax" : "failed", notes });
}

async function observeLinux(d, notes) {
  const shotJob = (async () => {
    const errs = [];
    for (const tool of LINUX_SHOT_TOOLS) {
      const tmp = d.tmpName("png");
      try {
        await d.run(tool.cmd, tool.args(tmp));
      } catch (err) {
        errs.push(`${tool.cmd}: ${errText(err)}`);
        await d.unlink(tmp);
        continue;
      }
      try {
        const physDims = parsePngDims(await d.readFile(tmp));
        if (!physDims) throw new Error("no PNG produced");
        // Resize when ImageMagick is around; otherwise ship full-size.
        const out = d.tmpName("png");
        let buf = null;
        let shotDims = physDims;
        let resized = false;
        for (const conv of ["convert", "magick"]) {
          try {
            await d.run(conv, linuxResizeArgs(tmp, out));
            buf = await d.readFile(out);
            const rd = parsePngDims(buf);
            if (rd) {
              shotDims = rd;
              resized = true;
            } else {
              buf = null;
            }
            break;
          } catch {
            buf = null;
          } finally {
            await d.unlink(out);
          }
        }
        if (!buf) {
          buf = await d.readFile(tmp);
          shotDims = parsePngDims(buf) || physDims;
        }
        if (!resized && Math.max(shotDims.width, shotDims.height) > OBSERVE_MAX_EDGE) {
          notes.push("screenshot: unscaled (no ImageMagick convert)");
        }
        return {
          b64: buf.toString("base64"),
          mime: "image/png",
          scale: shotDims.width / physDims.width,
          shot: shotDims,
          screen: { width: physDims.width, height: physDims.height, offsetX: 0, offsetY: 0 },
        };
      } finally {
        await d.unlink(tmp);
      }
    }
    throw new Error(errs.length ? errs.join("; ") : "no screenshot tool");
  })();
  const winJob = (async () => {
    const title = (await d.run("xdotool", ["getactivewindow", "getwindowname"])).trim();
    let bounds = null;
    try {
      bounds = parseXGeometry(await d.run("xdotool", ["getactivewindow", "getwindowgeometry"]));
    } catch {
      // Title still counts.
    }
    return { title, pid: null, app: null, bounds };
  })();
  const [shotR, winR] = await Promise.all([settled(shotJob), settled(winJob)]);
  const shot = shotR.ok ? shotR.value : null;
  if (!shot) notes.push(`screenshot: ${errText(shotR.error)}`);
  const window = winR.ok ? winR.value : null;
  if (!window) notes.push(`active_window: ${errText(winR.error)}`);
  notes.push(`ui_tree: ${LINUX_TREE_NOTE}`);
  if (!shot && !window) throw new Error(`observe: ${notes.join("; ")}`);
  return shapeObserve({ shot, window, nodes: [], treeSource: "unsupported", notes });
}

/**
 * observe {} → screenshot + active window + UI tree (see header).
 * `deps` injects platform/runners for tests; production omits it (the
 * system.mjs caller passes cached display metrics for AX scaling).
 */
export async function observeAction(_a = {}, deps = {}) {
  const notes = [];
  const d = {
    platform: deps.platform ?? platform(),
    metrics: deps.metrics ?? null,
    run: deps.run ?? run,
    readFile: deps.readFile ?? ((p) => fs.readFile(p)),
    unlink: deps.unlink ?? ((p) => fs.unlink(p).catch(() => {})),
    tmpName: deps.tmpName ?? tmpName,
    native: deps.native ?? { ready: win32NativeReady, capture: nativeCaptureBgra, windows: nativeWindows },
  };
  if (d.platform === "win32") return observeWindows(d, notes);
  if (d.platform === "darwin") return observeDarwin(d, notes);
  if (d.platform === "linux") return observeLinux(d, notes);
  throw new Error(`observe: unsupported platform ${d.platform}`);
}
