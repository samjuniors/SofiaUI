/**
 * core/soul.test.ts — persona dials, presets, prompt rendering, sync.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SoulStore,
  SOUL_PRESETS,
  DEFAULT_SOUL_PRESET,
  SOUL_COMPANION_KEY,
  defaultSoulSnapshot,
  soulDialsFrom,
  systemPromptFor,
} from './Soul.ts';
import type { CompanionCaller } from './Soul.ts';

test('presets run Warm Companion → JARVIS with valid dials', () => {
  const ids = Object.keys(SOUL_PRESETS);
  assert.deepEqual(ids, ['warm-companion', 'playful-mate', 'professional', 'jarvis']);
  assert.equal(DEFAULT_SOUL_PRESET, 'warm-companion');
  for (const p of Object.values(SOUL_PRESETS)) {
    assert.ok(p.label && p.blurb);
    for (const v of Object.values(p.dials)) {
      assert.ok(Number.isFinite(v) && v >= 0 && v <= 100, `${p.id} dial out of range`);
    }
  }
  // JARVIS is the formal, terse end of the range
  assert.ok(SOUL_PRESETS.jarvis.dials.formality > SOUL_PRESETS['warm-companion'].dials.formality);
  assert.ok(SOUL_PRESETS.jarvis.dials.verbosity < SOUL_PRESETS['warm-companion'].dials.verbosity);
});

test('fresh soul is default and emits no prompt override', () => {
  const store = new SoulStore();
  assert.equal(store.isDefault(), true);
  assert.equal(store.toPromptContext(), '');
  assert.equal(store.snapshot().preset, 'warm-companion');
});

test('setDials clamps to 0–100 and marks the soul custom', () => {
  const store = new SoulStore();
  store.setDials({ warmth: 140, energy: -20 });
  const s = store.snapshot();
  assert.equal(s.warmth, 100);
  assert.equal(s.energy, 0);
  assert.equal(s.preset, 'custom');
  assert.equal(store.isDefault(), false);
  assert.ok(store.toPromptContext().length > 0);
});

test('applyPreset restores the named persona', () => {
  const store = new SoulStore();
  store.setDials({ warmth: 5 });
  store.applyPreset('jarvis');
  const s = store.snapshot();
  assert.equal(s.preset, 'jarvis');
  assert.deepEqual(
    { w: s.warmth, f: s.formality },
    { w: SOUL_PRESETS.jarvis.dials.warmth, f: SOUL_PRESETS.jarvis.dials.formality },
  );
  assert.deepEqual(s.catchphrases, SOUL_PRESETS.jarvis.catchphrases);
  store.applyPreset('warm-companion');
  assert.equal(store.isDefault(), true);
});

test('systemPromptFor maps dial extremes to words', () => {
  const hot = systemPromptFor({ warmth: 100, humour: 100, formality: 0, verbosity: 100, energy: 100 });
  assert.match(hot, /deeply warm/);
  assert.match(hot, /playful/);
  assert.match(hot, /casual/);
  assert.match(hot, /thorough/);
  assert.match(hot, /upbeat/);
  const cold = systemPromptFor({ warmth: 0, humour: 0, formality: 100, verbosity: 0, energy: 0 });
  assert.match(cold, /reserved/);
  assert.match(cold, /strictly business/);
  assert.match(cold, /formal/);
  assert.match(cold, /terse/);
  assert.match(cold, /calm/);
});

test('systemPromptFor includes phrases and boundaries', () => {
  const p = systemPromptFor({
    ...defaultSoulSnapshot(),
    catchphrases: ['too easy'],
    boundaries: ['Never sing.'],
  });
  assert.match(p, /too easy/);
  assert.match(p, /Never sing/);
});

test('systemPromptFor never throws on garbage input', () => {
  for (const bad of [null, undefined, 42, 'warm', [], { warmth: NaN }, { warmth: 'hot' }, { catchphrases: 'x' }]) {
    const p = systemPromptFor(bad);
    assert.ok(typeof p === 'string' && p.length > 10, `bad prompt for ${JSON.stringify(bad)}`);
  }
});

test('soulDialsFrom falls back per-dial', () => {
  const d = soulDialsFrom({ warmth: 10, humour: Number.NaN });
  assert.equal(d.warmth, 10);
  assert.equal(d.humour, SOUL_PRESETS['warm-companion'].dials.humour);
});

test('phrase and boundary lists are capped and de-duplicated', () => {
  const store = new SoulStore();
  store.setCatchphrases(['a', 'a', '  ', ...Array.from({ length: 30 }, (_, i) => `p${i}`)]);
  assert.ok(store.snapshot().catchphrases.length <= 12);
  assert.ok(!store.snapshot().catchphrases.includes('  '));
  store.setBoundaries(Array.from({ length: 30 }, (_, i) => `rule ${i}`));
  assert.ok(store.snapshot().boundaries.length <= 12);
});

test('pushToCompanion writes the snapshot under the soul key', async () => {
  const store = new SoulStore();
  const calls: Array<{ action: string; args: Record<string, unknown> }> = [];
  const caller: CompanionCaller = async (action, args = {}) => {
    calls.push({ action, args });
    return { ok: true, result: undefined };
  };
  const r = await store.pushToCompanion(caller);
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'store_put');
  assert.equal(calls[0].args.key, SOUL_COMPANION_KEY);
  assert.equal(typeof (calls[0].args.value as { warmth: number }).warmth, 'number');
});

test('pullFromCompanion adopts newer remotes, keeps newer locals', async () => {
  const local = new SoulStore({ ...defaultSoulSnapshot(), updatedAt: 1000, warmth: 11 });
  const newerRemote = { ...defaultSoulSnapshot(), updatedAt: 2000, warmth: 99 };
  const asCaller = (value: unknown, found: boolean): CompanionCaller =>
    (async () => ({ ok: true, result: { value, found } })) as CompanionCaller;

  const adopted = await local.pullFromCompanion(asCaller(newerRemote, true));
  assert.deepEqual({ found: adopted.found, adopted: adopted.adopted }, { found: true, adopted: true });
  assert.equal(local.snapshot().warmth, 99);

  const older = await local.pullFromCompanion(asCaller({ ...defaultSoulSnapshot(), updatedAt: 1500, warmth: 1 }, true));
  assert.deepEqual({ found: older.found, adopted: older.adopted }, { found: true, adopted: false });
  assert.equal(local.snapshot().warmth, 99);

  const missing = await local.pullFromCompanion(asCaller(null, false));
  assert.deepEqual({ found: missing.found, adopted: missing.adopted }, { found: false, adopted: false });
});

test('pullFromCompanion surfaces transport failures', async () => {
  const store = new SoulStore();
  const down: CompanionCaller = async () => ({ ok: false, error: 'not_connected' });
  const r = await store.pullFromCompanion(down);
  assert.equal(r.ok, false);
  const throwing: CompanionCaller = async () => {
    throw new Error('boom');
  };
  const r2 = await store.pullFromCompanion(throwing);
  assert.equal(r2.ok, false);
});
