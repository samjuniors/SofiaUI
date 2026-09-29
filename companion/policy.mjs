/**
 * companion/policy.mjs — the safety layer every action passes through.
 *
 *   1. ALLOWLISTS   open_app only launches named apps; open_url only http(s)
 *   2. CONFIRMATION destructive / financial words return confirmation_required
 *                   until retried with confirm:true
 *   3. KILL SWITCH  abort flag + step budget + mouse top-left corner
 *   4. AUDIT        every action appended to actions.log.jsonl
 */
import { promises as fs } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";

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
  // Airplane-mode local voice (Phase 8)
  "voice_info", "tts_local", "stt_local",
  // skills meta
  "skills_list",
]);

/** Apps the open_app action is allowed to launch, by OS. */
export const APP_ALLOWLIST = {
  darwin: ["finder", "safari", "chrome", "terminal", "notes", "music", "mail", "calendar", "whatsapp", "slack", "code", "spotify", "vlc"],
  win32: ["explorer", "chrome", "msedge", "notepad", "calc", "cmd", "powershell", "winword", "excel", "outlook", "spotify", "whatsapp", "code", "vlc"],
  linux: ["nautilus", "files", "chrome", "chromium", "firefox", "gnome-terminal", "konsole", "gedit", "calc", "code", "vlc", "spotify"],
};

/** Words that make an action require spoken confirmation before executing. */
export const CONFIRM_WORDS = [
  "delete", "trash", "remove", "erase", "format", "wipe", "drop",
  "send", "pay", "purchase", "buy", "transfer", "order", "post", "publish",
  "uninstall", "kill", "force quit", "shut down", "shutdown", "restart",
];

/** Actions that ALWAYS require confirmation regardless of args. */
export const ALWAYS_CONFIRM = new Set(["files_trash", "whatsapp_send"]);

export class SafetyPolicy {
  constructor({ logDir, stepBudget = 40 } = {}) {
    this.logDir = logDir || null;
    this.stepBudget = stepBudget;
    this.mutatingSteps = 0;
    this.aborted = false;
    this.logPath = logDir ? join(logDir, "actions.log.jsonl") : null;
  }

  abort() { this.aborted = true; }
  resume() { this.aborted = false; this.mutatingSteps = 0; }

  /** Classify before executing. Returns {allow, needsConfirmation, reason}. */
  check(action, args = {}) {
    if (this.aborted && action !== "abort" && action !== "resume" && action !== "ping") {
      return { allow: false, error: "aborted", detail: "Kill switch is active. Say 'resume' to continue." };
    }
    if (!ACTIONS.has(action) && action !== "abort" && action !== "resume") {
      return { allow: false, error: "unknown_action", detail: `No such action: ${action}` };
    }
    const text = JSON.stringify(args).toLowerCase();
    const riskyWord = CONFIRM_WORDS.find((w) => text.includes(w));
    const needsConfirmation = ALWAYS_CONFIRM.has(action) || Boolean(riskyWord);
    if (needsConfirmation && !args.confirm) {
      return {
        allow: false,
        needsConfirmation: true,
        error: "confirmation_required",
        detail: `This ${riskyWord ? `mentions "${riskyWord}"` : "action is destructive"}. Say the confirmation and I'll retry with confirm:true.`,
      };
    }
    if (this.isMutating(action) && ++this.mutatingSteps > this.stepBudget) {
      return { allow: false, error: "step_budget_exceeded", detail: `Hit the ${this.stepBudget}-step safety budget. Start a new task.` };
    }
    return { allow: true, needsConfirmation: false };
  }

  isMutating(action) {
    return /^(click|double_click|right_click|type_text|hotkey|scroll|drag|move_mouse|files_move|files_trash|files_restore|whatsapp_|browser_click|browser_type|browser_navigate|open_app|set_volume|media_control)/.test(action);
  }

  async log(entry) {
    if (!this.logPath) return;
    try { await appendFile(this.logPath, JSON.stringify({ ts: Date.now(), ...entry }) + "\n"); } catch { /* best-effort */ }
  }
}

/** Validate an app name against the per-OS allowlist. */
export function appAllowed(platform, name) {
  const n = String(name ?? "").toLowerCase().trim().replace(/\.exe$|\.app$/g, "");
  return (APP_ALLOWLIST[platform] || []).some((a) => n === a || n.includes(a));
}

/** Only http(s) URLs may be opened. */
export function urlAllowed(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch { return false; }
}
