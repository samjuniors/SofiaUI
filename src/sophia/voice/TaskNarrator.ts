/**
 * sophia/voice/TaskNarrator.ts — Phase 19: the task loop's voice.
 *
 * Subscribes to taskEvents and turns step progress into one-line spoken
 * updates ("opened Excel, typing now") plus approval questions and result
 * announcements. Delivery goes through the injected announcer — the live
 * session when connected, silence otherwise (the TaskPanel shows it all).
 *
 * Cadence is one line per step (folding the just-verified step into the
 * next step's line), first-retry hints, approval questions, and terminal
 * results. Never chatty, never silent for a whole task.
 */

import { taskEvents } from '../../core/TaskLoop.ts';

export type NarrationKind = 'progress' | 'approval' | 'result';
export type TaskAnnouncer = (line: string, kind: NarrationKind) => void;

let announcer: TaskAnnouncer | null = null;

/** SophiaOS wires this to the live session; null = narrate nowhere. */
export function setTaskAnnouncer(fn: TaskAnnouncer | null): void {
  announcer = fn;
}

/** True between a task approval pause and its resolution (voice "yes/no" checks this). */
let awaitingApproval = false;
export function isAwaitingTaskApproval(): boolean {
  return awaitingApproval;
}

/**
 * Barge-in utterances (lowercased, trimmed): a bare stop/cancel kills the
 * running task instantly instead of waiting for a model tool call.
 */
export function matchTaskCancelUtterance(text: string): boolean {
  return /^(stop|cancel|abort|never mind|forget it|stop that|cancel that|hold on|wait(\s+stop)?)\.?$/.test(
    text.trim(),
  );
}

/** Approval answers while a task pause is pending. Null = not an answer. */
export function matchApprovalAnswer(text: string): 'approve' | 'deny' | null {
  const t = text.trim();
  if (/^(yes|yeah|yep|approve|approved|allow|allowed|go ahead|do it|ok|okay|sure)\.?$/.test(t)) return 'approve';
  if(/^(no|nope|deny|denied|don't|do not|never mind|forget it)\.?$/.test(t)) return 'deny';
  return null;
}

interface TaskStateDetail {
  phase: string;
  id: string;
  label?: string;
  question?: string;
  summary?: string;
  reason?: string | null;
}

function splitLabel(label: string): { action: string; arg: string } {
  const [action = '', ...rest] = label.trim().split(/\s+/);
  return { action: action.toLowerCase(), arg: rest.join(' ') };
}

const PAST: Record<string, (arg: string) => string> = {
  click: () => 'clicked',
  open_app: (a) => `opened ${a || 'the app'}`,
  open_file: () => 'opened the file',
  type_text: () => 'typed that in',
  type: () => 'typed that in',
  hotkey: (a) => `pressed ${a || 'the keys'}`,
  press_key: (a) => `pressed ${a || 'the key'}`,
  scroll: () => 'scrolled',
  drag: () => 'dragged that over',
  move_mouse: () => 'moved the mouse',
};

const PRESENT: Record<string, (arg: string) => string> = {
  click: () => 'clicking',
  open_app: (a) => `opening ${a || 'it'}`,
  open_file: () => 'opening the file',
  type_text: () => 'typing now',
  type: () => 'typing now',
  hotkey: (a) => `pressing ${a || 'the keys'}`,
  press_key: (a) => `pressing ${a || 'the key'}`,
  scroll: () => 'scrolling',
  drag: () => 'dragging that over',
  move_mouse: () => 'moving the mouse',
};

/** Finished step → past tense ("opened Excel"). Free-text notes pass through. */
export function pastTense(label: string): string {
  const { action, arg } = splitLabel(label);
  return PAST[action]?.(arg) ?? label.trim();
}

/** Live step → present tense ("typing now"). */
export function presentTense(label: string): string {
  const { action, arg } = splitLabel(label);
  return PRESENT[action]?.(arg) ?? label.trim();
}

function shortSummary(summary: string): string {
  const m = summary.match(/^[^.!?]+[.!?]/);
  const t = (m ? m[0] : summary).trim();
  return t.length > 140 ? `${t.slice(0, 137).trimEnd()}…` : t;
}

class TaskNarrator {
  private current: string | null = null;
  private lastDone: string | null = null;
  private retryHintSpoken = false;

  constructor() {
    taskEvents.addEventListener('task:state', (e) => {
      this.onEvent((e as CustomEvent).detail as TaskStateDetail);
    });
  }

  private say(line: string, kind: NarrationKind): void {
    announcer?.(line, kind);
  }

  private onEvent(d: TaskStateDetail): void {
    switch (d.phase) {
      case 'started':
        this.current = null;
        this.lastDone = null;
        this.retryHintSpoken = false;
        awaitingApproval = false;
        break;
      case 'decided':
        awaitingApproval = false;
        if (typeof d.label === 'string' && d.label) this.current = d.label;
        break;
      case 'step': {
        awaitingApproval = false;
        if (!this.current) break;
        const now = presentTense(this.current);
        this.say(
          this.lastDone ? `${pastTense(this.lastDone)}, ${now}.` : `${now[0].toUpperCase()}${now.slice(1)}.`,
          'progress',
        );
        break;
      }
      case 'verified':
        // Silent — folded into the next step's line (or the done summary).
        if (this.current) this.lastDone = this.current;
        this.retryHintSpoken = false;
        break;
      case 'retry':
        if (!this.retryHintSpoken) {
          this.retryHintSpoken = true;
          this.say("That didn't quite work — trying a different way.", 'progress');
        }
        break;
      case 'paused':
        awaitingApproval = true;
        if (typeof d.question === 'string' && d.question) {
          this.say(`${d.question} Say approve or deny.`, 'approval');
        }
        break;
      case 'done':
        awaitingApproval = false;
        this.say(`Done — ${shortSummary(d.summary ?? 'task complete.')}`, 'result');
        break;
      case 'failed':
        awaitingApproval = false;
        this.say(`That failed — ${shortSummary(d.summary ?? d.reason ?? 'something went wrong.')}`, 'result');
        break;
      case 'cancelled':
        awaitingApproval = false;
        this.say('Stopped.', 'result');
        break;
      default:
        break;
    }
  }
}

/** Singleton — subscribes on import; silent until an announcer is set. */
export const taskNarrator = new TaskNarrator();
