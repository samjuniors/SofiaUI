/**
 * companion/server.mjs — Sofia's local daemon.
 *
 * Binds 127.0.0.1 ONLY. HTTP + WebSocket share one port:
 *
 *   GET /healthz   {ok, daemon, ts} (loopback only)
 *   GET /pairing   {code, expires_at, daemon_id, daemon_pubkey}
 *                  (loopback only + browser-origin discipline — this is how
 *                  a same-machine page pairs with zero typing)
 *
 *   client → {"type":"hello","token":TOKEN}                    (installed / legacy)
 *   client → {"type":"hello","pairing_code":"AB12-CD34","device":{...}}
 *   client → {"type":"hello","session":"…","device":{...}}      (reconnect)
 *   daemon → {"type":"welcome","session":"…","scope":"control","expires_at":…}
 *
 * Scopes: `view` (read-only telemetry, default-deny) vs `control`
 * (everything, still SafetyPolicy-gated). Quick-code sessions grant control
 * immediately — reading the code off the PC screen IS the physical-presence
 * approval. View sessions escalate via control_request → a control session
 * approves → a 1-hour grant. Revoked/expired mid-connection → close 4009.
 *
 * Risky actions answer {"ok":false,"error":"confirmation_required",
 * "confirmation_id":"…"}; ONLY the UI/voice-confirm handler redeems it:
 *
 *     client → {"type":"confirm","id":8,"confirmation_id":"…"}
 *     daemon → {"type":"confirmed","id":8,"ok":true,"action":"…"}
 *     client → {"type":"action","id":9,"action":"…","args":{…,"confirmation_id":"…"}}
 *
 * A model-supplied `confirm:true` is ignored. Bad hello → close 4003 (all
 * failures look identical — no oracle). No hello within 5s → close 4001.
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { randomBytes } from "node:crypto";
import { platform, homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { SafetyPolicy, ACTIONS, appAllowed, urlAllowed, summarizeAction } from "./policy.mjs";
import { TrustStore, isViewAction } from "./pairing.mjs";
import { storeAction } from "./store.mjs";
import { episodesAction } from "./episodes.mjs";
import { filesAction } from "./files.mjs";
import { healthAction } from "./health.mjs";
import { groundAction } from "./ground.mjs";
import { voiceAction } from "./voice.mjs";
import { mediaAction } from "./media.mjs";
import { systemAction, targetTextAt } from "./system.mjs";
import { browserAction } from "./browser.mjs";
import { memoryAction } from "../memory/actions.mjs";

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
const trust = new TrustStore(DATA_DIR);
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

function loopback(req) {
  const r = req.socket.remoteAddress ?? "";
  return r === "127.0.0.1" || r === "::1" || r === "::ffff:127.0.0.1";
}

async function perform(action, a = {}) {
  switch (action) {
    case "ping": return { pong: true, platform: platform(), ts: Date.now(), version: "1.0.0" };
    case "abort": policy.abort(); return { aborted: true };
    case "resume": policy.resume(); return { resumed: true };
    case "skills_list": return { skills: [...ACTIONS].sort() };
    case "actions_recent": return { receipts: await policy.readRecent(a.limit) };

    // system / computer control
    case "open_url":
      if (!urlAllowed(a.url)) throw new Error("Only http(s) URLs are allowed.");
      return systemAction(action, a);
    case "open_app":
      if (!appAllowed(platform(), a.app)) throw new Error(`App "${a.app}" is not on the allowlist.`);
      return systemAction(action, a);
    case "notify": case "screenshot": case "observe":
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
    case "memory_working_put": case "memory_working_get": case "memory_working_clear":
    case "memory_episode_add": case "memory_fact_add": case "memory_skill_add": case "memory_skill_use": case "memory_derive":
    case "memory_context": case "memory_list": case "memory_get": case "memory_update": case "memory_delete":
    case "memory_export": case "memory_writes": case "memory_counts": case "memory_consolidate":
      return memoryAction(action, a, DATA_DIR);

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

/* ── trust plumbing (handled BEFORE the SafetyPolicy — own scope rules) ──── */

const TRUST_ACTIONS = new Set([
  "pairing_code", "devices_list", "devices_revoke",
  "sessions_list", "sessions_revoke", "approvals_list", "approvals_resolve",
  "control_request", "session_info",
]);
// Deliberately NOT in ACTIONS: trust admin never appears in skills_list,
// so the model path cannot stumble onto device revocation.
const TRUST_VIEW_OK = new Set(["session_info", "control_request"]);

/** Live peers: ws → {sessionId, deviceId}. Scope is re-read per message. */
const peers = new Map();

function peerScope(peer) {
  const s = trust.getSessionById(peer.sessionId);
  return s ? s.effectiveScope : null; // null = gone (revoked/expired)
}

function sendEvent(ws, event, detail = {}) {
  try {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: "event", event, ...detail }));
  } catch { /* dead socket */ }
}

function broadcastToScope(scope, event, detail = {}) {
  for (const [ws, peer] of peers) {
    if (peerScope(peer) === scope) sendEvent(ws, event, detail);
  }
}

function closePeers(predicate, code, reason) {
  for (const [ws, peer] of peers) {
    if (predicate(peer)) {
      sendEvent(ws, 'session_ended', { reason });
      try { ws.close(code, reason); } catch { /* ignore */ }
    }
  }
}

async function handleTrust(action, a, peer) {
  const scope = peerScope(peer);
  if (!scope) return { ok: false, error: "session_gone", detail: "Session expired or was revoked." };
  if (!TRUST_VIEW_OK.has(action) && scope !== "control") {
    return { ok: false, error: "view_only", detail: `${action} needs a control session.` };
  }
  switch (action) {
    case "session_info": {
      const s = trust.getSessionById(peer.sessionId);
      return { ok: true, result: { session: s.id, device: s.device_id, scope, grant: s.grant, expires_at: s.expires_at, grant_expires_at: s.grant_expires_at } };
    }
    case "pairing_code": {
      const code = trust.issueCode();
      return { ok: true, result: { code: code.value, expires_at: code.expires_at, daemon_id: trust.daemonId, daemon_pubkey: trust.daemonPubkey() } };
    }
    case "devices_list":
      return { ok: true, result: { devices: trust.listDevices() } };
    case "sessions_list":
      return { ok: true, result: { sessions: trust.listSessions() } };
    case "approvals_list":
      return { ok: true, result: { approvals: trust.listApprovals() } };
    case "control_request": {
      const r = trust.requestControl(peer.sessionId);
      if (!r.ok) return { ok: false, error: r.error };
      if (!r.duplicate) {
        const dev = trust.getDevice(r.approval.device_id);
        console.log(`[companion] control requested by ${dev?.name ?? r.approval.device_id} (${r.approval.id}) — approve in Devices or it expires in 5 min`);
        await policy.log({ action: "control_request", ok: true, device: r.approval.device_id, detail: `approval ${r.approval.id}` });
        broadcastToScope("control", "approval_request", { approval: r.approval, device: dev?.name ?? r.approval.device_id });
      }
      return { ok: true, result: { approval: r.approval, duplicate: r.duplicate ?? false } };
    }
    case "approvals_resolve": {
      const r = trust.resolveApproval(String(a.id ?? ""), a.ok === true, peer.sessionId);
      if (!r.ok) return { ok: false, error: r.error };
      await policy.log({ action: r.approval.status === "approved" ? "control_approved" : "control_denied", ok: true, device: r.approval.device_id, detail: `approval ${r.approval.id}` });
      for (const [ws, p] of peers) {
        if (p.sessionId === r.approval.session_id) sendEvent(ws, "approval_resolved", { approval: r.approval });
      }
      return { ok: true, result: { approval: r.approval } };
    }
    case "devices_revoke": {
      const r = trust.revokeDevice(String(a.id ?? ""));
      if (!r) return { ok: false, error: "no_such_device" };
      await policy.log({ action: "device_revoked", ok: true, device: r.device.id, detail: `${r.sessions.length} session(s) killed` });
      closePeers((p) => p.deviceId === r.device.id, 4009, "device revoked");
      return { ok: true, result: { device: r.device.id, sessions: r.sessions } };
    }
    case "sessions_revoke": {
      const gone = trust.revokeSession(String(a.id ?? ""));
      if (!gone) return { ok: false, error: "no_such_session" };
      await policy.log({ action: "session_revoked", ok: true, device: gone.device_id, detail: `session ${gone.id}` });
      closePeers((p) => p.sessionId === gone.id, 4009, "session revoked");
      return { ok: true, result: { session: gone.id } };
    }
    default:
      return { ok: false, error: "unknown_trust_action" };
  }
}

/* ── hello (three doors, one failure shape — no oracle) ──────────────────── */

const helloFails = new Map(); // ip → {count, resetAt}

function helloBlocked(ip) {
  const e = helloFails.get(ip);
  if (!e) return false;
  if (Date.now() > e.resetAt) {
    helloFails.delete(ip);
    return false;
  }
  return e.count >= 20;
}

function helloFailed(ip) {
  const e = helloFails.get(ip) ?? { count: 0, resetAt: Date.now() + 60000 };
  e.count++;
  helloFails.set(ip, e);
}

function deviceBlock(msg) {
  const d = msg.device && typeof msg.device === "object" ? msg.device : {};
  return {
    id: typeof d.id === "string" && d.id ? d.id.slice(0, 64) : undefined,
    name: typeof d.name === "string" && d.name ? d.name.slice(0, 80) : undefined,
    pubkey: d.pubkey && typeof d.pubkey === "object" ? d.pubkey : undefined,
  };
}

/**
 * Authenticate one hello. Resolves {session, token?} or rejects with a
 * log-only reason (the socket always hears the same 4003).
 */
async function acceptHello(msg, ip) {
  if (typeof msg.token === "string" && msg.token) {
    if (msg.token !== TOKEN) throw new Error("bad token");
    const d = deviceBlock(msg);
    const reg = trust.upsertDevice({ id: d.id ?? "master-token", name: d.name ?? "master token", pubkey: d.pubkey, trust: "token" });
    if (!reg.ok) throw new Error(reg.error);
    const { token, session } = trust.createSession(reg.device.id, "control", { grant: "token" });
    await policy.log({ action: "pair_accepted", ok: true, device: reg.device.id, detail: "master-token hello → control session" });
    return { session, token };
  }
  if (typeof msg.pairing_code === "string" && msg.pairing_code) {
    const verdict = trust.redeemCode(msg.pairing_code);
    if (verdict !== "ok") throw new Error(`pairing ${verdict}`);
    const d = deviceBlock(msg);
    const reg = trust.upsertDevice({ id: d.id, name: d.name ?? "paired device", pubkey: d.pubkey, trust: "quick" });
    if (!reg.ok) throw new Error(reg.error);
    const scope = msg.scope === "view" ? "view" : "control";
    const { token, session } = trust.createSession(reg.device.id, scope, { grant: "quick" });
    await policy.log({ action: "pair_accepted", ok: true, device: reg.device.id, detail: `quick code → ${scope} session` });
    return { session, token };
  }
  if (typeof msg.session === "string" && msg.session) {
    const s = trust.validateSession(msg.session);
    if (!s) throw new Error("bad session");
    return { session: s, token: undefined };
  }
  throw new Error("empty hello");
}

/* ── server (HTTP + WS, one loopback port) ────────────────────────────────── */

const httpServer = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const json = (code, obj, origin) => {
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  if (req.method === "GET" && url.pathname === "/healthz") {
    if (!loopback(req)) {
      res.writeHead(403);
      res.end("loopback only");
      return;
    }
    json(200, { ok: true, daemon: trust.daemonId, ts: Date.now() }, null);
    return;
  }
  if (req.method === "GET" && url.pathname === "/pairing") {
    if (!loopback(req)) {
      res.writeHead(403);
      res.end("loopback only");
      return;
    }
    const origin = req.headers.origin;
    // Browser-origin discipline: a foreign page that somehow reaches
    // loopback must not be able to READ the code (no ACAO → blocked).
    if (origin && !originAllowed(origin)) {
      console.warn(`[companion] rejected pairing fetch from origin ${origin}`);
      res.writeHead(403);
      res.end("origin not allowed");
      return;
    }
    const code = trust.issueCode();
    json(200, { code: code.value, expires_at: code.expires_at, daemon_id: trust.daemonId, daemon_pubkey: trust.daemonPubkey() }, origin);
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress ?? "unknown";
  const origin = req.headers.origin;
  if (origin && !originAllowed(origin)) {
    console.warn(`[companion] rejected origin ${origin}`);
    ws.close(4002, "origin not allowed");
    return;
  }
  if (helloBlocked(ip)) {
    ws.close(4003, "bad token");
    return;
  }
  let peer = null;
  const pairTimeout = setTimeout(() => { if (!peer) ws.close(4001, "pairing timeout"); }, 5000);

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (!peer) {
      if (msg.type === "hello") {
        try {
          const { session, token } = await acceptHello(msg, ip);
          peer = { sessionId: session.id, deviceId: session.device_id };
          peers.set(ws, peer);
          clearTimeout(pairTimeout);
          const live = trust.getSessionById(session.id);
          ws.send(JSON.stringify({
            type: "welcome",
            actions: [...ACTIONS].length,
            daemon_id: trust.daemonId,
            device: session.device_id,
            scope: live.effectiveScope,
            expires_at: session.expires_at,
            ...(token ? { session: token } : {}),
          }));
        } catch (err) {
          helloFailed(ip);
          await policy.log({ action: "pair_rejected", ok: false, detail: String(err.message ?? err).slice(0, 80) });
          ws.close(4003, "bad token");
        }
      }
      return;
    }

    if (msg.type === "confirm") {
      // UI/voice-confirm handler ONLY (and control scope only).
      const scope = peerScope(peer);
      if (!scope) {
        try { ws.close(4009, "session revoked"); } catch { /* ignore */ }
        return;
      }
      const { id, confirmation_id } = msg;
      if (scope !== "control") {
        ws.send(JSON.stringify({ type: "confirmed", id, ok: false, error: "view_only" }));
        return;
      }
      const r = policy.approve(String(confirmation_id ?? ""));
      ws.send(JSON.stringify({ type: "confirmed", id, ok: r.ok, action: r.action, error: r.error }));
      await policy.log({ action: "confirm", ok: r.ok, error: r.error, detail: summarizeAction("confirm", {}, r, r.ok).detail });
      return;
    }

    if (msg.type === "action") {
      const { id, action, args = {} } = msg;
      const scope = peerScope(peer);
      if (!scope) {
        try { ws.close(4009, "session revoked"); } catch { /* ignore */ }
        return;
      }
      if (TRUST_ACTIONS.has(action)) {
        const r = await handleTrust(action, args, peer);
        ws.send(JSON.stringify({ type: "result", id, ok: r.ok, result: r.result, error: r.error, detail: r.detail }));
        return;
      }
      if (scope !== "control" && !isViewAction(action)) {
        ws.send(JSON.stringify({ type: "result", id, ok: false, error: "view_only", detail: `${action} needs a control session.` }));
        await policy.log({ action, ok: false, error: "view_only", device: peer.deviceId, detail: "denied: view scope" });
        return;
      }
      // Daemon-read target text for the risk classifier: UIA/OCR text
      // under click targets, focused control for hotkeys. Best-effort.
      let targetText = "";
      try {
        if ((action === "click" || action === "double_click" || action === "right_click") &&
            Number.isFinite(Number(args.x)) && Number.isFinite(Number(args.y))) {
          targetText = await targetTextAt(Number(args.x), Number(args.y));
        } else if (action === "hotkey") {
          targetText = await targetTextAt();
        }
      } catch { /* target read failure must not block the action */ }
      const verdict = policy.check(action, args, { targetText });
      if (!verdict.allow) {
        ws.send(JSON.stringify({ type: "result", id, ok: false, error: verdict.error, detail: verdict.detail, needsConfirmation: verdict.needsConfirmation || undefined, confirmation_id: verdict.confirmation_id }));
        await policy.log({ action, ok: false, error: verdict.error, detail: summarizeAction(action, args, null, false).detail });
        return;
      }
      try {
        const result = await perform(action, args);
        ws.send(JSON.stringify({ type: "result", id, ok: true, result }));
        // Reading the receipts must not write a receipt (feedback loop).
        if (action !== "actions_recent") {
          const receipt = summarizeAction(action, args, result, true);
          await policy.log({ action, ok: true, detail: receipt.detail, ...(receipt.undo ? { undo: receipt.undo } : {}) });
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: "result", id, ok: false, error: "action_failed", detail: err?.message || String(err) }));
        if (action !== "actions_recent") {
          await policy.log({ action, ok: false, error: err?.message, detail: summarizeAction(action, args, null, false).detail });
        }
      }
    }
  });

  ws.on("close", () => {
    clearTimeout(pairTimeout);
    peers.delete(ws);
  });
});

httpServer.listen(PORT, "127.0.0.1", () => {
  console.log("╭──────────────────────────────────────────────╮");
  console.log("│  Sofia Companion — local daemon               │");
  console.log(`│  ws://127.0.0.1:${PORT}                        │`);
  console.log(`│  pairing code: ${TOKEN}`);
  console.log(`│  loopback pairing: http://127.0.0.1:${PORT}/pairing`);
  console.log("╰──────────────────────────────────────────────╯");
  cornerTimer = setInterval(watchCorner, 1500);
  setInterval(() => trust.sweep(), 60000);
});

process.on("SIGINT", () => { console.log("\n[companion] kill switch (Ctrl+C) — bye"); clearInterval(cornerTimer); wss.close(() => process.exit(0)); });
process.on("SIGTERM", () => { clearInterval(cornerTimer); wss.close(() => process.exit(0)); });
