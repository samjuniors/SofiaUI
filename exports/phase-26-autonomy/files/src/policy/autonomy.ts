/**
 * policy/autonomy.ts — Phase 26: autonomy tiers + the async approval queue.
 *
 * Three tiers per action:
 *   AUTO   — reversible, sandboxed/allowlisted: just do it.
 *   NOTIFY — do it, tell the user, undo where receipts support it.
 *   GATE   — irreversible (send/pay/delete/credentials/install/terminal):
 *            hold for one-time UI approval; the agent keeps working meanwhile.
 *
 * The DAEMON stays the hard backstop (its `classifyRisk` gates the same
 * shapes over the wire); this module is the client mirror for UX
 * (pre-classification, toasts, the queue). The two lists below are mirrors
 * of `companion/policy.mjs` — `autonomy.test.ts` asserts they agree with
 * the daemon on a sample battery, so drift fails loudly.
 *
 * Iron rules (structural, tested):
 * - Gate is computed FIRST from (action, args); the autonomy level can only
 *   move actions between AUTO and NOTIFY — never out of GATE. Credentials
 *   and payments ALWAYS gate, on every level.
 * - Untrusted text (screen/web/file/model output) can only ESCALATE a tier
 *   (risk words → gate); nothing in args text can de-escalate. Smuggled
 *   `{tier:'auto'}`, "auto approve", and goal-override prose are inert.
 * - Approval ids are unguessable, single-use, expiring, and redeemable only
 *   via an explicit UI/voice-confirm call — `approve(id, {via})` rejects
 *   every other channel ('model', 'tool', 'screen', …).
 */

export type Tier = 'auto' | 'notify' | 'gate';
export type AutonomyLevel = 'careful' | 'balanced' | 'bold';
export const AUTONOMY_LEVELS: AutonomyLevel[] = ['careful', 'balanced', 'bold'];
export const DEFAULT_AUTONOMY: AutonomyLevel = 'balanced';
export const AUTONOMY_STORAGE_KEY = 'sophia:autonomy:v1';

/** Mirror of daemon ALWAYS_CONFIRM — irreversible by nature. */
export const GATE_ACTIONS = new Set(['whatsapp_send', 'files_trash']);

/** Mirror of daemon RISK_WORDS — args mentioning these gate any action. */
export const RISK_WORDS = new Set([
  'delete', 'trash', 'remove', 'erase', 'format', 'wipe', 'drop',
  'send', 'pay', 'purchase', 'buy', 'transfer', 'order', 'post', 'publish',
  'submit', 'uninstall', 'kill', 'shutdown', 'restart',
]);

/** Mirror of daemon RISK_PHRASES. */
export const RISK_PHRASES = ['force quit', 'shut down'];

/**
 * Mirror of daemon CRED_WORDS. Credential USE gates; vault storage
 * (`store_put`) and diary entries (`episodes_*`, `memory_*`) do not —
 * the danger is exfiltration and fill-in, not possession.
 */
export const CRED_WORDS = new Set([
  'password', 'passwd', 'credential', 'credentials', 'token', 'tokens', 'secret', 'secrets',
]);

/** Actions where credential-shaped args mean USE (mirror of the daemon set). */
export const CRED_USE_ACTIONS = new Set(['store_get', 'type_text', 'browser_type']);

/** Memory-family content is data, never instructions (mirror of the daemon exemption). */
const MEMORY_FAMILY_RE = /^(memory_|store_|episodes_)/;

/**
 * Forward rule for actions that don't exist yet: no shell or installer may
 * ever run below GATE. Pinned by tests so a future `terminal_exec` cannot
 * slip in as AUTO.
 */
const TERMINAL_RE = /^(terminal|shell|exec|install|uninstall)(_|$)/;

/** Base NOTIFY tier (visible side effects, done first, user told after). */
const NOTIFY_BASE = new Set([
  'files_move', 'files_restore',
  'whatsapp_draft',
  'browser_navigate', 'browser_open_read', 'browser_click_text', 'browser_type',
  'memory_update', 'memory_delete', 'store_put', 'store_delete',
]);

/** NOTIFY actions whose receipts carry a working undo op (toast says so). */
export const UNDOABLE_ACTIONS = new Set(['files_move', 'files_restore']);

/**
 * The ONLY tier moves the autonomy setting may make: named actions between
 * AUTO and NOTIFY. GATE never appears here — enforced by gate-first
 * evaluation in `tierOf` plus a test that sweeps every level.
 */
const LEVEL_MOVES: Record<AutonomyLevel, Record<string, Tier>> = {
  careful: { open_app: 'notify', open_url: 'notify', browser_open_read: 'notify' },
  balanced: {},
  bold: {
    files_move: 'auto', files_restore: 'auto', whatsapp_draft: 'auto',
    memory_update: 'auto', memory_delete: 'auto',
  },
};

/** Daemon `tokenize` mirror: lowercase alnum words. */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

/** Daemon `containsWord` mirror: phrases via \b-regex, words via tokens. */
function containsWord(text: string, word: string): boolean {
  if (word.includes(' ')) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`).test(text.toLowerCase());
  }
  return tokenize(text).includes(word.toLowerCase());
}

function argText(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args, (k, v) => (k === 'confirm' || k === 'confirmation_id' ? undefined : v));
  } catch {
    return '';
  }
}

export interface TierContext {
  level?: AutonomyLevel;
}

/**
 * Classify one action. Pure. Gate rules run before anything else — the
 * level is consulted ONLY for AUTO↔NOTIFY moves, so no setting, no args
 * text, and no goal prose can ever lift an action out of GATE.
 */
export function tierOf(action: string, args: Record<string, unknown> = {}, ctx: TierContext = {}): Tier {
  const name = String(action ?? '');
  // 1. Forward rule: shells and installers never run below GATE.
  if (TERMINAL_RE.test(name)) return 'gate';
  // 2. Irreversible-by-nature actions.
  if (GATE_ACTIONS.has(name)) return 'gate';
  const memoryFamily = MEMORY_FAMILY_RE.test(name);
  const text = argText(args);
  // 3. Credential USE gates (reads, typing) — on any action family.
  if (CRED_USE_ACTIONS.has(name)) {
    for (const w of CRED_WORDS) {
      if (containsWord(text, w)) return 'gate';
    }
  }
  // 4. Risk words gate everything EXCEPT memory-family content (data, not
  // instructions — the daemon exemption, mirrored).
  if (!memoryFamily) {
    for (const w of RISK_WORDS) {
      if (containsWord(text, w)) return 'gate';
    }
    for (const p of RISK_PHRASES) {
      if (containsWord(text, p)) return 'gate';
    }
  }
  // 5. Base tier + the ONLY moves the level may make (AUTO↔NOTIFY).
  let tier: Tier = NOTIFY_BASE.has(name) ? 'notify' : 'auto';
  const level = ctx.level ?? DEFAULT_AUTONOMY;
  const move = LEVEL_MOVES[level]?.[name];
  if (move === 'notify' && tier === 'auto') tier = 'notify';
  else if (move === 'auto' && tier === 'notify') tier = 'auto';
  return tier;
}

// ─── Autonomy setting ────────────────────────────────────────────────────

export interface AutonomyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): AutonomyStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function createAutonomyStore(storage: AutonomyStorage | null = defaultStorage()) {
  let level: AutonomyLevel = DEFAULT_AUTONOMY;
  try {
    const raw = storage?.getItem(AUTONOMY_STORAGE_KEY);
    if (raw === 'careful' || raw === 'balanced' || raw === 'bold') level = raw;
  } catch {
    /* corrupted pref → default */
  }
  return {
    get(): AutonomyLevel {
      return level;
    },
    set(next: AutonomyLevel): void {
      if (next !== 'careful' && next !== 'balanced' && next !== 'bold') return;
      level = next;
      try {
        storage?.setItem(AUTONOMY_STORAGE_KEY, next);
      } catch {
        /* private mode — session-only */
      }
    },
  };
}

export type AutonomyStore = ReturnType<typeof createAutonomyStore>;

/** UI singleton (components re-read on render; tests build their own). */
export const autonomyStore = createAutonomyStore();

// ─── Async approval queue ────────────────────────────────────────────────

export type ApprovalState = 'pending' | 'approved' | 'denied' | 'expired';
/** Channels allowed to settle a request. Anything else is rejected. */
export type ApproveVia = 'ui' | 'voice-confirm';

export interface ApprovalRequest {
  id: string;
  taskId: string | null;
  action: string;
  label: string;
  question: string;
  detail: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
  state: ApprovalState;
  settledVia: ApproveVia | null;
}

export interface ApprovalInput {
  taskId?: string;
  action: string;
  label: string;
  question: string;
  detail?: Record<string, unknown>;
  ttlMs?: number;
}

export const APPROVAL_TTL_MS = 5 * 60_000;

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `appr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/**
 * Pending GATE requests. The agent keeps working while a request waits;
 * the gated step awaits `awaitApproval(id)`. Ids are unguessable,
 * single-settle, expiring — and `approve`/`deny` demand an explicit
 * UI/voice-confirm channel, so screen text, tool output, and model prose
 * can never settle a request (there is simply no call path).
 */
export class ApprovalQueue extends EventTarget {
  private readonly requests = new Map<string, ApprovalRequest>();
  private readonly waiters = new Map<string, Set<(ok: boolean) => void>>();

  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    super();
    this.now = now;
  }

  request(input: ApprovalInput): ApprovalRequest {
    this.sweep();
    const t = this.now();
    const req: ApprovalRequest = {
      id: newId(),
      taskId: input.taskId ?? null,
      action: input.action,
      label: input.label.slice(0, 200),
      question: input.question.slice(0, 500),
      detail: input.detail ?? {},
      createdAt: t,
      expiresAt: t + Math.max(1000, input.ttlMs ?? APPROVAL_TTL_MS),
      state: 'pending',
      settledVia: null,
    };
    this.requests.set(req.id, req);
    this.dispatchEvent(new CustomEvent('request', { detail: req }));
    return req;
  }

  approve(id: string, opts: { via: string }): boolean {
    return this.settle(id, true, opts.via);
  }

  deny(id: string, opts: { via: string }): boolean {
    return this.settle(id, false, opts.via);
  }

  private settle(id: string, ok: boolean, via: string): boolean {
    if (via !== 'ui' && via !== 'voice-confirm') return false;
    const req = this.requests.get(id);
    if (!req || req.state !== 'pending') return false;
    if (this.now() >= req.expiresAt) {
      req.state = 'expired';
      this.emitSettled(req);
      return false;
    }
    req.state = ok ? 'approved' : 'denied';
    req.settledVia = via as ApproveVia;
    this.emitSettled(req);
    return true;
  }

  private emitSettled(req: ApprovalRequest): void {
    this.dispatchEvent(new CustomEvent('settled', { detail: req }));
    const waiters = this.waiters.get(req.id);
    if (waiters) {
      this.waiters.delete(req.id);
      for (const w of waiters) {
        try {
          w(req.state === 'approved');
        } catch {
          /* waiter threw — the settlement stands */
        }
      }
    }
  }

  /** Resolves true on approval, false on deny/expiry/unknown. Never rejects. */
  awaitApproval(id: string): Promise<boolean> {
    const req = this.requests.get(id);
    if (!req) return Promise.resolve(false);
    if (req.state === 'approved') return Promise.resolve(true);
    if (req.state !== 'pending') return Promise.resolve(false);
    if (this.now() >= req.expiresAt) {
      req.state = 'expired';
      this.emitSettled(req);
      return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      let set = this.waiters.get(id);
      if (!set) {
        set = new Set();
        this.waiters.set(id, set);
      }
      set.add(resolve);
    });
  }

  pending(): ApprovalRequest[] {
    this.sweep();
    return [...this.requests.values()].filter((r) => r.state === 'pending');
  }

  get(id: string): ApprovalRequest | null {
    return this.requests.get(id) ?? null;
  }

  sweep(): void {
    const t = this.now();
    for (const req of this.requests.values()) {
      if (req.state === 'pending' && t >= req.expiresAt) {
        req.state = 'expired';
        this.emitSettled(req);
      }
    }
  }
}

/** App-wide queue (the wiring bridge + UI share it; tests build their own). */
export const approvalQueue = new ApprovalQueue();
