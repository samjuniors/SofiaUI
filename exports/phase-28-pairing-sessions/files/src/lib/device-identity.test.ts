/**
 * lib/device-identity.test.ts — Phase 28: device identity create/load/rotate.
 * Runs under node (WebCrypto subtle is global there too).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { getOrCreateDevice, helloDeviceBlock, pairPayloadText, DEVICE_STORAGE_KEY } from './device-identity.ts';

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    raw: m,
  };
}

test('creates a P-256 identity and persists it', async () => {
  const storage = memStorage();
  const d = await getOrCreateDevice(storage);
  assert.match(d.id, /^dev_[A-Za-z0-9_-]+$/);
  assert.equal(d.pubkey.kty, 'EC');
  assert.equal(d.pubkey.crv, 'P-256');
  assert.equal(typeof d.privkey.d, 'string');
  assert.ok(storage.raw.has(DEVICE_STORAGE_KEY));
});

test('loads the stable identity on repeat calls', async () => {
  const storage = memStorage();
  const a = await getOrCreateDevice(storage);
  const b = await getOrCreateDevice(storage);
  assert.equal(b.id, a.id);
  assert.deepEqual(b.pubkey, a.pubkey);
});

test('corrupt storage rotates to a fresh identity', async () => {
  const storage = memStorage();
  storage.setItem(DEVICE_STORAGE_KEY, 'not json{{{');
  const d = await getOrCreateDevice(storage);
  assert.match(d.id, /^dev_/);
  storage.setItem(DEVICE_STORAGE_KEY, JSON.stringify({ id: 'dev_evil', name: 'x' }));
  const e = await getOrCreateDevice(storage);
  assert.notEqual(e.id, 'dev_evil', 'keyless impostors are rejected');
});

test('hello block carries id+name+pubkey but never the private key', async () => {
  const d = await getOrCreateDevice(memStorage());
  const block = helloDeviceBlock(d);
  assert.equal(block.id, d.id);
  assert.deepEqual(block.pubkey, d.pubkey);
  assert.ok(!('privkey' in block));
  assert.ok(!JSON.stringify(block).includes(d.privkey.d as string));
});

test('pair payload is a compact scannable URL', () => {
  const text = pairPayloadText({ v: 1, daemon: 'pc_abc', code: 'AB12-CD34', expires_at: 1, port: 7788, pubkey: {} });
  assert.equal(text, 'sophia://pair?v=1&daemon=pc_abc&code=AB12-CD34&port=7788');
});
