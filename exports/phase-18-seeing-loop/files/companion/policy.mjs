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
import { appendFile } from "node:fs/promises";
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
