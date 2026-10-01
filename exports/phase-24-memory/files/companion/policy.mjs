/**
 * companion/policy.mjs — the safety layer every action passes through.
 *
 *   1. ALLOWLISTS   open_app only launches named apps (exact match); open_url
 *                   only http(s)
 *   2. CONFIRMATION a risk classifier (word-boundary match + OCR/UIA target
 *                   text) returns confirmation_required with a one-time
 *                   confirmation_id. The id is redeemed ONLY through the
 *                   UI/voice-confirm handler (`approve`); a model-supplied
 *                   `confirm:true` is ignored.
 *   3. KILL SWITCH  abort flag + step budget + mouse top-left corner
 *   4. AUDIT        every action appended to actions.log.jsonl
 */
import { appendFile, open, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const ACTIONS = new Set([
  // system / control
  "ping", "open_url", "open_app", "notify", "screenshot",
  "click", "double_click", "right_click", "move_mouse", "scroll",
  "type_text", "hotkey", "drag", "get_cursor", "get_active_window",
  "set_volume", "get_volume",
  // browser (DOM-level, via CDP)
  "browser_navigate", "browser_open_read", "browser_click_text", "browser_type",
  // files (sandboxed)
  "files_roots", "files_list", "files_find", "files_read", "files_open",
  "files_move", "files_trash", "files_restore",
  // memory
  "store_get", "store_put", "store_keys", "store_delete",
  "episodes_add", "episodes_search", "episodes_recent",
  // health & media
  "health_snapshot", "health_processes",
  "media_control", "media_status",
  // whatsapp (draft-first)
  "whatsapp_open", "whatsapp_draft", "whatsapp_send", "whatsapp_unread",
  // OCR grounding
  "ground_text", "ground_ocr",
  // one-call perception (read-only: never mutating, never gated)
  "observe",
  // Airplane-mode local voice (Phase 8)
  "voice_info", "tts_local", "stt_local",
  // skills meta
  "skills_list",
  // receipts: read-only tail of the audit log (Phase 22)
  "actions_recent",
  // long-term memory (Phase 24): working + episodic + semantic + procedural
  "memory_working_put", "memory_working_get", "memory_working_clear",
  "memory_episode_add", "memory_fact_add", "memory_skill_add", "memory_derive",
  "memory_context", "memory_list", "memory_get", "memory_update", "memory_delete",
  "memory_export", "memory_writes", "memory_counts", "memory_consolidate",
]);

/** Apps the open_app action is allowed to launch, by OS. */
export const APP_ALLOWLIST = {
  darwin: ["finder", "safari", "chrome", "terminal", "notes", "music", "mail", "calendar", "whatsapp", "slack", "code", "spotify", "vlc"],
  win32: ["explorer", "chrome", "msedge", "notepad", "calc", "cmd", "powershell", "winword", "excel", "outlook", "spotify", "whatsapp", "code", "vlc", "wmplayer", "mspaint", "snippingtool", "taskmgr"],
  linux: ["nautilus", "files", "chrome", "chromium", "firefox", "gnome-terminal", "konsole", "gedit", "calc", "code", "vlc", "spotify"],
};

/**
 * Destructive / financial words matched against action ARGS with word
 * boundaries ("sender" must NOT match "send"; "send invoice" must).
 */
export const RISK_WORDS = new Set([
  "delete", "trash", "remove", "erase", "format", "wipe", "drop",
  "send", "pay", "purchase", "buy", "transfer", "order", "post", "publish",
  "submit", "uninstall", "kill", "shutdown", "restart",
]);

/** Multi-word destructive phrases matched with word boundaries. */
export const RISK_PHRASES = ["force quit", "shut down"];

/**
 * Words that make a CLICK/HOTKEY target risky when they appear (whole-word)
 * in the OCR text / UIA name under the target, as read by the daemon.
 */
export const RISKY_TARGET_WORDS = new Set(["send", "pay", "delete", "submit", "buy"]);

/** Actions that ALWAYS require confirmation regardless of args. */
export const ALWAYS_CONFIRM = new Set(["files_trash", "whatsapp_send"]);

/** Split text into lowercase whole words (letters/digits/apostrophes). */
export function tokenize(text) {
  return String(text ?? "").toLowerCase().match(/[a-z0-9']+/g) || [];
}

/** Whole-word test for a single word, plus word-boundary phrase test. */
function containsWord(text, word) {
  const pattern = word.includes(" ")
    ? new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
    : null;
  if (pattern) return pattern.test(text.toLowerCase());
  return tokenize(text).includes(word.toLowerCase());
}

/**
 * Risk classifier. Pure: no I/O, no clock.
 *
 * @param {string} action
 * @param {object} args action args (confirmation fields are ignored)
 * @param {{targetText?: string}} opts.targetText daemon-read OCR/UIA text
 *        under the click/hotkey target — never model-supplied.
 * @returns {{risky: boolean, word?: string, reason: string}}
 */
export function classifyRisk(action, args = {}, opts = {}) {
  if (ALWAYS_CONFIRM.has(action)) {
    return { risky: true, reason: `action "${action}" always requires confirmation` };
  }
  const argText = JSON.stringify(args, (k, v) =>
    (k === "confirm" || k === "confirmation_id" ? undefined : v));
  for (const w of RISK_WORDS) {
    if (containsWord(argText, w)) {
      return { risky: true, word: w, reason: `args mention "${w}"` };
    }
  }
  for (const p of RISK_PHRASES) {
    if (containsWord(argText, p)) {
      return { risky: true, word: p, reason: `args mention "${p}"` };
    }
  }
  const targetText = String(opts.targetText ?? "");
  if (targetText) {
    const words = new Set(tokenize(targetText));
    for (const w of RISKY_TARGET_WORDS) {
      if (words.has(w)) {
        return { risky: true, word: w, reason: `target under cursor reads "${w}"` };
      }
    }
  }
  return { risky: false, reason: "clean" };
}

/** Stable fingerprint of args minus confirmation fields (for id binding). */
function fingerprint(args = {}) {
  const clean = {};
  for (const k of Object.keys(args).sort()) {
    if (k === "confirm" || k === "confirmation_id") continue;
    clean[k] = args[k];
  }
  return JSON.stringify(clean);
}

export class SafetyPolicy {
  constructor({ logDir, stepBudget = 40, confirmTtlMs = 5 * 60 * 1000 } = {}) {
    this.logDir = logDir || null;
    this.stepBudget = stepBudget;
    this.confirmTtlMs = confirmTtlMs;
    this.mutatingSteps = 0;
    this.aborted = false;
    this.logPath = logDir ? join(logDir, "actions.log.jsonl") : null;
    /** confirmation_id → {action, fp, approved, expires} */
    this.pendingConfirmations = new Map();
  }

  abort() { this.aborted = true; }
  resume() { this.aborted = false; this.mutatingSteps = 0; }

  /**
   * Classify before executing. Returns {allow, ...}.
   *
   * `opts.targetText` is daemon-read OCR/UIA text (see classifyRisk).
   * NOTE: `args.confirm === true` NEVER grants access — it is ignored.
   * Only a daemon-issued `confirmation_id` redeemed through `approve()`
   * (the UI/voice-confirm handler) authorizes a risky action, once.
   */
  check(action, args = {}, opts = {}) {
    if (this.aborted && action !== "abort" && action !== "resume" && action !== "ping") {
      return { allow: false, error: "aborted", detail: "Kill switch is active. Say 'resume' to continue." };
    }
    if (!ACTIONS.has(action) && action !== "abort" && action !== "resume") {
      return { allow: false, error: "unknown_action", detail: `No such action: ${action}` };
    }
    const verdict = classifyRisk(action, args, opts);
    if (verdict.risky) {
      const id = typeof args.confirmation_id === "string" ? args.confirmation_id : "";
      if (id && this.redeem(id, action, args)) {
        // One-time redemption consumed — fall through to budget + allow.
      } else {
        const confirmation_id = this.issue(action, args);
        return {
          allow: false,
          needsConfirmation: true,
          error: "confirmation_required",
          confirmation_id,
          detail: `Risky: ${verdict.reason}. The UI/voice-confirm handler must redeem confirmation_id ${confirmation_id} before retrying.`,
        };
      }
    }
    if (this.isMutating(action) && ++this.mutatingSteps > this.stepBudget) {
      return { allow: false, error: "step_budget_exceeded", detail: `Hit the ${this.stepBudget}-step safety budget. Start a new task.` };
    }
    return { allow: true, needsConfirmation: false };
  }

  /** Issue a one-time confirmation id bound to this exact action+args. */
  issue(action, args = {}) {
    this.prune();
    if (this.pendingConfirmations.size >= 100) {
      // Bound memory: drop the oldest pending id.
      const oldest = this.pendingConfirmations.keys().next().value;
      this.pendingConfirmations.delete(oldest);
    }
    const id = randomBytes(16).toString("hex");
    this.pendingConfirmations.set(id, {
      action,
      fp: fingerprint(args),
      approved: false,
      expires: Date.now() + this.confirmTtlMs,
    });
    return id;
  }

  /**
   * UI/voice-confirm handler redemption: marks the pending id approved.
   * The MODEL can never call this — it only travels the UI confirm path
   * (server.mjs `type:"confirm"` message). Returns the bound action so
   * the UI can show what is being approved.
   */
  approve(id) {
    this.prune();
    const p = this.pendingConfirmations.get(id);
    if (!p) return { ok: false, error: "unknown_confirmation_id" };
    p.approved = true;
    return { ok: true, action: p.action };
  }

  /**
   * Consume an approved id for the retried action. Requires UI approval
   * first (unapproved retries leave the id pending); the FIRST redemption
   * attempt after approval consumes the id whether it matches or not, so
   * each approval authorizes at most one execution.
   */
  redeem(id, action, args = {}) {
    this.prune();
    const p = this.pendingConfirmations.get(id);
    if (!p) return false;
    if (!p.approved) return false;
    this.pendingConfirmations.delete(id);
    if (p.action !== action) return false;
    return p.fp === fingerprint(args);
  }

  prune(now = Date.now()) {
    for (const [id, p] of this.pendingConfirmations) {
      if (p.expires <= now) this.pendingConfirmations.delete(id);
    }
  }

  isMutating(action) {
    return /^(click|double_click|right_click|type_text|hotkey|scroll|drag|move_mouse|files_move|files_trash|files_restore|whatsapp_|browser_click|browser_type|browser_navigate|open_app|set_volume|media_control)/.test(action);
  }

  async log(entry) {
    if (!this.logPath) return;
    try { await appendFile(this.logPath, JSON.stringify({ ts: Date.now(), ...entry }) + "\n"); } catch { /* best-effort */ }
  }

  /**
   * Read-only tail of the audit log, newest first. Reads at most the last
   * 256KB so an old install's log can't blow up memory; corrupt lines are
   * skipped. Used by the `actions_recent` action (the receipts panel).
   */
  async readRecent(n = 20) {
    if (!this.logPath) return [];
    const limit = Math.min(Math.max(Number(n) || 20, 1), 100);
    try {
      const size = (await stat(this.logPath)).size;
      if (!size) return [];
      const WINDOW = 256 * 1024;
      const start = Math.max(0, size - WINDOW);
      const fh = await open(this.logPath, "r");
      try {
        const buf = Buffer.alloc(Math.min(size, WINDOW));
        await fh.read(buf, 0, buf.length, start);
        const lines = buf.toString("utf8").split("\n");
        // The window can start mid-line — drop the first fragment (unless
        // we read from byte 0, in which case it is a real first line).
        if (start > 0) lines.shift();
        const out = [];
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          try { out.push(JSON.parse(t)); } catch { /* skip corrupt lines */ }
        }
        return out.slice(-limit).reverse();
      } finally {
        await fh.close();
      }
    } catch {
      return [];
    }
  }
}

/**
 * Validate an app name against the per-OS allowlist. EXACT match only
 * (after lowercasing + stripping a .exe/.app suffix) — no substring
 * matching, so "my-chrome-evil" and "chromium-stealer" are rejected.
 */
export function appAllowed(platform, name) {
  const n = String(name ?? "").toLowerCase().trim().replace(/\.(exe|app)$/, "");
  return (APP_ALLOWLIST[platform] || []).includes(n);
}

/** Only http(s) URLs may be opened. */
export function urlAllowed(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch { return false; }
}

/* ── receipts (Phase 22) ────────────────────────────────────────────────── */

/** Truncate display strings; receipts are summaries, not transcripts. */
function short(v, max = 80) {
  const s = String(v ?? "");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function coords(a) {
  const x = Number(a.x);
  const y = Number(a.y);
  return Number.isFinite(x) && Number.isFinite(y) ? `(${Math.round(x)}, ${Math.round(y)})` : "";
}

/** Last path segment for readable file receipts (full paths stay in undo). */
function base(p) {
  return String(p ?? "").split(/[/\\]/).filter(Boolean).pop() || String(p ?? "");
}

/**
 * Shape one audit line's human summary (+ machine undo when reversible).
 * Pure — the server calls it before logging; the receipts panel renders
 * `detail` and offers `undo` when present.
 *
 * PRIVACY: typed/dictated/page content is NEVER logged — lengths only.
 * Result payloads are never logged whole; only the fields undo needs
 * (from/to/trashPath/restored) travel in `undo.args`.
 */
export function summarizeAction(action, args = {}, result = null, ok = true) {
  const a = args && typeof args === "object" ? args : {};
  const r = result && typeof result === "object" ? result : {};
  switch (action) {
    case "click": case "double_click": case "right_click": case "move_mouse":
      return { detail: `${action.replaceAll("_", " ")} ${coords(a)}`.trim() };
    case "scroll": {
      const amt = Number(a.amount);
      return { detail: `scroll ${Number.isFinite(amt) ? amt : ""} ${coords(a)}`.trim() };
    }
    case "drag": {
      const f = coords({ x: a.fromX, y: a.fromY });
      const t = coords({ x: a.toX, y: a.toY });
      return { detail: `drag ${f} → ${t}`.trim() };
    }
    case "type_text": case "browser_type":
      return { detail: `typed ${String(a.text ?? "").length} chars${a.target ? ` into ${short(a.target, 24)}` : ""}` };
    case "hotkey":
      return { detail: `hotkey ${short(a.keys ?? a.key ?? "", 32)}` };
    case "open_app":
      return { detail: `opened ${short(a.app ?? "", 40)}` };
    case "open_url": case "browser_navigate": {
      try {
        return { detail: `opened ${new URL(String(a.url)).host}` };
      } catch {
        return { detail: `opened ${short(a.url ?? "", 60)}` };
      }
    }
    case "browser_open_read": {
      try {
        return { detail: `read ${new URL(String(a.url)).host}` };
      } catch {
        return { detail: "read page" };
      }
    }
    case "browser_click_text":
      return { detail: `clicked “${short(a.text ?? "", 48)}”` };
    case "files_move":
      if (ok && r.from && r.to) {
        return {
          detail: `moved ${base(r.from)} → ${base(r.to)}`,
          undo: { action: "files_move", args: { from: r.to, to: r.from } },
        };
      }
      return { detail: `move ${base(a.from)} → ${base(a.to)}` };
    case "files_trash":
      if (ok && r.trashPath) {
        return {
          detail: `trashed ${base(a.path ?? r.trashed)}`,
          undo: { action: "files_restore", args: { path: r.trashPath } },
        };
      }
      return { detail: `trash ${base(a.path)}` };
    case "files_restore":
      if (ok && r.restored) {
        return {
          detail: `restored ${base(r.restored)}`,
          undo: { action: "files_trash", args: { path: r.restored } },
        };
      }
      return { detail: `restore ${base(a.path)}` };
    case "files_open":
      return { detail: `opened ${base(a.path)}` };
    case "files_list": case "files_find":
      return { detail: `${action === "files_list" ? "listed" : "searched"} ${short(a.path ?? a.query ?? "", 60)}` };
    case "files_read":
      return { detail: `read ${base(a.path)}` };
    case "screenshot":
      return { detail: "took a screenshot" };
    case "observe":
      return { detail: "observed the screen" };
    case "get_active_window":
      return { detail: typeof r.window === "string" && r.window ? `active window: ${short(r.window, 60)}` : "read active window" };
    case "get_cursor":
      return { detail: "read cursor position" };
    case "notify":
      return { detail: `notification: ${short(a.body ?? a.title ?? "", 80)}` };
    case "set_volume":
      return { detail: `volume → ${short(a.level ?? a.volume ?? "", 8)}` };
    case "media_control":
      return { detail: `media ${short(a.action ?? "", 24)}` };
    case "ground_text": case "ground_ocr":
      return { detail: `located “${short(a.text ?? a.query ?? "", 48)}”` };
    case "whatsapp_open": case "whatsapp_unread":
      return { detail: action === "whatsapp_open" ? "opened WhatsApp" : "checked WhatsApp unread" };
    case "whatsapp_draft": case "whatsapp_send": {
      const n = String(a.body ?? a.text ?? a.message ?? "").length;
      return { detail: `${action === "whatsapp_draft" ? "drafted" : "sent"} WhatsApp message (${n} chars) to ${short(a.to ?? a.chat ?? "", 32)}` };
    }
    case "confirm":
      return { detail: ok ? `approved ${short(r.action ?? "", 32)}` : "approval failed" };
    case "store_put": case "store_delete":
      return { detail: `${action === "store_put" ? "saved" : "deleted"} memory “${short(a.key ?? "", 48)}”` };
    case "store_get": case "store_keys":
      return { detail: "read memory" };
    case "episodes_add":
      return { detail: "saved an episode" };
    case "episodes_search": case "episodes_recent":
      return { detail: "searched memory" };
    // Phase 24 memory stores: receipts name the store + op + ref only —
    // memory CONTENT never lands in the audit log (same rule as typed
    // content). The per-store writes log holds the summaries.
    case "memory_working_put": case "memory_working_clear":
      return { detail: action === "memory_working_put" ? "updated working memory" : "cleared working memory" };
    case "memory_episode_add": case "memory_fact_add": case "memory_skill_add":
      return { detail: `saved ${short(a.store ?? action.replace("memory_", "").replace("_add", ""), 16)} #${short(r.id ?? "", 8)}`.trim() };
    case "memory_update": case "memory_delete":
      return { detail: `${action === "memory_update" ? "edited" : "deleted"} ${short(a.store ?? "memory", 16)} ${short(a.id ?? "", 24)}`.trim() };
    case "memory_consolidate":
      return { detail: ok ? "consolidated memory" : "consolidation skipped" };
    case "memory_export":
      return { detail: "exported memory" };
    case "memory_context": case "memory_list": case "memory_get": case "memory_writes": case "memory_counts":
    case "memory_working_get": case "memory_derive":
      return { detail: "read memory" };
    case "health_snapshot": case "health_processes":
      return { detail: "checked system health" };
    case "media_status":
      return { detail: "checked media status" };
    case "voice_info":
      return { detail: "checked local voice" };
    case "tts_local": case "stt_local":
      return { detail: action === "tts_local" ? "spoke locally" : "transcribed locally" };
    case "ping":
      return { detail: "ping" };
    case "skills_list":
      return { detail: "listed skills" };
    default:
      return { detail: short(action, 48).replaceAll("_", " ") };
  }
}
