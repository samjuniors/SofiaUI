import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JudgeMemory, type JudgeStoreCaller, type JudgeStorage } from './judge-memory.ts';
import type { CalibratorSnapshot } from './decision-judge.ts';

const calib = (weights: Record<string, number> = {}): CalibratorSnapshot => ({ buckets: {}, weights });

function fakeStorage(initial: Record<string, string> = {}): JudgeStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

function fakeCaller(
  store: Map<string, unknown>,
  opts: { fail?: boolean } = {},
): { caller: JudgeStoreCaller; puts: Array<{ key: string; value: unknown }> } {
  const puts: Array<{ key: string; value: unknown }> = [];
  const caller: JudgeStoreCaller = async (action, params) => {
    if (opts.fail) throw new Error('offline');
    if (action === 'store_get') {
      const key = String(params?.key);
      return { ok: true, result: { found: store.has(key), value: store.get(key) } };
    }
    if (action === 'store_put') {
      const key = String(params?.key);
      store.set(key, params?.value);
      puts.push({ key, value: params?.value });
      return { ok: true, result: {} };
    }
    return { ok: false, error: 'unknown_action' };
  };
  return { caller, puts };
}

const KEY = 'sofia.judge.calibration.v1';
const persisted = (updatedAt: number, c: CalibratorSnapshot) => ({ v: 1, updatedAt, calib: c });

describe('JudgeMemory', () => {
  it('save writes local + remote and reports both legs', async () => {
    const storage = fakeStorage();
    const remote = new Map<string, unknown>();
    const { caller } = fakeCaller(remote);
    const mem = new JudgeMemory({ caller, storage });
    const r = await mem.save(calib({ 'plan:risk': 2 }));
    assert.deepEqual(r, { local: true, remote: true });
    assert.ok(storage.map.has(KEY));
    assert.ok(remote.has(KEY));
    assert.equal((remote.get(KEY) as { calib: CalibratorSnapshot }).calib.weights['plan:risk'], 2);
  });

  it('save survives companion failure — local still lands', async () => {
    const storage = fakeStorage();
    const { caller } = fakeCaller(new Map(), { fail: true });
    const mem = new JudgeMemory({ caller, storage });
    const r = await mem.save(calib());
    assert.deepEqual(r, { local: true, remote: false });
    assert.ok(storage.map.has(KEY));
  });

  it('save works with no local storage (remote only)', async () => {
    const remote = new Map<string, unknown>();
    const { caller } = fakeCaller(remote);
    const mem = new JudgeMemory({ caller, storage: null });
    const r = await mem.save(calib());
    assert.deepEqual(r, { local: false, remote: true });
  });

  it('load adopts the newer remote copy', async () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify(persisted(100, calib({ a: 1 }))) });
    const remote = new Map<string, unknown>([[KEY, persisted(200, calib({ b: 2 }))]]);
    const { caller, puts } = fakeCaller(remote);
    const mem = new JudgeMemory({ caller, storage });
    const got = await mem.load();
    assert.deepEqual(got, calib({ b: 2 }));
    assert.equal(puts.length, 0);
  });

  it('load adopts the newer local copy and pushes it up', async () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify(persisted(300, calib({ c: 3 }))) });
    const remote = new Map<string, unknown>([[KEY, persisted(100, calib({ b: 2 }))]]);
    const { caller, puts } = fakeCaller(remote);
    const mem = new JudgeMemory({ caller, storage });
    const got = await mem.load();
    assert.deepEqual(got, calib({ c: 3 }));
    assert.equal(puts.length, 1);
    assert.equal(puts[0].key, KEY);
  });

  it('load with nothing stored returns null', async () => {
    const mem = new JudgeMemory({ caller: fakeCaller(new Map()).caller, storage: fakeStorage() });
    assert.equal(await mem.load(), null);
  });

  it('load ignores malformed copies on either leg', async () => {
    const storage = fakeStorage({ [KEY]: 'not-json{{{' });
    const remote = new Map<string, unknown>([[KEY, { v: 1 }]]);
    const mem = new JudgeMemory({ caller: fakeCaller(remote).caller, storage });
    assert.equal(await mem.load(), null);
  });

  it('load survives companion failure — local still loads', async () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify(persisted(50, calib({ d: 4 }))) });
    const { caller } = fakeCaller(new Map(), { fail: true });
    const mem = new JudgeMemory({ caller, storage });
    assert.deepEqual(await mem.load(), calib({ d: 4 }));
  });
});
