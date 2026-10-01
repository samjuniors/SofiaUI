/**
 * core/mission-report.ts — Phase 31: the mission report after each task.
 *
 * Steps (with retained evidence shots), what changed (daemon receipts in
 * the task's wall-clock window, each carrying machine undo when reversible),
 * and the critic's one-line verdict. Built pure from the TaskResult +
 * receipts; published on `taskEvents` as `task:report` for the TaskPanel,
 * with `lastMissionReport` for late subscribers.
 */

import { taskEvents, type StepRecord, type TaskResult, type TaskStatus } from './TaskLoop.ts';

export interface MissionStep {
  index: number;
  state: StepRecord['state'];
  tool: string;
  note?: string;
  error?: string;
  shotDataUrl?: string;
}

export interface MissionChange {
  ts: number;
  action: string;
  detail: string;
  undo?: { action: string; args: Record<string, unknown> };
}

export interface MissionReport {
  id: string;
  goal: string;
  status: TaskStatus;
  summary: string;
  criticText: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  steps: MissionStep[];
  changes: MissionChange[];
  undoable: number;
  /** Phase 36: recalled skill/memory context was non-empty when the task ran. */
  memoryUsed?: boolean;
}

/** Clock-skew slack around the task window when matching receipts. Pure. */
export const REPORT_WINDOW_SLACK_MS = 1000;

export interface ReportReceipt {
  ts?: unknown;
  action?: unknown;
  detail?: unknown;
  undo?: unknown;
}

function cleanChange(r: ReportReceipt): MissionChange | null {
  if (!r || typeof r !== 'object') return null;
  const ts = typeof r.ts === 'number' ? r.ts : 0;
  const action = typeof r.action === 'string' ? r.action : '';
  if (!ts || !action) return null;
  const undo =
    r.undo && typeof r.undo === 'object' && typeof (r.undo as { action?: unknown }).action === 'string'
      ? { action: (r.undo as { action: string }).action, args: ((r.undo as { args?: unknown }).args ?? {}) as Record<string, unknown> }
      : undefined;
  return { ts, action, detail: typeof r.detail === 'string' ? r.detail : action, ...(undo ? { undo } : {}) };
}

/** Build the report. Pure — receipts are fetched by the caller (task-tool). */
export function buildMissionReport(input: {
  id: string;
  goal: string;
  result: TaskResult;
  receipts: ReportReceipt[];
  criticText?: string;
  memoryUsed?: boolean;
}): MissionReport {
  const { id, goal, result, receipts } = input;
  const startedAt = result.startedAt;
  const endedAt = result.endedAt;
  const changes = (receipts ?? [])
    .map(cleanChange)
    .filter((c): c is MissionChange => !!c && c.ts >= startedAt - REPORT_WINDOW_SLACK_MS && c.ts <= endedAt + REPORT_WINDOW_SLACK_MS)
    .sort((a, b) => a.ts - b.ts);
  return {
    id,
    goal,
    status: result.status,
    summary: result.summary,
    criticText: input.criticText ?? '',
    startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - startedAt),
    steps: result.steps.map((s) => ({
      index: s.index,
      state: s.state,
      tool: s.tool,
      ...(s.note ? { note: s.note } : {}),
      ...(s.error ? { error: s.error } : {}),
      ...(s.shotDataUrl ? { shotDataUrl: s.shotDataUrl } : {}),
    })),
    changes,
    undoable: changes.filter((c) => c.undo).length,
    ...(input.memoryUsed !== undefined ? { memoryUsed: input.memoryUsed } : {}),
  };
}

let last: MissionReport | null = null;

/** Latest published report (late subscribers, e.g. a reopened panel). */
export function lastMissionReport(): MissionReport | null {
  return last;
}

/** Publish on `taskEvents` (`task:report`) + remember as latest. */
export function publishMissionReport(report: MissionReport): void {
  last = report;
  taskEvents.dispatchEvent(new CustomEvent('task:report', { detail: report }));
}
