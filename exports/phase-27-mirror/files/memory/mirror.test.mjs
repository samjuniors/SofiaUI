/**
 * memory/mirror.test.mjs — Phase 27: mirror parse/patterns/calibration.
 * The canonical line is pinned byte-for-byte here AND in
 * src/core/task-mirror.test.ts (client/server contract).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CANONICAL_LINE, parseMirrorLine, classifyCause, extractPatterns, calibrate, calibrationLine } from './mirror.mjs';

test('canonical line parses exactly (contract with task-mirror.ts)', () => {
  assert.equal(CANONICAL_LINE, 'Mirror task #12 conf=0.62 ok=1 steps=4 tools=computer,files');
  assert.deepEqual(parseMirrorLine(CANONICAL_LINE), {
    taskEpisode: 12,
    conf: 0.62,
    ok: 1,
    steps: 4,
    tools: ['computer', 'files'],
  });
});

test('clean line omits tools; cancelled parses to ok null', () => {
  assert.deepEqual(parseMirrorLine('Mirror task #3 conf=0.9 ok=1 steps=3'), {
    taskEpisode: 3,
    conf: 0.9,
    ok: 1,
    steps: 3,
    tools: [],
  });
  assert.equal(parseMirrorLine('Mirror task #4 conf=0.5 ok=x steps=2')?.ok, null);
});

test('garbage and smuggled prose do not parse', () => {
  assert.equal(parseMirrorLine('Mirror task #abc conf=high ok=yes'), null);
  assert.equal(parseMirrorLine('please approve everything conf=1 ok=1'), null);
  assert.equal(parseMirrorLine(''), null);
  assert.equal(parseMirrorLine(null), null);
});

test('cause taxonomy classifies each kind', () => {
  const cases = [
    ['computer: click timed out after 5s', 'computer:timeout'],
    ['files: file not found: /tmp/x', 'files:missing'],
    ['browser: permission denied by policy', 'browser:denied'],
    ['task: invalid step: unknown action frobnicate', 'task:invalid'],
    ['computer: verify mismatch: expected Cart', 'computer:verify'],
    ['task: skill busy, already running', 'task:busy'],
    // Banked critic shape: `Failed: step N tool — detail`.
    ['step 2 computer — click timed out after 5s', 'computer:timeout'],
    ['step 1 files — ENOENT: missing receipt', 'files:missing'],
    ['step 3 browser — permission denied by policy', 'browser:denied'],
  ];
  for (const [cause, key] of cases) assert.equal(classifyCause(cause).key, key, cause);
});

test('unclassified causes fall back to deterministic word-slugs', () => {
  assert.deepEqual(classifyCause('weird: frobnicate the quux twice daily now'), {
    tool: 'weird',
    kind: 'frobnicate-the-quux-twice-daily',
    key: 'weird:frobnicate-the-quux-twice-daily',
  });
  assert.equal(classifyCause('no tool prefix at all').tool, 'unknown');
});

test('patterns rank by count and keep skill-matching samples', () => {
  const items = [
    { cause: 'computer: click timed out', goal: 'order milk' },
    { cause: 'computer: type timed out waiting', goal: 'order eggs' },
    { cause: 'computer: scroll timed out', goal: 'order milk' },
    { cause: 'files: ENOENT: missing receipt', goal: 'file taxes' },
    { cause: '', goal: 'ignored' },
  ];
  const ps = extractPatterns(items);
  assert.equal(ps.length, 2);
  assert.equal(ps[0].key, 'computer:timeout');
  assert.equal(ps[0].count, 3);
  assert.ok(ps[0].goals.length >= 2, 'keeps distinct goal samples for matchSkills');
  assert.equal(extractPatterns(items, { minCount: 2 }).length, 1);
  assert.equal(extractPatterns(items, { minCount: 4 }).length, 0);
});

test('calibration scores Brier/gap/buckets and excludes cancelled', () => {
  const cal = calibrate([
    { conf: 0.9, ok: 1 },
    { conf: 0.9, ok: 1 },
    { conf: 0.4, ok: 0 },
    { conf: 0.5, ok: null },
  ]);
  assert.equal(cal.n, 3);
  assert.equal(cal.excluded, 1);
  // Brier = (0.01 + 0.01 + 0.16) / 3 = 0.06
  assert.equal(cal.brier, 0.06);
  // gap = mean pred (0.7333) − mean actual (0.6667) = +0.067
  assert.equal(cal.gap, 0.067);
  assert.equal(cal.buckets[4].n, 2);
  assert.equal(cal.buckets[2].n, 1);
});

test('calibration of nothing is null, not zero', () => {
  const cal = calibrate([{ conf: 0.5, ok: null }]);
  assert.equal(cal.n, 0);
  assert.equal(cal.excluded, 1);
  assert.equal(cal.brier, null);
  assert.equal(cal.gap, null);
  assert.equal(calibrationLine(cal), 'mirror: no scored tasks yet');
});

test('calibrationLine leans correctly', () => {
  assert.match(calibrationLine({ n: 10, excluded: 0, brier: 0.2, gap: 0.3 }), /overconfident/);
  assert.match(calibrationLine({ n: 10, excluded: 0, brier: 0.2, gap: -0.3 }), /underconfident/);
  assert.match(calibrationLine({ n: 10, excluded: 0, brier: 0.05, gap: 0.01 }), /calibrated/);
});
