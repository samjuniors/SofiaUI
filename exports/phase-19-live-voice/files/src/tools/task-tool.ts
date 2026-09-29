/**
 * tools/task-tool.ts — Phase 18: the `task` tool (prefrontal cortex, part 3).
 *
 * Runs ONE multi-step desktop goal: the TaskLoop observes the screen,
 * the brain picks ONE action per step (screenshot in every call), each
 * step executes through the tool registry, verifies by observation, and
 * the loop pauses for approval before irreversible steps. Progress
 * streams to the TaskPanel step log via taskEvents.
 *
 * Judgments (step gate, verify second-opinion, recovery choice) come from
 * SofiaJudge — our own on-device decision engine, no API. Memory recall
 * grounds the decider in similar past tasks. The registry and episodic
 * memory load lazily because they touch the extensionless import chain.
 *
 * Phase 19: invoke is NON-BLOCKING — it returns {started:true} immediately
 * and the loop runs in the background. Progress, approval questions, and
 * the result stream to the TaskPanel AND the voice narrator via taskEvents.
 * A new goal supersedes the running task (barge-in redirect); cancel:true
 * stops it. Generations keep orphaned runs from touching new-run state.
 */

import type { ITool, ToolResult, GeminiFunctionDeclaration } from './types';
import { TaskLoop, type TaskResult } from '../core/TaskLoop.ts';
import { decideWithBrain, normalizeObservation, recallSimilar } from '../core/task-decider.ts';
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
/** Bumped on every start/cancel — only the latest generation owns `running`. */
let runGen = 0;

/** True while the latest run owns the task slot (voice barge-in checks this). */
export function isTaskRunning(): boolean {
  return running;
}
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
  // Recalled once per task; every step decision carries it.
  const memory = await recallSimilar(goal, async (q) => {
    const { searchEpisodes } = await import('../lib/episodes');
    const r = await searchEpisodes(undefined, q, 5);
    return r.hits;
  });
  const loop = new TaskLoop(
    {
      decide: async (g, ctx) =>
        decideWithBrain(g, ctx.obs, {
          step: ctx.step,
          failure: ctx.failure,
          history: ctx.history,
          memory: memory || undefined,
        }),
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
      observe: async () => {
        const r = await computerTool.invoke({ action: 'observe' });
        if (!r.success || !r.data) {
          throw new Error(r.errorDetail || r.error || 'observe failed');
        }
        return normalizeObservation(r.data);
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
    'Run ONE multi-step desktop task as a single goal: looks at the screen, acts one step ' +
    'at a time with verification after each step, recovers on failure, and asks before irreversible steps. ' +
    'NON-BLOCKING: returns {started:true} immediately — say "On it!" and keep chatting; progress, ' +
    'approval questions, and the result arrive as spoken updates plus the Task card. ' +
    'Use when the request needs 2+ PC actions or must be verified ("open VLC and play...", ' +
    '"go to X and click Y", "open the Start menu and launch..."). ' +
    'For single actions (open/click/type/scroll once) call computer directly — cheaper and faster. ' +
    'Calling task again with a new goal REDIRECTS the running task; cancel:true stops it. ' +
    'Approval pauses surface as questions to the user; you cannot skip them. ' +
    'Every step is safety-scored on-device and independently verified before moving on.',
  async invoke(rawArgs: Record<string, unknown>): Promise<ToolResult> {
    // NOTE: no model-settable confirm/autoConfirm — the model must never
    // skip approval pauses (that would be self-confirmation). Programmatic
    // callers may still pass autoConfirm through the runner opts.
    const args = rawArgs as { goal?: unknown; cancel?: unknown };
    if (args.cancel === true) {
      const had = running;
      runGen++; // orphan any in-flight run — its completion is ignored
      running = false;
      active?.cancel();
      return { success: true, data: { action: 'cancel', cancelled: !!had } };
    }
    const goal = String(args.goal ?? '').trim();
    if (!goal) {
      return { success: false, error: 'missing_goal', errorDetail: 'task requires a goal (or cancel:true).' };
    }
    // Redirect, not refusal: a new goal supersedes the running task. The
    // orphaned loop winds down on its own; the generation check below keeps
    // it from touching the new run's state.
    const superseded = running;
    if (superseded) {
      runGen++;
      active?.cancel();
    }
    const gen = ++runGen;
    running = true;
    const runner = runnerOverride ?? realRunner;
    void (async () => {
      try {
        await runner(goal, { autoConfirm: false });
      } catch {
        // Runner failures surface through taskEvents terminal states, never
        // as unhandled rejections — the tool already returned {started:true}.
      } finally {
        if (gen === runGen) running = false;
      }
    })();
    return {
      success: true,
      data: {
        started: true,
        goal,
        ...(superseded ? { superseded: true } : {}),
        note: 'Task started in the background — progress, approval questions, and the result arrive as spoken updates and in the Task card.',
      },
    };
  },
};

export const TASK_SCHEMA: GeminiFunctionDeclaration = {
  name: 'task',
  description:
    'Run one multi-step desktop task (NON-BLOCKING, returns started:true at once): observes the screen, ' +
    'acts one step at a time with verification, recovers on failure, asks before irreversible steps. ' +
    'Progress/result arrive as spoken updates. A new goal redirects; cancel:true stops. ' +
    'Single actions should use computer directly.',
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
