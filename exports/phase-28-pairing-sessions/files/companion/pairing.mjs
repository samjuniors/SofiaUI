/**
 * companion/pairing.mjs — Phase 28: pairing codes, devices, sessions, approvals.
 *
 * Two modes, one protocol:
 *   INSTALLED  Electron spawns the daemon with a bundled master token —
 *              hello{token} just works, no pairing step (as before).
 *   WEB/LOCAL  The page fetches a pairing code over loopback HTTP (or the
 *              user types the console code / scans the on-screen QR) and
 *              exchanges it for a device-bound session token.
 *
 * Scopes: `view` (read-only telemetry — default-deny allowlist below) and
 * `control` (everything, still subject to the SafetyPolicy risk gates).
 * Quick (quick-code) sessions grant control immediately: reading the code
 * off the PC screen IS the physical-presence approval. Anything weaker
 * (Phase 30's relay) starts view-only and escalates through the approval
 * queue, which this module implements now: control_request → a control
 * session approves → a time-boxed control grant (default 1h).
 *
 * Persistence: DATA_DIR/pairing.json (atomic tmp+rename writes) holds the
 * daemon identity, devices, sessions, and pending approvals — a daemon
 * restart neither kicks sessions nor strands approvals. Session TOKENS are
 * never persisted, only their sha256.
 *
 * Device keys: P-256 ECDSA identity + ECDH agreement (classic node:crypto
 * here, WebCrypto subtle in the browser — both standard, cross-checked in
 * pairing.test.mjs). Local quick pairing treats the asserted pubkey as
 * TOFU-pinned; relay pairing (Phase 30) will challenge it.
 */

import {
  randomBytes,
  createHash,
  timingSafeEqual,
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const SESSION_TTL_MS = 24 * 3600 * 1000;
export const CONTROL_GRANT_TTL_MS = 60 * 60 * 1000;
export const APPROVAL_TTL_MS = 5 * 60 * 1000;
export const CODE_ATTEMPT_WINDOW_MS = 60 * 1000;
export const CODE_ATTEMPT_MAX = 10;

const CODE_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // Crockford-ish, no 0/O/1/I/L

/** View scope: read-only telemetry. Everything else needs control. Default-deny. */
export const VIEW_ACTIONS = new Set([
  'ping', 'skills_list', 'actions_recent', 'session_info', 'control_request',
  'screenshot', 'observe', 'get_cursor', 'get_active_window', 'get_volume',
  'files_roots', 'files_list', 'files_find', 'files_read',
  'store_get', 'store_keys', 'episodes_search', 'episodes_recent',
  'health_snapshot', 'health_processes', 'media_status',
  'ground_text', 'ground_ocr', 'voice_info',
  'memory_context', 'memory_list', 'memory_get', 'memory_counts', 'memory_export',
]);

export function isViewAction(action) {
  return VIEW_ACTIONS.has(String(action ?? ''));
}

function rand(n) {
  return randomBytes(n).toString('base64url');
}

function sha256hex(s) {
  return createHash('sha256').update(String(s)).digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/* ── device-key crypto (P-256; shared with the browser via JWK) ─────────── */

export function generateIdentityKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    publicJwk: publicKey.export({ format: 'jwk' }),
    privateJwk: privateKey.export({ format: 'jwk' }),
  };
}

/** Raw 32-byte ECDH shared secret. Both sides HKDF it before use (Phase 30). */
export function ecdhSecret(privateJwk, peerPublicJwk) {
  const priv = createPrivateKey({ key: privateJwk, format: 'jwk' });
  const pub = createPublicKey({ key: peerPublicJwk, format: 'jwk' });
  return diffieHellman({ privateKey: priv, publicKey: pub });
}

export function signBytes(privateJwk, bytes) {
  const priv = createPrivateKey({ key: privateJwk, format: 'jwk' });
  // ieee-p1363 (raw R||S): the exact encoding WebCrypto subtle uses.
  return cryptoSign('sha256', Buffer.from(bytes), { key: priv, dsaEncoding: 'ieee-p1363' });
}

export function verifyBytes(publicJwk, bytes, signature) {
  try {
    const pub = createPublicKey({ key: publicJwk, format: 'jwk' });
    return cryptoVerify('sha256', Buffer.from(bytes), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature));
  } catch {
    return false;
  }
}

/* ── the store ──────────────────────────────────────────────────────────── */

export class TrustStore {
  constructor(dataDir, opts = {}) {
    this.dir = dataDir;
    this.now = opts.now ?? (() => Date.now());
    this.path = join(dataDir, 'pairing.json');
    this.attempts = []; // code-redeem attempt timestamps (in-memory rate limit)
    this.doc = this.load();
  }

  load() {
    let doc = null;
    try {
      doc = JSON.parse(readFileSync(this.path, 'utf8'));
    } catch {
      doc = null;
    }
    if (!doc || doc.version !== 1 || !doc.daemonId || !doc.daemonKey) {
      const { publicJwk, privateJwk } = generateIdentityKey();
      doc = {
        version: 1,
        daemonId: `pc_${rand(9)}`,
        daemonKey: { publicJwk, privateJwk },
        code: null,
        devices: [],
        sessions: [],
        approvals: [],
      };
      this.doc = doc;
      this.save();
      return doc;
    }
    doc.devices ??= [];
    doc.sessions ??= [];
    doc.approvals ??= [];
    return doc;
  }

  save() {
    mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.doc, null, 2));
    renameSync(tmp, this.path);
  }

  get daemonId() {
    return this.doc.daemonId;
  }

  daemonPubkey() {
    return this.doc.daemonKey.publicJwk;
  }

  /* ── pairing codes ── */

  issueCode() {
    const t = this.now();
    if (!this.doc.code || this.doc.code.expires_at <= t) {
      let raw = '';
      for (let i = 0; i < 8; i++) raw += CODE_ALPHA[randomBytes(1)[0] % CODE_ALPHA.length];
      this.doc.code = { value: `${raw.slice(0, 4)}-${raw.slice(4)}`, expires_at: t + CODE_TTL_MS };
      this.save();
    }
    return { ...this.doc.code };
  }

  /** 'ok' | 'bad' | 'expired' | 'locked' (rate-limited). Never throws. */
  redeemCode(code) {
    const t = this.now();
    this.attempts = this.attempts.filter((ts) => t - ts < CODE_ATTEMPT_WINDOW_MS);
    if (this.attempts.length >= CODE_ATTEMPT_MAX) return 'locked';
    this.attempts.push(t);
    const cur = this.doc.code;
    if (!cur || cur.expires_at <= t) return 'expired';
    const norm = String(code ?? '').trim().toUpperCase().replace(/[\s-]/g, '');
    const want = cur.value.replace(/-/g, '');
    return safeEqual(norm, want) ? 'ok' : 'bad';
  }

  /* ── devices (TOFU-pinned pubkeys) ── */

  upsertDevice({ id, name, pubkey, trust = 'quick' }) {
    const cleanId = String(id ?? '').slice(0, 64) || `dev_${rand(9)}`;
    let dev = this.doc.devices.find((d) => d.id === cleanId);
    const t = this.now();
    if (!dev) {
      dev = {
        id: cleanId,
        name: String(name ?? 'unnamed device').slice(0, 80),
        pubkey: pubkey && typeof pubkey === 'object' ? pubkey : null,
        trust,
        created_at: t,
        last_seen: t,
        revoked: false,
      };
      this.doc.devices.push(dev);
    } else {
      if (dev.revoked) return { device: dev, ok: false, error: 'device_revoked' };
      // TOFU pin: a known id may never present a different key.
      if (pubkey && dev.pubkey && JSON.stringify(pubkey) !== JSON.stringify(dev.pubkey)) {
        return { device: dev, ok: false, error: 'device_key_mismatch' };
      }
      if (pubkey && !dev.pubkey) dev.pubkey = pubkey;
      if (name) dev.name = String(name).slice(0, 80);
      dev.last_seen = t;
    }
    this.save();
    return { device: { ...dev }, ok: true };
  }

  getDevice(id) {
    return this.doc.devices.find((d) => d.id === id) ?? null;
  }

  listDevices() {
    return this.doc.devices.map((d) => ({ ...d, pubkey: d.pubkey ? true : undefined }));
  }

  /* ── sessions ── */

  createSession(deviceId, scope = 'control', opts = {}) {
    const t = this.now();
    const token = rand(32);
    const session = {
      id: `sess_${rand(6)}`,
      device_id: deviceId,
      scope: scope === 'view' ? 'view' : 'control',
      grant: opts.grant ?? 'quick',
      created_at: t,
      expires_at: t + (opts.ttlMs ?? SESSION_TTL_MS),
      grant_expires_at: t + (opts.ttlMs ?? SESSION_TTL_MS),
      token_hash: sha256hex(token),
    };
    this.doc.sessions.push(session);
    const dev = this.getDevice(deviceId);
    if (dev) dev.last_seen = t;
    this.save();
    const { token_hash: _h, ...pub } = session;
    return { token, session: pub };
  }

  validateSession(token) {
    this.sweep();
    const hash = sha256hex(String(token ?? ''));
    const s = this.doc.sessions.find((x) => x.token_hash && safeEqual(x.token_hash, hash));
    if (!s) return null;
    const dev = this.getDevice(s.device_id);
    if (!dev || dev.revoked) return null;
    dev.last_seen = this.now();
    return { ...s, effectiveScope: this.effectiveScope(s) };
  }

  effectiveScope(s) {
    if (s.scope !== 'control') return 'view';
    return this.now() > s.grant_expires_at ? 'view' : 'control';
  }

  getSessionById(id) {
    const s = this.doc.sessions.find((x) => x.id === id);
    return s ? { ...s, effectiveScope: this.effectiveScope(s) } : null;
  }

  listSessions() {
    this.sweep();
    return this.doc.sessions.map((s) => {
      const { token_hash: _h, ...rest } = s;
      return { ...rest, effectiveScope: this.effectiveScope(s) };
    });
  }

  revokeSession(id) {
    const i = this.doc.sessions.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const [gone] = this.doc.sessions.splice(i, 1);
    this.save();
    return { ...gone };
  }

  revokeDevice(id) {
    const dev = this.getDevice(id);
    if (!dev || dev.revoked) return null;
    dev.revoked = true;
    const killed = this.doc.sessions.filter((x) => x.device_id === id).map((x) => x.id);
    this.doc.sessions = this.doc.sessions.filter((x) => x.device_id !== id);
    for (const a of this.doc.approvals) {
      if (a.device_id === id && a.status === 'pending') a.status = 'denied';
    }
    this.save();
    return { device: { ...dev }, sessions: killed };
  }

  /* ── control approvals (per-session, default view-only) ── */

  requestControl(sessionId) {
    this.sweep();
    const s = this.doc.sessions.find((x) => x.id === sessionId);
    if (!s) return { ok: false, error: 'no_session' };
    if (this.effectiveScope(s) === 'control') return { ok: false, error: 'already_control' };
    const open = this.doc.approvals.find((a) => a.session_id === sessionId && a.status === 'pending');
    if (open) return { ok: true, approval: { ...open }, duplicate: true };
    const t = this.now();
    const approval = {
      id: `appr_${rand(6)}`,
      session_id: sessionId,
      device_id: s.device_id,
      created_at: t,
      expires_at: t + APPROVAL_TTL_MS,
      status: 'pending',
    };
    this.doc.approvals.push(approval);
    this.save();
    return { ok: true, approval: { ...approval } };
  }

  listApprovals() {
    this.sweep();
    return this.doc.approvals.filter((a) => a.status === 'pending').map((a) => ({ ...a }));
  }

  resolveApproval(id, ok, bySessionId) {
    this.sweep();
    const by = this.doc.sessions.find((x) => x.id === bySessionId);
    if (!by || this.effectiveScope(by) !== 'control') return { ok: false, error: 'approver_not_control' };
    const a = this.doc.approvals.find((x) => x.id === id && x.status === 'pending');
    if (!a) return { ok: false, error: 'no_pending_approval' };
    if (a.session_id === bySessionId) return { ok: false, error: 'cannot_self_approve' };
    a.status = ok ? 'approved' : 'denied';
    a.resolved_at = this.now();
    a.resolved_by = bySessionId;
    if (ok) {
      const s = this.doc.sessions.find((x) => x.id === a.session_id);
      if (s) {
        s.scope = 'control';
        s.grant = 'approved';
        s.grant_expires_at = Math.min(s.expires_at, this.now() + CONTROL_GRANT_TTL_MS);
      }
    }
    this.save();
    return { ok: true, approval: { ...a } };
  }

  /** Drop expired sessions + approvals. Returns what was swept. */
  sweep() {
    const t = this.now();
    const beforeS = this.doc.sessions.length;
    const beforeA = this.doc.approvals.length;
    this.doc.sessions = this.doc.sessions.filter((x) => x.expires_at > t);
    this.doc.approvals = this.doc.approvals.filter((x) => x.status !== 'pending' || x.expires_at > t);
    // Keep resolved history bounded.
    if (this.doc.approvals.length > 50) {
      const pending = this.doc.approvals.filter((x) => x.status === 'pending');
      const done = this.doc.approvals.filter((x) => x.status !== 'pending').slice(-30);
      this.doc.approvals = [...pending, ...done];
    }
    if (this.doc.sessions.length !== beforeS || this.doc.approvals.length !== beforeA) this.save();
    return { sessions: beforeS - this.doc.sessions.length, approvals: beforeA - this.doc.approvals.length };
  }
}
