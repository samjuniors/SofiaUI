/**
 * core/task-planner.ts — Phase 11a: the prefrontal cortex, part 1 (planning).
 *
 * Pure plan types + validation + the LLM planner prompt. The real planner
 * calls the same /api/sophia/chat brain the chat UI uses, with an empty
 * history so every plan starts from a clean slate plus a grounded snapshot
 * of the PC (foreground window, cursor, vision flag).
 *
 * 11a scope: plans may only drive the `computer` tool (the real PC).
 * No nested `task` calls — recursion is a loop bug waiting to happen.
 */

export interface StepExpectation {
  /** Case-insensitive substring that must appear in the foreground window title. */
  windowContains?: string;
  /** On-screen text that must be findable after the step. */
  textVisible?: string;
}

export interface TaskStep {
  tool: string;
  args: Record<string, unknown>;
  expect?: StepExpectation;
  /** Irreversible/sensitive: the loop pauses for approval before running. */
  needsConfirm?: boolean;
  note?: string;
}

export interface TaskPlan {
  goal: string;
  steps: TaskStep[];
}

export interface PlannerContext {
  window?: string | null;
  cursor?: { x?: unknown; y?: unknown } | null;
  vision?: boolean;
  /** Set on replans: what just failed and what was observed. */
  failure?: string;
  /** Past similar tasks, recalled from episodic memory. */
  memory?: string;
}

export const MAX_PLAN_STEPS = 8;

/** computer-tool actions the planner is allowed to emit. */
const KNOWN_ACTIONS = new Set([
  'open_app',
  'open_url',
  'click',
  'double_click',
  'right_click',
  'move_mouse',
  'scroll',
  'type_text',
  'hotkey',
  'find_text',
  'active_window',
  'cursor',
  'browser_go',
  'browser_click',
  'browser_type',
  'browser_read',
  'notify',
  'see',
]);

export function planPrompt(goal: string, ctx: PlannerContext): string {
  const snapshot = [
    `foreground window: ${ctx.window || 'unknown'}`,
    `cursor: ${String(ctx.cursor?.x ?? '?')},${String(ctx.cursor?.y ?? '?')}`,
    `screen vision: ${ctx.vision ? 'LIVE (you can see pixels)' : 'OFF (window titles + text search only)'}`,
  ].join(' · ');
  return (
    `You are Sofia's task planner. Decompose the goal into numbered computer steps. ` +
    `Current PC snapshot: ${snapshot}.` +
    (ctx.failure ? ` Previous attempt FAILED: ${ctx.failure}. Replan the remaining work differently.` : '') +
    (ctx.memory ? ` Past similar tasks (copy what worked):\n${ctx.memory}\n` : '') +
    `\nRules:\n` +
    `1. Reply with JSON ONLY, no prose, no fences: {"steps":[{"tool":"computer","args":{"action":"..."},"expect":{...},"needsConfirm":false,"note":"..."}]}.\n` +
    `2. tool MUST be "computer". action MUST be one of: ${[...KNOWN_ACTIONS].join(', ')}.\n` +
    `3. Max ${MAX_PLAN_STEPS} steps. Prefer find_text before blind coordinate clicks; use hotkey "win" for the Start menu.\n` +
    `4. Every step SHOULD declare expect: {"windowContains":"..."} and/or {"textVisible":"..."} so the executor can verify it worked.\n` +
    `5. needsConfirm:true for irreversible or sensitive steps (trash/delete, send/pay/post, closing unsaved work).\n` +
    `Goal: ${goal}`
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Parse + validate one planner reply. Never throws — errors are values. */
export function parsePlan(raw: string, goal: string): { plan: TaskPlan } | { error: string } {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { error: 'planner_not_json: the planner did not return JSON.' };
  }
  if (!isRecord(json) || !Array.isArray(json.steps)) {
    return { error: 'planner_bad_shape: expected {"steps":[...]}.' };
  }
  if (json.steps.length === 0) return { error: 'planner_empty: no steps planned.' };
  if (json.steps.length > MAX_PLAN_STEPS) {
    return { error: `planner_too_long: max ${MAX_PLAN_STEPS} steps.` };
  }
  const steps: TaskStep[] = [];
  for (let i = 0; i < json.steps.length; i++) {
    const s = json.steps[i];
    if (!isRecord(s)) return { error: `planner_bad_step_${i + 1}: not an object.` };
    if (s.tool !== 'computer') {
      return { error: `planner_bad_step_${i + 1}: tool must be "computer".` };
    }
    const args = isRecord(s.args) ? (s.args as Record<string, unknown>) : {};
    const action = args.action;
    if (typeof action !== 'string' || !KNOWN_ACTIONS.has(action)) {
      return { error: `planner_bad_step_${i + 1}: unknown computer action "${String(action)}".` };
    }
    let expect: StepExpectation | undefined;
    if (s.expect !== undefined) {
      if (!isRecord(s.expect)) return { error: `planner_bad_step_${i + 1}: expect must be an object.` };
      const e = s.expect as Record<string, unknown>;
      if (e.windowContains !== undefined && typeof e.windowContains !== 'string') {
        return { error: `planner_bad_step_${i + 1}: expect.windowContains must be a string.` };
      }
      if (e.textVisible !== undefined && typeof e.textVisible !== 'string') {
        return { error: `planner_bad_step_${i + 1}: expect.textVisible must be a string.` };
      }
      expect = {
        ...(typeof e.windowContains === 'string' && e.windowContains ? { windowContains: e.windowContains.slice(0, 120) } : {}),
        ...(typeof e.textVisible === 'string' && e.textVisible ? { textVisible: e.textVisible.slice(0, 120) } : {}),
      };
      if (!expect.windowContains && !expect.textVisible) expect = undefined;
    }
    steps.push({
      tool: 'computer',
      args,
      ...(expect ? { expect } : {}),
      ...(s.needsConfirm === true ? { needsConfirm: true } : {}),
      ...(typeof s.note === 'string' && s.note ? { note: s.note.slice(0, 200) } : {}),
    });
  }
  return { plan: { goal: goal.slice(0, 500), steps } };
}

/** Real planner: one clean-slate brain call. Throws on transport/parse failure. */
export async function planWithBrain(
  goal: string,
  ctx: PlannerContext,
  fetchImpl: typeof fetch = fetch,
): Promise<TaskPlan> {
  let reply = '';
  try {
    const res = await fetchImpl('/api/sophia/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lastUser: planPrompt(goal, ctx), history: [], brainMode: 'auto' }),
    });
    const j = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
    reply = (j?.text ?? '').trim();
    if (!reply) throw new Error(j?.error || 'empty reply');
  } catch (err) {
    throw new Error(`planner_unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
  const parsed = parsePlan(reply, goal);
  if ('error' in parsed) throw new Error(parsed.error);
  return parsed.plan;
}

export interface SimilarEpisode {
  text: string;
}

/** Recall past similar tasks from episodic memory. Best-effort: '' on any failure. */
export async function recallSimilar(
  goal: string,
  search: (q: string) => Promise<SimilarEpisode[]>,
): Promise<string> {
  try {
    const hits = await search(goal);
    const tops = hits
      .filter((h) => h && typeof h.text === 'string' && h.text.trim())
      .slice(0, 3)
      .map((h) => `- ${h.text.trim().slice(0, 200)}`);
    return tops.join('\n');
  } catch {
    return '';
  }
}
