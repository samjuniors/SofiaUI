/**
 * lib/companion-client.ts — the browser end of the Sofia Companion link.
 * Pairs with companion/server.mjs over WebSocket on 127.0.0.1, correlates
 * request ids, and exposes a typed `send()` plus status events.
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

export interface CompanionInfo {
  port: number;
  actions?: number;
}

interface Pending {
  resolve: (reply: CompanionReply) => void;
  timer: number;
}

class CompanionClient extends EventTarget {
  status: CompanionStatus = 'disconnected';
  info: CompanionInfo = { port: 7788 };
  lastError = '';
  private ws: WebSocket | null = null;
  private token = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();

  get connected(): boolean {
    return this.status === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  setPairing(token: string, port?: number) {
    this.token = token.trim();
    if (port) this.info.port = port;
    try { localStorage.setItem('sophia:companion:token', this.token); } catch { /* ignore */ }
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
      if (!this.token) {
        this.setStatus('error', 'No pairing code. Start companion/server.mjs and paste its code in Settings.');
        done(false);
        return;
      }
      this.setStatus('connecting');
      const ws = new WebSocket(`ws://127.0.0.1:${this.info.port}`);
      this.ws = ws;
      const timeout = window.setTimeout(() => { ws.close(); this.setStatus('error', 'Companion not reachable — is companion/server.mjs running?'); done(false); }, 4000);

      ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', token: this.token }));
      ws.onmessage = (ev) => {
        let msg: any;
        try { msg = JSON.parse(String(ev.data)); } catch { return; }
        if (msg.type === 'welcome') {
          window.clearTimeout(timeout);
          this.setStatus('connected', '', { ...this.info, actions: msg.actions });
          done(true);
        } else if ((msg.type === 'result' || msg.type === 'confirmed') && typeof msg.id === 'number') {
          const p = this.pending.get(msg.id);
          if (p) {
            window.clearTimeout(p.timer);
            this.pending.delete(msg.id);
            p.resolve({
              ok: Boolean(msg.ok),
              result: msg.result,
              error: msg.error,
              detail: msg.detail,
              needsConfirmation: msg.needsConfirmation,
              confirmation_id: typeof msg.confirmation_id === 'string' ? msg.confirmation_id : undefined,
              action: typeof msg.action === 'string' ? msg.action : undefined,
            });
          }
        }
      };
      ws.onclose = (ev) => {
        window.clearTimeout(timeout);
        for (const [, p] of this.pending) { window.clearTimeout(p.timer); p.resolve({ ok: false, error: 'disconnected' }); }
        this.pending.clear();
        const wasConnected = this.status === 'connected';
        if (ev.code === 4003) this.setStatus('error', 'Pairing code rejected by the companion.');
        else if (ev.code === 4001) this.setStatus('error', 'Pairing timed out.');
        else this.setStatus(wasConnected ? 'disconnected' : 'error', wasConnected ? '' : 'Companion not reachable — is companion/server.mjs running?');
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

  /** Send one action. Resolves with the daemon's reply (never throws on protocol errors). */
  send<T = unknown>(action: string, args: Record<string, unknown> = {}, timeoutMs = 20000): Promise<CompanionReply<T>> {
    if (!this.connected || !this.ws) return Promise.resolve({ ok: false, error: 'not_connected', detail: this.lastError || 'Companion is not connected.' });
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => { this.pending.delete(id); resolve({ ok: false, error: 'timeout', detail: `${action} timed out` }); }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (r: CompanionReply) => void, timer });
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
      });
      this.ws!.send(JSON.stringify({ type: 'confirm', id, confirmation_id: confirmationId }));
    });
  }
}

export const companion = new CompanionClient();
