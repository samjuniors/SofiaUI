/**
 * tools/mcp-tool.ts — the `mcp` registry tool (Phase 35).
 *
 * The agent's handle on MCP connectors: search the curated registry, propose
 * a connector (the user gets a one-click consent link), list/call/revoke.
 * Secrets are never agent-visible — the user types them into the loopback
 * consent page and they land in the OS keychain. A factory keeps the daemon
 * caller injectable for tests.
 */
import { companion } from '../lib/companion-client.ts';
import type { GeminiFunctionDeclaration, ITool } from './types';

export interface McpReply {
  ok: boolean;
  result?: unknown;
  error?: string;
  detail?: string;
}

export type McpCaller = (action: string, args: Record<string, unknown>, timeoutMs: number) => Promise<McpReply>;

const defaultCaller: McpCaller = async (action, args, timeoutMs) => {
  const r = await companion.send(action, args, timeoutMs);
  return { ok: r.ok === true, result: r.result, error: r.error, detail: r.detail };
};

function errText(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function createMcpTool(caller: McpCaller = defaultCaller): ITool {
  return {
    name: 'mcp',
    description:
      'MCP connectors: search a curated registry, propose a connector (user approves via a ' +
      'one-click consent link; secrets go to the OS keychain), list/call/revoke connectors.',
    invoke: async (args) => {
      const op = typeof args.op === 'string' ? args.op : 'list';
      try {
        if (op === 'search') {
          const r = await caller('connector_search', { query: typeof args.query === 'string' ? args.query : '' }, 20000);
          if (!r.ok) return { success: false, error: errText(r.error) ?? 'mcp_failed', errorDetail: errText(r.detail) ?? 'search failed' };
          return { success: true, data: (r.result ?? {}) as Record<string, unknown> };
        }
        if (op === 'propose') {
          const entryId = typeof args.entryId === 'string' ? args.entryId.trim() : '';
          if (!entryId) return { success: false, error: 'missing_entry', errorDetail: 'mcp propose requires an entryId from search.' };
          const callArgs: Record<string, unknown> = { entryId };
          if (typeof args.dirs === 'string' && args.dirs.trim()) {
            callArgs.dirs = args.dirs
              .split(',')
              .map((d) => d.trim())
              .filter(Boolean);
          } else if (Array.isArray(args.dirs)) {
            callArgs.dirs = args.dirs;
          }
          const r = await caller('connector_propose', callArgs, 20000);
          if (!r.ok) return { success: false, error: errText(r.error) ?? 'mcp_failed', errorDetail: errText(r.detail) ?? 'propose failed' };
          return { success: true, data: (r.result ?? {}) as Record<string, unknown> };
        }
        if (op === 'call') {
          const connectorId = typeof args.connectorId === 'string' ? args.connectorId.trim() : '';
          const tool = typeof args.tool === 'string' ? args.tool.trim() : '';
          if (!connectorId || !tool) {
            return { success: false, error: 'missing_target', errorDetail: 'mcp call requires connectorId and tool.' };
          }
          const r = await caller(
            'connector_call',
            { connectorId, tool, ...(args.args !== undefined ? { args: args.args } : {}) },
            90000,
          );
          if (!r.ok) return { success: false, error: errText(r.error) ?? 'mcp_failed', errorDetail: errText(r.detail) ?? 'call failed' };
          return { success: true, data: (r.result ?? {}) as Record<string, unknown> };
        }
        if (op === 'revoke') {
          const connectorId = typeof args.connectorId === 'string' ? args.connectorId.trim() : '';
          if (!connectorId) return { success: false, error: 'missing_target', errorDetail: 'mcp revoke requires a connectorId.' };
          const r = await caller('connector_revoke', { connectorId }, 20000);
          if (!r.ok) return { success: false, error: errText(r.error) ?? 'mcp_failed', errorDetail: errText(r.detail) ?? 'revoke failed' };
          return { success: true, data: (r.result ?? {}) as Record<string, unknown> };
        }
        if (op !== 'list') return { success: false, error: 'bad_op', errorDetail: 'mcp op must be search|propose|list|call|revoke.' };
        const r = await caller('connector_list', {}, 20000);
        if (!r.ok) return { success: false, error: errText(r.error) ?? 'mcp_failed', errorDetail: errText(r.detail) ?? 'list failed' };
        return { success: true, data: (r.result ?? {}) as Record<string, unknown> };
      } catch (err) {
        return {
          success: false,
          error: 'mcp_unreachable',
          errorDetail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

export const mcpTool = createMcpTool();

export const MCP_SCHEMA: GeminiFunctionDeclaration = {
  name: 'mcp',
  description:
    'MCP connectors: search the registry, propose one (user approves via consent link), list, call a connector tool, revoke.',
  parameters: {
    type: 'OBJECT',
    properties: {
      op: { type: 'STRING', description: '"list" (default) | "search" | "propose" | "call" | "revoke".' },
      query: { type: 'STRING', description: 'Search words for op=search.' },
      entryId: { type: 'STRING', description: 'Registry id for op=propose (from search).' },
      dirs: { type: 'STRING', description: 'Comma-separated absolute dirs for servers that need them (filesystem).' },
      connectorId: { type: 'STRING', description: 'Connector id for op=call/revoke.' },
      tool: { type: 'STRING', description: 'MCP tool name for op=call.' },
      args: { type: 'STRING', description: 'JSON object string of tool args for op=call.' },
    },
    required: [],
  },
};
