import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskTool, __setTaskRunner, TASK_SCHEMA } from './task-tool.ts';
import type { TaskResult } from '../core/TaskLoop.ts';

function result(status: TaskResult['status'], summary = `${status} summary`): TaskResult {
  return { status, goal: 'g', steps: [], summary };
}

test('missing goal and cancel-with-nothing fail/empty cleanly', async () => {
  __setTaskRunner(async () => result('done'));
  const m = await taskTool.invoke({});
  assert.equal(m.success, false);
  assert.equal(m.error, 'missing_goal');
  const c = await taskTool.invoke({ cancel: true });
  assert.equal(c.success, true);
  assert.equal((c.data as { cancelled: boolean }).cancelled, false);
});

test('done/failed/cancelled runner results map to tool results', async () => {
  __setTaskRunner(async () => result('done', 'Did it'));
  const d = await taskTool.invoke({ goal: 'do it' });
  assert.equal(d.success, true);
  assert.equal((d.data as { summary: string }).summary, 'Did it');

  __setTaskRunner(async () => result('failed', 'Broke'));
  const f = await taskTool.invoke({ goal: 'do it' });
  assert.equal(f.success, false);
  assert.equal(f.error, 'task_failed');
  assert.equal(f.errorDetail, 'Broke');

  __setTaskRunner(async () => result('cancelled', 'Stopped'));
  const x = await taskTool.invoke({ goal: 'do it' });
  assert.equal(x.success, false);
  assert.equal(x.error, 'task_cancelled');
});

test('second task while running is refused; confirm passes through', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const seenOpts: Array<{ autoConfirm: boolean }> = [];
  __setTaskRunner(async (_g, opts) => {
    seenOpts.push(opts);
    await gate;
    return result('done');
  });
  const first = taskTool.invoke({ goal: 'long one', confirm: true });
  const busy = await taskTool.invoke({ goal: 'another' });
  assert.equal(busy.success, false);
  assert.equal(busy.error, 'task_busy');
  release();
  const done = await first;
  assert.equal(done.success, true);
  assert.deepEqual(seenOpts, [{ autoConfirm: true }]);
});

test('schema declares goal/confirm/cancel', () => {
  assert.equal(TASK_SCHEMA.name, 'task');
  const props = Object.keys(TASK_SCHEMA.parameters.properties ?? {});
  assert.ok(props.includes('goal') && props.includes('confirm') && props.includes('cancel'));
});
