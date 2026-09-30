import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpTool, type McpReply } from './mcp-tool.ts';

function callerFor(reply: McpReply, seen: { action?: string; args?: Record<string, unknown> }) {
  return async (action: string, args: Record<string, unknown>) => {
    seen.action = action;
    seen.args = args;
    return reply;
  };
}

test('mcp validates propose/call/revoke inputs before touching the daemon', async () => {
  const seen: { action?: string } = {};
  const tool = createMcpTool(callerFor({ ok: true, result: {} }, seen));
  assert.equal(((await tool.invoke({ op: 'propose' })) as { error?: string }).error, 'missing_entry');
  assert.equal(((await tool.invoke({ op: 'call', connectorId: 'c' })) as { error?: string }).error, 'missing_target');
  assert.equal(((await tool.invoke({ op: 'revoke' })) as { error?: string }).error, 'missing_target');
  assert.equal(((await tool.invoke({ op: 'delete' })) as { error?: string }).error, 'bad_op');
  assert.equal(seen.action, undefined);
});

test('mcp propose returns the consent link for the user', async () => {
  const seen: { action?: string; args?: Record<string, unknown> } = {};
  const tool = createMcpTool(
    callerFor({ ok: true, result: { link: 'http://127.0.0.1:7788/connectors/approve?token=abc', scopes: ['web:search'] } }, seen),
  );
  const r = await tool.invoke({ op: 'propose', entryId: 'brave-search' });
  assert.equal(r.success, true);
  assert.equal(seen.action, 'connector_propose');
  assert.match((r as { data: { link: string } }).data.link, /\/connectors\/approve\?token=/);
});

test('mcp maps daemon failures and transport errors', async () => {
  const fail = createMcpTool(async () => ({ ok: false, error: 'connector_inactive', detail: 'revoked' }));
  const r = await fail.invoke({ op: 'call', connectorId: 'c', tool: 't' });
  assert.equal((r as { error?: string }).error, 'connector_inactive');
  const down = createMcpTool(async () => {
    throw new Error('no daemon');
  });
  assert.equal(((await down.invoke({})) as { error?: string }).error, 'mcp_unreachable');
});
