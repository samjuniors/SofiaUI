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

/**
 * Compact execution shape banked on every task episode
 * (`[trail: observe → click → type]`); the dream's skill induction reads it
 * back to give learned skills real steps. Pure.
 */
export function episodeTrail(steps: Array<{ tool?: unknown }>): string {
  return steps
    .map((s) => String(s.tool ?? '').trim())
    .filter(Boolean)
    .join(' → ')
    .slice(0, 300);
}

/** Screenshots bigger than this never ride to the daemon (it would drop them). */
const MAX_SHOT_B64 = 2_400_000; // ≈1.8 MB of PNG

/**
 * Per-step tool@target pairs banked beside the trail (`[moves: observe;
 * click@Login]`); skill induction aligns them into parameters. Pure.
 */
export function episodeMoves(steps: Array<{ tool?: unknown; target?: unknown }>): string {
  return steps
    .map((s) => {
      const tool = String(s.tool ?? '').trim();
      if (!tool) return '';
      const tgt = String(s.target ?? '').trim().slice(0, 40);
      return tgt ? `${tool}@${tgt}` : tool;
    })
    .filter(Boolean)
    .join('; ')
    .slice(0, 500);
}
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
    const { searchEpisodesHybrid } = await import('../lib/episodes');
    const r = await searchEpisodesHybrid(undefined, q, 5);
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
        const { addEpisodeEnriched } = await import('../lib/episodes');
        await addEpisodeEnriched(undefined, summary, 'task');
      },
    },
    { autoConfirm: opts.autoConfirm },
  );
  active = loop;
  try {
    await ensureJudgeMemory();
    // Phase 24: the running goal lives in working memory ("current task"),
    // recalled into every turn; best-effort — tasks never fail on memory.
    try {
      const { putWorking } = await import('../lib/memory');
      await putWorking(undefined, { goal, plan: `task: ${goal}` });
    } catch {
      /* companion down → the task still runs */
    }
    const result = await loop.run(goal);
    // …and the outcome lands in episodic memory: what happened + outcome +
    // the step trail and moves (skill induction reads them back) + a
    // screenshot of the final state. All best-effort — memory never fails
    // a finished task.
    try {
      const { addMemoryEpisode } = await import('../lib/memory');
      const trail = episodeTrail(result.steps);
      const moves = episodeMoves(result.steps);
      let shots: string[] | undefined;
      try {
        const obs = await computerTool.invoke({ action: 'observe' });
        const b64 = (obs.data as { screenshot_b64?: unknown } | null)?.screenshot_b64;
        if (obs.success && typeof b64 === 'string' && b64.length > 100 && b64.length < MAX_SHOT_B64) {
          shots = [`data:image/png;base64,${b64}`];
        }
      } catch {
        /* headed-only luxury — headless tasks simply bank no shot */
      }
      const ep = await addMemoryEpisode(undefined, {
        text:
          `Task "${goal}" ${result.status} after ${result.steps.length} steps: ${result.summary}` +
          (trail ? ` [trail: ${trail}]` : '') +
          (moves ? ` [moves: ${moves}]` : ''),
        kind: 'task',
        outcome: result.status,
        source: 'task-tool',
        importance: result.status === 'done' ? 0.6 : 0.9,
        ...(shots ? { shots } : {}),
      });
      const epId = ep.id;
      // The critic reflects: goal, steps, what failed, what worked.
      try {
        const { critiqueTask, failureCause } = await import('../core/task-critic');
        const { formatMirrorLine, mirrorStore } = await import('../core/task-mirror');
        const { recordSkillUse, recallForTurn } = await import('../lib/memory');
        const c = critiqueTask(goal, result.status, result.steps, result.summary);
        await addMemoryEpisode(undefined, {
          text: `Reflection on task episode #${epId}: ${c.text}`,
          kind: 'reflection',
          outcome: result.status === 'done' ? 'done' : result.status === 'cancelled' ? 'cancelled' : 'failed',
          source: 'task-critic',
          importance: c.verdict === 'clean' ? 0.3 : 0.7,
        });
        // The mirror: one confidence line per task for calibration + patterns.
        try {
          await addMemoryEpisode(undefined, {
            text: formatMirrorLine({
              taskEpisode: Number.isInteger(epId) ? (epId as number) : 0,
              confidence: c.confidence,
              outcome: result.status,
              stepsTotal: result.steps.length,
              failedTools: c.failed.map((f) => f.tool),
            }),
            kind: 'mirror',
            outcome: result.status,
            source: 'task-mirror',
            importance: 0.2,
          });
        } catch {
          /* the mirror never fails a finished task */
        }
        try {
          mirrorStore.record({
            taskEpisode: Number.isInteger(epId) ? (epId as number) : 0,
            at: Date.now(),
            confidence: c.confidence,
            outcome: result.status,
            stepsTotal: result.steps.length,
            failedTools: c.failed.map((f) => f.tool),
            goal,
          });
        } catch {
          /* local ring is a luxury */
        }
        // Skill attribution: the top recalled how-to owns this outcome, so
        // success rates move with production evidence.
        try {
          const mem = await recallForTurn(goal, { topK: 3 });
          const top = mem.skills[0];
          if (top && (top.status === 'active' || top.status === 'candidate')) {
            const cause = failureCause(c);
            await recordSkillUse(undefined, top.id, result.status === 'done', cause ?? undefined);
          }
        } catch {
          /* attribution is advisory — the reflection above is the record */
        }
      } catch {
        /* the critic never fails a finished task */
      }
    } catch {
      /* never fail a finished task on memory */
    }
    return result;
  } finally {
    if (active === loop) active = null;
    try {
      const { clearWorking } = await import('../lib/memory');
      await clearWorking();
    } catch {
      /* working memory already gone or unreachable — fine */
    }
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
