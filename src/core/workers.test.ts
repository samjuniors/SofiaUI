import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskBoard } from './task-board.ts';
import { WORKERS, parseWorkerOutput, runWorkerTask } from './workers.ts';

function board() {
  let t = 1000;
  return new TaskBoard(() => t++);
}

test('worker allowlists match the spec', () => {
  assert.deepEqual(WORKERS.operator.tools, ['computer', 'observe', 'system_control']);
  assert.deepEqual(WORKERS.researcher.tools, ['web_search']);
  assert.deepEqual(WORKERS.coder.tools, ['coder']);
  assert.deepEqual(WORKERS.curator.tools, []);
  assert.deepEqual(WORKERS.critic.tools, []);
});

test('parseWorkerOutput accepts actions and finals, salvages prose', () => {
  const a = parseWorkerOutput('{"action": {"tool": "web_search", "args": {"q": "x"}}, "note": "why"}');
  assert.equal(a.kind, 'action');
  if (a.kind === 'action') {
    assert.equal(a.tool, 'web_search');
    assert.deepEqual(a.args, { q: 'x' });
  }
  const f = parseWorkerOutput('thinking out loud {"final": {"summary": "done", "data": {"n": 1}}} trailing');
  assert.equal(f.kind, 'final');
  if (f.kind === 'final') assert.equal(f.summary, 'done');
  assert.equal(parseWorkerOutput('just prose, no json').kind, 'error');
  assert.equal(parseWorkerOutput('{"final": {}}').kind, 'error');
  assert.equal(parseWorkerOutput('{"action": {"args": {}}}').kind, 'error');
  assert.equal(parseWorkerOutput('{"note": "nothing actionable"}').kind, 'error');
});

test('runWorkerTask loops tool → final and posts the transcript', async () => {
  const b = board();
  const t = b.createTask({ goal: 'price of tea', kind: 'research' });
  const prompts: string[] = [];
  const replies = [
    '{"action": {"tool": "web_search", "args": {"q": "tea price"}}, "note": "searching"}',
    '{"final": {"summary": "tea costs $5", "data": {"sources": ["http://x"]}}}',
  ];
  const out = await runWorkerTask(b, t.id, {
    chat: async (p) => {
      prompts.push(p);
      return { text: replies[prompts.length - 1], costUsd: 0.01 };
    },
    invoke: async (tool, args) => {
      assert.equal(tool, 'web_search');
      assert.deepEqual(args, { q: 'tea price' });
      return [{ title: 'tea', url: 'http://x' }];
    },
  });
  assert.equal(out.summary, 'tea costs $5');
  assert.equal(b.getTask(t.id).status, 'done');
  assert.equal(out.usage.steps, 2);
  assert.equal(out.usage.costUsd, 0.02);
  // The second prompt carried the tool outcome back to the worker.
  assert.ok(prompts[1].includes('web_search →'));
  assert.ok(prompts[1].includes('http://x'));
  assert.equal(b.messagesFor(t.id, 'progress').length, 1);
  assert.equal(b.messagesFor(t.id, 'result').length, 1);
});

test('runWorkerTask denies off-allowlist tools and continues', async () => {
  const b = board();
  const t = b.createTask({ goal: 'g', kind: 'research' });
  let invokes = 0;
  const out = await runWorkerTask(b, t.id, {
    chat: async (p) =>
      p.includes('[allowlist]')
        ? { text: '{"final": {"summary": "ok"}}', costUsd: 0 }
        : { text: '{"action": {"tool": "computer", "args": {}}}', costUsd: 0 },
    invoke: async () => {
      invokes += 1;
      return {};
    },
  });
  assert.equal(out.summary, 'ok');
  assert.equal(invokes, 0);
  assert.match(b.messagesFor(t.id, 'progress')[0].payload.note as string, /denied/);
});

test('runWorkerTask fails after two unparseable replies', async () => {
  const b = board();
  const t = b.createTask({ goal: 'g', kind: 'critique' });
  await assert.rejects(
    () => runWorkerTask(b, t.id, { chat: async () => ({ text: 'uhh…', costUsd: 0 }), invoke: async () => ({}) }),
    /worker_bad_output/,
  );
  assert.equal(b.getTask(t.id).status, 'failed');
});

test('runWorkerTask enforces the step budget', async () => {
  const b = board();
  const t = b.createTask({ goal: 'g', kind: 'research', budget: { maxSteps: 1 } });
  await assert.rejects(
    () =>
      runWorkerTask(b, t.id, {
        chat: async () => ({ text: '{"action": {"tool": "web_search", "args": {}}}', costUsd: 0 }),
        invoke: async () => ({}),
      }),
    /budget_exhausted_steps/,
  );
  assert.equal(b.messagesFor(t.id, 'budget').length, 1);
});

test('runWorkerTask enforces the time budget', async () => {
  let now = 0;
  const b = new TaskBoard(() => now);
  const t = b.createTask({ goal: 'g', kind: 'research', budget: { maxMs: 100 } });
  await assert.rejects(
    () =>
      runWorkerTask(
        b,
        t.id,
        {
          chat: async () => {
            now += 500;
            return { text: '{"action": {"tool": "web_search", "args": {}}}', costUsd: 0 };
          },
          invoke: async () => ({}),
          clock: () => now,
        },
      ),
    /budget_exhausted_time/,
  );
});

test('runWorkerTask aborts cooperatively on cancel', async () => {
  const b = board();
  const t = b.createTask({ goal: 'g', kind: 'research' });
  await assert.rejects(
    () =>
      runWorkerTask(b, t.id, {
        chat: async () => {
          b.setStatus(t.id, 'cancelled');
          return { text: '{"action": {"tool": "web_search", "args": {}}}', costUsd: 0 };
        },
        invoke: async () => ({}),
      }),
    /worker_cancelled/,
  );
  assert.equal(b.getTask(t.id).status, 'cancelled');
});

test('runWorkerTask refuses owners without a worker definition', async () => {
  const b = board();
  const t = b.createTask({ goal: 'g', kind: 'run' });
  await assert.rejects(() => runWorkerTask(b, t.id, { chat: async () => ({ text: '', costUsd: 0 }), invoke: async () => ({}) }), /worker_no_def/);
});
