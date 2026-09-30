/**
 * core/task-board.ts — typed task board + structured messages (Phase 33).
 *
 * The ONLY communication channel between the orchestrator and the workers:
 * no free chat. Every message carries a payload validated for its type, and
 * every worker only ever sees the messages scoped to its own task.
 */

export type WorkerId = 'operator' | 'researcher' | 'coder' | 'curator' | 'critic';
export type Owner = WorkerId | 'orchestrator';
/** `run` is the orchestrator's own root task; the rest map 1:1 to workers. */
export type TaskKind = 'run' | 'operate' | 'research' | 'code' | 'curate' | 'critique';

export const KIND_OWNER: Record<TaskKind, Owner> = {
  run: 'orchestrator',
  operate: 'operator',
  research: 'researcher',
  code: 'coder',
  curate: 'curator',
  critique: 'critic',
};

export type TaskStatus = 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'cancelled';

export interface Budget {
  maxSteps: number;
  maxMs: number;
  maxCostUsd: number;
}

export interface Usage {
  steps: number;
  ms: number;
  costUsd: number;
}

export const DEFAULT_BUDGET: Budget = { maxSteps: 24, maxMs: 10 * 60_000, maxCostUsd: 1 };

export interface TaskResultPayload {
  summary: string;
  data?: unknown;
}

export interface AgentTask {
  id: string;
  goal: string;
  kind: TaskKind;
  owner: Owner;
  status: TaskStatus;
  parentId: string | null;
  dependsOn: string[];
  input: Record<string, unknown>;
  result?: TaskResultPayload;
  error?: string;
  budget: Budget;
  usage: Usage;
  createdAt: number;
  updatedAt: number;
}

export type MessageType = 'assign' | 'progress' | 'result' | 'need_input' | 'budget' | 'cancel';

export interface BoardMessage {
  id: string;
  taskId: string;
  from: Owner;
  to: Owner;
  type: MessageType;
  payload: Record<string, unknown>;
  ts: number;
}

export type NewMessage = Omit<BoardMessage, 'id' | 'ts'>;

const OWNERS: ReadonlySet<string> = new Set(['operator', 'researcher', 'coder', 'curator', 'critic', 'orchestrator']);
const KINDS: ReadonlySet<string> = new Set(['run', 'operate', 'research', 'code', 'curate', 'critique']);
const STATUSES: ReadonlySet<string> = new Set(['queued', 'running', 'waiting', 'done', 'failed', 'cancelled']);
const TYPES: ReadonlySet<string> = new Set(['assign', 'progress', 'result', 'need_input', 'budget', 'cancel']);

/** Legal status transitions. Terminal states (done/failed/cancelled) never move. */
const TRANSITIONS: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
  queued: new Set(['running', 'failed', 'cancelled']),
  running: new Set(['waiting', 'done', 'failed', 'cancelled']),
  waiting: new Set(['running', 'failed', 'cancelled']),
  done: new Set([]),
  failed: new Set([]),
  cancelled: new Set([]),
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validUsage(u: unknown): u is Usage {
  if (!isRecord(u)) return false;
  return (
    typeof u.steps === 'number' && u.steps >= 0 &&
    typeof u.ms === 'number' && u.ms >= 0 &&
    typeof u.costUsd === 'number' && u.costUsd >= 0
  );
}

function validBudget(b: unknown): b is Budget {
  if (!isRecord(b)) return false;
  return (
    typeof b.maxSteps === 'number' && b.maxSteps >= 1 &&
    typeof b.maxMs === 'number' && b.maxMs >= 1 &&
    typeof b.maxCostUsd === 'number' && b.maxCostUsd >= 0
  );
}

/**
 * Validate a message payload for its type. Returns null when valid, else a
 * `board_bad_*` reason. Unknown types are rejected — no free chat.
 */
export function validatePayload(type: string, payload: unknown): string | null {
  if (!TYPES.has(type)) return `board_bad_type: unknown message type "${type}".`;
  if (!isRecord(payload)) return `board_bad_payload: ${type} needs an object payload.`;
  switch (type) {
    case 'assign':
      if (typeof payload.taskId !== 'string' || !payload.taskId) return 'board_bad_payload: assign needs taskId.';
      if (typeof payload.goal !== 'string' || !payload.goal.trim()) return 'board_bad_payload: assign needs a goal.';
      if (typeof payload.kind !== 'string' || !KINDS.has(payload.kind)) {
        return 'board_bad_payload: assign needs a known kind.';
      }
      if (!validBudget(payload.budget)) return 'board_bad_payload: assign needs a valid budget.';
      return null;
    case 'progress':
      if (typeof payload.note !== 'string' || !payload.note.trim()) return 'board_bad_payload: progress needs a note.';
      if (typeof payload.step !== 'number' || payload.step < 0) return 'board_bad_payload: progress needs step >= 0.';
      return null;
    case 'result':
      if (typeof payload.summary !== 'string' || !payload.summary.trim()) {
        return 'board_bad_payload: result needs a summary.';
      }
      if (!validUsage(payload.usage)) return 'board_bad_payload: result needs a valid usage.';
      return null;
    case 'need_input':
      if (typeof payload.question !== 'string' || !payload.question.trim()) {
        return 'board_bad_payload: need_input needs a question.';
      }
      return null;
    case 'budget':
      if (!validUsage(payload.usage)) return 'board_bad_payload: budget needs a valid usage.';
      if (payload.exhausted !== 'steps' && payload.exhausted !== 'time' && payload.exhausted !== 'cost') {
        return 'board_bad_payload: budget needs exhausted ∈ steps|time|cost.';
      }
      return null;
    case 'cancel':
      if (typeof payload.reason !== 'string' || !payload.reason.trim()) {
        return 'board_bad_payload: cancel needs a reason.';
      }
      return null;
    default:
      return `board_bad_type: unknown message type "${type}".`;
  }
}

export interface CreateTaskSpec {
  goal: string;
  kind: TaskKind;
  parentId?: string;
  dependsOn?: string[];
  input?: Record<string, unknown>;
  budget?: Partial<Budget>;
}

export class TaskBoard extends EventTarget {
  private readonly tasks = new Map<string, AgentTask>();
  private readonly messages: BoardMessage[] = [];
  private seq = 0;
  private readonly clock: () => number;

  constructor(clock: () => number = () => Date.now()) {
    super();
    this.clock = clock;
  }

  /** Create a task. Dependencies must already exist (DAG by construction). */
  createTask(spec: CreateTaskSpec): AgentTask {
    const goal = spec.goal?.trim() ?? '';
    if (!goal) throw new Error('board_bad_task: goal must be a non-empty string.');
    if (!KINDS.has(spec.kind)) throw new Error(`board_bad_task: unknown kind "${String(spec.kind)}".`);
    const parentId = spec.parentId ?? null;
    if (parentId !== null && !this.tasks.has(parentId)) {
      throw new Error(`board_bad_task: unknown parent "${parentId}".`);
    }
    const dependsOn = [...new Set(spec.dependsOn ?? [])];
    for (const d of dependsOn) {
      if (!this.tasks.has(d)) throw new Error(`board_bad_task: unknown dependency "${d}".`);
    }
    const id = `t-${++this.seq}`;
    if (dependsOn.includes(id)) throw new Error('board_bad_task: a task cannot depend on itself.');
    const budget: Budget = {
      maxSteps: spec.budget?.maxSteps ?? DEFAULT_BUDGET.maxSteps,
      maxMs: spec.budget?.maxMs ?? DEFAULT_BUDGET.maxMs,
      maxCostUsd: spec.budget?.maxCostUsd ?? DEFAULT_BUDGET.maxCostUsd,
    };
    if (!validBudget(budget)) throw new Error('board_bad_task: budget must hold maxSteps>=1, maxMs>=1, maxCostUsd>=0.');
    const now = this.clock();
    const task: AgentTask = {
      id,
      goal,
      kind: spec.kind,
      owner: KIND_OWNER[spec.kind],
      status: 'queued',
      parentId,
      dependsOn,
      input: spec.input ?? {},
      budget,
      usage: { steps: 0, ms: 0, costUsd: 0 },
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(id, task);
    this.dispatchEvent(new CustomEvent('task', { detail: { id } }));
    this.dispatchEvent(new CustomEvent('change'));
    return task;
  }

  getTask(id: string): AgentTask {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`board_no_task: unknown task "${id}".`);
    return t;
  }

  listTasks(filter: { status?: TaskStatus; owner?: Owner; parentId?: string | null } = {}): AgentTask[] {
    return [...this.tasks.values()].filter(
      (t) =>
        (filter.status === undefined || t.status === filter.status) &&
        (filter.owner === undefined || t.owner === filter.owner) &&
        (filter.parentId === undefined || t.parentId === filter.parentId),
    );
  }

  /** Queued tasks whose dependencies are all done — the schedulable wave. */
  readyTasks(): AgentTask[] {
    return this.listTasks({ status: 'queued' }).filter((t) =>
      t.dependsOn.every((d) => this.tasks.get(d)?.status === 'done'),
    );
  }

  setStatus(id: string, status: TaskStatus, extra: { error?: string; result?: TaskResultPayload } = {}): AgentTask {
    if (!STATUSES.has(status)) throw new Error(`board_bad_status: unknown status "${String(status)}".`);
    const t = this.getTask(id);
    if (!TRANSITIONS[t.status].has(status)) {
      throw new Error(`board_bad_transition: ${t.status} → ${status} is not allowed.`);
    }
    t.status = status;
    if (extra.error !== undefined) t.error = extra.error;
    if (extra.result !== undefined) t.result = extra.result;
    t.updatedAt = this.clock();
    this.dispatchEvent(new CustomEvent('task', { detail: { id } }));
    this.dispatchEvent(new CustomEvent('change'));
    return t;
  }

  addUsage(id: string, delta: Partial<Usage>): Usage {
    const t = this.getTask(id);
    t.usage.steps += Math.max(0, delta.steps ?? 0);
    t.usage.ms += Math.max(0, delta.ms ?? 0);
    t.usage.costUsd += Math.max(0, delta.costUsd ?? 0);
    t.updatedAt = this.clock();
    return t.usage;
  }

  /** Post a structured message. Anything unshaped is rejected — no free chat. */
  post(msg: NewMessage): BoardMessage {
    if (!this.tasks.has(msg.taskId)) throw new Error(`board_no_task: unknown task "${msg.taskId}".`);
    if (!OWNERS.has(msg.from)) throw new Error(`board_bad_from: unknown sender "${String(msg.from)}".`);
    if (!OWNERS.has(msg.to)) throw new Error(`board_bad_to: unknown recipient "${String(msg.to)}".`);
    const bad = validatePayload(msg.type, msg.payload);
    if (bad) throw new Error(bad);
    const full: BoardMessage = { ...msg, id: `m-${++this.seq}`, ts: this.clock() };
    this.messages.push(full);
    this.dispatchEvent(new CustomEvent('message', { detail: { id: full.id, taskId: full.taskId } }));
    this.dispatchEvent(new CustomEvent('change'));
    return full;
  }

  /** Everything scoped to one task — a worker's entire visible world. */
  messagesFor(taskId: string, type?: MessageType): BoardMessage[] {
    return this.messages.filter((m) => m.taskId === taskId && (type === undefined || m.type === type));
  }
}
