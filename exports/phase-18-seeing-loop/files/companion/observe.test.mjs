import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import {
  OBSERVE_MAX_EDGE, OBSERVE_MAX_NODES,
  shotSizeFor, downscaleBgra32, crc32, pngFromRgb24, parsePngDims, shotFromBgra32,
  winShotScript, parseWinShot, uiaTreeScript, parseUiaTree,
  darwinAxScript, axRoleToUiRole, parseAxTree,
  linuxResizeArgs, parseXGeometry, LINUX_TREE_NOTE,
  observeAction,
} from "./observe.mjs";

/* ── shot geometry ───────────────────────────────────────────────────────── */

test("shotSizeFor caps the long edge at 1568, never upscales", () => {
  assert.equal(OBSERVE_MAX_EDGE, 1568);
  const land = shotSizeFor(3840, 2160);
  assert.equal(land.width, 1568);
  assert.equal(land.height, 882);
  assert.ok(Math.abs(land.scale - 1568 / 3840) < 1e-9);
  const port = shotSizeFor(1080, 2400);
  assert.equal(port.height, 1568);
  assert.equal(port.width, 706); // 1080 * 1568/2400 = 705.6 → 706
  const small = shotSizeFor(800, 600);
  assert.deepEqual(small, { width: 800, height: 600, scale: 1 });
  const edge = shotSizeFor(1568, 1568);
  assert.equal(edge.scale, 1);
});

/* ── pixels ──────────────────────────────────────────────────────────────── */

test("downscaleBgra32 averages source blocks", () => {
  // 2x2 BGRA: red, green / blue, white → 1x1 mean
  const src = Buffer.from([0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255]);
  const out = downscaleBgra32(src, 2, 2, 1, 1);
  assert.deepEqual([...out], [128, 128, 128]);
  // identity size keeps pixels (as RGB)
  const same = downscaleBgra32(src, 2, 2, 2, 2);
  assert.deepEqual([...same], [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
});

test("crc32 matches the standard vector", () => {
  assert.equal(crc32(Buffer.from("123456789", "ascii")), 0xcbf43926);
});

test("pngFromRgb24 emits a decodable PNG", () => {
  const rgb = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
  const png = pngFromRgb24(2, 2, rgb);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 2);
  assert.equal(png.readUInt32BE(20), 2);
  // IDAT follows the 25-byte IHDR chunk; inflate must restore scanlines.
  const idatLen = png.readUInt32BE(33);
  assert.equal(png.subarray(37, 41).toString("ascii"), "IDAT");
  const raw = inflateSync(png.subarray(41, 41 + idatLen));
  assert.equal(raw.length, 2 * (1 + 2 * 3));
  assert.equal(raw[0], 0); // filter byte, row 0
  assert.deepEqual([...raw.subarray(1, 7)], [255, 0, 0, 0, 255, 0]);
  assert.deepEqual([...raw.subarray(8, 14)], [0, 0, 255, 255, 255, 255]);
});

test("parsePngDims round-trips and rejects garbage", () => {
  const png = pngFromRgb24(1568, 1, Buffer.alloc(1568 * 1 * 3));
  assert.deepEqual(parsePngDims(png), { width: 1568, height: 1 });
  assert.equal(parsePngDims(Buffer.from("not a png")), null);
  assert.equal(parsePngDims(Buffer.alloc(0)), null);
});

test("shotFromBgra32 composes size + pixels + base64", () => {
  const bgra = Buffer.alloc(4 * 2 * 4, 128);
  const s = shotFromBgra32(bgra, 4, 2);
  assert.equal(s.mime, "image/png");
  assert.equal(s.scale, 1);
  assert.deepEqual(s.shot, { width: 4, height: 2 });
  const raw = Buffer.from(s.b64, "base64");
  assert.deepEqual([...raw.subarray(0, 4)], [137, 80, 78, 71]);
  const big = shotFromBgra32(Buffer.alloc(4000 * 10 * 4), 4000, 10);
  assert.equal(big.shot.width, 1568);
  assert.ok(big.scale < 1);
});

/* ── win32 scripts + parsers ─────────────────────────────────────────────── */

test("winShotScript captures, rescales and base64s in one spawn", () => {
  const s = winShotScript();
  assert.match(s, /CopyFromScreen/);
  assert.match(s, /1568/);
  assert.match(s, /ToBase64String/);
  assert.match(s, /ImageFormat\]::Png/);
  assert.match(s, /ConvertTo-Json -Compress/);
  assert.match(winShotScript(800), /800/);
});

test("parseWinShot recomputes scale from dims", () => {
  const j = JSON.stringify({
    b64: "iVBOR".padEnd(200, "A"), mime: "image/png",
    shotW: 1568, shotH: 882, physW: 3840, physH: 2160, offX: -1920, offY: 0,
  });
  const s = parseWinShot(j);
  assert.equal(s.mime, "image/png");
  assert.ok(Math.abs(s.scale - 1568 / 3840) < 1e-9);
  assert.deepEqual(s.shot, { width: 1568, height: 882 });
  assert.deepEqual(s.screen, { width: 3840, height: 2160, offsetX: -1920, offsetY: 0 });
  assert.throws(() => parseWinShot("nope"), /not JSON/);
  assert.throws(() => parseWinShot("{}"), /missing pixels/);
});

test("uiaTreeScript walks the foreground window via UIA", () => {
  const s = uiaTreeScript();
  assert.match(s, /UIAutomationClient/);
  assert.match(s, /ControlViewWalker/);
  assert.match(s, /GetForegroundWindow/);
  assert.match(s, /ProcessName/);
  assert.match(s, /\$maxN=150/);
  assert.match(s, /\$maxD=7/);
  assert.match(uiaTreeScript(50, 4), /\$maxN=50/);
});

test("parseUiaTree assigns e-ids, truncates, tolerates garbage", () => {
  const j = JSON.stringify({
    window: { title: "Mail", pid: 42, app: "outlook", x: 0, y: 0, width: 800, height: 600 },
    nodes: [
      { n: "Send", t: "ControlType.Button", r: [10, 20, 60, 24], e: true, v: "", d: 3 },
      { n: "x".repeat(200), t: "Edit", r: [0, 0, 100, 20], e: false, v: "y".repeat(200), d: 4 },
      { n: "", t: "Pane", r: null, e: true, v: "", d: 1 },
    ],
  });
  const { window, nodes } = parseUiaTree(j);
  assert.deepEqual(window, {
    title: "Mail", pid: 42, app: "outlook",
    bounds: { x: 0, y: 0, width: 800, height: 600 },
  });
  assert.equal(nodes.length, 3);
  assert.equal(nodes[0].id, "e1");
  assert.equal(nodes[0].role, "ControlType.Button");
  assert.deepEqual(nodes[0].bounds, { x: 10, y: 20, width: 60, height: 24 });
  assert.equal(nodes[0].enabled, true);
  assert.ok(!("value" in nodes[0]));
  assert.equal(nodes[1].name.length, 80);
  assert.equal(nodes[1].value.length, 80);
  assert.equal(nodes[1].enabled, false);
  assert.equal(nodes[2].bounds, null);
  assert.deepEqual(parseUiaTree("garbage"), { window: null, nodes: [] });
  assert.deepEqual(parseUiaTree("{}").nodes, []);
  const capped = parseUiaTree(JSON.stringify({ nodes: Array.from({ length: 300 }, () => ({})) }));
  assert.equal(capped.nodes.length, OBSERVE_MAX_NODES);
});

/* ── darwin scripts + parsers ────────────────────────────────────────────── */

test("darwinAxScript walks frontmost via System Events", () => {
  const s = darwinAxScript();
  assert.match(s, /System Events/);
  assert.match(s, /frontmost is true/);
  assert.match(s, /SOPHIA-WINDOW/);
  assert.match(s, /SOPHIA-NODE/);
  assert.match(s, /AXEnabled/);
});

test("axRoleToUiRole maps AppleScript classes", () => {
  assert.equal(axRoleToUiRole("button"), "Button");
  assert.equal(axRoleToUiRole("static text"), "Text");
  assert.equal(axRoleToUiRole("text field"), "Edit");
  assert.equal(axRoleToUiRole("pop up button"), "ComboBox");
  assert.equal(axRoleToUiRole("menu item"), "MenuItem");
  assert.equal(axRoleToUiRole("weird new thing"), "WeirdNewThing");
  assert.equal(axRoleToUiRole(""), "Unknown");
});

test("parseAxTree scales points to physical pixels", () => {
  const text = [
    "SOPHIA-WINDOW\tSafari\t123\tExample\t0\t0\t400\t300",
    "SOPHIA-NODE\t2\tbutton\tSend\t\t10\t20\t60\t24\ttrue",
    "SOPHIA-NODE\t3\ttext field\t\tquery\t10\t50\t100\t20\tfalse",
  ].join("\n");
  const { window, nodes } = parseAxTree(text, 2);
  assert.deepEqual(window, {
    title: "Example", pid: 123, app: "Safari",
    bounds: { x: 0, y: 0, width: 800, height: 600 },
  });
  assert.equal(nodes[0].id, "e1");
  assert.equal(nodes[0].role, "Button");
  assert.deepEqual(nodes[0].bounds, { x: 20, y: 40, width: 120, height: 48 });
  assert.equal(nodes[1].role, "Edit");
  assert.equal(nodes[1].value, "query");
  assert.equal(nodes[1].enabled, false);
  assert.deepEqual(parseAxTree("nope", 1), { window: null, nodes: [] });
});

/* ── linux bits ──────────────────────────────────────────────────────────── */

test("linux resize args + geometry parser", () => {
  assert.deepEqual(linuxResizeArgs("a.png", "b.png"), ["a.png", "-resize", "1568x1568>", "b.png"]);
  assert.deepEqual(
    parseXGeometry("Window 1\n  Position: -5,10 (screen: 0)\n  Geometry: 800x600\n"),
    { x: -5, y: 10, width: 800, height: 600 },
  );
  assert.equal(parseXGeometry("junk"), null);
  assert.match(LINUX_TREE_NOTE, /unsupported on linux/);
});

/* ── orchestration (injected deps, no real spawns) ───────────────────────── */

const UIA_JSON = JSON.stringify({
  window: { title: "App", pid: 7, app: "app", x: 0, y: 0, width: 100, height: 100 },
  nodes: [{ n: "OK", t: "Button", r: [1, 2, 30, 10], e: true, v: "", d: 2 }],
});

function winShotJson() {
  return JSON.stringify({
    b64: "iVBOR".padEnd(200, "A"), mime: "image/png",
    shotW: 100, shotH: 100, physW: 100, physH: 100, offX: 0, offY: 0,
  });
}

test("observeAction on win32-native composes pixels + windows + UIA", async () => {
  const calls = [];
  const r = await observeAction({}, {
    platform: "win32",
    run: async (cmd) => {
      calls.push(cmd);
      if (cmd === "powershell") return UIA_JSON;
      throw new Error(`unexpected ${cmd}`);
    },
    native: {
      ready: async () => true,
      capture: async () => ({ w: 4, h: 2, bgra: Buffer.alloc(4 * 2 * 4, 200), metrics: { offsetX: -4, offsetY: 0 } }),
      windows: async () => [
        { active: true, title: "App", pid: 7, exe: "app.exe", visible: true, bounds: { x: 0, y: 0, width: 4, height: 2 } },
      ],
    },
  });
  assert.equal(r.mime, "image/png");
  assert.equal(typeof r.screenshot_b64, "string");
  assert.equal(r.scale, 1);
  assert.deepEqual(r.shot, { width: 4, height: 2 });
  assert.deepEqual(r.screen, { width: 4, height: 2, offsetX: -4, offsetY: 0 });
  assert.equal(r.active_window.title, "App");
  assert.equal(r.active_window.app, "app.exe");
  assert.equal(r.tree_source, "uia");
  assert.deepEqual(r.ui_tree.map((n) => n.id), ["e1"]);
  assert.deepEqual(r.notes, []);
  assert.deepEqual(calls, ["powershell"], "one spawn (UIA); pixels + windows zero-spawn");
});

test("observeAction on win32-legacy takes window + tree from one UIA probe", async () => {
  const r = await observeAction({}, {
    platform: "win32",
    run: async (cmd, args) => {
      assert.equal(cmd, "powershell");
      return String(args[2]).includes("CopyFromScreen") ? winShotJson() : UIA_JSON;
    },
    native: { ready: async () => false, capture: async () => { throw new Error("no"); }, windows: async () => [] },
  });
  assert.equal(r.tree_source, "uia");
  assert.equal(r.active_window.title, "App");
  assert.equal(r.active_window.app, "app");
  assert.equal(typeof r.screenshot_b64, "string");
  assert.deepEqual(r.notes, []);
});

test("observeAction on darwin scales AX points and reads sips output", async () => {
  const physPng = pngFromRgb24(2000, 1000, Buffer.alloc(2000 * 1000 * 3, 9));
  const shotPng = pngFromRgb24(1568, 784, Buffer.alloc(1568 * 784 * 3, 9));
  let reads = 0;
  const r = await observeAction({}, {
    platform: "darwin",
    metrics: { scaleX: 2 },
    run: async (cmd) => {
      if (cmd === "screencapture") return "";
      if (cmd === "sips") return "";
      if (cmd === "osascript") {
        return "SOPHIA-WINDOW\tSafari\t1\tT\t0\t0\t100\t100\nSOPHIA-NODE\t1\tbutton\tGo\t\t1\t1\t10\t10\ttrue";
      }
      throw new Error(`unexpected ${cmd}`);
    },
    readFile: async () => (++reads === 1 ? physPng : shotPng),
    unlink: async () => {},
  });
  assert.equal(r.tree_source, "ax");
  assert.equal(r.shot.width, 1568);
  assert.ok(Math.abs(r.scale - 1568 / 2000) < 1e-9);
  assert.equal(r.ui_tree[0].role, "Button");
  assert.equal(r.ui_tree[0].bounds.width, 20, "10pt @2x = 20px");
  assert.deepEqual(r.notes, []);
});

test("observeAction degrades partially and fails closed", async () => {
  // linux: shot tool missing, xdotool missing → everything fails → throw.
  await assert.rejects(
    () => observeAction({}, {
      platform: "linux",
      run: async () => { throw new Error("ENOENT"); },
      readFile: async () => { throw new Error("ENOENT"); },
      unlink: async () => {},
    }),
    /observe: screenshot: .*active_window: .*ui_tree: unsupported/,
  );
  // linux: window works, shot fails → partial result + notes.
  const r = await observeAction({}, {
    platform: "linux",
    run: async (cmd) => {
      if (cmd === "xdotool") return "My App";
      throw new Error("ENOENT");
    },
    readFile: async () => { throw new Error("ENOENT"); },
    unlink: async () => {},
  });
  assert.equal(r.screenshot_b64, null);
  assert.equal(r.active_window.title, "My App");
  assert.equal(r.tree_source, "unsupported");
  assert.deepEqual(r.ui_tree, []);
  assert.ok(r.notes.some((n) => n.startsWith("screenshot:")));
  assert.ok(r.notes.some((n) => n.includes("unsupported on linux")));
});
