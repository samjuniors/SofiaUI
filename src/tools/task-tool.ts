/**
 * tools/task-tool.ts — Phase 11a: the `task` tool (prefrontal cortex, part 3).
 *
 * Runs ONE multi-step desktop goal: the brain plans it, the TaskLoop
 * executes each step through the tool registry, verifies by observation,
 * replans on failure, and pauses for approval before irreversible steps.
 * Progress streams to the TaskPanel step log via taskEvents.
 *
 * Static imports stay inside the strip-types-safe set (TaskLoop and the
 * planner are dependency-free); the registry and episodic memory load
 * lazily because they touch the extensionless import chain.
 */

import type { ITool, ToolResult, GeminiFunctionDeclaration } from './types';
import { TaskLoop, type TaskResult } from '../core/TaskLoop.ts';
import { planWithBrain } from '../core/task-planner.ts';
import { computerTool } from './computer-tool.ts';

export type TaskRunner = (goal: string, opts: { autoConfirm: boolean }) => Promise<TaskResult>;

let runnerOverride: TaskRunner | null = null;

/** Test seam — stub the whole run. */
export function __setTaskRunner(r: TaskRunner | null): void {
  runnerOverride = r;
}

let running = false;
let active: TaskLoop | null = null;

/** UI hooks for the TaskPanel approve/deny/cancel buttons. */
export function getActiveTask(): TaskLoop | null {
  return active;
}
export function approveTask(ok: boolean): boolean {
  if (!active) return false;
  active.resume(ok);
  return true;
}
export function cancelTask(): boolean {
  if (!active) return false;
  active.cancel();
  return true;
}

async function realRunner(goal: string, opts: { autoConfirm: boolean }): Promise<TaskResult> {
  const [{ toolRegistry }] = await Promise.all([import('./registry')]);
  const loop = new TaskLoop(
    {
      plan: (g, ctx) => planWithBrain(g, ctx),
      execute: async (tool, args) => {
        const r = await toolRegistry.invoke({ name: tool, args });
        return typeof r.error === 'string'
          ? { ok: false, error: r.error, detail: typeof r.detail === 'string' ? r.detail : undefined }
          : { ok: true, data: r };
      },
      observe: async (expect) => {
        const obs: { window?: string | null; textFound?: boolean } = {};
        const see = await computerTool.invoke({ action: 'see' });
        if (see.success && see.data && typeof see.data === 'object') {
          const w = (see.data as { window?: unknown }).window;
          if (typeof w === 'string') obs.window = w;
        }
        if (expect?.textVisible) {
          const found = await computerTool.invoke({ action: 'find_text', text: expect.textVisible });
          obs.textFound = found.success;
        }
        return obs;
      },
      remember: async (summary) => {
        const { addEpisode } = await import('../lib/episodes');
        await addEpisode(undefined, summary, 'task');
      },
    },
    { autoConfirm: opts.autoConfirm },
  );
  active = loop;
  try {
    return await loop.run(goal);
  } finally {
    if (active === loop) active = null;
  }
}

export const taskTool: ITool = {
  name: 'task',
  description:
    'Run ONE multi-step desktop task as a single goal: plans the steps, checks its work ' +
    'after each step, recovers/replans on failure, and asks before irreversible steps. ' +
    'Use when the request needs 2+ PC actions or must be verified ("open VLC and play...", ' +
    '"go to X and click Y", "open the Start menu and launch..."). ' +
    'For single actions (open/click/type/scroll once) call computer directly — cheaper and faster. ' +
    'Pass confirm:true only if the user already approved confirmations. ' +
    'Live progress appears in the Task card; pauses surface as approval questions.',
  async invoke(rawArgs: Record<string, unknown>): Promise<ToolResult> {
    const args = rawArgs as { goal?: unknown; cancel?: unknown; confirm?: unknown };
    if (args.cancel === true) {
      const had = active;
      active?.cancel();
      return { success: true, data: { action: 'cancel', cancelled: !!had } };
    }
    const goal = String(args.goal ?? '').trim();
    if (!goal) {
      return { success: false, error: 'missing_goal', errorDetail: 'task requires a goal (or cancel:true).' };
    }
    if (running) {
      return {
        success: false,
        error: 'task_busy',
        errorDetail: 'Another task is already running. Wait for it or cancel it first.',
      };
    }
    running = true;
    try {
      const runner = runnerOverride ?? realRunner;
      const result = await runner(goal, { autoConfirm: args.confirm === true });
      if (result.status === 'done') {
        return { success: true, data: { status: 'done', summary: result.summary, steps: result.steps.length } };
      }
      return {
        success: false,
        error: result.status === 'cancelled' ? 'task_cancelled' : 'task_failed',
        errorDetail: result.summary,
      };
    } finally {
      running = false;
    }
  },
};

export const TASK_SCHEMA: GeminiFunctionDeclaration = {
  name: 'task',
  description:
    'Run one multi-step desktop task: plans, executes with verification, replans on ' +
    'failure, asks before irreversible steps. Single actions should use computer directly.',
  parameters: {
    type: 'OBJECT',
    properties: {
      goal: {
        type: 'STRING',
        description: 'The multi-step goal, e.g. "open VLC and play the movie".',
      },
      confirm: {
        type: 'BOOLEAN',
        description: 'Skip approval pauses (only when the user already approved).',
      },
      cancel: {
        type: 'BOOLEAN',
        description: 'Set true to cancel the running task.',
      },
    },
    required: [],
  },
};
