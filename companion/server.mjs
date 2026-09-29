/**
 * companion/server.mjs — Sofia's local daemon.
 *
 * Binds 127.0.0.1 ONLY. Every socket must pair with the printed token:
 *
 *     client → {"type":"hello","token":TOKEN}
 *     daemon → {"type":"welcome"}
 *     client → {"type":"action","id":7,"action":"ping","args":{}}
 *     daemon → {"type":"result","id":7,"ok":true,"result":{...}}
 *
 * Wrong token → close 4003. No hello within 5s → close 4001.
 */
import { WebSocketServer } from "ws";
import { randomBytes } from "node:crypto";
import { platform, homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { SafetyPolicy, ACTIONS, appAllowed, urlAllowed } from "./policy.mjs";
import { storeAction } from "./store.mjs";
import { episodesAction } from "./episodes.mjs";
import { filesAction } from "./files.mjs";
import { healthAction } from "./health.mjs";
import { groundAction } from "./ground.mjs";
import { voiceAction } from "./voice.mjs";
import { mediaAction } from "./media.mjs";
import { systemAction } from "./system.mjs";
import { browserAction } from "./browser.mjs";

const PORT = Number(process.env.SOPHIA_COMPANION_PORT || 7788);
const TOKEN = process.env.SOPHIA_COMPANION_TOKEN || randomBytes(12).toString("base64url");
const STEP_BUDGET = Number(process.env.SOPHIA_COMPANION_STEP_BUDGET || 40);
const DATA_DIR = process.env.SOPHIA_DATA_DIR || join(homedir(), ".sophia");
const ORIGINS = new Set([
  "http://localhost", "http://127.0.0.1",
  ...(process.env.SOPHIA_COMPANION_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
]);
mkdirSync(DATA_DIR, { recursive: true });

const policy = new SafetyPolicy({ logDir: DATA_DIR, stepBudget: STEP_BUDGET });
const filesRoots = (process.env.SOPHIA_FILES_ROOTS || "").split(",").map((s) => s.trim()).filter(Boolean);

function originAllowed(origin) {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    const host = `${u.protocol}//${u.hostname}`;
    if (ORIGINS.has(host)) return true;
    return u.hostname === "localhost" || u.hostname === "127.0.0.1" ||
      u.hostname.endsWith(".grok.me") || u.hostname.endsWith(".e2b.app");
  } catch { return false; }
}

async function perform(action, a = {}) {
  switch (action) {
    case "ping": return { pong: true, platform: platform(), ts: Date.now(), version: "1.0.0" };
    case "abort": policy.abort(); return { aborted: true };
    case "resume": policy.resume(); return { resumed: true };
    case "skills_list": return { skills: [...ACTIONS].sort() };

    // system / computer control
    case "open_url":
      if (!urlAllowed(a.url)) throw new Error("Only http(s) URLs are allowed.");
      return systemAction(action, a);
    case "open_app":
      if (!appAllowed(platform(), a.app)) throw new Error(`App "${a.app}" is not on the allowlist.`);
      return systemAction(action, a);
    case "notify": case "screenshot":
    case "click": case "double_click": case "right_click": case "move_mouse":
    case "scroll": case "type_text": case "hotkey": case "drag":
    case "get_cursor": case "get_active_window":
      return systemAction(action, a);

    // browser (DOM-level)
    case "browser_navigate": case "browser_open_read": case "browser_click_text": case "browser_type":
      return browserAction(action, a);

    // files
    case "files_roots": case "files_list": case "files_find": case "files_read":
    case "files_open": case "files_move": case "files_trash": case "files_restore":
      return filesAction(action, a, { roots: filesRoots });

    // memory
    case "store_get": case "store_put": case "store_keys": case "store_delete":
      return storeAction(action, a, DATA_DIR);
    case "episodes_add": case "episodes_search": case "episodes_recent":
      return episodesAction(action, a, DATA_DIR);

    // health & media
    case "health_snapshot": case "health_processes":
      return healthAction(action, a);
    case "media_control": case "media_status":
      return mediaAction(action, a);

    // whatsapp (needs playwright-core + your own Chrome profile)
    case "whatsapp_open": case "whatsapp_draft": case "whatsapp_send": case "whatsapp_unread":
      throw new Error("WhatsApp needs playwright-core installed and your Chrome profile configured.");

    // OCR grounding
    case "ground_text": case "ground_ocr":
      return groundAction(action, a);

    // airplane-mode local voice
    case "voice_info": case "tts_local": case "stt_local":
      return voiceAction(action, a);

    default: throw new Error(`No handler for action ${action}`);
  }
}

/* ── mouse-corner kill switch ─────────────────────────────────────────────── */
let cornerTimer = null;
async function watchCorner() {
  try {
    const cur = await systemAction("get_cursor", {});
    if (cur && typeof cur.x === "number" && cur.x <= 2 && cur.y <= 2 && !policy.aborted) {
      policy.abort();
      console.log("[companion] kill switch: mouse hit top-left corner");
    }
  } catch { /* cursor read can fail on headless; ignore */ }
}

/* ── server ───────────────────────────────────────────────────────────────── */
const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });

wss.on("connection", (ws, req) => {
  const origin = req.headers.origin;
  if (origin && !originAllowed(origin)) {
    console.warn(`[companion] rejected origin ${origin}`);
    ws.close(4002, "origin not allowed");
    return;
  }
  let paired = false;
  const pairTimeout = setTimeout(() => { if (!paired) ws.close(4001, "pairing timeout"); }, 5000);

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (!paired) {
      if (msg.type === "hello") {
        if (msg.token === TOKEN) {
          paired = true;
          clearTimeout(pairTimeout);
          ws.send(JSON.stringify({ type: "welcome", actions: [...ACTIONS].length }));
        } else {
          ws.close(4003, "bad token");
        }
      }
      return;
    }

    if (msg.type === "action") {
      const { id, action, args = {} } = msg;
      const verdict = policy.check(action, args);
      if (!verdict.allow) {
        ws.send(JSON.stringify({ type: "result", id, ok: false, error: verdict.error, detail: verdict.detail, needsConfirmation: verdict.needsConfirmation || undefined }));
        await policy.log({ action, ok: false, error: verdict.error });
        return;
      }
      try {
        const result = await perform(action, args);
        ws.send(JSON.stringify({ type: "result", id, ok: true, result }));
        await policy.log({ action, ok: true });
      } catch (err) {
        ws.send(JSON.stringify({ type: "result", id, ok: false, error: "action_failed", detail: err?.message || String(err) }));
        await policy.log({ action, ok: false, error: err?.message });
      }
    }
  });

  ws.on("close", () => clearTimeout(pairTimeout));
});

wss.on("listening", () => {
  console.log("╭──────────────────────────────────────────────╮");
  console.log("│  Sofia Companion — local daemon               │");
  console.log(`│  ws://127.0.0.1:${PORT}                        │`);
  console.log(`│  pairing code: ${TOKEN}`);
  console.log("╰──────────────────────────────────────────────╯");
  cornerTimer = setInterval(watchCorner, 1500);
});

process.on("SIGINT", () => { console.log("\n[companion] kill switch (Ctrl+C) — bye"); clearInterval(cornerTimer); wss.close(() => process.exit(0)); });
process.on("SIGTERM", () => { clearInterval(cornerTimer); wss.close(() => process.exit(0)); });
