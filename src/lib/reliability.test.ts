/**
 * lib/reliability.test.ts — Phase 30: report parsing is strict (bad JSON →
 * null, never half-numbers) and grades break at 95/80.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReport, gradeFor } from './reliability.ts';

const good = {
  generatedAt: '2026-09-30T00:00:00.000Z',
  suite: 'all',
  platform: 'linux',
  summary: { pass: 32, failed: 0, skip: 21, ran: 32, passRate: 100 },
  apps: [
    { app: 'Notepad', pass: 0, fail: 0, skip: 5, ran: 0, rate: null },
    { app: 'Core', pass: 8, fail: 0, skip: 0, ran: 8, rate: 100 },
  ],
  failures: [],
};

test('parses a good report, preserving null rates', () => {
  const r = parseReport(good);
  assert.ok(r);
  assert.equal(r?.apps.length, 2);
  assert.equal(r?.apps[0].rate, null);
  assert.equal(r?.summary.passRate, 100);
});

test('rejects malformed reports outright', () => {
  assert.equal(parseReport(null), null);
  assert.equal(parseReport('nope'), null);
  assert.equal(parseReport({}), null);
  assert.equal(parseReport({ ...good, apps: 'x' }), null);
  assert.equal(parseReport({ ...good, apps: [{ app: 'X' }] }), null);
  assert.equal(parseReport({ ...good, summary: {} }), null);
});

test('grades break at 95 and 80; null is none', () => {
  assert.equal(gradeFor(100), 'great');
  assert.equal(gradeFor(95), 'great');
  assert.equal(gradeFor(94), 'ok');
  assert.equal(gradeFor(80), 'ok');
  assert.equal(gradeFor(79), 'bad');
  assert.equal(gradeFor(0), 'bad');
  assert.equal(gradeFor(null), 'none');
});
