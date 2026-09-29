/**
 * core/memory-store.test.ts — durable user facts, prompt context, sync.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryStore,
  MEMORY_COMPANION_KEY,
  defaultMemorySnapshot,
  memoryContextFor,
} from './MemoryStore.ts';
import type { CompanionCaller } from './Soul.ts';

test('fresh memory is empty and context-free', () => {
  const store = new MemoryStore();
  assert.equal(store.isEmpty(), true);
  assert.equal(store.toPromptContext(), '');
  assert.deepEqual(store.snapshot(), { ...defaultMemorySnapshot(), updatedAt: store.snapshot().updatedAt });
});

test('user name lands in the prompt context', () => {
  const store = new MemoryStore();
  store.setUserName('  Sam  ');
  assert.equal(store.snapshot().userName, 'Sam');
  assert.match(store.toPromptContext(), /Sam/);
  assert.equal(store.isEmpty(), false);
});

test('people upsert by name and merge fields', () => {
  const store = new MemoryStore();
  store.upsertPerson({ name: 'Ada', relation: 'sister' });
  store.upsertPerson({ name: 'ada', notes: 'loves jazz' });
  const people = store.snapshot().people;
  assert.equal(people.length, 1);
  assert.equal(people[0].name, 'Ada');
  assert.equal(people[0].relation, 'sister');
  assert.equal(people[0].notes, 'loves jazz');
  assert.match(store.toPromptContext(), /Ada.*jazz/);
  store.removePerson('ADA');
  assert.equal(store.snapshot().people.length, 0);
  // blank names are ignored
  store.upsertPerson({ name: '   ' });
  assert.equal(store.snapshot().people.length, 0);
});

test('preferences set, overwrite, and clear on empty value', () => {
  const store = new MemoryStore();
  store.setPreference('coffee', 'flat white');
  store.setPreference('coffee', 'long black');
  assert.equal(store.snapshot().preferences.coffee, 'long black');
  assert.match(store.toPromptContext(), /coffee = long black/);
  store.setPreference('coffee', '   ');
  assert.ok(!('coffee' in store.snapshot().preferences));
  store.setPreference('  ', 'x');
  assert.deepEqual(store.snapshot().preferences, {});
  store.setPreference('a', '1');
  store.removePreference('a');
  assert.deepEqual(store.snapshot().preferences, {});
});

test('instructions de-duplicate and remove cleanly', () => {
  const store = new MemoryStore();
  store.addInstruction('Always confirm before sending.');
  store.addInstruction('Always confirm before sending.');
  store.addInstruction('  ');
  assert.equal(store.snapshot().instructions.length, 1);
  assert.match(store.toPromptContext(), /Standing instructions/);
  store.removeInstruction('Always confirm before sending.');
  assert.equal(store.snapshot().instructions.length, 0);
});

test('fields are length-capped', () => {
  const store = new MemoryStore();
  store.setUserName('x'.repeat(500));
  assert.ok(store.snapshot().userName.length <= 80);
  store.addInstruction('y'.repeat(2000));
  assert.ok(store.snapshot().instructions[0].length <= 500);
});

test('memoryContextFor renders every section and ignores garbage', () => {
  assert.equal(memoryContextFor(null), '');
  assert.equal(memoryContextFor(undefined), '');
  assert.equal(memoryContextFor({}), '');
  const ctx = memoryContextFor({
    userName: 'Sam',
    people: [{ name: 'Ada', relation: 'sister', notes: 'jazz' }],
    preferences: { coffee: 'flat white' },
    instructions: ['Confirm before sending.'],
  });
  assert.match(ctx, /Sam/);
  assert.match(ctx, /Ada \(sister\) — jazz/);
  assert.match(ctx, /coffee = flat white/);
  assert.match(ctx, /Confirm before sending/);
});

test('push writes the snapshot under the memory key', async () => {
  const store = new MemoryStore();
  store.setUserName('Sam');
  const calls: Array<{ action: string; args: Record<string, unknown> }> = [];
  const caller: CompanionCaller = async (action, args = {}) => {
    calls.push({ action, args });
    return { ok: true, result: undefined };
  };
  const r = await store.pushToCompanion(caller);
  assert.equal(r.ok, true);
  assert.equal(calls[0].action, 'store_put');
  assert.equal(calls[0].args.key, MEMORY_COMPANION_KEY);
  assert.equal((calls[0].args.value as { userName: string }).userName, 'Sam');
});

test('pull adopts newer remotes and reports missing keys', async () => {
  const store = new MemoryStore({ ...defaultMemorySnapshot(), updatedAt: 1000 });
  const asCaller = (value: unknown, found: boolean): CompanionCaller =>
    (async () => ({ ok: true, result: { value, found } })) as CompanionCaller;

  const newer = await store.pullFromCompanion(
    asCaller({ userName: 'Sam', updatedAt: 2000 }, true),
  );
  assert.deepEqual({ found: newer.found, adopted: newer.adopted }, { found: true, adopted: true });
  assert.equal(store.snapshot().userName, 'Sam');

  const older = await store.pullFromCompanion(
    asCaller({ userName: 'Zed', updatedAt: 1500 }, true),
  );
  assert.equal(older.adopted, false);
  assert.equal(store.snapshot().userName, 'Sam');

  const missing = await store.pullFromCompanion(asCaller(null, false));
  assert.equal(missing.found, false);
});

test('clear wipes everything', () => {
  const store = new MemoryStore();
  store.setUserName('Sam');
  store.addInstruction('x');
  store.clear();
  assert.equal(store.isEmpty(), true);
});
