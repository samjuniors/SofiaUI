/**
 * lib/companion-client.ts — the browser end of the Sofia Companion link.
 * Pairs with companion/server.mjs over WebSocket on 127.0.0.1, correlates
 * request ids, and exposes a typed `send()` plus status events.
 *
 * Phase 28 pairing ladder (first success wins): Electron-bundled master
 * token → stored session token → loopback /pairing fetch (zero typing on
 * the same machine) → manually pasted token/code. Sessions persist in
 * localStorage; revocation (close 4009) clears them and re-pairs silently
 * once. Daemon events (approvals, revocations) arrive via `onEvent`.
 */

export type CompanionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface CompanionReply<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
  detail?: string;
  needsConfirmation?: boolean;
  /** One-time daemon-issued id on confirmation_required; redeemed via confirm(). */
  confirmation_id?: string;
  /** Bound action on confirmed replies, so the UI can show what was approved. */
  action?: string;
}

import { getOrCreateDevice, helloDeviceBlock } from './device-identity.ts';

export type CompanionScope = 'control' | 'view' | '';

export interface CompanionInfo {
  port: number;
  actions?: number;
}

const SESSION_KEY = 'sophia:companion:session';

interface StoredSession {
  token: string;
  expires_at: number;
  port: number;
}

/** Quick-code shape: 8 Crockford chars, dash optional. Tokens are longer. */
export function looksLikeCode(v: string): boolean {
  return /^[A-Z2-9]{4}-?[A-Z2-9]{4}$/i.test(v.trim());
}

interface Pending {
  resolve: (reply: CompanionReply) => void;
  timer: number;
  action: string;
  args: Record<string, unknown>;
}

class CompanionClient extends EventTarget {
  status: CompanionStatus = 'disconnected';
  info: CompanionInfo = { port: 7788 };
  lastError = '';
  private ws: WebSocket | null = null;
  private token = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();
  /** This connection's scope (empty until welcome). */
  scope: CompanionScope = '';
  private repairedd = false;

  get connected(): boolean {
    return this.status === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  setPairing(token: string, port?: number) {
    this.token = token.trim();
    if (port) this.info.port = port;
    try { localStorage.setItem('sophia:companion:token', this.token); } catch { /* ignore */ }
    // A manual code/token supersedes any stored session.
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    this.repairedd = false;
  }

  private loadSession(): StoredSession | null {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as StoredSession;
      if (typeof s.token !== 'string' || !s.token || typeof s.expires_at !== 'number') return null;
      if (s.expires_at <= Date.now()) return null;
      return s;
    } catch {
      return null;
    }
  }

  private storeSession(token: string, expires_at: number) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ token, expires_at, port: this.info.port } satisfies StoredSession));
    } catch { /* ignore */ }
  }

  private clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }

  /** Zero-typing pair: the daemon serves a fresh code to loopback only. */
  private async fetchLoopbackCode(): Promise<string | null> {
    try {
      const ctl = new AbortController();
      const t = window.setTimeout(() => ctl.abort(), 3000);
      const r = await fetch(`http://127.0.0.1:${this.info.port}/pairing`, { signal: ctl.signal });
      window.clearTimeout(t);
      if (!r.ok) return null;
      const j = (await r.json()) as { code?: unknown };
      return typeof j.code === 'string' && j.code ? j.code : null;
    } catch {
      return null;
    }
  }

  private setStatus(status: CompanionStatus, err = '', info?: CompanionInfo) {
    this.status = status;
    if (err) this.lastError = err;
    if (info) this.info = { ...this.info, ...info };
    this.dispatchEvent(new CustomEvent('status', { detail: { status, error: err, info: this.info } }));
  }

  /** Connect (idempotent). Resolves true when paired. */
  connect(): Promise<boolean> {
    if (this.connected) return Promise.resolve(true);
    return new Promise((done) => {
      void this.applyDesktopPairing()
        .catch(() => undefined)
        .finally(() => this.openSocket(done));
    });
  }

  /**
   * Desktop auto-pair: the Electron shell bundles the companion token+port
   * through the preload bridge. Preferred over any manual code (managed
   * tokens rotate every launch); silently absent in plain browsers.
   */
  private async applyDesktopPairing(): Promise<void> {
    try {
      const pairing = await window.sophiaDesktop?.getPairing();
      if (!pairing) return;
      if (typeof pairing.port === 'number' && pairing.port >= 1 && pairing.port <= 65535) {
        this.info.port = pairing.port;
      }
      if (typeof pairing.token === 'string' && pairing.token.trim().length >= 8) {
        this.token = pairing.token.trim();
        try {
          localStorage.setItem('sophia:companion:token', this.token);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* plain browser — manual pairing below */
    }
  }

  private openSocket(done: (ok: boolean) => void) {
    try {
      if (!this.token) {
        try { this.token = localStorage.getItem('sophia:companion:token') ?? ''; } catch { /* ignore */ }
      }
      const session = this.token ? null : this.loadSession();
      const needCode = !this.token && !session;
      const helloFor = async (): Promise<Record<string, unknown> | null> => {
        const device = helloDeviceBlock(await getOrCreateDevice());
        if (this.token) {
          return looksLikeCode(this.token)
            ? { type: 'hello', pairing_code: this.token, device }
            : { type: 'hello', token: this.token, device };
        }
        if (session) return { type: 'hello', session: session.token, device };
        const code = await this.fetchLoopbackCode();
        return code ? { type: 'hello', pairing_code: code, device } : null;
      };
      void helloFor().then((hello) => {
        if (!hello) {
          this.setStatus('error', needCode ? 'No pairing code. Start companion/server.mjs and paste its code in Settings.' : 'Pairing failed.');
          done(false);
          return;
        }
        this.dial(hello, done);
      });
    } catch (e) {
      this.setStatus('error', (e as Error).message);
      done(false);
    }
  }

  private dial(hello: Record<string, unknown>, done: (ok: boolean) => void) {
    try {
      this.setStatus('connecting');
      const ws = new WebSocket(`ws://127.0.0.1:${this.info.port}`);
      this.ws = ws;
      const timeout = window.setTimeout(() => { ws.close(); this.setStatus('error', 'Companion not reachable — is companion/server.mjs running?'); done(false); }, 4000);

      ws.onopen = () => ws.send(JSON.stringify(hello));
      ws.onmessage = (ev) => {
        let msg: any;
        try { msg = JSON.parse(String(ev.data)); } catch { return; }
        if (msg.type === 'welcome') {
          window.clearTimeout(timeout);
          this.scope = msg.scope === 'view' ? 'view' : 'control';
          if (typeof msg.session === 'string' && typeof msg.expires_at === 'number') {
            this.storeSession(msg.session, msg.expires_at);
          }
          this.repairedd = false;
          this.setStatus('connected', '', { ...this.info, actions: msg.actions });
          done(true);
        } else if (msg.type === 'event' && typeof msg.event === 'string') {
          const { type: _t, event, ...detail } = msg;
          try {
            this.onEvent?.(event, detail as Record<string, unknown>);
          } catch { /* observers never break the link */ }
          this.dispatchEvent(new CustomEvent('companion-event', { detail: { event, ...(detail as object) } }));
        } else if ((msg.type === 'result' || msg.type === 'confirmed') && typeof msg.id === 'number') {
          const p = this.pending.get(msg.id);
          if (p) {
            window.clearTimeout(p.timer);
            this.pending.delete(msg.id);
            const reply = {
              ok: Boolean(msg.ok),
              result: msg.result,
              error: msg.error,
              detail: msg.detail,
              needsConfirmation: msg.needsConfirmation,
              confirmation_id: typeof msg.confirmation_id === 'string' ? msg.confirmation_id : undefined,
              action: typeof msg.action === 'string' ? msg.action : undefined,
            };
            this.observe(p.action, p.args, reply);
            p.resolve(reply);
          }
        }
      };
      ws.onclose = (ev) => {
        window.clearTimeout(timeout);
        for (const [, p] of this.pending) { window.clearTimeout(p.timer); p.resolve({ ok: false, error: 'disconnected' }); }
        this.pending.clear();
        const wasConnected = this.status === 'connected';
        this.scope = '';
        if (ev.code === 4003) this.setStatus('error', 'Pairing code rejected by the companion.');
        else if (ev.code === 4001) this.setStatus('error', 'Pairing timed out.');
        else if (ev.code === 4009) {
          // Revoked or expired: drop the stored session and re-pair once
          // (loopback fetch makes this silent on the same machine).
          this.clearSession();
          if (!this.repairedd && !this.token) {
            this.repairedd = true;
            this.setStatus('connecting');
            window.setTimeout(() => { void this.connect(); }, 800);
            return;
          }
          this.setStatus('error', 'Session revoked or expired — pair again in Settings.');
        } else this.setStatus(wasConnected ? 'disconnected' : 'error', wasConnected ? '' : 'Companion not reachable — is companion/server.mjs running?');
      };
      ws.onerror = () => { /* onclose follows */ };
    } catch (e) {
      this.setStatus('error', (e as Error).message);
      done(false);
    }
  }

  disconnect() {
    try { this.ws?.close(); } catch { /* ignore */ }
    this.setStatus('disconnected');
  }

  /**
   * Optional observer fired after every daemon reply (the autonomy bridge
   * uses it for NOTIFY-tier toasts). Fire-and-forget: throws are swallowed,
   * and the reply itself is never altered. Unset = zero behavior change.
   */
  afterReply?: (action: string, args: Record<string, unknown>, reply: CompanionReply) => void;

  /**
   * Daemon events (approval_request, approval_resolved, session_ended).
   * Fire-and-forget like afterReply. Unset = zero behavior change.
   */
  onEvent?: (event: string, detail: Record<string, unknown>) => void;

  private observe(action: string, args: Record<string, unknown>, reply: CompanionReply): void {
    try {
      this.afterReply?.(action, args, reply);
    } catch {
      /* observers never break the link */
    }
  }

  /** Send one action. Resolves with the daemon's reply (never throws on protocol errors). */
  send<T = unknown>(action: string, args: Record<string, unknown> = {}, timeoutMs = 20000): Promise<CompanionReply<T>> {
    if (!this.connected || !this.ws) {
      const reply = { ok: false, error: 'not_connected', detail: this.lastError || 'Companion is not connected.' };
      this.observe(action, args, reply);
      return Promise.resolve(reply);
    }
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        const reply = { ok: false, error: 'timeout', detail: `${action} timed out` };
        this.observe(action, args, reply);
        resolve(reply);
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (r: CompanionReply) => void, timer, action, args });
      this.ws!.send(JSON.stringify({ type: 'action', id, action, args }));
    });
  }

  /**
   * UI/voice-confirm handler: redeem a daemon-issued confirmation_id so the
   * retried action may run once. The model tool path NEVER calls this — only
   * explicit user approval (tap / spoken "yes") may redeem an id.
   */
  confirm(confirmationId: string, timeoutMs = 10000): Promise<{ ok: boolean; action?: string; error?: string }> {
    if (!this.connected || !this.ws) return Promise.resolve({ ok: false, error: 'not_connected' });
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: 'timeout' });
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (r) => resolve({
          ok: r.ok,
          action: typeof (r.result as { action?: unknown } | undefined)?.action === 'string'
            ? String((r.result as { action: unknown }).action)
            : undefined,
          error: r.error,
        }),
        timer,
        action: 'confirm',
        args: {},
      });
      this.ws!.send(JSON.stringify({ type: 'confirm', id, confirmation_id: confirmationId }));
    });
  }
}

export const companion = new CompanionClient();
