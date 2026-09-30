import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KIND_OWNER, TaskBoard, validatePayload } from './task-board.ts';

function board() {
  let t = 1000;
  return new TaskBoard(() => t++);
}

test('creates tasks with owner mapping and zeroed usage', () => {
  const b = board();
  const t = b.createTask({ goal: 'do research', kind: 'research' });
  assert.equal(t.owner, 'researcher');
  assert.equal(t.status, 'queued');
  assert.deepEqual(t.usage, { steps: 0, ms: 0, costUsd: 0 });
  assert.equal(KIND_OWNER[t.kind], 'researcher');
});

test('rejects malformed task specs', () => {
  const b = board();
  assert.throws(() => b.createTask({ goal: '  ', kind: 'research' }), /board_bad_task/);
  assert.throws(() => b.createTask({ goal: 'x', kind: 'teleport' as never }), /board_bad_task/);
  assert.throws(() => b.createTask({ goal: 'x', kind: 'code', parentId: 't-99' }), /unknown parent/);
  assert.throws(() => b.createTask({ goal: 'x', kind: 'code', dependsOn: ['t-99'] }), /unknown dependency/);
  assert.throws(() => b.createTask({ goal: 'x', kind: 'code', budget: { maxSteps: 0 } }), /budget/);
  assert.throws(() => b.getTask('t-99'), /board_no_task/);
});

test('enforces status transitions', () => {
  const b = board();
  const t = b.createTask({ goal: 'x', kind: 'operate' });
  assert.throws(() => b.setStatus(t.id, 'done'), /board_bad_transition/);
  b.setStatus(t.id, 'running');
  b.setStatus(t.id, 'waiting');
  b.setStatus(t.id, 'running');
  b.setStatus(t.id, 'done', { result: { summary: 'ok' } });
  assert.equal(b.getTask(t.id).result?.summary, 'ok');
  assert.throws(() => b.setStatus(t.id, 'cancelled'), /board_bad_transition/);
  const u = b.createTask({ goal: 'y', kind: 'code' });
  b.setStatus(u.id, 'cancelled');
  assert.throws(() => b.setStatus(u.id, 'running'), /board_bad_transition/);
  assert.throws(() => b.setStatus(t.id, 'flying' as never), /board_bad_status/);
});

test('accumulates usage and clamps negatives', () => {
  const b = board();
  const t = b.createTask({ goal: 'x', kind: 'code' });
  b.addUsage(t.id, { steps: 2, costUsd: 0.5 });
  b.addUsage(t.id, { steps: -5, ms: 120 });
  assert.deepEqual(b.getTask(t.id).usage, { steps: 2, ms: 120, costUsd: 0.5 });
});

test('validates every message payload shape', () => {
  assert.equal(
    validatePayload('assign', { taskId: 't-1', goal: 'g', kind: 'code', budget: { maxSteps: 1, maxMs: 1, maxCostUsd: 0 } }),
    null,
  );
  assert.equal(validatePayload('progress', { note: 'n', step: 0 }), null);
  assert.equal(validatePayload('result', { summary: 's', usage: { steps: 1, ms: 2, costUsd: 0 } }), null);
  assert.equal(validatePayload('need_input', { question: 'q?' }), null);
  assert.equal(validatePayload('budget', { usage: { steps: 1, ms: 2, costUsd: 0 }, exhausted: 'time' }), null);
  assert.equal(validatePayload('cancel', { reason: 'r' }), null);
  assert.match(validatePayload('whisper', {}) as string, /board_bad_type/);
  assert.match(validatePayload('result', { usage: {} }) as string, /needs a summary/);
  assert.match(validatePayload('result', 'free chat') as string, /needs an object/);
  assert.match(validatePayload('budget', { usage: { steps: 0, ms: 0, costUsd: 0 }, exhausted: 'vibes' }) as string, /exhausted/);
  assert.match(validatePayload('assign', { taskId: 't-1' }) as string, /needs a goal/);
});

test('post() scopes messages and rejects the unshaped', () => {
  const b = board();
  const t = b.createTask({ goal: 'x', kind: 'research' });
  const m = b.post({ taskId: t.id, from: 'orchestrator', to: 'researcher', type: 'assign', payload: { taskId: t.id, goal: 'x', kind: 'research', budget: { ...t.budget } } });
  assert.ok(m.id.startsWith('m-'));
  assert.throws(
    () => b.post({ taskId: 't-99', from: 'orchestrator', to: 'researcher', type: 'cancel', payload: { reason: 'x' } }),
    /board_no_task/,
  );
  assert.throws(
    () => b.post({ taskId: t.id, from: 'mallory' as never, to: 'researcher', type: 'cancel', payload: { reason: 'x' } }),
    /board_bad_from/,
  );
  assert.throws(
    () => b.post({ taskId: t.id, from: 'orchestrator', to: 'researcher', type: 'cancel', payload: { vibe: 'stop' } }),
    /board_bad_payload/,
  );
});

test('messagesFor and readyTasks scope the schedulable world', () => {
  const b = board();
  const a = b.createTask({ goal: 'a', kind: 'research' });
  const c = b.createTask({ goal: 'c', kind: 'curate', dependsOn: [a.id] });
  b.post({ taskId: a.id, from: 'researcher', to: 'orchestrator', type: 'progress', payload: { note: 'n', step: 1 } });
  assert.equal(b.messagesFor(a.id).length, 1);
  assert.equal(b.messagesFor(c.id).length, 0);
  assert.deepEqual(b.readyTasks().map((t) => t.id), [a.id]);
  b.setStatus(a.id, 'running');
  b.setStatus(a.id, 'done', { result: { summary: 'ok' } });
  assert.deepEqual(b.readyTasks().map((t) => t.id), [c.id]);
});

test('emits task/message/change events', () => {
  const b = board();
  const seen: string[] = [];
  b.addEventListener('task', () => seen.push('task'));
  b.addEventListener('message', () => seen.push('message'));
  b.addEventListener('change', () => seen.push('change'));
  const t = b.createTask({ goal: 'x', kind: 'code' });
  b.post({ taskId: t.id, from: 'orchestrator', to: 'coder', type: 'cancel', payload: { reason: 'test' } });
  assert.deepEqual(seen, ['task', 'change', 'message', 'change']);
});
