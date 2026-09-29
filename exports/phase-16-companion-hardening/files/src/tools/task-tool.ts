/**
 * tools/task-tool.ts — Phase 11a/11b: the `task` tool (prefrontal cortex, part 3).
 *
 * Runs ONE multi-step desktop goal: the brain plans it, the TaskLoop
 * executes each step through the tool registry, verifies by observation,
 * replans on failure, and pauses for approval before irreversible steps.
 * Progress streams to the TaskPanel step log via taskEvents.
 *
 * Judgments (plan gate, verify second-opinion, recovery choice) come from
 * SofiaJudge — our own on-device decision engine, no API. Memory recall
 * grounds the planner in similar past tasks. The registry and episodic
 * memory load lazily because they touch the extensionless import chain.
 */

import type { ITool, ToolResult, GeminiFunctionDeclaration } from './types';
import { TaskLoop, type TaskResult } from '../core/TaskLoop.ts';
import { planWithBrain, recallSimilar } from '../core/task-planner.ts';
import { SofiaJudge } from '../core/decision-judge.ts';
import { JudgeMemory } from '../core/judge-memory.ts';
import { computerTool } from './computer-tool.ts';

export type TaskRunner = (goal: string, opts: { autoConfirm: boolean }) => Promise<TaskResult>;

let runnerOverride: TaskRunner | null = null;

/** Test seam — stub the whole run. */
export function __setTaskRunner(r: TaskRunner | null): void {
  runnerOverride = r;
}

let running = false;
let active: TaskLoop | null = null;
/** Shared across tasks so calibration learns from every outcome; persisted in 11c. */
const sharedJudge = new SofiaJudge();
const judgeMemory = new JudgeMemory();
let judgeMemoryReady: Promise<void> | null = null;

/** Load persisted learning once; best-effort — judging never waits on it failing. */
function ensureJudgeMemory(): Promise<void> {
  if (!judgeMemoryReady) {
    judgeMemoryReady = judgeMemory
      .load()
      .then((snap) => {
        if (snap) sharedJudge.importMemory(snap);
      })
      .catch(() => undefined);
  }
  return judgeMemoryReady;
}

function persistJudgeMemory(): Promise<void> {
  return judgeMemory
    .save(sharedJudge.calibrationSnapshot())
    .then(() => undefined)
    .catch(() => undefined);
}

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
      plan: async (g, ctx) => {
        const memory = await recallSimilar(g, async (q) => {
          const { searchEpisodes } = await import('../lib/episodes');
          const r = await searchEpisodes(undefined, q, 5);
          return r.hits;
        });
        return planWithBrain(g, { ...ctx, memory: memory || undefined });
      },
      judge: sharedJudge,
      execute: async (tool, args) => {
        const r = await toolRegistry.invoke({ name: tool, args });
        if (typeof r.error === 'string') {
          const cid = typeof r.confirmation_id === 'string' ? r.confirmation_id : undefined;
          return {
            ok: false,
            error: r.error,
            detail: typeof r.detail === 'string' ? r.detail : undefined,
            confirmationId: cid,
          };
        }
        return { ok: true, data: r };
      },
      // UI/voice-confirm redemption — the loop calls this only after the
      // user approves (pause resume), never on the model's say-so.
      confirm: async (id) => {
        const { companion } = await import('../lib/companion-client');
        const r = await companion.confirm(id);
        return r.ok ? { ok: true } : { ok: false, error: r.error ?? 'redemption_failed' };
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
    await ensureJudgeMemory();
    return await loop.run(goal);
  } finally {
    if (active === loop) active = null;
    await persistJudgeMemory();
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
    'Approval pauses surface as questions to the user; you cannot skip them. ' +
    'Live progress appears in the Task card; pauses surface as approval questions. ' +
    'Every plan is safety-scored on-device and every step independently verified before moving on.',
  async invoke(rawArgs: Record<string, unknown>): Promise<ToolResult> {
    // NOTE: no model-settable confirm/autoConfirm — the model must never
    // skip approval pauses (that would be self-confirmation). Programmatic
    // callers may still pass autoConfirm through the runner opts.
    const args = rawArgs as { goal?: unknown; cancel?: unknown };
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
      const result = await runner(goal, { autoConfirm: false });
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
      cancel: {
        type: 'BOOLEAN',
        description: 'Set true to cancel the running task.',
      },
    },
    required: [],
  },
};
