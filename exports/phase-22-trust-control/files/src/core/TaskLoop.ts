/**
 * core/TaskLoop.ts — Phase 18: the prefrontal cortex, part 2 (the loop).
 *
 * observe → decide ONE action → act → observe → verify → repeat.
 *
 * The 8-steps-upfront planner is gone: every iteration decides from a
 * FRESH observation (screenshot + active window + UI tree), so the loop
 * adapts to whatever is actually on screen instead of executing a stale
 * script. The brain prefers ui_tree element ids ("target":"e7") and falls
 * back to screenshot-pixel coordinates, which the loop maps back to
 * physical pixels through obs.scale before executing.
 *
 * The loop itself is pure orchestration: observation, deciding,
 * execution and memory are ALL injected, so node tests run it with fakes
 * and the module never touches the extensionless import chain. The
 * `task` tool provides the real deps (computer.observe, brain decider
 * with screenshot, tool registry, episodic memory).
 *
 * Four bounds keep every task finite: maxSteps (decide attempts AND
 * executions share the limit), maxRetries (consecutive failures),
 * repeat-state stops (no progress), and the daemon's own step budget.
 * Observation failure fails CLOSED — the loop never acts blind.
 *
 * Progress broadcasts on `taskEvents` ('task:state') for the TaskPanel
 * step log: started → decided → step → verified → … → done/failed/
 * cancelled, with paused (approval) and retry (failure notes) between.
 * Pauses resolve via resume(); cancel() is the UI kill switch (the
 * daemon ALSO aborts on its own kill switch — corner, Ctrl+C, abort).
 *
 * The optional `judge` dep is a System-One judge (see decision-judge.ts):
 * it gates each single decision, second-guesses verifications, and picks
 * the recovery strategy (retry_same / replan-meaning-decide-fresh /
 * ask_user). Advisory — any judge error falls back to heuristics, never
 * fails the task by itself.
 */

import {
  POINTER_ACTIONS,
  TARGET_RE,
  type StepDecision,
  type StepExpectation,
  type TaskObservation,
} from './task-decider.ts';
import type { SystemOneJudge } from './decision-judge';

export interface ExecuteResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  detail?: string;
  /** Daemon-issued one-time id on confirmation_required; redeemed via deps.confirm. */
  confirmationId?: string;
}

/** What the decider sees: the fresh obs plus loop bookkeeping. */
export interface DecideContext {
  obs: TaskObservation;
  /** 1-based iteration about to run. */
  step: number;
  /** Last failure, so the brain can correct (undefined on clean runs). */
  failure?: string;
  /** Recent "label — outcome" lines, oldest first. */
  history: string[];
}

export interface TaskLoopDeps {
  /** Fresh screen observation. Must never resolve blind — throw instead. */
  observe: () => Promise<TaskObservation>;
  /** Pick ONE action (or done) from the observation. */
  decide: (goal: string, ctx: DecideContext) => Promise<StepDecision>;
  execute: (tool: string, args: Record<string, unknown>) => Promise<ExecuteResult>;
  remember?: (summary: string) => Promise<void>;
  /**
   * UI/voice-confirm redemption: approve a daemon-issued confirmation id
   * after the user says yes. The loop only calls this following an
   * explicit approval (pause resume / pre-approved autoConfirm).
   */
  confirm?: (confirmationId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Advisory System-One judge: step gate, verify second-opinion, recovery choice. */
  judge?: SystemOneJudge;
}

export type StepState = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

/** Slim post-act snapshot kept on records (never the base64 pixels). */
export interface SlimObservation {
  window?: string | null;
  treeNodes?: number;
  shot?: boolean;
}

export interface StepRecord {
  index: number;
  state: StepState;
  tool: string;
  /** RESOLVED args: physical pixels, element id already consumed. */
  args: Record<string, unknown>;
  /** Element id the model named, for the step log (if any). */
  target?: string;
  /** Physical click point (+ element box when id-targeted) for the preview overlay. */
  preview?: StepPreviewTarget;
  note?: string;
  expect?: StepExpectation;
  needsConfirm?: boolean;
  observation?: SlimObservation;
  error?: string;
  /** Set once the user approves this step (survives judge-ordered retries). */
  approved?: boolean;
}

/**
 * Where a step will land, in PHYSICAL pixels: the primary point plus the
 * element box when the model named a UI-tree id (drags add the end point).
 * Null when the step has no single screen target (e.g. bare typing).
 */
export interface StepPreviewTarget {
  x: number;
  y: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
  toX?: number;
  toY?: number;
}

export type TaskStatus = 'done' | 'failed' | 'cancelled';

export interface TaskResult {
  status: TaskStatus;
  goal: string;
  steps: StepRecord[];
  summary: string;
}

export interface TaskLoopOptions {
  /** Hard cap on decide attempts AND executions (shared limit). Default 12. */
  maxSteps?: number;
  /** Max consecutive failures before giving up. Default 2. */
  maxRetries?: number;
  /** Skip approval pauses (the caller already asked the user). */
  autoConfirm?: boolean;
  /** Settle delay (ms) between act and re-observe. Default 500. */
  settleMs?: number;
  /** Extra sightings of one screen state tolerated before stopping. Default 1. */
  repeatTolerance?: number;
}

/** Shared bus: every loop emits CustomEvent('task:state', {detail:{phase,id,...}}). */
export const taskEvents = new EventTarget();

function emit(id: string, phase: string, detail: Record<string, unknown> = {}): void {
  taskEvents.dispatchEvent(new CustomEvent('task:state', { detail: { phase, id, ...detail } }));
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export function describeStep(step: {
  note?: string;
  tool?: string;
  args: Record<string, unknown>;
  target?: string;
}): string {
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
  const tgt = step.target ? ` ${step.target}` : '';
  return `${String(a.action ?? step.tool ?? '?')}${tgt}${what ? ` ${what}` : ''}`.trim();
}

/** Screenshot pixels → physical pixels through the observe scale. Pure. */
export function shotToPhysical(v: number, scale: number): number {
  return Math.round(v / scale);
}

/** Clamp a physical point into the observed screen (no-op when unknown). Pure. */
export function clampToScreen(
  x: number,
  y: number,
  screen: TaskObservation['screen'],
): { x: number; y: number } {
  if (!screen || screen.width <= 0 || screen.height <= 0) {
    return { x: Math.round(x), y: Math.round(y) };
  }
  const minX = screen.offsetX;
  const maxX = screen.offsetX + screen.width - 1;
  const minY = screen.offsetY;
  const maxY = screen.offsetY + screen.height - 1;
  return {
    x: Math.max(minX, Math.min(maxX, Math.round(x))),
    y: Math.max(minY, Math.min(maxY, Math.round(y))),
  };
}

/**
 * Resolve a raw decision against the observation it was decided from:
 * element ids → physical centers (preferred), shot coords → physical
 * (fallback), everything else passes through with `target` stripped
 * (the daemon never sees element ids). Pure.
 */
export function resolveStepTarget(
  decision: StepDecision,
  obs: TaskObservation,
): { args: Record<string, unknown>; target?: string; preview?: StepPreviewTarget } | { error: string } {
  const raw = decision.args ?? {};
  const args = { ...raw };
  const action = args.action;
  delete args.target;
  /** Element box the model named (for the preview overlay), if any. */
  const namedBounds = (): StepPreviewTarget | null => {
    const t = raw.target;
    if (typeof t !== 'string' || !TARGET_RE.test(t)) return null;
    const node = obs.tree.find((n) => n.id.toLowerCase() === t.toLowerCase());
    if (!node?.bounds) return null;
    return {
      x: node.bounds.x + Math.floor(node.bounds.width / 2),
      y: node.bounds.y + Math.floor(node.bounds.height / 2),
      bounds: { ...node.bounds },
    };
  };
  if (typeof action === 'string' && POINTER_ACTIONS.has(action)) {
    const t = raw.target;
    if (typeof t === 'string' && TARGET_RE.test(t)) {
      const node = obs.tree.find((n) => n.id.toLowerCase() === t.toLowerCase());
      if (node?.bounds) {
        return {
          args: {
            ...args,
            x: node.bounds.x + Math.floor(node.bounds.width / 2),
            y: node.bounds.y + Math.floor(node.bounds.height / 2),
          },
          target: node.id,
          preview: {
            x: node.bounds.x + Math.floor(node.bounds.width / 2),
            y: node.bounds.y + Math.floor(node.bounds.height / 2),
            bounds: { ...node.bounds },
          },
        };
      }
      // Else fall through to coordinates (prefer ids, fall back to coords).
    }
    const x = num(args.x);
    const y = num(args.y);
    if (x === null || y === null) {
      return { error: `${action} needs a UI-tree target or x/y coordinates.` };
    }
    if (!obs.scale || !obs.shot) {
      return { error: `${action} coordinates need a screenshot, but this step has none — use an element target.` };
    }
    const c = clampToScreen(shotToPhysical(x, obs.scale), shotToPhysical(y, obs.scale), obs.screen);
    return { args: { ...args, x: c.x, y: c.y }, preview: { x: c.x, y: c.y, bounds: null } };
  }
  if (action === 'drag') {
    const pts = [num(args.fromX), num(args.fromY), num(args.toX), num(args.toY)];
    if (pts.some((p) => p === null)) return { error: 'drag needs fromX/fromY/toX/toY coordinates.' };
    if (!obs.scale || !obs.shot) {
      return { error: 'drag coordinates need a screenshot, but this step has none.' };
    }
    const [fx, fy, tx, ty] = pts as number[];
    const f = clampToScreen(shotToPhysical(fx, obs.scale), shotToPhysical(fy, obs.scale), obs.screen);
    const t = clampToScreen(shotToPhysical(tx, obs.scale), shotToPhysical(ty, obs.scale), obs.screen);
    return {
      args: { ...args, fromX: f.x, fromY: f.y, toX: t.x, toY: t.y },
      preview: { x: f.x, y: f.y, toX: t.x, toY: t.y, bounds: null },
    };
  }
  const preview = namedBounds();
  return preview ? { args, target: String(raw.target), preview } : { args };
}

/**
 * Stable screen-state fingerprint: window + app + tree (role/name/value/
 * bounds/enabled). Deliberately EXCLUDES the screenshot (blinking cursors
 * and clocks would make every state unique) and the cursor. Pure.
 */
export function fingerprintObservation(obs: TaskObservation): string {
  const head = `${obs.window ?? ''}\n${obs.app ?? ''}`;
  const nodes = obs.tree.map((n) => {
    const b = n.bounds ? `${n.bounds.x},${n.bounds.y},${n.bounds.width},${n.bounds.height}` : '-';
    return `${n.role}|${n.name}|${n.value ?? ''}|${b}|${n.enabled ? 1 : 0}`;
  });
  return `${head}\n${nodes.join('\n')}`;
}

/** Heuristic judge: does the fresh observation match the step's expectation? Pure. */
export function verifyExpectation(
  expect: StepExpectation | undefined,
  obs: TaskObservation,
): { pass: boolean; reason?: string } {
  if (!expect || (!expect.windowContains && !expect.textVisible)) return { pass: true };
  if (
    expect.windowContains &&
    !(obs.window ?? '').toLowerCase().includes(expect.windowContains.toLowerCase())
  ) {
    return {
      pass: false,
      reason: `window "${obs.window ?? 'unknown'}" lacks "${expect.windowContains}"`,
    };
  }
  if (expect.textVisible) {
    const hay = obs.tree
      .map((n) => `${n.name} ${n.value ?? ''}`)
      .join(' ')
      .toLowerCase();
    if (!hay.includes(expect.textVisible.toLowerCase())) {
      return { pass: false, reason: `"${expect.textVisible}" not found in UI tree (${obs.tree.length} nodes)` };
    }
  }
  return { pass: true };
}

let loopSeq = 0;

export class TaskLoop {
  readonly id: string;
  private cancelled = false;
  private pausedResolve: ((approved: boolean) => void) | null = null;
  private readonly maxSteps: number;
  private readonly maxRetries: number;
  private readonly autoConfirm: boolean;
  private readonly settleMs: number;
  private readonly repeatTolerance: number;

  private readonly deps: TaskLoopDeps;

  constructor(deps: TaskLoopDeps, opts: TaskLoopOptions = {}) {
    this.deps = deps;
    this.id = `task-${Date.now().toString(36)}-${++loopSeq}`;
    this.maxSteps = Math.max(1, Math.min(40, opts.maxSteps ?? 12));
    this.maxRetries = Math.max(0, Math.min(5, opts.maxRetries ?? 2));
    this.autoConfirm = opts.autoConfirm === true;
    this.settleMs = Math.max(0, Math.min(10000, opts.settleMs ?? 500));
    this.repeatTolerance = Math.max(0, Math.min(3, opts.repeatTolerance ?? 1));
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

  /** Observe with one retry — still blind afterwards the caller fails closed. */
  private async observeBlind(): Promise<TaskObservation> {
    try {
      return await this.deps.observe();
    } catch {
      return await this.deps.observe();
    }
  }

  async run(rawGoal: string): Promise<TaskResult> {
    const goal = rawGoal.trim().slice(0, 500);
    if (!goal) throw new Error('missing_goal');
    emit(this.id, 'started', { goal });

    let obs: TaskObservation;
    try {
      obs = await this.observeBlind();
    } catch (err) {
      const summary = `Couldn't observe the screen for "${goal}": ${err instanceof Error ? err.message : String(err)}`;
      emit(this.id, 'failed', { goal, summary });
      return { status: 'failed', goal, steps: [], summary };
    }

    const seen = new Map<string, number>([[fingerprintObservation(obs), 1]]);
    const records: StepRecord[] = [];
    let usedSteps = 0;
    let executed = 0;
    let consecutiveFailures = 0;
    let lastFailure: string | undefined;
    let carried: { decision: StepDecision; rec: StepRecord } | null = null;
    const gate: { ticket?: { question: string; p: number } } = {};

    const finish = async (status: TaskStatus, summary: string): Promise<TaskResult> => {
      for (const r of records) if (r.state === 'pending' || r.state === 'active') r.state = 'skipped';
      emit(this.id, status, { goal, summary });
      emit(this.id, 'preview', { goal, dismissed: true });
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

    const historyLines = (): string[] =>
      records.map((r, i) => {
        const outcome =
          r.state === 'done' ? 'verified' : r.state === 'failed' ? `FAILED: ${r.error ?? 'unknown'}` : r.state;
        return `${i + 1}. ${describeStep(r)} — ${outcome}`;
      });

    // Pre-execution failure (decide/gate/resolve): bounded retries with
    // failure feedback, no judge (nothing was attempted yet).
    const failSilent = async (msg: string): Promise<TaskResult | null> => {
      consecutiveFailures++;
      lastFailure = msg;
      emit(this.id, 'retry', { goal, reason: msg });
      if (consecutiveFailures > this.maxRetries) {
        return finish('failed', `Failed "${goal}" — ${msg} (${consecutiveFailures} consecutive failures).`);
      }
      return null;
    };

    // Post-execution failure (execute/verify): budget first, then the
    // judge picks retry_same / replan (= decide fresh) / ask_user.
    const failExecuted = async (
      rec: StepRecord,
      decision: StepDecision,
      failure: string,
    ): Promise<TaskResult | { carry: boolean }> => {
      consecutiveFailures++;
      lastFailure = failure;
      if (consecutiveFailures > this.maxRetries) {
        rec.state = 'failed';
        rec.error = failure;
        return finish('failed', `Failed "${goal}" — ${failure} (${consecutiveFailures} consecutive failures).`);
      }
      emit(this.id, 'retry', { goal, reason: failure });
      let strategy: 'retry_same' | 'replan' | 'ask_user' = 'replan';
      if (this.deps.judge) {
        try {
          const r = await this.deps.judge.choice(
            `goal: ${goal}\nstep: ${describeStep(rec)}\nobservation: ${JSON.stringify({ window: obs.window, nodes: obs.tree.length })}\nfailure: ${failure}\nreplans left: ${this.maxRetries - consecutiveFailures}`,
            'recovery',
            ['retry_same', 'replan', 'ask_user'],
          );
          if (r.confidence >= 0.5 && (r.choice === 'retry_same' || r.choice === 'replan' || r.choice === 'ask_user')) {
            strategy = r.choice;
          }
        } catch {
          // Judge down — decide fresh as usual.
        }
      }
      if (strategy === 'ask_user') {
        emit(this.id, 'paused', {
          goal,
          index: rec.index,
          question: `Task hit trouble — ${failure}. Keep trying?`,
        });
        const approved = await this.waitApproval();
        if (!approved || this.cancelled) {
          return finish('cancelled', `Cancelled "${goal}" at step ${rec.index + 1} (not approved).`);
        }
        // Explicit user approval grants a fresh failure budget (maxSteps
        // still bounds the task, so this cannot spin forever).
        consecutiveFailures = 0;
        return { carry: false };
      }
      if (strategy === 'retry_same') {
        rec.state = 'pending';
        carried = { decision, rec };
        return { carry: true };
      }
      return { carry: false };
    };

    // Drain a judge-ordered retry. A helper (not inline narrowing) so the
    // carried decision survives control-flow analysis across loop iterations.
    const takeCarried = (): { decision: StepDecision; rec: StepRecord } | null => {
      const out = carried;
      carried = null;
      return out;
    };

    for (;;) {
      if (this.cancelled) {
        return finish('cancelled', `Cancelled "${goal}" after ${executed} step(s).`);
      }
      if (usedSteps >= this.maxSteps) {
        return finish('failed', `Step budget (${this.maxSteps}) exceeded on "${goal}" after ${executed} steps.`);
      }

      // 1. Decide — or reuse a judge-ordered retry of the same decision.
      let decision: StepDecision;
      let rec: StepRecord;
      const c = takeCarried();
      if (c) {
        decision = c.decision;
        rec = c.rec;
      } else {
        usedSteps++;
        try {
          decision = await this.deps.decide(goal, {
            obs,
            step: usedSteps,
            failure: lastFailure,
            history: historyLines().slice(-6),
          });
        } catch (err) {
          const terminal = await failSilent(
            `decide failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          if (terminal) return terminal;
          continue;
        }
        if (this.cancelled) {
          return finish('cancelled', `Cancelled "${goal}" after ${executed} step(s).`);
        }
        if (decision.done) {
          const doneCount = records.filter((r) => r.state === 'done').length;
          const extra = decision.summary ? ` ${decision.summary.slice(0, 200)}` : '';
          return finish('done', `Done "${goal}" — ${doneCount}/${records.length} steps verified.${extra}`);
        }
        // 2. Judge step-gate: a reject is failure feedback (the brain
        // proposes something safer next), never terminal by itself.
        const gated = await this.gateDecision(goal, decision, obs, consecutiveFailures);
        if (gated.ticket) gate.ticket = gated.ticket;
        if (gated.rejection) {
          const terminal = await failSilent(gated.rejection);
          if (terminal) return terminal;
          continue;
        }
        // 3. Resolve element target / shot coords → physical pixels.
        const resolved = resolveStepTarget(decision, obs);
        if ('error' in resolved) {
          const terminal = await failSilent(resolved.error);
          if (terminal) return terminal;
          continue;
        }
        rec = {
          index: records.length,
          state: 'pending',
          tool: decision.tool ?? 'computer',
          args: resolved.args,
          ...(resolved.target ? { target: resolved.target } : {}),
          ...(resolved.preview ? { preview: resolved.preview } : {}),
          ...(typeof decision.note === 'string' && decision.note ? { note: decision.note } : {}),
          ...(decision.expect ? { expect: decision.expect } : {}),
          ...(decision.needsConfirm === true ? { needsConfirm: true } : {}),
        };
        records.push(rec);
        emit(this.id, 'decided', {
          goal,
          index: rec.index,
          label: describeStep(rec),
          needsConfirm: rec.needsConfirm === true,
        });
      }

      rec.state = 'active';
      emit(this.id, 'step', {
        goal,
        index: rec.index,
        label: describeStep(rec),
        ...(rec.preview ? { target: rec.preview } : {}),
      });

      // 4. Checkpoint: approval pause (once per record — judge-ordered
      // retries don't re-ask). Every pause also raises `preview` with the
      // click target and the current screenshot so the overlay can show
      // exactly where the step will land BEFORE the user approves.
      const preApproved = this.autoConfirm || rec.approved === true;
      const raisePreview = (reason: 'confirm' | 'daemon-gate', question: string): void => {
        const detail: Record<string, unknown> = {
          goal,
          index: rec.index,
          label: describeStep(rec),
          question,
          reason,
          target: rec.preview ?? null,
          shot: obs.screenshot_b64
            ? {
                b64: obs.screenshot_b64,
                mime: obs.mime ?? 'image/png',
                width: obs.shot?.width ?? 0,
                height: obs.shot?.height ?? 0,
              }
            : null,
          screen: obs.screen ?? null,
        };
        emit(this.id, 'preview', detail);
      };
      if (rec.needsConfirm && !this.autoConfirm && !rec.approved) {
        const question = `Step ${rec.index + 1} needs your OK: ${describeStep(rec)}. Approve?`;
        emit(this.id, 'paused', { goal, index: rec.index, question });
        raisePreview('confirm', question);
        const approved = await this.waitApproval();
        if (!approved || this.cancelled) {
          emit(this.id, 'preview', { goal, index: rec.index, dismissed: true });
          return finish('cancelled', `Cancelled "${goal}" at step ${rec.index + 1} (not approved).`);
        }
        rec.approved = true;
        emit(this.id, 'preview', { goal, index: rec.index, dismissed: true });
      }

      // 5. Act — with a second chance through the daemon's own confirm
      // gate (one-time confirmation_id, redeemed only via deps.confirm
      // after user approval; pre-approved steps redeem without asking).
      if (executed >= this.maxSteps) {
        return finish('failed', `Step budget (${this.maxSteps}) exceeded on "${goal}" after ${executed} steps.`);
      }
      let res = await this.deps.execute(rec.tool, rec.args);
      executed++;
      if (!res.ok && res.error === 'confirmation_required') {
        const cid = res.confirmationId;
        if (!cid) {
          res = { ok: false, error: 'confirmation_required', detail: 'Daemon gated the step but issued no confirmation_id.' };
        } else {
          if (!preApproved) {
            const question = `Step ${rec.index + 1} was gated: ${res.detail || res.error}. Approve and retry?`;
            emit(this.id, 'paused', { goal, index: rec.index, question });
            raisePreview('daemon-gate', question);
            const approved = await this.waitApproval();
            if (!approved || this.cancelled) {
              emit(this.id, 'preview', { goal, index: rec.index, dismissed: true });
              return finish('cancelled', `Cancelled "${goal}" at step ${rec.index + 1} (not approved).`);
            }
            rec.approved = true;
            emit(this.id, 'preview', { goal, index: rec.index, dismissed: true });
          }
          if (!this.deps.confirm) {
            res = { ok: false, error: 'confirmation_required', detail: 'No UI/voice-confirm handler wired (deps.confirm missing).' };
          } else {
            const redemption = await this.deps.confirm(cid);
            if (!redemption.ok) {
              res = { ok: false, error: 'confirmation_required', detail: `Confirmation redemption failed: ${redemption.error ?? 'unknown'}.` };
            } else {
              if (executed >= this.maxSteps) {
                return finish('failed', `Step budget (${this.maxSteps}) exceeded on "${goal}" after ${executed} steps.`);
              }
              res = await this.deps.execute(rec.tool, { ...rec.args, confirmation_id: cid });
              executed++;
            }
          }
        }
      }
      if (!res.ok) {
        const failure = `step ${rec.index + 1} (${describeStep(rec)}) failed: ${res.detail || res.error}`;
        const out = await failExecuted(rec, decision, failure);
        if ('status' in out) return out;
        if (!out.carry) {
          rec.state = 'failed';
          rec.error = failure;
        }
        continue;
      }

      // 6. Settle + re-observe (fail closed when blind — never verify blind).
      if (this.settleMs > 0) await sleep(this.settleMs);
      let next: TaskObservation;
      try {
        next = await this.observeBlind();
      } catch (err) {
        rec.state = 'failed';
        rec.error = `blind after act: ${err instanceof Error ? err.message : String(err)}`;
        return finish('failed', `Failed "${goal}" — lost screen observation after step ${rec.index + 1}.`);
      }

      // 7. Repeat-state stop: the same screen again means no progress.
      // Only post-act observations are checked — decide/gate/resolve
      // failures never re-observe, so they can't false-trigger this.
      const fp = fingerprintObservation(next);
      const sightings = (seen.get(fp) ?? 0) + 1;
      seen.set(fp, sightings);
      if (sightings > this.repeatTolerance + 1) {
        rec.state = 'failed';
        rec.error = 'state repeated';
        return finish(
          'failed',
          `Stopped "${goal}" — same screen state ${sightings}× after step ${rec.index + 1} (no progress).`,
        );
      }
      obs = next;
      rec.observation = { window: obs.window, treeNodes: obs.tree.length, shot: !!obs.screenshot_b64 };

      // 8. Verify: heuristic first, judge second-opinion on a miss or
      // when the step declared no expectation.
      let verdict = verifyExpectation(rec.expect, obs);
      let judgeNote = '';
      if (this.deps.judge && (!verdict.pass || !rec.expect)) {
        try {
          const statement = rec.expect?.windowContains
            ? `After "${describeStep(rec)}": the foreground window contains "${rec.expect.windowContains}".`
            : rec.expect?.textVisible
              ? `After "${describeStep(rec)}": the text "${rec.expect.textVisible}" is visible on screen.`
              : `After "${describeStep(rec)}": the step achieved its intent.`;
          const j = await this.deps.judge.noul(
            `goal: ${goal}\nstep: ${describeStep(rec)}\nargs: ${JSON.stringify(rec.args)}\nobservation: ${JSON.stringify({ window: obs.window, tree: obs.tree.slice(0, 40).map((n) => n.name).filter(Boolean), nodes: obs.tree.length })}\nexpect: ${JSON.stringify(rec.expect ?? null)}`,
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
        const out = await failExecuted(rec, decision, failure);
        if ('status' in out) return out;
        if (!out.carry) {
          rec.state = 'failed';
          rec.error = failure;
        }
        continue;
      }

      rec.state = 'done';
      consecutiveFailures = 0;
      lastFailure = undefined;
    }
  }

  private async gateDecision(
    goal: string,
    decision: StepDecision,
    obs: TaskObservation,
    usedFailures: number,
  ): Promise<{ rejection: string | null; ticket?: { question: string; p: number } }> {
    if (!this.deps.judge) return { rejection: null };
    try {
      // 'replans left' is the key the judge parses; it means retries left now.
      const g = await this.deps.judge.score(
        `goal: ${goal}\nstep: ${describeStep({ note: decision.note, tool: decision.tool, args: decision.args ?? {} })}\nargs: ${JSON.stringify(decision.args ?? {})}\nobservation: ${JSON.stringify({ window: obs.window, nodes: obs.tree.length })}\nreplans left: ${this.maxRetries - usedFailures}`,
        'step_gate',
        ['unsafe or nonsense', 'risky or confused', 'acceptable', 'solid', 'excellent'],
      );
      if (g.score <= 2) {
        return {
          rejection: `safety gate rejected the step (score ${g.score}/5, confidence ${g.confidence.toFixed(2)})`,
          ticket: g.ticket,
        };
      }
      return { rejection: null, ticket: g.ticket };
    } catch {
      return { rejection: null };
    }
  }
}
