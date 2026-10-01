import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCoderTool, type CoderReply } from './coder-tool.ts';

function callerFor(reply: CoderReply, seen: { action?: string; args?: Record<string, unknown>; timeout?: number }) {
  return async (action: string, args: Record<string, unknown>, timeoutMs: number) => {
    seen.action = action;
    seen.args = args;
    seen.timeout = timeoutMs;
    return reply;
  };
}

test('coder run requires repo, task and testCmd', async () => {
  const seen: { action?: string } = {};
  const tool = createCoderTool(callerFor({ ok: true, result: {} }, seen));
  assert.equal(((await tool.invoke({ task: 'x', testCmd: 'npm test' })) as { error?: string }).error, 'missing_repo');
  assert.equal(((await tool.invoke({ repo: '/r', testCmd: 'npm test' })) as { error?: string }).error, 'missing_task');
  assert.equal(((await tool.invoke({ repo: '/r', task: 'x' })) as { error?: string }).error, 'missing_tests');
  assert.equal(seen.action, undefined);
  assert.equal(((await tool.invoke({ op: 'delete' })) as { error?: string }).error, 'bad_op');
});

test('coder run forwards to the daemon and clamps the timeout', async () => {
  const seen: { action?: string; args?: Record<string, unknown>; timeout?: number } = {};
  const tool = createCoderTool(callerFor({ ok: true, result: { jobId: 'j', testsPassed: true } }, seen));
  const r = await tool.invoke({ repo: '/r', task: 'x', testCmd: 'npm test', cli: 'claude', timeoutMs: 1 });
  assert.equal(r.success, true);
  assert.equal(seen.action, 'coder_run');
  assert.equal(seen.args?.cli, 'claude');
  assert.equal(seen.timeout, 60_000 + 180_000);
});

test('coder maps daemon failures and transport errors', async () => {
  const fail = createCoderTool(async () => ({ ok: false, error: 'confirmation_required', detail: 'risky' }));
  const r = await fail.invoke({ op: 'merge', jobId: 'j' });
  assert.equal(r.success, false);
  assert.equal((r as { error?: string }).error, 'confirmation_required');
  const down = createCoderTool(async () => {
    throw new Error('no daemon');
  });
  const r2 = await down.invoke({ op: 'probe' });
  assert.equal((r2 as { error?: string }).error, 'coder_unreachable');
});

test('coder probe and merge validate their inputs', async () => {
  const seen: { action?: string } = {};
  const tool = createCoderTool(callerFor({ ok: true, result: { clis: {} } }, seen));
  assert.equal((await tool.invoke({ op: 'probe' })).success, true);
  assert.equal(seen.action, 'coder_probe');
  assert.equal(((await tool.invoke({ op: 'merge' })) as { error?: string }).error, 'missing_job');
});
