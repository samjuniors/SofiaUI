import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskBoard, type Usage } from './task-board.ts';
import { parsePlan, runGoal, splitBudget } from './orchestrator.ts';
import type { WorkerOutcome } from './workers.ts';

function board() {
  let t = 1000;
  return new TaskBoard(() => t++);
}

/** Fake worker: marks the board exactly like a real run would. */
function fakeWorker(outcomes: Record<string, { summary?: string; data?: unknown; fail?: string }> = {}) {
  const order: string[] = [];
  const run = async (b: TaskBoard, taskId: string): Promise<WorkerOutcome> => {
    order.push(taskId);
    const o = outcomes[taskId];
    b.setStatus(taskId, 'running');
    if (o?.fail) {
      b.setStatus(taskId, 'failed', { error: o.fail });
      throw new Error(o.fail);
    }
    const summary = o?.summary ?? `result of ${taskId}`;
    const usage: Usage = { steps: 1, ms: 5, costUsd: 0 };
    b.post({ taskId, from: b.getTask(taskId).owner, to: 'orchestrator', type: 'result', payload: { summary, usage } });
    b.setStatus(taskId, 'done', { result: { summary, ...(o?.data !== undefined ? { data: o.data } : {}) } });
    b.addUsage(taskId, usage);
    return { summary, usage: { ...usage } };
  };
  return { run, order };
}

test('parsePlan accepts valid plans and rejects the malformed', () => {
  const good = parsePlan('{"subtasks": [{"kind": "research", "goal": "a"}, {"kind": "code", "goal": "b", "dependsOn": [0]}], "merge": "critic"}');
  assert.ok('plan' in good);
  if ('plan' in good) {
    assert.equal(good.plan.subtasks.length, 2);
    assert.equal(good.plan.merge, 'critic');
  }
  assert.match((parsePlan('nope') as { error: string }).error, /plan_not_json/);
  assert.match((parsePlan('{"subtasks": []}') as { error: string }).error, /plan_bad_shape/);
  assert.match((parsePlan('{"subtasks": [{"kind": "nap", "goal": "x"}]}') as { error: string }).error, /plan_bad_kind/);
  assert.match((parsePlan('{"subtasks": [{"kind": "code", "goal": ""}]}') as { error: string }).error, /needs a goal/);
  assert.match((parsePlan('{"subtasks": [{"kind": "code", "goal": "x", "dependsOn": [7]}]}') as { error: string }).error, /plan_bad_deps/);
  assert.match((parsePlan('{"subtasks": [{"kind": "code", "goal": "x", "dependsOn": [0]}]}') as { error: string }).error, /invalid dependency/);
  assert.match(
    (parsePlan('{"subtasks": [{"kind": "code", "goal": "a", "dependsOn": [1]}, {"kind": "code", "goal": "b", "dependsOn": [0]}]}') as { error: string }).error,
    /cycle/,
  );
});

test('splitBudget keeps workable minima', () => {
  assert.deepEqual(splitBudget({ maxSteps: 24, maxMs: 60000, maxCostUsd: 1 }, 3), {
    maxSteps: 8,
    maxMs: 20000,
    maxCostUsd: 1 / 3,
  });
  const tiny = splitBudget({ maxSteps: 2, maxMs: 500, maxCostUsd: 0 }, 8);
  assert.ok(tiny.maxSteps >= 2 && tiny.maxMs >= 1000);
});

test('runGoal runs independent tasks in parallel', async () => {
  const b = board();
  let active = 0;
  let peak = 0;
  const gate = { release: () => {} };
  const gatePromise = new Promise<void>((resolve) => {
    gate.release = resolve;
  });
  const started: string[] = [];
  const run = async (bb: TaskBoard, taskId: string): Promise<WorkerOutcome> => {
    started.push(taskId);
    active += 1;
    peak = Math.max(peak, active);
    if (started.length === 2) gate.release();
    else await gatePromise;
    active -= 1;
    bb.setStatus(taskId, 'running');
    const usage: Usage = { steps: 1, ms: 5, costUsd: 0 };
    bb.post({ taskId, from: 'researcher', to: 'orchestrator', type: 'result', payload: { summary: `r-${taskId}`, usage } });
    bb.setStatus(taskId, 'done', { result: { summary: `r-${taskId}` } });
    bb.addUsage(taskId, usage);
    return { summary: `r-${taskId}`, usage };
  };
  const r = await runGoal(
    'do two things',
    {
      chat: async () => ({
        text: '{"subtasks": [{"kind": "research", "goal": "a"}, {"kind": "research", "goal": "b"}]}',
        costUsd: 0,
      }),
      invoke: async () => ({}),
      board: b,
      runWorker: run,
    },
    { maxParallel: 2 },
  );
  assert.equal(peak, 2);
  assert.equal(r.mergedFrom.length, 2);
  assert.equal(r.partial, false);
  assert.ok(r.summary.includes('###'));
});

test('runGoal respects dependencies across waves', async () => {
  const b = board();
  const { run, order } = fakeWorker();
  const r = await runGoal(
    'ordered',
    {
      chat: async () => ({
        text: '{"subtasks": [{"kind": "research", "goal": "a"}, {"kind": "curate", "goal": "b", "dependsOn": [0]}]}',
        costUsd: 0,
      }),
      invoke: async () => ({}),
      board: b,
      runWorker: run,
    },
  );
  assert.equal(order.length, 2);
  assert.deepEqual(r.mergedFrom, order);
});

test('runGoal marks downstream blocked and merges partial results', async () => {
  const b = board();
  const chat = async () => ({
    text: '{"subtasks": [{"kind": "research", "goal": "a"}, {"kind": "research", "goal": "b"}, {"kind": "curate", "goal": "c", "dependsOn": [0]}]}',
    costUsd: 0,
  });
  const run = async (bb: TaskBoard, taskId: string): Promise<WorkerOutcome> => {
    const goal = bb.getTask(taskId).goal;
    bb.setStatus(taskId, 'running');
    if (goal === 'a') {
      bb.setStatus(taskId, 'failed', { error: 'boom' });
      throw new Error('boom');
    }
    const usage: Usage = { steps: 1, ms: 1, costUsd: 0 };
    bb.post({ taskId, from: 'researcher', to: 'orchestrator', type: 'result', payload: { summary: `r-${goal}`, usage } });
    bb.setStatus(taskId, 'done', { result: { summary: `r-${goal}` } });
    bb.addUsage(taskId, usage);
    return { summary: `r-${goal}`, usage };
  };
  const r = await runGoal('partial', { chat, invoke: async () => ({}), board: b, runWorker: run });
  assert.equal(r.partial, true);
  assert.equal(r.mergedFrom.length, 1);
  const blocked = b.listTasks().find((t) => t.goal === 'c');
  assert.equal(blocked?.status, 'failed');
  assert.match(blocked?.error ?? '', /blocked_upstream/);
  assert.ok(r.notes.some((n) => n.startsWith('partial:')));
});

test('runGoal cancels pending work when the global budget is exhausted', async () => {
  const b = board();
  const { run, order } = fakeWorker();
  await assert.rejects(
    () =>
      runGoal(
        'tiny budget',
        {
          chat: async () => ({ text: '{"subtasks": [{"kind": "research", "goal": "a"}]}', costUsd: 0 }),
          invoke: async () => ({}),
          board: b,
          runWorker: run,
        },
        { budget: { maxSteps: 1 } },
      ),
    /merge_empty/,
  );
  assert.equal(order.length, 0);
  const t = b.listTasks().find((x) => x.goal === 'a');
  assert.equal(t?.status, 'cancelled');
  assert.equal(b.messagesFor(t?.id ?? '', 'cancel').length, 1);
});

test('runGoal merges through the critic when asked', async () => {
  const b = board();
  const seen: string[] = [];
  const run = async (bb: TaskBoard, taskId: string): Promise<WorkerOutcome> => {
    const t = bb.getTask(taskId);
    seen.push(t.kind);
    bb.setStatus(taskId, 'running');
    const summary = t.kind === 'critique' ? 'verdict: pass — solid work' : `r-${taskId}`;
    const usage: Usage = { steps: 1, ms: 1, costUsd: 0 };
    bb.post({ taskId, from: t.owner, to: 'orchestrator', type: 'result', payload: { summary, usage } });
    bb.setStatus(taskId, 'done', { result: { summary } });
    bb.addUsage(taskId, usage);
    return { summary, usage };
  };
  const r = await runGoal(
    'reviewed',
    {
      chat: async () => ({ text: '{"subtasks": [{"kind": "research", "goal": "a"}]}', costUsd: 0 }),
      invoke: async () => ({}),
      board: b,
      runWorker: run,
    },
    { merge: 'critic' },
  );
  assert.deepEqual(seen, ['research', 'critique']);
  assert.equal(r.summary, 'verdict: pass — solid work');
});

test('runGoal applies curator ops through the sink', async () => {
  const b = board();
  const { run } = fakeWorker();
  let got: unknown = null;
  const r = await runGoal(
    'remember',
    {
      chat: async () => ({ text: '{"subtasks": [{"kind": "curate", "goal": "save it"}]}', costUsd: 0 }),
      invoke: async () => ({}),
      board: b,
      runWorker: async (bb, taskId) => {
        bb.setStatus(taskId, 'running');
        const usage: Usage = { steps: 1, ms: 1, costUsd: 0 };
        const data = { ops: [{ op: 'set_preference', key: 'k', value: 'v' }] };
        bb.post({ taskId, from: 'curator', to: 'orchestrator', type: 'result', payload: { summary: 'curated', data, usage } });
        bb.setStatus(taskId, 'done', { result: { summary: 'curated', data } });
        bb.addUsage(taskId, usage);
        return { summary: 'curated', data, usage };
      },
      applyCuration: async (ops) => {
        got = ops;
        return { applied: 1, skipped: 0 };
      },
    },
  );
  assert.deepEqual(got, [{ op: 'set_preference', key: 'k', value: 'v' }]);
  assert.ok(r.notes.some((n) => n.includes('curation applied 1')));
  void run;
});

test('runGoal retries a bad plan once, then fails the root', async () => {
  const b = board();
  let calls = 0;
  await assert.rejects(
    () =>
      runGoal('bad plan', {
        chat: async () => {
          calls += 1;
          return { text: '{"subtasks": []}', costUsd: 0 };
        },
        invoke: async () => ({}),
        board: b,
        runWorker: fakeWorker().run,
      }),
    /plan_bad_shape/,
  );
  assert.equal(calls, 2);
  assert.equal(b.listTasks({ owner: 'orchestrator' })[0].status, 'failed');
});
