/**
 * core/orchestrator.ts — goal splitter, parallel scheduler, merger (Phase 33).
 *
 * The orchestrator never touches tools itself: it plans a goal into typed
 * board tasks, runs dependency-ready tasks in parallel, merges the results,
 * and enforces the global budget (steps, wall time, cost). All coordination
 * flows through the task board's structured messages.
 */
import { extractFirstJsonObject } from './task-decider.ts';
import {
  DEFAULT_BUDGET,
  TaskBoard,
  type AgentTask,
  type Budget,
  type TaskKind,
  type Usage,
} from './task-board.ts';
import { runWorkerTask, type ChatFn, type InvokeFn, type WorkerOutcome } from './workers.ts';

export type MergeMode = 'concat' | 'critic';

export interface PlanSubtask {
  kind: Exclude<TaskKind, 'run'>;
  goal: string;
  input?: Record<string, unknown>;
  dependsOn?: number[];
}

export interface RunGoalOpts {
  budget?: Partial<Budget>;
  maxParallel?: number;
  merge?: MergeMode;
}

export interface GoalResult {
  summary: string;
  taskIds: string[];
  usage: Usage;
  mergedFrom: string[];
  partial: boolean;
  notes: string[];
  /** Phase 36: memory ops the curation sink applied (feeds task analytics). */
  curationApplied: number;
}

export interface CuratorOp {
  op: 'set_name' | 'add_person' | 'set_preference' | 'add_instruction';
  [key: string]: unknown;
}

export type CurationSink = (ops: CuratorOp[]) => Promise<{ applied: number; skipped: number }>;

export interface OrchestratorDeps {
  chat: ChatFn;
  invoke: InvokeFn;
  board?: TaskBoard;
  runWorker?: (board: TaskBoard, taskId: string, deps: { chat: ChatFn; invoke: InvokeFn; clock?: () => number }) => Promise<WorkerOutcome>;
  applyCuration?: CurationSink;
  clock?: () => number;
}

const PLANNER_PROMPT = `You are the Sofia orchestrator. Split the GOAL into 1-8 independent-where-possible subtasks for specialist workers. Reply with ONE JSON object, no prose:
{"subtasks": [{"kind": "operate"|"research"|"code"|"curate"|"critique", "goal": "<concrete>", "input": {<optional>}, "dependsOn": [<optional 0-based indices>]}], "merge": "concat"|"critic"}
- operate: screen/mouse/keyboard work. research: web facts. code: repo changes (input should name the repo path when known). curate: durable memory updates. critique: review other results (rarely planned — the merge step covers it).
- dependsOn only when a subtask truly needs another's result; keep the graph shallow.`;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const PLAN_KINDS: ReadonlySet<string> = new Set(['operate', 'research', 'code', 'curate', 'critique']);

/** Parse + validate a planner reply. Returns the plan or a `plan_*` error. */
export function parsePlan(text: string): { plan: { subtasks: PlanSubtask[]; merge: MergeMode } } | { error: string } {
  let json: unknown = null;
  try {
    json = JSON.parse(text.trim());
  } catch {
    const salvaged = extractFirstJsonObject(text);
    if (salvaged !== null) {
      try {
        json = JSON.parse(salvaged);
      } catch {
        json = null;
      }
    }
  }
  if (!isRecord(json)) return { error: 'plan_not_json: the planner did not return a JSON object.' };
  const raw = json.subtasks;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 8) {
    return { error: 'plan_bad_shape: subtasks must be an array of 1–8 items.' };
  }
  const subtasks: PlanSubtask[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    if (!isRecord(s)) return { error: `plan_bad_shape: subtask ${i} is not an object.` };
    if (typeof s.kind !== 'string' || !PLAN_KINDS.has(s.kind)) {
      return { error: `plan_bad_kind: subtask ${i} has unknown kind "${String(s.kind)}".` };
    }
    if (typeof s.goal !== 'string' || !s.goal.trim() || s.goal.length > 2000) {
      return { error: `plan_bad_shape: subtask ${i} needs a goal of 1–2000 chars.` };
    }
    let dependsOn: number[] | undefined;
    if (s.dependsOn !== undefined) {
      if (!Array.isArray(s.dependsOn)) return { error: `plan_bad_deps: subtask ${i} dependsOn must be an array.` };
      dependsOn = [];
      for (const d of s.dependsOn) {
        if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d >= raw.length || d === i) {
          return { error: `plan_bad_deps: subtask ${i} has an invalid dependency "${String(d)}".` };
        }
        dependsOn.push(d);
      }
    }
    subtasks.push({
      kind: s.kind as PlanSubtask['kind'],
      goal: s.goal.trim(),
      ...(isRecord(s.input) ? { input: s.input } : {}),
      ...(dependsOn && dependsOn.length > 0 ? { dependsOn } : {}),
    });
  }
  // Acyclic check (Kahn).
  const indeg = subtasks.map(() => 0);
  subtasks.forEach((s) => (s.dependsOn ?? []).forEach(() => { indeg[subtasks.indexOf(s)] += 1; }));
  const queue: number[] = [];
  indeg.forEach((d, i) => {
    if (d === 0) queue.push(i);
  });
  let visited = 0;
  while (queue.length > 0) {
    const n = queue.pop() as number;
    visited += 1;
    subtasks.forEach((s, i) => {
      if ((s.dependsOn ?? []).includes(n)) {
        indeg[i] -= 1;
        if (indeg[i] === 0) queue.push(i);
      }
    });
  }
  if (visited !== subtasks.length) return { error: 'plan_bad_deps: subtask dependencies contain a cycle.' };
  const merge = json.merge === 'critic' ? 'critic' : 'concat';
  return { plan: { subtasks, merge } };
}

/** Split a global budget across n tasks (each keeps a workable minimum). */
export function splitBudget(budget: Budget, n: number): Budget {
  const count = Math.max(1, n);
  return {
    maxSteps: Math.max(2, Math.floor(budget.maxSteps / count)),
    maxMs: Math.max(1000, Math.floor(budget.maxMs / count)),
    maxCostUsd: Math.max(0, budget.maxCostUsd / count),
  };
}

function sumUsage(tasks: AgentTask[]): Usage {
  return tasks.reduce<Usage>(
    (acc, t) => ({ steps: acc.steps + t.usage.steps, ms: acc.ms + t.usage.ms, costUsd: acc.costUsd + t.usage.costUsd }),
    { steps: 0, ms: 0, costUsd: 0 },
  );
}

function exhaustedBy(usage: Usage, budget: Budget): 'steps' | 'time' | 'cost' | null {
  if (usage.steps >= budget.maxSteps) return 'steps';
  if (usage.ms >= budget.maxMs) return 'time';
  if (usage.costUsd >= budget.maxCostUsd) return 'cost';
  return null;
}

/**
 * Plan a goal, run the waves in parallel, merge the results. Throws on
 * planning failure or when nothing completes; otherwise returns the merged
 * result with full usage accounting.
 */
export async function runGoal(goal: string, deps: OrchestratorDeps, opts: RunGoalOpts = {}): Promise<GoalResult> {
  const clock = deps.clock ?? (() => Date.now());
  const runWorker = deps.runWorker ?? runWorkerTask;
  const board = deps.board ?? new TaskBoard(clock);
  const budget: Budget = {
    maxSteps: opts.budget?.maxSteps ?? DEFAULT_BUDGET.maxSteps,
    maxMs: opts.budget?.maxMs ?? DEFAULT_BUDGET.maxMs,
    maxCostUsd: opts.budget?.maxCostUsd ?? DEFAULT_BUDGET.maxCostUsd,
  };
  const maxParallel = Math.max(1, Math.min(5, opts.maxParallel ?? 3));
  const notes: string[] = [];
  const t0 = clock();
  let plannerSteps = 0;
  let plannerCost = 0;

  const root = board.createTask({ goal, kind: 'run' });
  board.setStatus(root.id, 'running');

  // ── plan (one retry with the validation error fed back) ──
  let plan: { subtasks: PlanSubtask[]; merge: MergeMode } | null = null;
  let planErr = '';
  for (let attempt = 0; attempt < 2 && !plan; attempt++) {
    const prompt =
      attempt === 0
        ? `${PLANNER_PROMPT}\n\nGOAL: ${goal}`
        : `${PLANNER_PROMPT}\n\nGOAL: ${goal}\n\nYour previous reply was rejected (${planErr}). Reply with ONE valid plan object now.`;
    let reply: { text: string; costUsd: number };
    try {
      reply = await deps.chat(prompt);
    } catch (err) {
      const error = `plan_chat_failed: ${err instanceof Error ? err.message : String(err)}`;
      board.setStatus(root.id, 'failed', { error });
      throw new Error(error);
    }
    plannerSteps += 1;
    plannerCost += Math.max(0, reply.costUsd || 0);
    const parsed = parsePlan(reply.text);
    if ('plan' in parsed) plan = parsed.plan;
    else planErr = parsed.error;
  }
  if (!plan) {
    board.setStatus(root.id, 'failed', { error: planErr });
    throw new Error(planErr);
  }

  // ── spawn ──
  const perTask = splitBudget(budget, plan.subtasks.length);
  const tasks = plan.subtasks.map((s) =>
    board.createTask({ goal: s.goal, kind: s.kind, parentId: root.id, input: s.input ?? {}, budget: { ...perTask } }),
  );
  // Index deps → id deps (validated acyclic by parsePlan; patch via re-resolve).
  const withDeps = tasks.map((t, i) => {
    const ids = (plan as { subtasks: PlanSubtask[] }).subtasks[i].dependsOn ?? [];
    t.dependsOn.push(...ids.map((n) => tasks[n].id));
    return t;
  });
  for (const t of withDeps) {
    board.post({
      taskId: t.id,
      from: 'orchestrator',
      to: t.owner,
      type: 'assign',
      payload: { taskId: t.id, goal: t.goal, kind: t.kind, budget: { ...t.budget } },
    });
  }

  const workerDeps = { chat: deps.chat, invoke: deps.invoke, clock };
  const taskIds = withDeps.map((t) => t.id);

  // ── waves ──
  for (;;) {
    const usage = sumUsage(withDeps);
    usage.steps += plannerSteps;
    usage.ms = Math.max(usage.ms, clock() - t0);
    usage.costUsd += plannerCost;
    const out = exhaustedBy(usage, budget);
    if (out) {
      notes.push(`global budget exhausted (${out}); pending tasks cancelled.`);
      for (const t of withDeps) {
        if (t.status === 'queued' || t.status === 'running' || t.status === 'waiting') {
          board.post({
            taskId: t.id,
            from: 'orchestrator',
            to: t.owner,
            type: 'cancel',
            payload: { reason: `global budget exhausted (${out})` },
          });
          board.setStatus(t.id, 'cancelled');
        }
      }
      break;
    }
    const ready = withDeps.filter(
      (t) => t.status === 'queued' && t.dependsOn.every((d) => board.getTask(d).status === 'done'),
    );
    if (ready.length === 0) {
      const stuck = withDeps.filter((t) => t.status === 'queued');
      for (const t of stuck) {
        const blockers = t.dependsOn
          .map((d) => board.getTask(d))
          .filter((d) => d.status !== 'done')
          .map((d) => `${d.id} (${d.status})`);
        board.post({
          taskId: t.id,
          from: 'orchestrator',
          to: t.owner,
          type: 'cancel',
          payload: { reason: `blocked upstream: ${blockers.join(', ') || 'unknown'}` },
        });
        board.setStatus(t.id, 'failed', { error: `blocked_upstream: ${blockers.join(', ') || 'unknown'}` });
      }
      break;
    }
    const wave = ready.slice(0, maxParallel);
    await Promise.allSettled(wave.map((t) => runWorker(board, t.id, workerDeps)));
  }

  // ── curate: apply memory ops through the sink ──
  let curationApplied = 0;
  if (deps.applyCuration) {
    for (const t of withDeps.filter((t) => t.kind === 'curate' && t.status === 'done')) {
      const data = t.result?.data as { ops?: unknown } | undefined;
      const ops = Array.isArray(data?.ops) ? (data?.ops as CuratorOp[]) : [];
      if (ops.length === 0) {
        notes.push(`${t.id}: curator returned no ops.`);
        continue;
      }
      try {
        const r = await deps.applyCuration(ops);
        curationApplied += Math.max(0, r.applied || 0);
        notes.push(`${t.id}: curation applied ${r.applied}, skipped ${r.skipped}.`);
      } catch (err) {
        notes.push(`${t.id}: curation sink failed (${err instanceof Error ? err.message : String(err)}).`);
      }
    }
  }

  // ── merge ──
  const done = withDeps.filter((t) => t.status === 'done');
  const mergeMode = opts.merge ?? plan.merge;
  let summary: string;
  if (done.length === 0) {
    const error = 'merge_empty: no subtask completed; nothing to merge.';
    board.setStatus(root.id, 'failed', { error });
    throw new Error(error);
  }
  if (mergeMode === 'critic' && done.length > 0) {
    const review = board.createTask({
      goal: `Review ${done.length} result(s) against the goal.`,
      kind: 'critique',
      parentId: root.id,
      input: {
        goal,
        results: done.map((t) => ({ taskId: t.id, kind: t.kind, summary: t.result?.summary ?? '', data: t.result?.data ?? null })),
      },
      budget: { ...perTask },
    });
    taskIds.push(review.id);
    board.post({
      taskId: review.id,
      from: 'orchestrator',
      to: 'critic',
      type: 'assign',
      payload: { taskId: review.id, goal: review.goal, kind: review.kind, budget: { ...review.budget } },
    });
    try {
      const outcome = await runWorker(board, review.id, workerDeps);
      summary = outcome.summary;
      notes.push(`${review.id}: critic verdict merged.`);
    } catch (err) {
      summary = done.map((t) => `### ${t.id} (${t.kind})\n${t.result?.summary ?? ''}`).join('\n\n');
      notes.push(`${review.id}: critic failed (${err instanceof Error ? err.message : String(err)}); concatenated instead.`);
    }
  } else {
    summary = done.map((t) => `### ${t.id} (${t.kind})\n${t.result?.summary ?? ''}`).join('\n\n');
  }

  const usage = sumUsage([...withDeps, ...board.listTasks({ parentId: root.id }).filter((t) => !taskIds.includes(t.id))]);
  usage.steps += plannerSteps;
  usage.ms = Math.max(usage.ms, clock() - t0);
  usage.costUsd += plannerCost;
  const failed = withDeps.filter((t) => t.status === 'failed' || t.status === 'cancelled');
  const partial = failed.length > 0;
  if (partial) notes.push(`partial: ${failed.map((t) => `${t.id} (${t.status})`).join(', ')}`);

  board.setStatus(root.id, 'done', { result: { summary } });
  board.post({
    taskId: root.id,
    from: 'orchestrator',
    to: 'orchestrator',
    type: 'result',
    payload: { summary, usage: { ...usage } },
  });
  return { summary, taskIds, usage, mergedFrom: done.map((t) => t.id), partial, notes, curationApplied };
}
