/**
 * core/task-critic.ts — Phase 25: the critic agent's reflection writer.
 *
 * After every task, the critic distills the run into a reflection: goal,
 * steps, what failed, what worked. The text form is banked as a
 * `reflection` episode (linked to its task episode); the `Failed:` lines
 * double as machine-readable causes for skill failure modes and the
 * self-improvement loop. Pure — no I/O, no brain calls.
 */

import type { StepRecord, TaskStatus } from './TaskLoop.ts';

export interface CriticFailure {
  step: number;
  tool: string;
  detail: string;
}

export type CriticVerdict = 'clean' | 'recovered' | 'failed' | 'cancelled';

export interface CriticReflection {
  goal: string;
  status: TaskStatus;
  stepsTotal: number;
  worked: string[];
  failed: CriticFailure[];
  skipped: number;
  verdict: CriticVerdict;
  /** Banked form (multi-line, `Failed:`-prefixed cause lines). */
  text: string;
}

export function critiqueTask(
  goal: string,
  status: TaskStatus,
  steps: StepRecord[],
  summary: string,
): CriticReflection {
  const worked: string[] = [];
  const failed: CriticFailure[] = [];
  let skipped = 0;
  for (const s of steps) {
    if (s.state === 'done') worked.push(s.tool);
    else if (s.state === 'failed') {
      failed.push({
        step: s.index,
        tool: s.tool,
        detail: String(s.error || s.note || 'step failed').slice(0, 160),
      });
    } else if (s.state === 'skipped') skipped++;
  }
  const verdict: CriticVerdict =
    status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'failed' : failed.length > 0 ? 'recovered' : 'clean';
  const lines = [
    `Reflection — "${goal}" ${status}, ${steps.length} steps (${verdict}).`,
    `Worked: ${worked.length > 0 ? worked.join(' → ') : 'nothing'} (${worked.length}/${steps.length} clean).`,
  ];
  for (const f of failed.slice(0, 5)) lines.push(`Failed: step ${f.step} ${f.tool} — ${f.detail}`);
  if (skipped > 0) lines.push(`Skipped: ${skipped}.`);
  if (summary.trim()) lines.push(`Summary: ${summary.trim().slice(0, 300)}`);
  return { goal, status, stepsTotal: steps.length, worked, failed, skipped, verdict, text: lines.join('\n') };
}

/** First failure as a skill failure-mode cause, or null when clean. */
export function failureCause(c: CriticReflection): string | null {
  const f = c.failed[0];
  return f ? `${f.tool}: ${f.detail}`.slice(0, 200) : null;
}
