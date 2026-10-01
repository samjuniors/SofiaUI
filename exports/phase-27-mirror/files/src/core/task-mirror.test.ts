/**
 * core/task-mirror.test.ts — Phase 27: confidence scores, the banked line
 * format, and the local store. The canonical line is pinned byte-for-byte
 * here AND in memory/mirror.test.mjs (client/server contract).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMirrorStore, formatMirrorLine, selfScore } from './task-mirror.ts';

test('canonical line formats exactly (contract with memory/mirror.mjs)', () => {
  assert.equal(
    formatMirrorLine({ taskEpisode: 12, confidence: 0.62, outcome: 'done', stepsTotal: 4, failedTools: ['computer', 'files'] }),
    'Mirror task #12 conf=0.62 ok=1 steps=4 tools=computer,files',
  );
});

test('clean runs omit tools; failed/cancelled encode ok', () => {
  assert.equal(
    formatMirrorLine({ taskEpisode: 3, confidence: 0.9, outcome: 'done', stepsTotal: 3, failedTools: [] }),
    'Mirror task #3 conf=0.90 ok=1 steps=3',
  );
  assert.match(
    formatMirrorLine({ taskEpisode: 4, confidence: 0.15, outcome: 'failed', stepsTotal: 5, failedTools: ['computer'] }),
    /ok=0 steps=5 tools=computer$/,
  );
  assert.match(
    formatMirrorLine({ taskEpisode: 5, confidence: 0.5, outcome: 'cancelled', stepsTotal: 2, failedTools: [] }),
    /ok=x steps=2$/,
  );
});

test('formatter sanitizes hostile tool names and non-integer episodes', () => {
  const line = formatMirrorLine({
    taskEpisode: NaN,
    confidence: 0.7,
    outcome: 'done',
    stepsTotal: 1,
    failedTools: ['computer', 'a b', 'x=y', '../z'],
  });
  assert.equal(line, 'Mirror task #0 conf=0.70 ok=1 steps=1 tools=computer');
});

test('confidence: clean 0.90, recovered degrades per failure, floor holds', () => {
  assert.equal(selfScore({ verdict: 'clean', stepsTotal: 3, failedCount: 0, skipped: 0 }).confidence, 0.9);
  assert.equal(selfScore({ verdict: 'clean', stepsTotal: 3, failedCount: 0, skipped: 2 }).confidence, 0.85);
  assert.equal(selfScore({ verdict: 'recovered', stepsTotal: 4, failedCount: 1, skipped: 0 }).confidence, 0.75);
  assert.equal(selfScore({ verdict: 'recovered', stepsTotal: 9, failedCount: 5, skipped: 0 }).confidence, 0.35);
  const floor = selfScore({ verdict: 'recovered', stepsTotal: 12, failedCount: 12, skipped: 0 });
  assert.ok(floor.confidence >= 0.05 && floor.confidence <= 0.95);
});

test('confidence: failed 0.15, cancelled 0.50 with unknown-outcome basis', () => {
  const f = selfScore({ verdict: 'failed', stepsTotal: 5, failedCount: 2, skipped: 0 });
  assert.equal(f.confidence, 0.15);
  const c = selfScore({ verdict: 'cancelled', stepsTotal: 2, failedCount: 0, skipped: 1 });
  assert.equal(c.confidence, 0.5);
  assert.match(c.basis.join(' '), /unknown/);
});

test('scores always carry a human-readable basis', () => {
  for (const verdict of ['clean', 'recovered', 'failed', 'cancelled'] as const) {
    const s = selfScore({ verdict, stepsTotal: 2, failedCount: 1, skipped: 0 });
    assert.ok(s.basis.length > 0 && s.basis[0].length > 0, verdict);
  }
});

test('store caps at 200 and heals corrupt storage', () => {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
  };
  const store = createMirrorStore(storage);
  for (let i = 0; i < 250; i++) {
    store.record({ taskEpisode: i, at: i, confidence: 0.9, outcome: 'done', stepsTotal: 1, failedTools: [], goal: `g${i}` });
  }
  const list = store.list();
  assert.equal(list.length, 200);
  assert.equal(list[0].taskEpisode, 50);
  mem.set('sophia:mirror:v1', 'not json{{{');
  assert.deepEqual(createMirrorStore(storage).list(), []);
});
