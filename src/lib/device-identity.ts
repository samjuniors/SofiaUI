/**
 * lib/device-identity.ts — Phase 28: this device's identity for pairing.
 *
 * One P-256 keypair per browser/profile, generated once via WebCrypto and
 * kept in localStorage (`sophia:device:v1`). The daemon TOFU-pins the
 * public half at pairing; a changed key for a known id is rejected, so a
 * stolen device id alone cannot impersonate. The private half never leaves
 * this profile (it signs relay challenges in Phase 30).
 *
 * Pure storage injection keeps this testable under node (which also has
 * WebCrypto subtle — the daemon cross-checks agreement in pairing.test.mjs).
 */

export interface DeviceIdentity {
  id: string;
  name: string;
  pubkey: JsonWebKey;
  privkey: JsonWebKey;
  created: number;
}

export interface DeviceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEVICE_STORAGE_KEY = 'sophia:device:v1';

function defaultStorage(): DeviceStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function randomId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `dev_${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

function defaultName(): string {
  try {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    if (/Android/i.test(ua)) return 'Android phone';
    if (/iPhone|iPad/i.test(ua)) return 'iPhone';
    if (/Windows/i.test(ua)) return 'Windows browser';
    if (/Macintosh|Mac OS/i.test(ua)) return 'Mac browser';
    if (/Linux/i.test(ua)) return 'Linux browser';
  } catch {
    /* fall through */
  }
  return 'web browser';
}

function validIdentity(v: unknown): v is DeviceIdentity {
  const o = v as DeviceIdentity | null;
  return (
    !!o &&
    typeof o.id === 'string' &&
    o.id.startsWith('dev_') &&
    typeof o.name === 'string' &&
    !!o.pubkey &&
    o.pubkey.kty === 'EC' &&
    o.pubkey.crv === 'P-256' &&
    typeof o.pubkey.x === 'string' &&
    typeof o.pubkey.y === 'string' &&
    !!o.privkey &&
    typeof o.privkey.d === 'string'
  );
}

/** Load or create this profile's device identity (rotates on corruption). */
export async function getOrCreateDevice(storage: DeviceStorage | null = defaultStorage()): Promise<DeviceIdentity> {
  try {
    const raw = storage?.getItem(DEVICE_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (validIdentity(parsed)) return parsed;
    }
  } catch {
    /* corrupt → regenerate below */
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const [pubkey, privkey] = await Promise.all([
    crypto.subtle.exportKey('jwk', pair.publicKey),
    crypto.subtle.exportKey('jwk', pair.privateKey),
  ]);
  const identity: DeviceIdentity = { id: randomId(), name: defaultName(), pubkey, privkey, created: Date.now() };
  try {
    storage?.setItem(DEVICE_STORAGE_KEY, JSON.stringify(identity));
  } catch {
    /* private mode — session-only identity */
  }
  return identity;
}

/** The device block sent inside every hello. */
export function helloDeviceBlock(identity: DeviceIdentity): { id: string; name: string; pubkey: JsonWebKey } {
  return { id: identity.id, name: identity.name, pubkey: identity.pubkey };
}

/** QR/code payload a NEW device scans or types (shown on the PC screen). */
export interface PairPayload {
  v: 1;
  daemon: string;
  code: string;
  expires_at: number;
  port: number;
  pubkey: JsonWebKey;
}

export function pairPayloadText(p: PairPayload): string {
  return `sophia://pair?v=1&daemon=${encodeURIComponent(p.daemon)}&code=${encodeURIComponent(p.code)}&port=${p.port}`;
}
