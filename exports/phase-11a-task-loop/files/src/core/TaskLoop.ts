/**
 * core/TaskLoop.ts — Phase 11a: the prefrontal cortex, part 2 (the loop).
 *
 * plan → checkpoint → act → verify → (reflect/replan) → done.
 *
 * The loop itself is pure orchestration: planning, execution, observation
 * and memory are ALL injected, so node tests run it with fakes and the
 * module never touches the extensionless import chain. The `task` tool
 * provides the real deps (brain planner, tool registry, computer.see).
 *
 * Progress is broadcast on `taskEvents` ('task:state') for the TaskPanel
 * step log; pauses (approval gates) resolve via resume().
 */

import type { StepExpectation, TaskPlan, TaskStep, PlannerContext } from './task-planner';

export interface StepObservation {
  window?: string | null;
  textFound?: boolean;
}

export interface ExecuteResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  detail?: string;
}

export interface TaskLoopDeps {
  plan: (goal: string, ctx: PlannerContext) => Promise<TaskPlan>;
  execute: (tool: string, args: Record<string, unknown>) => Promise<ExecuteResult>;
  observe: (expect?: StepExpectation) => Promise<StepObservation>;
  remember?: (summary: string) => Promise<void>;
}

export type StepState = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

export interface StepRecord extends TaskStep {
  index: number;
  state: StepState;
  observation?: StepObservation;
  error?: string;
}

export type TaskStatus = 'done' | 'failed' | 'cancelled';

export interface TaskResult {
  status: TaskStatus;
  goal: string;
  steps: StepRecord[];
  summary: string;
}

export interface TaskLoopOptions {
  /** Hard cap on executed steps (planner output + replans). Default 12. */
  maxSteps?: number;
  /** Max replans after a failure before giving up. Default 2. */
  maxReplans?: number;
  /** Skip approval pauses (the caller already asked the user). */
  autoConfirm?: boolean;
}

/** Shared bus: every loop emits CustomEvent('task:state', {detail:{phase,id,...}}). */
export const taskEvents = new EventTarget();

function emit(id: string, phase: string, detail: Record<string, unknown> = {}): void {
  taskEvents.dispatchEvent(new CustomEvent('task:state', { detail: { phase, id, ...detail } }));
}

export function describeStep(step: TaskStep): string {
  if (step.note) return step.note;
  const a = step.args as Record<string, unknown>;
  const what =
    typeof a.app === 'string'
      ? a.app
      : typeof a.url === 'string'
        ? a.url
        : typeof a.text === 'string'
          ? `"${a.text.slice(0, 40)}"`
          : typeof a.keys === 'string'
            ? a.keys
            : '';
  return `${String(a.action ?? step.tool)}${what ? ` ${what}` : ''}`.trim();
}

/** Heuristic judge: does the observation match the step's expectation? */
export function verifyStep(
  step: TaskStep,
  obs: StepObservation,
): { pass: boolean; reason?: string } {
  const exp = step.expect;
  if (!exp || (!exp.windowContains && !exp.textVisible)) return { pass: true };
  if (exp.windowContains && !(obs.window ?? '').toLowerCase().includes(exp.windowContains.toLowerCase())) {
    return {
      pass: false,
      reason: `window "${obs.window ?? 'unknown'}" lacks "${exp.windowContains}"`,
    };
  }
  if (exp.textVisible && !obs.textFound) {
    return { pass: false, reason: `"${exp.textVisible}" not found on screen` };
  }
  return { pass: true };
}

let loopSeq = 0;

export class TaskLoop {
  readonly id: string;
  private cancelled = false;
  private pausedResolve: ((approved: boolean) => void) | null = null;
  private readonly maxSteps: number;
  private readonly maxReplans: number;
  private readonly autoConfirm: boolean;

  private readonly deps: TaskLoopDeps;

  constructor(deps: TaskLoopDeps, opts: TaskLoopOptions = {}) {
    this.deps = deps;
    this.id = `task-${Date.now().toString(36)}-${++loopSeq}`;
    this.maxSteps = Math.max(1, Math.min(40, opts.maxSteps ?? 12));
    this.maxReplans = Math.max(0, Math.min(5, opts.maxReplans ?? 2));
    this.autoConfirm = opts.autoConfirm === true;
  }

  cancel(): void {
    this.cancelled = true;
    if (this.pausedResolve) {
      const r = this.pausedResolve;
      this.pausedResolve = null;
      r(false);
    }
  }

  resume(approved: boolean): void {
    if (this.pausedResolve) {
      const r = this.pausedResolve;
      this.pausedResolve = null;
      r(approved);
    }
  }

  private waitApproval(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.pausedResolve = resolve;
    });
  }

  async run(rawGoal: string): Promise<TaskResult> {
    const goal = rawGoal.trim().slice(0, 500);
    if (!goal) throw new Error('missing_goal');
    emit(this.id, 'started', { goal });

    const ground = await this.deps.observe().catch((): StepObservation => ({}));
    let plan: TaskPlan;
    try {
      plan = await this.deps.plan(goal, {
        window: ground.window ?? null,
        vision: undefined,
      });
    } catch (err) {
      const summary = `Couldn't plan "${goal}": ${err instanceof Error ? err.message : String(err)}`;
      emit(this.id, 'failed', { goal, summary });
      return { status: 'failed', goal, steps: [], summary };
    }

    const records: StepRecord[] = plan.steps.map((s, i) => ({ ...s, index: i, state: 'pending' }));
    emit(this.id, 'planned', {
      goal,
      steps: records.map((r) => ({ index: r.index, label: describeStep(r), needsConfirm: r.needsConfirm === true })),
    });

    let executed = 0;
    let replans = 0;
    let cursor = 0;

    const finish = async (status: TaskStatus, summary: string): Promise<TaskResult> => {
      for (const r of records) if (r.state === 'pending' || r.state === 'active') r.state = 'skipped';
      emit(this.id, status, { goal, summary });
      if ((status === 'done' || status === 'failed') && this.deps.remember) {
        await this.deps.remember(summary).catch(() => {});
      }
      return { status, goal, steps: records, summary };
    };

    while (cursor < records.length) {
      if (this.cancelled) {
        return finish('cancelled', `Cancelled "${goal}" after ${executed} step(s).`);
      }
      if (executed >= this.maxSteps) {
        return finish('failed', `Step budget (${this.maxSteps}) exceeded on "${goal}" after ${executed} steps.`);
      }
      const rec = records[cursor];
      rec.state = 'active';
      emit(this.id, 'step', { goal, index: rec.index, label: describeStep(rec) });

      // 1. Checkpoint: planned approval gate.
      let confirmed = this.autoConfirm && rec.needsConfirm === true;
      if (rec.needsConfirm && !this.autoConfirm) {
        emit(this.id, 'paused', {
          goal,
          index: rec.index,
          question: `Step ${rec.index + 1}/${records.length} needs your OK: ${describeStep(rec)}. Approve?`,
        });
        const approved = await this.waitApproval();
        if (!approved || this.cancelled) {
          return finish('cancelled', `Cancelled "${goal}" at step ${rec.index + 1} (not approved).`);
        }
        confirmed = true;
      }

      // 2. Act — with a second chance through the daemon's own confirm gate.
      const args = confirmed ? { ...rec.args, confirm: true } : rec.args;
      let res = await this.deps.execute(rec.tool, args);
      executed++;
      if (!res.ok && res.error === 'confirmation_required' && !confirmed) {
        emit(this.id, 'paused', {
          goal,
          index: rec.index,
          question: `Step ${rec.index + 1}/${records.length} was gated: ${res.detail || res.error}. Approve and retry?`,
        });
        const approved = await this.waitApproval();
        if (!approved || this.cancelled) {
          return finish('cancelled', `Cancelled "${goal}" at step ${rec.index + 1} (not approved).`);
        }
        res = await this.deps.execute(rec.tool, { ...rec.args, confirm: true });
        executed++;
      }

      // 3. Reflect + replan on execution failure.
      if (!res.ok) {
        const failure = `step ${rec.index + 1} (${describeStep(rec)}) failed: ${res.detail || res.error}`;
        if (replans < this.maxReplans) {
          replans++;
          emit(this.id, 'replan', { goal, index: rec.index, reason: failure });
          const next = await this.tryReplan(goal, failure);
          if (next) {
            records.splice(cursor, records.length - cursor, ...next);
            continue;
          }
        }
        rec.state = 'failed';
        rec.error = res.detail || res.error;
        return finish('failed', `Failed "${goal}" — ${failure}.`);
      }

      // 4. Observe + verify (the JEPA idea, done symbolically).
      const obs = await this.deps.observe(rec.expect).catch((): StepObservation => ({}));
      rec.observation = obs;
      const verdict = verifyStep(rec, obs);
      emit(this.id, 'verified', { goal, index: rec.index, pass: verdict.pass, reason: verdict.reason ?? null });
      if (!verdict.pass) {
        const failure = `step ${rec.index + 1} (${describeStep(rec)}) unverified: ${verdict.reason}`;
        if (replans < this.maxReplans) {
          replans++;
          emit(this.id, 'replan', { goal, index: rec.index, reason: failure });
          const next = await this.tryReplan(goal, failure);
          if (next) {
            records.splice(cursor, records.length - cursor, ...next);
            continue;
          }
        }
        rec.state = 'failed';
        rec.error = verdict.reason;
        return finish('failed', `Failed "${goal}" — ${failure}.`);
      }

      rec.state = 'done';
      cursor++;
    }

    const doneCount = records.filter((r) => r.state === 'done').length;
    return finish('done', `Done "${goal}" — ${doneCount}/${records.length} steps verified.`);
  }

  private async tryReplan(goal: string, failure: string): Promise<StepRecord[] | null> {
    const ground = await this.deps.observe().catch((): StepObservation => ({}));
    try {
      const plan = await this.deps.plan(goal, {
        window: ground.window ?? null,
        failure,
      });
      return plan.steps.map((s, i) => ({ ...s, index: i, state: 'pending' as StepState }));
    } catch {
      return null;
    }
  }
}
