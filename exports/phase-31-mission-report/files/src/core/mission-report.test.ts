/**
 * core/mission-report.test.ts — Phase 31: window filtering, undo counts,
 * shot passthrough, and the publish/late-subscriber bus.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionReport, publishMissionReport, lastMissionReport } from './mission-report.ts';
import type { TaskResult } from './TaskLoop.ts';

function result(over: Partial<TaskResult> = {}): TaskResult {
  return {
    status: 'done',
    goal: 'file the receipts',
    steps: [
      { index: 0, state: 'done', tool: 'computer', args: {}, note: 'moved', shotDataUrl: 'data:image/png;base64,AAA' },
      { index: 1, state: 'failed', tool: 'computer', args: {}, error: 'nope' },
    ],
    summary: 'filed 3 receipts',
    startedAt: 10000,
    endedAt: 15000,
    ...over,
  };
}

test('keeps receipts inside the window, drops the rest', () => {
  const r = buildMissionReport({
    id: 't1',
    goal: 'g',
    result: result(),
    receipts: [
      { ts: 5000, action: 'click', detail: 'before' },
      { ts: 11000, action: 'files_move', detail: 'moved a', undo: { action: 'files_move', args: {} } },
      { ts: 16000, action: 'notify', detail: 'after (within slack)' },
      { ts: 30000, action: 'click', detail: 'after' },
      { action: 'no-ts' },
    ],
  });
  assert.deepEqual(r.changes.map((c) => c.action), ['files_move', 'notify']);
  assert.equal(r.undoable, 1);
  assert.equal(r.durationMs, 5000);
});

test('steps pass through with shots, notes, and errors', () => {
  const r = buildMissionReport({ id: 't1', goal: 'g', result: result(), receipts: [] });
  assert.equal(r.steps.length, 2);
  assert.equal(r.steps[0].shotDataUrl, 'data:image/png;base64,AAA');
  assert.equal(r.steps[1].shotDataUrl, undefined);
  assert.equal(r.steps[1].error, 'nope');
  assert.equal(r.changes.length, 0);
  assert.equal(r.undoable, 0);
  assert.equal(r.criticText, '');
});

test('malformed receipts never break the report', () => {
  const r = buildMissionReport({
    id: 't1',
    goal: 'g',
    result: result(),
    receipts: [null, 42, { ts: 11000 }, { ts: 11000, action: 'click', undo: 'bogus' }] as never,
  });
  assert.equal(r.changes.length, 1);
  assert.equal(r.changes[0].undo, undefined);
});

test('publish/late-subscriber bus delivers the same object', () => {
  const r = buildMissionReport({ id: 't9', goal: 'g', result: result(), receipts: [] });
  publishMissionReport(r);
  assert.equal(lastMissionReport()?.id, 't9');
});
