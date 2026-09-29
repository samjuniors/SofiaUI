/**
 * companion/ground.mjs — OCR grounding so the Operator finds buttons by their
 * text instead of guessing pixels. Needs the `tesseract` binary; degrades into
 * an install hint when absent.
 *
 *   ground_text {text, screenshot?} → pixel coordinates of on-screen text
 *   ground_ocr  {screenshot?}       → raw word boxes
 */
import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { systemAction } from "./system.mjs";

const run = (cmd, args, timeout = 20000) =>
  new Promise((resolve, reject) => execFile(cmd, args, { timeout, maxBuffer: 20e6 }, (err, out) => (err ? reject(err) : resolve(String(out)))));

async function tesseractAvailable() {
  try { await run(process.platform === "win32" ? "where" : "which", ["tesseract"], 2000); return true; } catch { return false; }
}

async function screenshotTo(file) {
  // Reuse the system screenshot action (returns {path} when saved to file).
  const shot = await systemAction("screenshot", { path: file });
  return shot.path || file;
}

/** Run tesseract TSV on an image; return word boxes. */
async function ocrWords(imagePath) {
  const out = await run("tesseract", [imagePath, "stdout", "--psm", "11", "tsv"]);
  const lines = out.trim().split("\n");
  const header = lines[0].split("\t");
  const li = header.indexOf("left"), ti = header.indexOf("top"), wi = header.indexOf("width"), hi = header.indexOf("height"), tw = header.indexOf("text");
  const words = [];
  for (const l of lines.slice(1)) {
    const c = l.split("\t");
    const text = (c[tw] || "").trim();
    if (!text) continue;
    words.push({ text, x: Number(c[li]), y: Number(c[ti]), w: Number(c[wi]), h: Number(c[hi]) });
  }
  return words;
}

export async function groundAction(action, a = {}) {
  if (!(await tesseractAvailable())) {
    throw new Error("OCR grounding needs tesseract. Install: apt install tesseract-ocr / brew install tesseract / choco install tesseract.");
  }
  const img = a.screenshot ? a.screenshot : join(tmpdir(), `sophia-shot-${Date.now()}.png`);
  let toClean = null;
  if (!a.screenshot) { await screenshotTo(img); toClean = img; }
  try {
    const words = await ocrWords(img);
    if (action === "ground_ocr") return { words, count: words.length };

    // ground_text: find the phrase among the word boxes.
    const target = String(a.text ?? "").toLowerCase().trim();
    if (!target) throw new Error("missing text");
    const phrase = target.split(/\s+/);
    // Build line groups by approximate y, then search for the phrase sequence.
    const byLine = new Map();
    for (const w of words) {
      const key = Math.round(w.y / 12);
      if (!byLine.has(key)) byLine.set(key, []);
      byLine.get(key).push(w);
    }
    for (const line of byLine.values()) {
      line.sort((p, q) => p.x - q.x);
      const joined = line.map((w) => w.text.toLowerCase());
      for (let i = 0; i + phrase.length <= joined.length; i++) {
        if (phrase.every((p, k) => joined[i + k].includes(p) || p.includes(joined[i + k]))) {
          const first = line[i], last = line[i + phrase.length - 1];
          return {
            found: true,
            text: target,
            x: Math.round(first.x + first.w / 2),
            y: Math.round(first.y + first.h / 2),
            box: { x: first.x, y: first.y, w: last.x + last.w - first.x, h: Math.max(first.h, last.h) },
          };
        }
      }
    }
    return { found: false, text: target, hint: "Text not visible on screen." };
  } finally {
    if (toClean) await fs.unlink(toClean).catch(() => {});
  }
}
