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
 *
 * The optional `judge` dep is a System-One judge (see decision-judge.ts):
 * it safety-scores plans, second-guesses verifications, and picks the
 * recovery strategy. It is advisory — any judge error falls back to the
 * heuristic behavior, never fails the task by itself.
 */

import type { StepExpectation, TaskPlan, TaskStep, PlannerContext } from './task-planner';
import type { SystemOneJudge } from './decision-judge';

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
  /** Advisory System-One judge: plan gate, verify second-opinion, recovery choice. */
  judge?: SystemOneJudge;
}

export type StepState = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

export interface StepRecord extends TaskStep {
  index: number;
  state: StepState;
  observation?: StepObservation;
  error?: string;
  /** Set once the user approves this step (survives judge-ordered retries). */
  approved?: boolean;
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

    const gate: { ticket?: { question: string; p: number } } = {};

    const finish = async (status: TaskStatus, summary: string): Promise<TaskResult> => {
      for (const r of records) if (r.state === 'pending' || r.state === 'active') r.state = 'skipped';
      emit(this.id, status, { goal, summary });
      // Report the gate outcome for calibration — only for plans that ran
      // (rejected plans and cancellations carry no observed outcome).
      if (gate.ticket && (status === 'done' || status === 'failed') && this.deps.judge?.report) {
        try {
          this.deps.judge.report(gate.ticket, status === 'done' ? 1 : 0);
        } catch {
          // Calibration must never break the loop.
        }
      }
      if ((status === 'done' || status === 'failed') && this.deps.remember) {
        await this.deps.remember(summary).catch(() => {});
      }
      return { status, goal, steps: records, summary };
    };

    // reflect: the judge picks retry_same / replan / ask_user (advisory —
    // errors and low confidence fall back to replan). Returns a terminal
    // result, or null to continue the loop (same step or fresh splice).
    const recoverOrFail = async (rec: StepRecord, failure: string): Promise<TaskResult | null> => {
      if (replans >= this.maxReplans) {
        rec.state = 'failed';
        rec.error = failure;
        return finish('failed', `Failed "${goal}" — ${failure}.`);
      }
      let strategy: 'retry_same' | 'replan' | 'ask_user' = 'replan';
      if (this.deps.judge) {
        try {
          const r = await this.deps.judge.choice(
            `goal: ${goal}\nstep: ${describeStep(rec)}\nobservation: ${JSON.stringify(rec.observation ?? {})}\nfailure: ${failure}\nreplans left: ${this.maxReplans - replans}`,
            'recovery',
            ['retry_same', 'replan', 'ask_user'],
          );
          if (
            r.confidence >= 0.5 &&
            (r.choice === 'retry_same' || r.choice === 'replan' || r.choice === 'ask_user')
          ) {
            strategy = r.choice;
          }
        } catch {
          // Judge down — replan as usual.
        }
      }
      if (strategy === 'ask_user') {
        emit(this.id, 'paused', {
          goal,
          index: rec.index,
          question: `Task hit trouble — ${failure}. Replan and retry?`,
        });
        const approved = await this.waitApproval();
        if (!approved || this.cancelled) {
          return finish('cancelled', `Cancelled "${goal}" at step ${rec.index + 1} (not approved).`);
        }
        strategy = 'replan';
      }
      replans++;
      if (strategy === 'retry_same') {
        emit(this.id, 'replan', { goal, index: rec.index, reason: `${failure} (judge: retry_same)` });
        rec.state = 'pending';
        return null;
      }
      emit(this.id, 'replan', { goal, index: rec.index, reason: failure });
      const next = await this.tryReplan(goal, failure);
      if (next) {
        records.splice(cursor, records.length - cursor, ...next);
        return null;
      }
      rec.state = 'failed';
      rec.error = failure;
      return finish('failed', `Failed "${goal}" — ${failure}.`);
    };

    const gated = await this.gatePlan(goal, plan);
    if (gated.rejection) {
      return finish('failed', `Failed "${goal}" — ${gated.rejection}.`);
    }
    gate.ticket = gated.ticket;

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

      // 1. Checkpoint: planned approval gate (once per step — judge-ordered
      // retries don't re-ask).
      let confirmed = (this.autoConfirm && rec.needsConfirm === true) || rec.approved === true;
      if (rec.needsConfirm && !this.autoConfirm && !rec.approved) {
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
        rec.approved = true;
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
        rec.approved = true;
        res = await this.deps.execute(rec.tool, { ...rec.args, confirm: true });
        executed++;
      }

      // 3. Reflect + recover on execution failure (judge picks the strategy).
      if (!res.ok) {
        const failure = `step ${rec.index + 1} (${describeStep(rec)}) failed: ${res.detail || res.error}`;
        const terminal = await recoverOrFail(rec, failure);
        if (terminal) return terminal;
        continue;
      }

      // 4. Observe + verify: heuristic first, judge second-opinion on a
      // miss or when the step declared no expectation.
      const obs = await this.deps.observe(rec.expect).catch((): StepObservation => ({}));
      rec.observation = obs;
      let verdict = verifyStep(rec, obs);
      let judgeNote = '';
      if (this.deps.judge && (!verdict.pass || !rec.expect)) {
        try {
          const statement = rec.expect?.windowContains
            ? `After "${describeStep(rec)}": the foreground window contains "${rec.expect.windowContains}".`
            : rec.expect?.textVisible
              ? `After "${describeStep(rec)}": the text "${rec.expect.textVisible}" is visible on screen.`
              : `After "${describeStep(rec)}": the step achieved its intent.`;
          const j = await this.deps.judge.noul(
            `goal: ${goal}\nstep: ${describeStep(rec)}\nargs: ${JSON.stringify(rec.args)}\nobservation: ${JSON.stringify(obs)}\nexpect: ${JSON.stringify(rec.expect ?? null)}`,
            'verify',
            statement,
          );
          judgeNote = ` (judge: ${j.noul.toFixed(2)})`;
          const bar = rec.expect ? 0.65 : 0.5;
          if (j.noul >= bar) verdict = { pass: true };
          else if (verdict.pass) verdict = { pass: false, reason: `judge doubted it (${j.noul.toFixed(2)})` };
        } catch {
          // Judge down — the heuristic verdict stands.
        }
      }
      emit(this.id, 'verified', {
        goal,
        index: rec.index,
        pass: verdict.pass,
        reason: verdict.reason ? `${verdict.reason}${judgeNote}` : judgeNote || null,
      });
      if (!verdict.pass) {
        const failure = `step ${rec.index + 1} (${describeStep(rec)}) unverified: ${verdict.reason}`;
        const terminal = await recoverOrFail(rec, failure);
        if (terminal) return terminal;
        continue;
      }

      rec.state = 'done';
      cursor++;
    }

    const doneCount = records.filter((r) => r.state === 'done').length;
    return finish('done', `Done "${goal}" — ${doneCount}/${records.length} steps verified.`);
  }

  private async gatePlan(
    goal: string,
    plan: TaskPlan,
  ): Promise<{ rejection: string | null; ticket?: { question: string; p: number } }> {
    if (!this.deps.judge) return { rejection: null };
    try {
      const g = await this.deps.judge.score(
        `goal: ${goal}\nplan:\n${plan.steps.map((s, i) => `${i + 1}. ${describeStep(s)}${s.needsConfirm ? ' [asks first]' : ''}`).join('\n')}\nsteps: ${JSON.stringify(plan.steps.map((s) => ({ action: (s.args as Record<string, unknown>).action, expect: !!s.expect, needsConfirm: s.needsConfirm === true })))}`,
        'plan_gate',
        ['unsafe or nonsense', 'risky or confused', 'acceptable', 'solid', 'excellent'],
      );
      if (g.score <= 2) {
        return {
          rejection: `plan rejected by the safety gate (score ${g.score}/5, confidence ${g.confidence.toFixed(2)})`,
        };
      }
      return { rejection: null, ticket: g.ticket };
    } catch {
      return { rejection: null };
    }
  }

  private async tryReplan(goal: string, failure: string): Promise<StepRecord[] | null> {
    const ground = await this.deps.observe().catch((): StepObservation => ({}));
    try {
      const plan = await this.deps.plan(goal, {
        window: ground.window ?? null,
        failure,
      });
      const gated = await this.gatePlan(goal, plan);
      if (gated.rejection) return null;
      return plan.steps.map((s, i) => ({ ...s, index: i, state: 'pending' as StepState }));
    } catch {
      return null;
    }
  }
}
