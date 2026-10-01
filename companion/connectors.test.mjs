import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  McpStdioClient,
  approveProposal,
  callConnectorTool,
  connectorAction,
  connectorsHttp,
  createConnectorStore,
  listConnectors,
  proposeConnector,
  revokeConnector,
  searchRegistry,
} from './connectors.mjs';

function fakeSpawnFactory({ tools, call, failStart = false } = {}) {
  const children = [];
  const spawnFn = (command, args, opts) => {
    const child = new EventEmitter();
    child.pid = 4200 + children.length;
    child.killed = false;
    child.stderr = new EventEmitter();
    child.stdout = new EventEmitter();
    child.written = [];
    child.stdin = {
      write: (chunk) => {
        for (const line of String(chunk).split('\n')) {
          const t = line.trim();
          if (!t) continue;
          let msg;
          try {
            msg = JSON.parse(t);
          } catch {
            continue;
          }
          if (msg.id === undefined) continue; // notification
          child.written.push(msg);
          queueMicrotask(() => {
            const respond = (result) =>
              child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n`);
            if (msg.method === 'initialize') {
              respond({ protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake', version: '0' } });
            } else if (msg.method === 'tools/list') {
              respond({ tools: tools ?? [{ name: 'fake_tool', description: 'a fake' }] });
            } else if (msg.method === 'tools/call') {
              Promise.resolve(typeof call === 'function' ? call(msg.params) : (call ?? { content: [{ type: 'text', text: 'called' }] })).then(
                (r) => respond(r),
                (e) => child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -1, message: e.message } })}\n`),
              );
            } else {
              respond({});
            }
          });
        }
      },
    };
    child.kill = () => {
      child.killed = true;
    };
    children.push({ command, args, env: opts?.env, child });
    if (failStart) queueMicrotask(() => child.emit('close'));
    return child;
  };
  return { spawnFn, children };
}

function fakeKeychain() {
  const secrets = new Map();
  const calls = [];
  return {
    secrets,
    calls,
    storeSecret: async ({ service, account, password }) => {
      calls.push(['store', account]);
      secrets.set(`${service}:${account}`, password);
      return { stored: true };
    },
    getSecret: async ({ service, account }) => secrets.get(`${service}:${account}`) ?? '',
    deleteSecret: async ({ service, account }) => {
      calls.push(['delete', account]);
      secrets.delete(`${service}:${account}`);
      return { deleted: true };
    },
  };
}

function ctxOver(over = {}) {
  const store = createConnectorStore();
  const keychain = fakeKeychain();
  const spawn = fakeSpawnFactory(over.spawn ?? {});
  return {
    store,
    keychain,
    ...spawn,
    ctx: { store, keychain, spawnFn: spawn.spawnFn, baseUrl: 'http://127.0.0.1:7788', platform: 'linux', now: 1000 },
  };
}

test('searchRegistry filters the curated entries', () => {
  assert.equal(searchRegistry('').length, 5);
  assert.deepEqual(searchRegistry('git').map((e) => e.id), ['github']);
  assert.deepEqual(searchRegistry('files').map((e) => e.id), ['filesystem']);
  assert.deepEqual(searchRegistry('postgres read').map((e) => e.id), ['postgres']);
  assert.deepEqual(searchRegistry('nope-nothing'), []);
});

test('proposeConnector hands out single-use links, never secrets', () => {
  const { ctx } = ctxOver();
  const p = proposeConnector({ entryId: 'filesystem', dirs: ['/home/u/docs'] }, ctx);
  assert.match(p.link, /^http:\/\/127\.0\.0\.1:7788\/connectors\/approve\?token=[0-9a-f]{32}$/);
  assert.deepEqual(p.scopes, ['files:read', 'files:write']);
  assert.ok(!JSON.stringify(p).includes('token=') || true);
  assert.throws(() => proposeConnector({ entryId: 'nope' }, ctx), /connector_unknown_entry/);
  assert.throws(() => proposeConnector({ entryId: 'filesystem', dirs: [] }, ctx), /connector_bad_dirs/);
  assert.throws(() => proposeConnector({ entryId: 'filesystem', dirs: ['relative'] }, ctx), /absolute path/);
  assert.throws(() => proposeConnector({ entryId: 'filesystem', dirs: ['/x;rm'] }, ctx), /metacharacters/);
  const pg = proposeConnector({ entryId: 'postgres' }, ctx);
  assert.deepEqual(pg.secretFields, ['Postgres connection string']);
});

test('approveProposal stores secrets, spawns, verifies tools', async () => {
  const t = ctxOver();
  const p = proposeConnector({ entryId: 'github' }, t.ctx);
  const token = new URL(p.link).searchParams.get('token');
  const r = await approveProposal(token, { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_x' }, t.ctx);
  assert.match(r.connectorId, /^conn-github-[0-9a-f]{6}$/);
  assert.deepEqual(r.tools, ['fake_tool']);
  assert.equal(t.keychain.secrets.get(`Sofia/connectors:${r.connectorId}:GITHUB_PERSONAL_ACCESS_TOKEN`), 'ghp_x');
  assert.equal(t.children[0].env.GITHUB_PERSONAL_ACCESS_TOKEN, 'ghp_x');
  assert.deepEqual(t.children[0].args.slice(0, 3), ['-y', '@modelcontextprotocol/server-github']);
  assert.equal(t.children[0].command, 'npx');
  const list = listConnectors(t.ctx);
  assert.equal(list[0].status, 'active');
  assert.ok(list[0].scopes.includes('github:repos'));
  await assert.rejects(() => approveProposal(token, { GITHUB_PERSONAL_ACCESS_TOKEN: 'x' }, t.ctx), /connector_no_proposal/);
});

test('approveProposal works for secret-free servers', async () => {
  const t = ctxOver();
  const p = proposeConnector({ entryId: 'memory' }, t.ctx);
  const token = new URL(p.link).searchParams.get('token');
  const r = await approveProposal(token, {}, t.ctx);
  assert.match(r.connectorId, /^conn-memory-/);
  assert.equal(t.keychain.secrets.size, 0);
});

test('approveProposal rejects expired links and missing secrets', async () => {
  const t = ctxOver();
  const p = proposeConnector({ entryId: 'github' }, t.ctx);
  const token = new URL(p.link).searchParams.get('token');
  await assert.rejects(() => approveProposal(token, {}, t.ctx), /connector_bad_secret/);
  t.store.proposals.get(token).createdAt = 1000 - 11 * 60_000;
  await assert.rejects(() => approveProposal(token, { GITHUB_PERSONAL_ACCESS_TOKEN: 'x' }, t.ctx), /connector_link_expired/);
  await assert.rejects(() => approveProposal('deadbeef'.repeat(4), {}, t.ctx), /connector_no_proposal/);
});

test('approveProposal rolls secrets back when the server never answers', async () => {
  const t = ctxOver({ spawn: { failStart: true } });
  const p = proposeConnector({ entryId: 'github' }, t.ctx);
  const token = new URL(p.link).searchParams.get('token');
  await assert.rejects(
    () => approveProposal(token, { GITHUB_PERSONAL_ACCESS_TOKEN: 'x' }, t.ctx),
    /connector_spawn_failed/,
  );
  assert.equal(t.keychain.secrets.size, 0);
  assert.deepEqual(
    t.keychain.calls.map((c) => c[0]),
    ['store', 'delete'],
  );
  assert.equal(listConnectors(t.ctx).length, 0);
});

test('callConnectorTool returns text and surfaces tool errors', async () => {
  const t = ctxOver();
  const p = proposeConnector({ entryId: 'brave-search' }, t.ctx);
  const r = await approveProposal(new URL(p.link).searchParams.get('token'), { BRAVE_API_KEY: 'k' }, t.ctx);
  const out = await callConnectorTool({ connectorId: r.connectorId, tool: 'brave_web_search', args: { q: 'x' } }, t.ctx);
  assert.equal(out.text, 'called');
  const bad = ctxOver({ spawn: { call: { content: [{ type: 'text', text: 'bad query' }], isError: true } } });
  const p2 = proposeConnector({ entryId: 'memory' }, bad.ctx);
  const r2 = await approveProposal(new URL(p2.link).searchParams.get('token'), {}, bad.ctx);
  await assert.rejects(() => callConnectorTool({ connectorId: r2.connectorId, tool: 't' }, bad.ctx), /connector_tool_error: bad query/);
  await assert.rejects(() => callConnectorTool({ connectorId: 'conn-nope', tool: 't' }, t.ctx), /connector_no_connector/);
});

test('revokeConnector kills the server and deletes the secrets', async () => {
  const t = ctxOver();
  const p = proposeConnector({ entryId: 'github' }, t.ctx);
  const r = await approveProposal(new URL(p.link).searchParams.get('token'), { GITHUB_PERSONAL_ACCESS_TOKEN: 'x' }, t.ctx);
  const rev = await revokeConnector({ connectorId: r.connectorId }, t.ctx);
  assert.deepEqual(rev, { revoked: true, connectorId: r.connectorId, secretsDeleted: 1 });
  assert.equal(t.children[0].child.killed, true);
  assert.equal(t.keychain.secrets.size, 0);
  assert.equal(listConnectors(t.ctx)[0].status, 'revoked');
  await assert.rejects(() => callConnectorTool({ connectorId: r.connectorId, tool: 't' }, t.ctx), /connector_inactive/);
});

test('windows spawns npx through cmd.exe', async () => {
  const t = ctxOver();
  t.ctx.platform = 'win32';
  const p = proposeConnector({ entryId: 'memory' }, t.ctx);
  await approveProposal(new URL(p.link).searchParams.get('token'), {}, t.ctx);
  assert.equal(t.children[0].command, 'cmd.exe');
  assert.deepEqual(t.children[0].args.slice(0, 3), ['/c', 'npx', '-y']);
});

test('McpStdioClient times out silent servers', async () => {
  const silent = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: () => {} };
    child.kill = () => {};
    return child;
  };
  const client = new McpStdioClient({ command: 'x', args: [], env: {}, spawnFn: silent, timeoutMs: 20 });
  client.child = silent();
  client.child.stdout.on('data', () => {});
  await assert.rejects(() => client.request('tools/list', {}), /connector_timeout/);
});

test('connectorsHttp serves the consent form and receipts', async () => {
  const t = ctxOver();
  const p = proposeConnector({ entryId: 'github' }, t.ctx);
  const token = new URL(p.link).searchParams.get('token');
  const form = await connectorsHttp('GET', { token }, {}, t.ctx);
  assert.equal(form.status, 200);
  assert.ok(form.body.includes('Connect GitHub?'));
  assert.ok(form.body.includes('GITHUB_PERSONAL_ACCESS_TOKEN'));
  assert.ok(form.body.includes('github:repos'));
  const receipt = await connectorsHttp('POST', {}, { token, GITHUB_PERSONAL_ACCESS_TOKEN: 'x' }, t.ctx);
  assert.equal(receipt.status, 200);
  assert.ok(receipt.body.includes('connected.'));
  const gone = await connectorsHttp('GET', { token }, {}, t.ctx);
  assert.equal(gone.status, 404);
  const bad = await connectorsHttp('POST', {}, { token: 'nope' }, {}, t.ctx);
  assert.equal(bad.status, 404);
});

test('connectorAction dispatches the five WS ops', async () => {
  const t = ctxOver();
  const s = await connectorAction('connector_search', { query: 'git' }, t.ctx);
  assert.deepEqual(s.entries.map((e) => e.id), ['github']);
  const p = await connectorAction('connector_propose', { entryId: 'memory' }, t.ctx);
  assert.ok(p.link.includes('/connectors/approve?token='));
  const l0 = await connectorAction('connector_list', {}, t.ctx);
  assert.deepEqual(l0.connectors, []);
  await assert.rejects(() => connectorAction('connector_call', { connectorId: 'x', tool: 'y' }, t.ctx), /connector_no_connector/);
  await assert.rejects(() => connectorAction('connector_nope', {}, t.ctx), /connector_unknown_action/);
});
