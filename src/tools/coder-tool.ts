/**
 * tools/coder-tool.ts — the `coder` registry tool (Phase 34).
 *
 * The Coder worker's only tool: it delegates to the companion daemon, which
 * runs a headless coding CLI (Codex / Claude) inside an isolated git
 * worktree, runs the REQUIRED test command, and returns a diff. Merges go
 * through `coder_merge`, which the daemon refuses unless tests passed (and
 * which always needs a user confirmation). A factory keeps the daemon
 * caller injectable for tests.
 */
import { companion } from '../lib/companion-client.ts';
import type { GeminiFunctionDeclaration, ITool } from './types';

export interface CoderReply {
  ok: boolean;
  result?: unknown;
  error?: string;
  detail?: string;
}

export type CoderCaller = (action: string, args: Record<string, unknown>, timeoutMs: number) => Promise<CoderReply>;

const defaultCaller: CoderCaller = async (action, args, timeoutMs) => {
  const r = await companion.send(action, args, timeoutMs);
  return { ok: r.ok === true, result: r.result, error: r.error, detail: r.detail };
};

function errText(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function createCoderTool(caller: CoderCaller = defaultCaller): ITool {
  return {
    name: 'coder',
    description:
      'Run a headless coding CLI (Codex/Claude) in an isolated git worktree: implements the task, ' +
      'runs the required test command, returns a diff + test verdict. Nothing is merged without ' +
      'passing tests; merging additionally needs the user\'s confirmation.',
    invoke: async (args) => {
      const op = typeof args.op === 'string' ? args.op : 'run';
      try {
        if (op === 'probe') {
          const r = await caller('coder_probe', {}, 20000);
          if (!r.ok) return { success: false, error: errText(r.error) ?? 'coder_failed', errorDetail: errText(r.detail) ?? 'probe failed' };
          return { success: true, data: (r.result ?? {}) as Record<string, unknown> };
        }
        if (op === 'merge') {
          const jobId = typeof args.jobId === 'string' ? args.jobId.trim() : '';
          if (!jobId) return { success: false, error: 'missing_job', errorDetail: 'coder merge requires a jobId from a run.' };
          const r = await caller('coder_merge', { jobId }, 180000);
          if (!r.ok) return { success: false, error: errText(r.error) ?? 'coder_failed', errorDetail: errText(r.detail) ?? 'merge failed' };
          return { success: true, data: (r.result ?? {}) as Record<string, unknown> };
        }
        if (op !== 'run') return { success: false, error: 'bad_op', errorDetail: 'coder op must be probe|run|merge.' };
        const repo = typeof args.repo === 'string' ? args.repo.trim() : '';
        const task = typeof args.task === 'string' ? args.task.trim() : '';
        const testCmd = typeof args.testCmd === 'string' ? args.testCmd.trim() : '';
        if (!repo) return { success: false, error: 'missing_repo', errorDetail: 'coder run requires an absolute repo path.' };
        if (!task) return { success: false, error: 'missing_task', errorDetail: 'coder run requires a task description.' };
        if (!testCmd) {
          return { success: false, error: 'missing_tests', errorDetail: 'coder run requires testCmd — code is never accepted without running tests.' };
        }
        const timeoutMs =
          typeof args.timeoutMs === 'number' && Number.isFinite(args.timeoutMs)
            ? Math.max(60_000, Math.min(1_800_000, Math.floor(args.timeoutMs)))
            : 600_000;
        const callArgs: Record<string, unknown> = { repo, task, testCmd, timeoutMs };
        for (const k of ['cli', 'model', 'testTimeoutMs', 'maxTurns', 'budgetUsd'] as const) {
          if (args[k] !== undefined) callArgs[k] = args[k];
        }
        const r = await caller('coder_run', callArgs, timeoutMs + 180_000);
        if (!r.ok) return { success: false, error: errText(r.error) ?? 'coder_failed', errorDetail: errText(r.detail) ?? 'coder run failed' };
        return { success: true, data: (r.result ?? {}) as Record<string, unknown> };
      } catch (err) {
        return {
          success: false,
          error: 'coder_unreachable',
          errorDetail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

export const coderTool = createCoderTool();

export const CODER_SCHEMA: GeminiFunctionDeclaration = {
  name: 'coder',
  description:
    'Run a headless coding CLI in an isolated git worktree with mandatory tests; returns a diff. ' +
    'Merge (op=merge) needs passing tests plus user confirmation.',
  parameters: {
    type: 'OBJECT',
    properties: {
      op: { type: 'STRING', description: '"run" (default) | "probe" (which CLIs exist) | "merge" (merge a jobId).' },
      repo: { type: 'STRING', description: 'Absolute path to the git checkout (must be clean).' },
      task: { type: 'STRING', description: 'Precise change request for the coding CLI.' },
      testCmd: { type: 'STRING', description: 'REQUIRED test command, e.g. "npm test". No shell metacharacters.' },
      cli: { type: 'STRING', description: '"codex" (default) or "claude".' },
      model: { type: 'STRING', description: 'Optional model override for the CLI.' },
      timeoutMs: { type: 'NUMBER', description: 'CLI time budget, 60s–30min (default 600000).' },
      testTimeoutMs: { type: 'NUMBER', description: 'Test time budget (default 300000).' },
      maxTurns: { type: 'NUMBER', description: 'Claude max agentic turns (default 25).' },
      budgetUsd: { type: 'NUMBER', description: 'Claude spend cap in USD (optional).' },
      jobId: { type: 'STRING', description: 'Job id for op=merge.' },
    },
    required: [],
  },
};
