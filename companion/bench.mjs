/**
 * companion/bench.mjs — native input latency probe (win32 + koffi only).
 *
 * Default measures NON-INTRUSIVE ops (cursor reads, no-op moves, window
 * enumeration, metrics, focused title, screenshots to tmp). Pass
 * --intrusive to also measure clicks at the CURRENT cursor position and
 * typing (12 chars go to the FOCUSED app!) after a 5s countdown.
 *
 * Budget: p95 < 50ms per click/type. Always exits 0 (informational).
 */
import { platform, tmpdir } from "node:os";
import { join } from "node:path";

const BUDGET_MS = Number(process.env.SOPHIA_BENCH_BUDGET_MS || 50);
const INTRUSIVE = process.argv.includes("--intrusive");

function stats(name, samples) {
  const s = [...samples].sort((a, b) => a - b);
  const avg = s.reduce((x, y) => x + y, 0) / s.length;
  const p95 = s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
  const max = s[s.length - 1];
  const verdict = p95 < BUDGET_MS ? "PASS" : "FAIL";
  console.log(`${verdict} ${name}: n=${s.length} avg=${avg.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms (budget p95<${BUDGET_MS}ms)`);
}

async function measure(fn, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fn(i);
    out.push(performance.now() - t0);
  }
  return out;
}

async function main() {
  if (platform() !== "win32") {
    console.log("bench: win32 only — skip");
    return;
  }
  const { win32NativeReady, nativeSystemAction, nativeFocusedText, nativeMetrics } =
    await import("./win32.mjs");
  if (!(await win32NativeReady())) {
    console.log("bench: native backend unavailable (npm install koffi?) — skip");
    return;
  }
  console.log("bench: native win32 backend");

  // Warm up (first FFI calls + DPI init are slower).
  await nativeSystemAction("get_cursor");

  const cur = await nativeSystemAction("get_cursor");
  stats("get_cursor", await measure(() => nativeSystemAction("get_cursor"), 100));
  stats("move_mouse (no-op)", await measure(
    () => nativeSystemAction("move_mouse", { x: cur.x, y: cur.y }), 50));
  stats("get_active_window", await measure(() => nativeSystemAction("get_active_window"), 30));
  stats("get_active_window {list}", await measure(
    () => nativeSystemAction("get_active_window", { list: true }), 20));
  stats("focused title", await measure(() => nativeFocusedText(), 30));
  stats("metrics", await measure(() => nativeMetrics(), 30));
  const shot = join(tmpdir(), `sophia-bench-${Date.now()}.bmp`);
  stats("screenshot", await measure(() => nativeSystemAction("screenshot", { path: shot }), 3));

  if (!INTRUSIVE) {
    console.log("bench: pass --intrusive to also measure click/type (acts on YOUR cursor + focused app!)");
    return;
  }
  console.log("bench: INTRUSIVE mode — clicking + typing in 5s (Ctrl+C to abort)…");
  await new Promise((r) => setTimeout(r, 5000));
  stats("click (current pos)", await measure(() => nativeSystemAction("click"), 20));
  stats("type_text (12 chars)", await measure(
    () => nativeSystemAction("type_text", { text: "bench-012345" }), 10));
  console.log("bench: done (you may want to delete the typed text +", shot + ")");
}

await main();
