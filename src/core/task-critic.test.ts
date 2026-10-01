/**
 * core/task-critic.test.ts — reflections: verdicts, cause lines, banked form.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { critiqueTask, failureCause } from './task-critic.ts';
import type { StepRecord } from './TaskLoop.ts';

function step(index: number, state: StepRecord['state'], tool = 'click', extra: Partial<StepRecord> = {}): StepRecord {
  return { index, state, tool, args: {}, ...extra };
}

test('clean run: all worked, no cause', () => {
  const c = critiqueTask('open calc', 'done', [step(0, 'done', 'observe'), step(1, 'done', 'click')], 'opened');
  assert.equal(c.verdict, 'clean');
  assert.deepEqual(c.worked, ['observe', 'click']);
  assert.deepEqual(c.failed, []);
  assert.equal(failureCause(c), null);
  assert.match(c.text, /\(clean\)/);
  assert.match(c.text, /Worked: observe → click \(2\/2 clean\)/);
});

test('recovered run: failure recorded, cause extracted', () => {
  const c = critiqueTask(
    'mail the report',
    'done',
    [step(0, 'done', 'observe'), step(1, 'failed', 'click', { error: 'gate: confirmation_required' }), step(2, 'done', 'click')],
    'sent after approval',
  );
  assert.equal(c.verdict, 'recovered');
  assert.equal(c.failed.length, 1);
  assert.match(c.text, /Failed: step 1 click — gate: confirmation_required/);
  assert.equal(failureCause(c), 'click: gate: confirmation_required');
});

test('failed and cancelled verdicts; skips counted; empty run safe', () => {
  const f = critiqueTask('g', 'failed', [step(0, 'failed', 'type', { note: 'window vanished' })], '');
  assert.equal(f.verdict, 'failed');
  assert.match(f.text, /window vanished/);
  const c = critiqueTask('g', 'cancelled', [step(0, 'done'), step(1, 'skipped'), step(2, 'skipped')], '');
  assert.equal(c.verdict, 'cancelled');
  assert.equal(c.skipped, 2);
  assert.match(c.text, /Skipped: 2/);
  const e = critiqueTask('g', 'done', [], '');
  assert.equal(e.verdict, 'clean');
  assert.match(e.text, /0 steps/);
});
