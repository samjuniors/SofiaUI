/**
 * companion/pairing.test.mjs — Phase 28: codes, devices, sessions, approvals,
 * and the device-key crypto both sides share (classic API here, WebCrypto
 * subtle in the browser — cross-checked below, since node has both).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import {
  TrustStore,
  VIEW_ACTIONS,
  isViewAction,
  CODE_TTL_MS,
  SESSION_TTL_MS,
  CONTROL_GRANT_TTL_MS,
  generateIdentityKey,
  ecdhSecret,
  signBytes,
  verifyBytes,
} from './pairing.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'sophia-pairing-'));
const clock = () => {
  let t = 1_700_000_000_000;
  return { now: () => t, skip: (ms) => { t += ms; } };
};
const store = () => {
  const c = clock();
  return { c, s: new TrustStore(tmp(), { now: c.now }) };
};
const dev = (id = 'dev_1') => ({ id, name: 'test phone', pubkey: { kty: 'EC', crv: 'P-256', x: 'a', y: 'b' } });

test('codes issue, redeem once each, and expire', () => {
  const { c, s } = store();
  const a = s.issueCode();
  assert.match(a.value, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(s.issueCode().value, a.value, 'stable until expiry');
  assert.equal(s.redeemCode(a.value.toLowerCase().replace('-', ' ')), 'ok', 'tolerant format');
  assert.equal(s.redeemCode('ZZZZ-ZZZZ'), 'bad');
  c.skip(CODE_TTL_MS + 1);
  assert.equal(s.redeemCode(a.value), 'expired');
  assert.notEqual(s.issueCode().value, a.value, 'rotates after expiry');
});

test('code redemption is rate-limited', () => {
  const { s } = store();
  s.issueCode();
  for (let i = 0; i < 10; i++) s.redeemCode('bad-code');
  assert.equal(s.redeemCode('bad-code'), 'locked');
});

test('devices register and TOFU-pin their pubkey', () => {
  const { s } = store();
  const r1 = s.upsertDevice(dev());
  assert.equal(r1.ok, true);
  const other = { ...dev(), pubkey: { kty: 'EC', crv: 'P-256', x: 'EVIL', y: 'b' } };
  const r2 = s.upsertDevice(other);
  assert.equal(r2.ok, false);
  assert.equal(r2.error, 'device_key_mismatch');
});

test('sessions validate, expire, and die with their device', () => {
  const { c, s } = store();
  s.upsertDevice(dev());
  const { token, session } = s.createSession('dev_1', 'control');
  assert.equal(typeof token, 'string');
  assert.ok(token.length >= 40);
  assert.equal(s.validateSession(token)?.device_id, 'dev_1');
  assert.equal(s.validateSession('bogus'), null);
  // The token itself is never persisted — only its hash.
  assert.ok(!JSON.stringify(s.doc).includes(token), 'no raw token on disk');
  c.skip(SESSION_TTL_MS + 1);
  assert.equal(s.validateSession(token), null, 'expired sessions die');
  const again = s.createSession('dev_1', 'control');
  assert.ok(s.revokeDevice('dev_1'));
  assert.equal(s.validateSession(again.token), null, 'revoked device kills sessions');
  assert.equal(s.upsertDevice(dev()).ok, false, 'revoked devices cannot re-register');
});

test('control approvals: per-session, non-self, time-boxed', () => {
  const { c, s } = store();
  s.upsertDevice(dev('viewer'));
  s.upsertDevice(dev('approver'));
  const view = s.createSession('viewer', 'view');
  const ctrl = s.createSession('approver', 'control');
  const req = s.requestControl(view.session.id);
  assert.equal(req.ok, true);
  assert.equal(s.requestControl(view.session.id).duplicate, true, 'one open request per session');
  // A view session cannot approve, and nobody can self-approve.
  assert.equal(s.resolveApproval(req.approval.id, true, view.session.id).ok, false);
  const done = s.resolveApproval(req.approval.id, true, ctrl.session.id);
  assert.equal(done.ok, true);
  assert.equal(s.getSessionById(view.session.id).effectiveScope, 'control');
  // The grant expires back to view even though the session lives on.
  c.skip(CONTROL_GRANT_TTL_MS + 1);
  assert.equal(s.getSessionById(view.session.id).effectiveScope, 'view');
});

test('stale approvals cannot be resolved', () => {
  const { c, s } = store();
  s.upsertDevice(dev('v'));
  s.upsertDevice(dev('a'));
  const view = s.createSession('v', 'view');
  const ctrl = s.createSession('a', 'control');
  const req = s.requestControl(view.session.id);
  c.skip(6 * 60 * 1000);
  assert.equal(s.listApprovals().length, 0);
  assert.equal(s.resolveApproval(req.approval.id, true, ctrl.session.id).error, 'no_pending_approval');
});

test('view scope is default-deny: control actions stay out', () => {
  for (const a of ['click', 'type_text', 'hotkey', 'open_app', 'files_move', 'files_trash', 'whatsapp_send', 'devices_revoke', ' Approvals_resolve'.trim(), 'browser_navigate', 'notify', 'confirm']) {
    assert.equal(isViewAction(a), false, a);
  }
  for (const a of ['ping', 'screenshot', 'files_read', 'memory_list', 'session_info', 'control_request', 'observe']) {
    assert.equal(isViewAction(a), true, a);
  }
  assert.ok(VIEW_ACTIONS.size > 20);
});

test('crypto: ECDH agreement matches WebCrypto subtle (browser parity)', async () => {
  const a = generateIdentityKey();
  const b = generateIdentityKey();
  const classicAB = ecdhSecret(a.privateJwk, b.publicJwk);
  assert.equal(classicAB.length, 32);
  assert.ok(classicAB.equals(ecdhSecret(b.privateJwk, a.publicJwk)), 'agreement is symmetric');
  // Same answer via the exact API the browser will use.
  const privA = await webcrypto.subtle.importKey('jwk', a.privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const pubB = await webcrypto.subtle.importKey('jwk', b.publicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const subtleAB = Buffer.from(await webcrypto.subtle.deriveBits({ name: 'ECDH', public: pubB }, privA, 256));
  assert.ok(classicAB.equals(subtleAB), 'node classic === WebCrypto subtle');
});

test('crypto: ECDSA signatures verify cross-API and reject forgeries', async () => {
  const a = generateIdentityKey();
  const b = generateIdentityKey();
  const msg = Buffer.from('pairing challenge 123');
  const sig = signBytes(a.privateJwk, msg);
  assert.equal(verifyBytes(a.publicJwk, msg, sig), true);
  assert.equal(verifyBytes(a.publicJwk, Buffer.from('tampered'), sig), false);
  assert.equal(verifyBytes(b.publicJwk, msg, sig), false, 'wrong key rejects');
  // Browser-side verification of a daemon signature.
  const pub = await webcrypto.subtle.importKey('jwk', a.publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.equal(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig, msg), true);
});

test('daemon identity persists across restarts', () => {
  const dir = tmp();
  const c = clock();
  const s1 = new TrustStore(dir, { now: c.now });
  const s2 = new TrustStore(dir, { now: c.now });
  assert.equal(s2.daemonId, s1.daemonId);
  assert.deepEqual(s2.daemonPubkey(), s1.daemonPubkey());
});
