import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskTool, __setTaskRunner, isTaskRunning, TASK_SCHEMA, episodeTrail } from './task-tool.ts';
import type { TaskResult } from '../core/TaskLoop.ts';

function result(status: TaskResult['status'], summary = `${status} summary`): TaskResult {
  return { status, goal: 'g', steps: [], summary };
}

const flush = () => new Promise<void>((r) => setImmediate(r));

test('missing goal and cancel-with-nothing fail/empty cleanly', async () => {
  __setTaskRunner(async () => result('done'));
  try {
    const m = await taskTool.invoke({});
    assert.equal(m.success, false);
    assert.equal(m.error, 'missing_goal');
    const c = await taskTool.invoke({ cancel: true });
    assert.equal(c.success, true);
    assert.equal((c.data as { cancelled: boolean }).cancelled, false);
  } finally {
    __setTaskRunner(null);
  }
});

test('invoke returns started:true immediately; the run settles in background', async () => {
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
  try {
    const started = await taskTool.invoke({ goal: 'long one', confirm: true });
    assert.equal(started.success, true);
    assert.equal((started.data as { started: boolean }).started, true);
    assert.ok(!('superseded' in (started.data as object)));
    assert.equal(isTaskRunning(), true);
    release();
    await flush();
    await flush();
    assert.equal(isTaskRunning(), false);
    assert.deepEqual(seenOpts, [{ autoConfirm: false }], 'model confirm:true must not skip pauses');
  } finally {
    __setTaskRunner(null);
  }
});

test('a new goal supersedes the running task (redirect, not refusal)', async () => {
  const releases: Array<() => void> = [];
  const goals: string[] = [];
  __setTaskRunner(async (g) => {
    goals.push(g);
    await new Promise<void>((r) => releases.push(r));
    return result('done');
  });
  try {
    await taskTool.invoke({ goal: 'first' });
    const second = await taskTool.invoke({ goal: 'second' });
    assert.equal(second.success, true);
    assert.equal((second.data as { superseded: boolean }).superseded, true);
    assert.deepEqual(goals, ['first', 'second']);
    // The orphan settles first — the slot must stay owned by the new run.
    releases[0]();
    await flush();
    await flush();
    assert.equal(isTaskRunning(), true);
    releases[1]();
    await flush();
    await flush();
    assert.equal(isTaskRunning(), false);
  } finally {
    __setTaskRunner(null);
  }
});

test('cancel orphans the run; its late completion is ignored', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  __setTaskRunner(async () => {
    await gate;
    return result('done');
  });
  try {
    await taskTool.invoke({ goal: 'doomed' });
    const c = await taskTool.invoke({ cancel: true });
    assert.equal((c.data as { cancelled: boolean }).cancelled, true);
    assert.equal(isTaskRunning(), false);
    release();
    await flush();
    await flush();
    assert.equal(isTaskRunning(), false);
  } finally {
    __setTaskRunner(null);
  }
});

test('a throwing runner never rejects the tool call', async () => {
  __setTaskRunner(async () => {
    throw new Error('runner blew up');
  });
  try {
    const started = await taskTool.invoke({ goal: 'boom' });
    assert.equal(started.success, true);
    await flush();
    await flush();
    assert.equal(isTaskRunning(), false);
  } finally {
    __setTaskRunner(null);
  }
});

test('schema declares goal/cancel only (no model confirm)', () => {
  assert.equal(TASK_SCHEMA.name, 'task');
  assert.deepEqual(Object.keys(TASK_SCHEMA.parameters.properties ?? {}).sort(), ['cancel', 'goal']);
  assert.match(TASK_SCHEMA.description, /NON-BLOCKING/);
});

test('episodeTrail compacts the step tools for skill induction', () => {
  assert.equal(episodeTrail([{ tool: 'observe' }, { tool: 'click' }, { tool: 'type' }]), 'observe → click → type');
  assert.equal(episodeTrail([]), '');
  assert.equal(episodeTrail([{ tool: '' }, { tool: 'click' }, {}]), 'click');
  assert.ok(episodeTrail(Array.from({ length: 100 }, () => ({ tool: 'x'.repeat(10) }))).length <= 300);
});
