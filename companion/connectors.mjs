/**
 * companion/connectors.mjs — MCP connector lifecycle (Phase 35).
 *
 * search → propose → one-click consent link → approve → call → revoke.
 *
 * The agent searches a curated registry and proposes a connector; the user
 * gets a loopback-only consent link showing scopes + required secrets; one
 * submit stores the secrets in the OS keychain, spawns the MCP server over
 * stdio, and verifies tools/list before the connector goes active. Tokens
 * are least-scope (declared per entry, shown at consent) and revoking kills
 * the server and deletes the keychain entries.
 *
 * Connectors are session-scoped in P35 (in-memory store): a daemon restart
 * drops them and they must be re-approved. Persist + respawn is P36.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { deleteSecret, getSecret, storeSecret } from './keychain.mjs';

export const CONNECTOR_SERVICE = 'Sofia/connectors';
export const PROPOSAL_TTL_MS = 10 * 60_000;
const MCP_CALL_MAX_CHARS = 8_000;

/* ── curated registry (packages verified live on npm, 2026-09-30) ──────────
 * Run with `npx -y <pkg>`. secretFields come from the consent page, never
 * from the agent: via 'env' they join the spawn env, via 'arg' they append
 * as a trailing argv element (postgres connection string).
 */
export const REGISTRY = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read/write files inside allowlisted directories you choose.',
    pkg: '@modelcontextprotocol/server-filesystem',
    needsDirs: true,
    secretFields: [],
    scopes: ['files:read', 'files:write'],
    scopeNote: 'Only the directories you list at approval. Nothing else on disk.',
    homepage: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repos, issues and pull requests via the GitHub API.',
    pkg: '@modelcontextprotocol/server-github',
    needsDirs: false,
    secretFields: [{ key: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: 'GitHub personal access token', via: 'env' }],
    scopes: ['github:repos', 'github:issues', 'github:pulls'],
    scopeNote: 'Mint a fine-grained PAT with access to only the repos Sofia needs.',
    homepage: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web search results for the Researcher.',
    pkg: '@modelcontextprotocol/server-brave-search',
    needsDirs: false,
    secretFields: [{ key: 'BRAVE_API_KEY', label: 'Brave Search API key', via: 'env' }],
    scopes: ['web:search'],
    scopeNote: 'Search queries only — no browsing history, no account access.',
    homepage: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    id: 'memory',
    name: 'Memory graph',
    description: 'A persistent knowledge graph of entities and relations.',
    pkg: '@modelcontextprotocol/server-memory',
    needsDirs: false,
    secretFields: [],
    scopes: ['memory:entities'],
    scopeNote: 'Lives in the server\'s own store; nothing leaves the machine.',
    homepage: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    id: 'postgres',
    name: 'Postgres',
    description: 'Run read queries against one Postgres database.',
    pkg: '@modelcontextprotocol/server-postgres',
    needsDirs: false,
    secretFields: [{ key: 'POSTGRES_URL', label: 'Postgres connection string', via: 'arg' }],
    scopes: ['db:query'],
    scopeNote: 'Use a read-only role (GRANT SELECT only) for least privilege.',
    homepage: 'https://github.com/modelcontextprotocol/servers',
  },
];

export function searchRegistry(query = '') {
  const q = String(query ?? '').trim().toLowerCase();
  const all = REGISTRY.map((e) => ({
    id: e.id,
    name: e.name,
    description: e.description,
    scopes: [...e.scopes],
    needsSecrets: e.secretFields.length > 0,
    needsDirs: e.needsDirs,
    homepage: e.homepage,
  }));
  if (!q) return all;
  return all.filter((e) => {
    const hay = `${e.name} ${e.description} ${e.scopes.join(' ')}`.toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  });
}

function entryById(id) {
  const e = REGISTRY.find((x) => x.id === id);
  if (!e) throw new Error(`connector_unknown_entry: no registry entry "${id}". Use connector_search first.`);
  return e;
}

/* ── store (session-scoped; see header) ───────────────────────────────────── */

export function createConnectorStore() {
  return {
    proposals: new Map(), // token → {token, entryId, dirs, createdAt, used}
    connectors: new Map(), // id → {id, entryId, name, status, scopes, tools, connectedAt}
    children: new Map(), // id → live McpStdioClient
  };
}

export const defaultStore = createConnectorStore();

/* ── minimal MCP stdio client (JSON-RPC 2.0, newline-delimited) ───────────── */

export class McpStdioClient {
  constructor({ command, args, env, spawnFn = nodeSpawn, timeoutMs = 20000 }) {
    this.command = command;
    this.args = args;
    this.env = env;
    this.spawnFn = spawnFn;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.seq = 0;
    this.buf = '';
    this.stderrTail = '';
    this.dead = false;
    this.child = null;
  }

  async start() {
    this.child = this.spawnFn(this.command, this.args, { env: this.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.on('data', (d) => this._onData(d));
    this.child.stderr?.on('data', (d) => {
      this.stderrTail = `${this.stderrTail}${String(d)}`.slice(-2000);
    });
    this.child.on('error', (err) => this._failAll(err));
    this.child.on('close', () => this._failAll(new Error('connector_offline: the MCP server exited.')));
    const init = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'sofia-companion', version: '1.0.0' },
    });
    this._notify('notifications/initialized', {});
    return init;
  }

  _onData(d) {
    this.buf += String(d);
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg && msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(`mcp_error_${msg.error.code ?? 'x'}: ${msg.error.message ?? 'unknown'}`));
        else p.resolve(msg.result);
      }
    }
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
      if (this.dead || !this.child) {
        reject(new Error('connector_offline: the MCP server process is gone.'));
        return;
      }
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`connector_timeout: ${method} exceeded ${this.timeoutMs}ms.`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  _notify(method, params) {
    try {
      this.child?.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    } catch { /* notifications are fire-and-forget */ }
  }

  _failAll(err) {
    if (this.dead) return;
    this.dead = true;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  async listTools() {
    const r = await this.request('tools/list', {});
    const tools = Array.isArray(r?.tools) ? r.tools : [];
    return tools.map((t) => ({ name: String(t?.name ?? 'unknown'), description: String(t?.description ?? '') }));
  }

  async callTool(name, args) {
    return this.request('tools/call', { name, arguments: args ?? {} });
  }

  async stop() {
    this._failAll(new Error('connector_stopped'));
    try {
      this.child?.kill();
    } catch { /* already gone */ }
    this.child = null;
  }
}

/* ── propose / approve ────────────────────────────────────────────────────── */

const DIR_METACHARS = /[&|<>()^%!`'";]/;

function validateDirs(dirs) {
  if (!Array.isArray(dirs) || dirs.length < 1 || dirs.length > 5) {
    throw new Error('connector_bad_dirs: list 1–5 absolute directories.');
  }
  for (const d of dirs) {
    if (typeof d !== 'string' || !isAbsolute(d) || d.length > 500) {
      throw new Error(`connector_bad_dirs: "${String(d).slice(0, 80)}" is not an absolute path.`);
    }
    if (DIR_METACHARS.test(d)) throw new Error('connector_bad_dirs: shell metacharacters are not allowed in paths.');
  }
  return [...dirs];
}

function sweepProposals(store, now) {
  for (const [token, p] of store.proposals) {
    if (p.used || now - p.createdAt > PROPOSAL_TTL_MS) store.proposals.delete(token);
  }
}

function launcher(entry, dirs, secretArgs, platform) {
  const argv = ['-y', entry.pkg, ...dirs, ...secretArgs];
  if (platform === 'win32') return { command: 'cmd.exe', args: ['/c', 'npx', ...argv] };
  return { command: 'npx', args: argv };
}

/**
 * The agent proposes a connector; the user gets a one-click consent link.
 * Secrets are NEVER part of the proposal — they are typed into the consent
 * page by the user.
 */
export function proposeConnector({ entryId, dirs = [] }, ctx = {}) {
  const store = ctx.store ?? defaultStore;
  const now = ctx.now ?? Date.now();
  const baseUrl = ctx.baseUrl ?? 'http://127.0.0.1:7788';
  const entry = entryById(entryId);
  const finalDirs = entry.needsDirs ? validateDirs(dirs) : [];
  sweepProposals(store, now);
  const token = randomBytes(16).toString('hex');
  store.proposals.set(token, { token, entryId, dirs: finalDirs, createdAt: now, used: false });
  return {
    link: `${baseUrl}/connectors/approve?token=${token}`,
    entry: { id: entry.id, name: entry.name, description: entry.description },
    scopes: [...entry.scopes],
    scopeNote: entry.scopeNote,
    secretFields: entry.secretFields.map((f) => f.label),
    expiresAt: now + PROPOSAL_TTL_MS,
  };
}

function readProposal(store, token, now) {
  const p = store.proposals.get(String(token ?? ''));
  if (!p) throw new Error('connector_no_proposal: unknown consent link.');
  if (p.used) throw new Error('connector_link_used: this consent link was already used.');
  if (now - p.createdAt > PROPOSAL_TTL_MS) {
    store.proposals.delete(p.token);
    throw new Error('connector_link_expired: consent links last 10 minutes — propose again.');
  }
  return p;
}

/**
 * Approve a proposal (the consent-page submit): store secrets in the OS
 * keychain, spawn the MCP server, verify tools/list, go active. On any
 * failure the stored secrets are rolled back.
 */
export async function approveProposal(token, secrets = {}, ctx = {}) {
  const store = ctx.store ?? defaultStore;
  const now = ctx.now ?? Date.now();
  const spawnFn = ctx.spawnFn ?? nodeSpawn;
  const platform = ctx.platform ?? process.platform;
  const kc = ctx.keychain ?? { storeSecret, getSecret, deleteSecret };
  const proposal = readProposal(store, token, now);
  const entry = entryById(proposal.entryId);

  const values = {};
  for (const f of entry.secretFields) {
    const v = typeof secrets[f.key] === 'string' ? secrets[f.key].trim() : '';
    if (!v || v.length > 2000) throw new Error(`connector_bad_secret: "${f.label}" is required.`);
    values[f.key] = v;
  }
  const connectorId = `conn-${entry.id}-${randomBytes(3).toString('hex')}`;
  const stored = [];
  try {
    for (const [key, value] of Object.entries(values)) {
      await kc.storeSecret({ service: CONNECTOR_SERVICE, account: `${connectorId}:${key}`, password: value });
      stored.push(key);
    }
    const secretEnv = {};
    const secretArgs = [];
    for (const f of entry.secretFields) {
      if (f.via === 'arg') secretArgs.push(values[f.key]);
      else secretEnv[f.key] = values[f.key];
    }
    const { command, args } = launcher(entry, proposal.dirs, secretArgs, platform);
    const client = new McpStdioClient({ command, args, env: { ...process.env, ...secretEnv }, spawnFn });
    let tools;
    try {
      await client.start();
      tools = await client.listTools();
    } catch (err) {
      try { await client.stop(); } catch { /* ignore */ }
      throw new Error(`connector_spawn_failed: ${entry.name} did not answer MCP initialize/list (${err?.message ?? err}). Is npx on PATH?`);
    }
    proposal.used = true;
    store.proposals.delete(proposal.token);
    const connector = {
      id: connectorId,
      entryId: entry.id,
      name: entry.name,
      status: 'active',
      scopes: [...entry.scopes, ...(proposal.dirs.length > 0 ? [`dirs:${proposal.dirs.join(',')}`] : [])],
      tools: tools.map((t) => t.name),
      connectedAt: now,
    };
    store.connectors.set(connectorId, connector);
    store.children.set(connectorId, client);
    return { connectorId, name: entry.name, scopes: connector.scopes, tools: connector.tools };
  } catch (err) {
    for (const key of stored) {
      try {
        await kc.deleteSecret({ service: CONNECTOR_SERVICE, account: `${connectorId}:${key}` });
      } catch { /* rollback is best-effort */ }
    }
    throw err;
  }
}

/* ── list / call / revoke ─────────────────────────────────────────────────── */

export function listConnectors(ctx = {}) {
  const store = ctx.store ?? defaultStore;
  return [...store.connectors.values()].map((c) => ({ ...c, scopes: [...c.scopes], tools: [...c.tools] }));
}

export async function callConnectorTool({ connectorId, tool, args = {} }, ctx = {}) {
  const store = ctx.store ?? defaultStore;
  const c = store.connectors.get(String(connectorId ?? ''));
  if (!c) throw new Error('connector_no_connector: unknown connector id.');
  if (c.status !== 'active') throw new Error(`connector_inactive: ${c.id} is ${c.status}.`);
  const client = store.children.get(c.id);
  if (!client) throw new Error('connector_offline: the server process is gone (daemon restart drops P35 connectors — re-approve).');
  if (typeof tool !== 'string' || !tool.trim()) throw new Error('connector_bad_tool: tool must be a non-empty string.');
  if (tool.length > 128) throw new Error('connector_bad_tool: tool name too long.');
  let result;
  try {
    result = await client.callTool(tool.trim(), args && typeof args === 'object' ? args : {});
  } catch (err) {
    throw new Error(`connector_call_failed: ${err?.message ?? err}`);
  }
  if (result?.isError) {
    const detail = Array.isArray(result.content)
      ? result.content.map((p) => String(p?.text ?? '')).join('\n').slice(0, 500)
      : 'tool reported an error';
    throw new Error(`connector_tool_error: ${detail || 'tool reported an error'}`);
  }
  const text = Array.isArray(result?.content)
    ? result.content.map((p) => (typeof p?.text === 'string' ? p.text : JSON.stringify(p) ?? '')).join('\n')
    : JSON.stringify(result) ?? '';
  return { connectorId: c.id, tool: tool.trim(), text: text.length > MCP_CALL_MAX_CHARS ? `${text.slice(0, MCP_CALL_MAX_CHARS)}…[truncated]` : text };
}

/** Revoke: kill the server, delete the keychain secrets, mark revoked. */
export async function revokeConnector({ connectorId }, ctx = {}) {
  const store = ctx.store ?? defaultStore;
  const kc = ctx.keychain ?? { storeSecret, getSecret, deleteSecret };
  const c = store.connectors.get(String(connectorId ?? ''));
  if (!c) throw new Error('connector_no_connector: unknown connector id.');
  const child = store.children.get(c.id);
  if (child) {
    try { await child.stop(); } catch { /* already gone */ }
    store.children.delete(c.id);
  }
  const entry = REGISTRY.find((e) => e.id === c.entryId);
  let deleted = 0;
  for (const f of entry?.secretFields ?? []) {
    try {
      await kc.deleteSecret({ service: CONNECTOR_SERVICE, account: `${c.id}:${f.key}` });
      deleted += 1;
    } catch { /* best-effort */ }
  }
  c.status = 'revoked';
  return { revoked: true, connectorId: c.id, secretsDeleted: deleted };
}

/* ── consent-page HTTP (pure handler; server.mjs routes + parses) ─────────── */

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function page(title, inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font-family:system-ui,sans-serif;background:#0b1020;color:#e8ecf8;max-width:560px;margin:48px auto;padding:0 20px}h1{font-size:20px;font-weight:600}ul{background:#141b33;border:1px solid #2a3560;border-radius:10px;padding:12px 12px 12px 32px}li{margin:6px 0;font-size:14px}label{display:block;margin:12px 0 4px;font-size:13px;color:#aeb8d8}input{width:100%;box-sizing:border-box;background:#0e1430;border:1px solid #2a3560;color:#fff;border-radius:8px;padding:10px 12px;font-size:14px}button{margin-top:18px;background:#4f7cff;border:none;color:#fff;border-radius:10px;padding:12px 20px;font-size:15px;font-weight:600;cursor:pointer}button:hover{background:#3d68f0}.note{margin-top:16px;font-size:12px;color:#8b95b8}.err{background:#3a1420;border:1px solid #7c2a3a;border-radius:10px;padding:14px;font-size:14px}.ok{background:#0f2f22;border:1px solid #1f6b4a;border-radius:10px;padding:14px;font-size:14px}code{font-size:12px;color:#9fd0ff}</style></head><body>${inner}</body></html>`;
}

function consentForm(proposal, entry) {
  const secretInputs = entry.secretFields
    .map((f) => `<label>${esc(f.label)}<input type="password" name="${esc(f.key)}" required autocomplete="off" spellcheck="false"></label>`)
    .join('');
  return page(
    `Connect ${entry.name} — Sofia`,
    `<h1>Connect ${esc(entry.name)}?</h1><p style="font-size:14px;color:#c4cdea">${esc(entry.description)}</p>` +
    `<ul>${entry.scopes.map((s) => `<li><code>${esc(s)}</code></li>`).join('')}` +
    (proposal.dirs.length > 0 ? proposal.dirs.map((d) => `<li><code>dir:${esc(d)}</code></li>`).join('') : '') + `</ul>` +
    `<p class="note">${esc(entry.scopeNote)} Secrets go to your OS keychain, never to chat logs. Revoke anytime in Dashboard → MCP.</p>` +
    `<form method="post" action="/connectors/approve"><input type="hidden" name="token" value="${esc(proposal.token)}">${secretInputs}<button type="submit">Approve &amp; connect</button></form>` +
    `<p class="note">This link works once and expires in 10 minutes. Loopback only — it cannot leave this machine.</p>`,
  );
}

/**
 * Pure HTTP handler for the consent flow. query/body are plain objects.
 * Returns {status, contentType, body}.
 */
export async function connectorsHttp(method, query = {}, body = {}, ctx = {}) {
  const store = ctx.store ?? defaultStore;
  const now = ctx.now ?? Date.now();
  if (method === 'GET' && typeof query.token === 'string') {
    try {
      const p = readProposal(store, query.token, now);
      return { status: 200, contentType: 'text/html; charset=utf-8', body: consentForm(p, entryById(p.entryId)) };
    } catch (err) {
      const gone = /expired|used/.test(err?.message ?? '');
      return {
        status: gone ? 410 : 404,
        contentType: 'text/html; charset=utf-8',
        body: page('Link invalid — Sofia', `<h1>That consent link is ${gone ? 'expired' : 'unknown'}.</h1><p class="note">Ask Sofia to propose the connector again for a fresh link.</p>`),
      };
    }
  }
  if (method === 'POST' && typeof body.token === 'string') {
    try {
      const r = await approveProposal(body.token, body, ctx);
      return {
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: page(
          `Connected — Sofia`,
          `<h1>${esc(r.name)} connected.</h1><div class="ok">${r.tools.length} tool(s): ${r.tools.map(esc).join(', ') || 'none listed'}.<br>Scopes: ${r.scopes.map(esc).join(', ')}.</div><p class="note">Connector <code>${esc(r.connectorId)}</code>. Revoke anytime in Dashboard → MCP → Revoke. You can close this tab.</p>`,
        ),
      };
    } catch (err) {
      const msg = err?.message ?? String(err);
      const status = /no_proposal/.test(msg)
        ? 404
        : /expired|used/.test(msg)
          ? 410
          : /spawn_failed/.test(msg)
            ? 502
            : /keychain/.test(msg)
              ? 500
              : 400;
      return {
        status,
        contentType: 'text/html; charset=utf-8',
        body: page('Could not connect — Sofia', `<h1>Could not connect.</h1><div class="err">${esc(msg)}</div><p class="note">Ask Sofia to propose the connector again for a fresh link.</p>`),
      };
    }
  }
  return { status: 404, contentType: 'text/plain; charset=utf-8', body: 'not found' };
}

/* ── WS dispatcher (server.mjs perform()) ─────────────────────────────────── */

export async function connectorAction(action, args = {}, ctx = {}) {
  switch (action) {
    case 'connector_search':
      return { entries: searchRegistry(args.query) };
    case 'connector_propose':
      return proposeConnector({ entryId: args.entryId, dirs: args.dirs }, ctx);
    case 'connector_list':
      return { connectors: listConnectors(ctx) };
    case 'connector_call':
      return callConnectorTool({ connectorId: args.connectorId, tool: args.tool, args: args.args }, ctx);
    case 'connector_revoke':
      return revokeConnector({ connectorId: args.connectorId }, ctx);
    default:
      throw new Error(`connector_unknown_action: ${action}`);
  }
}
