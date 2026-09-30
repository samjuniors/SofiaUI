/**
 * tools/orchestrate-tool.ts — the `orchestrate` registry tool (Phase 33).
 *
 * Runs a multi-specialist goal through the orchestrator: plan → parallel
 * worker waves on the typed task board → merged result. A factory keeps the
 * production wiring (server brain, tool registry, memory store) injectable
 * for tests.
 */
import { runGoal, type CurationSink, type MergeMode } from '../core/orchestrator.ts';
import type { ChatFn, InvokeFn } from '../core/workers.ts';
import { sophiaFetch } from '../lib/sophia-fetch.ts';
import { memoryStore } from '../core/MemoryStore.ts';
import type { GeminiFunctionDeclaration, ITool } from './types';

export interface OrchestrateToolDeps {
  chat?: ChatFn;
  invoke?: InvokeFn;
  applyCuration?: CurationSink;
}

async function serverChat(prompt: string): Promise<{ text: string; costUsd: number }> {
  const res = await sophiaFetch('/api/sophia/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lastUser: prompt, history: [], brainMode: 'auto' }),
  });
  const j = (await res.json().catch(() => null)) as { text?: unknown; error?: unknown } | null;
  const text = typeof j?.text === 'string' ? j.text : '';
  if (!text.trim()) throw new Error(typeof j?.error === 'string' && j.error ? j.error : 'brain returned no reply');
  return { text, costUsd: 0 };
}

const CURATOR_OPS = new Set(['set_name', 'add_person', 'set_preference', 'add_instruction']);

/** Default curation sink: validated ops land in the memory store. */
export const memoryCurationSink: CurationSink = async (ops) => {
  let applied = 0;
  let skipped = 0;
  for (const o of ops) {
    try {
      if (!o || typeof o !== 'object' || !CURATOR_OPS.has(String((o as { op?: unknown }).op))) {
        skipped += 1;
        continue;
      }
      const op = (o as { op: string }).op;
      const f = o as Record<string, unknown>;
      if (op === 'set_name' && typeof f.name === 'string' && f.name.trim()) {
        memoryStore.setUserName(f.name.trim().slice(0, 120));
      } else if (op === 'add_person' && typeof f.name === 'string' && f.name.trim()) {
        memoryStore.upsertPerson({
          name: f.name.trim().slice(0, 120),
          ...(typeof f.note === 'string' && f.note.trim() ? { notes: f.note.trim().slice(0, 500) } : {}),
        });
      } else if (op === 'set_preference' && typeof f.key === 'string' && f.key.trim() && typeof f.value === 'string') {
        memoryStore.setPreference(f.key.trim().slice(0, 120), f.value.trim().slice(0, 500));
      } else if (op === 'add_instruction' && typeof f.text === 'string' && f.text.trim()) {
        memoryStore.addInstruction(f.text.trim().slice(0, 500));
      } else {
        skipped += 1;
        continue;
      }
      applied += 1;
    } catch {
      skipped += 1;
    }
  }
  return { applied, skipped };
};

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.max(min, Math.min(max, n));
}

export function createOrchestrateTool(deps: OrchestrateToolDeps = {}): ITool {
  return {
    name: 'orchestrate',
    description:
      'Run a goal through the specialist team (Operator, Researcher, Coder, Memory-curator, Critic): ' +
      'the orchestrator splits it, runs independent subtasks in parallel on a typed task board, ' +
      'and merges the results under step/time/cost budgets.',
    invoke: async (args) => {
      const goal = typeof args.goal === 'string' ? args.goal.trim() : '';
      if (!goal) {
        return { success: false, error: 'missing_goal', errorDetail: 'orchestrate requires a goal string.' };
      }
      const chat = deps.chat ?? serverChat;
      // Dynamic import — registry.ts registers this tool (static import would cycle).
      const invoke =
        deps.invoke ??
        (async (tool: string, a: Record<string, unknown>) =>
          (await import('./registry.ts')).toolRegistry.invoke({ name: tool, args: a }));
      const merge: MergeMode = args.merge === 'critic' ? 'critic' : 'concat';
      try {
        const r = await runGoal(
          goal,
          { chat, invoke, applyCuration: deps.applyCuration ?? memoryCurationSink },
          {
            budget: {
              maxSteps: num(args.maxSteps, 24, 2, 200),
              maxMs: num(args.maxMs, 10 * 60_000, 1000, 60 * 60_000),
              maxCostUsd: num(args.maxCostUsd, 1, 0, 100),
            },
            maxParallel: num(args.maxParallel, 3, 1, 5),
            merge,
          },
        );
        return {
          success: true,
          data: {
            summary: r.summary,
            taskIds: r.taskIds,
            usage: r.usage,
            mergedFrom: r.mergedFrom,
            partial: r.partial,
            notes: r.notes,
          },
        };
      } catch (err) {
        return {
          success: false,
          error: 'orchestrate_failed',
          errorDetail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

export const orchestrateTool = createOrchestrateTool();

export const ORCHESTRATE_SCHEMA: GeminiFunctionDeclaration = {
  name: 'orchestrate',
  description:
    'Run a complex goal through the specialist team (Operator, Researcher, Coder, Memory-curator, Critic) ' +
    'with parallel execution and step/time/cost budgets. Returns the merged result.',
  parameters: {
    type: 'OBJECT',
    properties: {
      goal: {
        type: 'STRING',
        description: 'The goal, e.g. "research standing desks under $500 and save the pick to memory".',
      },
      merge: {
        type: 'STRING',
        description: '"concat" (default) joins worker summaries; "critic" has the Critic review them first.',
      },
      maxParallel: { type: 'NUMBER', description: 'Max parallel subtasks, 1–5 (default 3).' },
      maxSteps: { type: 'NUMBER', description: 'Global step budget (default 24).' },
      maxMs: { type: 'NUMBER', description: 'Global time budget in ms (default 600000).' },
      maxCostUsd: { type: 'NUMBER', description: 'Global cost budget in USD (default 1).' },
    },
    required: ['goal'],
  },
};
