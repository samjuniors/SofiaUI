import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrateTool, memoryCurationSink } from './orchestrate-tool.ts';
import { memoryStore } from '../core/MemoryStore.ts';

test('orchestrate requires a goal', async () => {
  const tool = createOrchestrateTool({ chat: async () => ({ text: '', costUsd: 0 }), invoke: async () => ({}) });
  const r = await tool.invoke({});
  assert.equal(r.success, false);
  assert.equal((r as { error?: string }).error, 'missing_goal');
});

test('orchestrate runs plan → worker → merge end to end', async () => {
  const tool = createOrchestrateTool({
    chat: async (p) =>
      p.includes('You are the Sofia orchestrator')
        ? { text: '{"subtasks": [{"kind": "research", "goal": "find tea prices"}]}', costUsd: 0.02 }
        : { text: '{"final": {"summary": "tea is $5", "data": {"sources": ["http://x"]}}}', costUsd: 0.01 },
    invoke: async (name) => {
      assert.fail(`no tool calls expected, got ${name}`);
    },
  });
  const r = await tool.invoke({ goal: 'tea prices' });
  assert.equal(r.success, true);
  const data = (r as { data: { summary: string; taskIds: string[]; usage: { steps: number; costUsd: number }; partial: boolean } }).data;
  assert.ok(data.summary.includes('tea is $5'));
  assert.equal(data.taskIds.length, 1);
  assert.equal(data.partial, false);
  assert.ok(data.usage.steps >= 2);
  assert.ok(Math.abs(data.usage.costUsd - 0.03) < 1e-9);
});

test('orchestrate reports planning failure without throwing', async () => {
  const tool = createOrchestrateTool({
    chat: async () => ({ text: 'not json at all', costUsd: 0 }),
    invoke: async () => ({}),
  });
  const r = await tool.invoke({ goal: 'x' });
  assert.equal(r.success, false);
  assert.equal((r as { error?: string }).error, 'orchestrate_failed');
  assert.match((r as { errorDetail?: string }).errorDetail ?? '', /plan_/);
});

test('memoryCurationSink applies valid ops and skips garbage', async () => {
  const r = await memoryCurationSink([
    { op: 'set_preference', key: 'p33_test_key', value: 'p33_test_value' },
    { op: 'add_instruction', text: 'p33 test instruction' },
    { op: 'set_name', name: '' },
    { op: 'hack', x: 1 } as never,
    null as never,
  ]);
  assert.deepEqual(r, { applied: 2, skipped: 3 });
  const snap = memoryStore.snapshot();
  assert.equal(snap.preferences['p33_test_key'], 'p33_test_value');
  assert.ok(snap.instructions.includes('p33 test instruction'));
  memoryStore.removePreference('p33_test_key');
  memoryStore.removeInstruction('p33 test instruction');
});
