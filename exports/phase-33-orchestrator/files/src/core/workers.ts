/**
 * core/workers.ts — the five specialists (Phase 33).
 *
 * Operator (screen/mouse/keyboard), Researcher (web), Coder (headless coding
 * CLI via the `coder` tool), Memory-curator (durable facts), Critic (review).
 * Each worker has its own context (role prompt + task-scoped board messages)
 * and its own tool allowlist, enforced below — never advisory.
 *
 * Worker↔orchestrator communication is strict JSON only: either a tool
 * action or a final result. Anything else is a protocol violation.
 */
import { extractFirstJsonObject } from './task-decider.ts';
import type { TaskBoard } from './task-board.ts';
import type { Usage, WorkerId } from './task-board.ts';

export interface WorkerDef {
  id: WorkerId;
  title: string;
  role: string;
  /** Registry tool names this worker may invoke. Empty = chat/context only. */
  tools: string[];
}

/** One brain turn: reply text + what it cost (0 when unknown/local). */
export type ChatFn = (prompt: string) => Promise<{ text: string; costUsd: number }>;
export type InvokeFn = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

export interface WorkerRunDeps {
  chat: ChatFn;
  invoke: InvokeFn;
  clock?: () => number;
}

export interface WorkerOutcome {
  summary: string;
  data?: unknown;
  usage: Usage;
}

const PROTOCOL = `You communicate ONLY through strict JSON — exactly one object per reply, no prose outside it.
- To use a tool: {"action": {"tool": "<name>", "args": {...}}, "note": "<one line on why>"}.
- To finish: {"final": {"summary": "<result for the orchestrator>", "data": {<optional structured payload>}}}.`;

export const WORKERS: Record<WorkerId, WorkerDef> = {
  operator: {
    id: 'operator',
    title: 'Operator',
    tools: ['computer', 'observe', 'system_control'],
    role: `You are the Operator. You see the screen through "observe" and act through "computer" (mouse/keyboard) and "system_control" (apps/media). Verify every action by observing again before you claim anything changed. Never ask questions — if the goal is impossible from the current screen, finish with what you tried and what blocked you.`,
  },
  researcher: {
    id: 'researcher',
    title: 'Researcher',
    tools: ['web_search'],
    role: `You are the Researcher. You answer factual and web questions with "web_search". Run several focused queries, cross-check important claims, and cite the URLs you relied on in data.sources. Never browse the screen or touch the machine — that is the Operator's job.`,
  },
  coder: {
    id: 'coder',
    title: 'Coder',
    tools: ['coder'],
    role: `You are the Coder. You implement code changes by delegating to the "coder" tool, which runs a headless coding CLI inside an isolated git worktree, runs the test command, and returns a diff. Call it as {"repo": "<absolute repo path>", "task": "<precise change request>", "testCmd": "<how to verify, e.g. npm test>"} plus optional {"cli": "codex"|"claude"}. You never write code yourself and never claim done unless the tool reports testsPassed true — report the diff stat and the test result verbatim.`,
  },
  curator: {
    id: 'curator',
    title: 'Memory curator',
    tools: [],
    role: `You are the Memory curator. You turn outcomes (in INPUT) into durable memory ops. You have NO tools: emit final.data.ops, an array of {op, ...fields}. Ops: {"op":"set_name","name":...}, {"op":"add_person","name":...,"note":...}, {"op":"set_preference","key":...,"value":...}, {"op":"add_instruction","text":...}. Keep only durable facts about the user — never secrets, never trivia, never duplicates of what INPUT already lists as known.`,
  },
  critic: {
    id: 'critic',
    title: 'Critic',
    tools: [],
    role: `You are the Critic. You review worker results (in INPUT) against the goal and emit final.data = {"verdict": "pass"|"fail", "findings": ["..."]}. Be strict about correctness and evidence, lenient about style. A "fail" must name exactly what is missing or wrong so the work can be redone.`,
  },
};

export type ParsedWorkerOutput =
  | { kind: 'action'; tool: string; args: Record<string, unknown>; note: string }
  | { kind: 'final'; summary: string; data?: unknown }
  | { kind: 'error'; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Parse one worker reply. Strict JSON first, salvage second, error after. */
export function parseWorkerOutput(text: string): ParsedWorkerOutput {
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
  if (!isRecord(json)) return { kind: 'error', error: 'worker_not_json: reply was not a JSON object.' };
  if ('final' in json) {
    const f = json.final;
    if (!isRecord(f) || typeof f.summary !== 'string' || !f.summary.trim()) {
      return { kind: 'error', error: 'worker_bad_shape: final needs {summary}.' };
    }
    return { kind: 'final', summary: f.summary.trim(), ...(f.data !== undefined ? { data: f.data } : {}) };
  }
  if ('action' in json) {
    const a = json.action;
    if (!isRecord(a) || typeof a.tool !== 'string' || !a.tool.trim()) {
      return { kind: 'error', error: 'worker_bad_shape: action needs {tool, args}.' };
    }
    const args = a.args === undefined ? {} : a.args;
    if (!isRecord(args)) return { kind: 'error', error: 'worker_bad_shape: action.args must be an object.' };
    return {
      kind: 'action',
      tool: a.tool.trim(),
      args,
      note: typeof json.note === 'string' ? json.note.slice(0, 200) : '',
    };
  }
  return { kind: 'error', error: 'worker_bad_shape: reply needs "action" or "final".' };
}

function truncate(v: unknown, max = 160): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v) ?? String(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function transcriptSeed(board: TaskBoard, taskId: string): string[] {
  return board.messagesFor(taskId).map((m) => {
    if (m.type === 'assign') return `[assign] goal: ${String((m.payload.goal as string) ?? '')}`;
    if (m.type === 'progress') return `[step ${String(m.payload.step)}] ${String(m.payload.note ?? '')}`;
    return `[${m.type}] ${truncate(m.payload)}`;
  });
}

function buildPrompt(def: WorkerDef, goal: string, input: Record<string, unknown>, lines: string[], left: Usage): string {
  const tools = def.tools.length > 0 ? def.tools.join(', ') : 'none — answer from the provided context';
  return [
    def.role,
    '',
    PROTOCOL,
    `Allowed tools: ${tools}.`,
    '',
    `GOAL: ${goal}`,
    `INPUT: ${JSON.stringify(input)}`,
    `BUDGET LEFT: ${left.steps} steps · ${Math.max(0, Math.round(left.ms))}ms · $${left.costUsd.toFixed(4)}`,
    'TRANSCRIPT (newest last):',
    ...(lines.length > 0 ? lines.slice(-12) : ['(none yet)']),
    '',
    'Reply with ONE JSON object now.',
  ].join('\n');
}

/**
 * Run one board task to completion with its owner's worker loop.
 * Marks the board (done/failed), posts progress/result/budget messages, and
 * enforces the task budget (steps, wall time, cost) plus the tool allowlist.
 * Cooperative cancellation: a `cancelled` task aborts at the next step.
 */
export async function runWorkerTask(
  board: TaskBoard,
  taskId: string,
  deps: WorkerRunDeps,
): Promise<WorkerOutcome> {
  const clock = deps.clock ?? (() => Date.now());
  const task = board.getTask(taskId);
  const def = WORKERS[task.owner as WorkerId];
  if (!def) throw new Error(`worker_no_def: no worker definition for owner "${task.owner}".`);
  board.setStatus(taskId, 'running');

  const t0 = clock();
  let lastTick = t0;
  const usage: Usage = { steps: 0, ms: 0, costUsd: 0 };
  const transcript = transcriptSeed(board, taskId);
  let parseErrors = 0;

  const tick = (): void => {
    const now = clock();
    board.addUsage(taskId, { ms: Math.max(0, now - lastTick) });
    usage.ms = Math.max(0, now - t0);
    lastTick = now;
  };

  const exhaust = (which: 'steps' | 'time' | 'cost'): Error => {
    tick();
    board.post({
      taskId,
      from: task.owner,
      to: 'orchestrator',
      type: 'budget',
      payload: { usage: { ...usage }, exhausted: which },
    });
    const error = `budget_exhausted_${which}: ${task.owner} ran out of ${which} on "${task.goal.slice(0, 80)}".`;
    board.setStatus(taskId, 'failed', { error });
    return new Error(error);
  };

  const fail = (error: string): Error => {
    tick();
    board.setStatus(taskId, 'failed', { error });
    return new Error(error);
  };

  for (;;) {
    if (board.getTask(taskId).status === 'cancelled') throw new Error('worker_cancelled: task was cancelled.');
    if (usage.steps >= task.budget.maxSteps) throw exhaust('steps');
    if (clock() - t0 >= task.budget.maxMs) throw exhaust('time');
    if (usage.costUsd >= task.budget.maxCostUsd) throw exhaust('cost');

    const left: Usage = {
      steps: task.budget.maxSteps - usage.steps,
      ms: task.budget.maxMs - (clock() - t0),
      costUsd: task.budget.maxCostUsd - usage.costUsd,
    };
    let reply: { text: string; costUsd: number };
    try {
      reply = await deps.chat(buildPrompt(def, task.goal, task.input, transcript, left));
    } catch (err) {
      throw fail(`worker_chat_failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    tick();
    usage.steps += 1;
    usage.costUsd += Math.max(0, reply.costUsd || 0);
    board.addUsage(taskId, { steps: 1, costUsd: Math.max(0, reply.costUsd || 0) });

    const parsed = parseWorkerOutput(reply.text);
    if (parsed.kind === 'error') {
      parseErrors += 1;
      transcript.push(`[protocol] ${parsed.error}`);
      board.post({
        taskId,
        from: task.owner,
        to: 'orchestrator',
        type: 'progress',
        payload: { note: `unparseable reply (${parsed.error})`, step: usage.steps },
      });
      if (parseErrors >= 2) throw fail(`worker_bad_output: ${parsed.error}`);
      continue;
    }
    parseErrors = 0;

    if (parsed.kind === 'final') {
      board.post({
        taskId,
        from: task.owner,
        to: 'orchestrator',
        type: 'result',
        payload: { summary: parsed.summary, ...(parsed.data !== undefined ? { data: parsed.data } : {}), usage: { ...usage } },
      });
      board.setStatus(taskId, 'done', {
        result: { summary: parsed.summary, ...(parsed.data !== undefined ? { data: parsed.data } : {}) },
      });
      return { summary: parsed.summary, ...(parsed.data !== undefined ? { data: parsed.data } : {}), usage: { ...usage } };
    }

    if (!def.tools.includes(parsed.tool)) {
      const note = `denied: "${parsed.tool}" is outside your allowlist (${def.tools.join(', ') || 'no tools'}).`;
      transcript.push(`[allowlist] ${note}`);
      board.post({
        taskId,
        from: task.owner,
        to: 'orchestrator',
        type: 'progress',
        payload: { note, step: usage.steps },
      });
      continue;
    }
    let outcome: unknown;
    try {
      outcome = await deps.invoke(parsed.tool, parsed.args);
    } catch (err) {
      outcome = { error: err instanceof Error ? err.message : String(err) };
    }
    tick();
    const line = `${parsed.tool} → ${truncate(outcome)}`;
    transcript.push(parsed.note ? `[step ${usage.steps}] ${parsed.note} — ${line}` : `[step ${usage.steps}] ${line}`);
    board.post({
      taskId,
      from: task.owner,
      to: 'orchestrator',
      type: 'progress',
      payload: { note: line.slice(0, 300), step: usage.steps },
    });
  }
}
