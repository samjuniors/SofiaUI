/**
 * policy/autonomy-wiring.ts — Phase 26: the autonomy bridge (installed once
 * from `mind-wiring`; safe to import anywhere).
 *
 * - TaskLoop approval pauses (`task:state` phase `paused`) become async
 *   ApprovalQueue requests: desktop toast + phone push fire here, voice
 *   speaks through the existing TaskNarrator 'paused' announcement, and the
 *   gated step waits — everything else keeps running.
 * - `resolveTaskApproval` is the ONLY UI path that settles a request
 *   (`via: 'ui'`); it falls back to plain `approveTask` when the bridge
 *   never saw a pause (or is off, e.g. in tests).
 * - NOTIFY-tier daemon replies (observed via `companion.afterReply`) raise
 *   a "did it" toast, naming undo where receipts support it.
 *
 * The model can neither see nor settle queue ids: they never enter tool
 * args, results, or prompts — only the TaskPanel/voice-confirm handlers
 * call `resolveTaskApproval`, and `approve` demands an explicit UI channel.
 */

import { taskEvents } from '../core/TaskLoop.ts';
import { approveTask } from '../tools/task-tool.ts';
import { companion } from '../lib/companion-client.ts';
import { computerTool } from '../tools/computer-tool.ts';
import {
  UNDOABLE_ACTIONS,
  approvalQueue,
  autonomyStore,
  tierOf,
  type ApprovalRequest,
} from './autonomy.ts';

/** Phone-push delivery. No push backend ships yet — see LogPushNotifier. */
export interface PushNotifier {
  send(title: string, body: string): Promise<void> | void;
}

/**
 * Default push: structured log line. Swap via `setPushNotifier` when a
 * push backend (FCM/APNs relay, ntfy, …) is configured — the queue and
 * the UI flow stay identical.
 */
export class LogPushNotifier implements PushNotifier {
  send(title: string, body: string): void {
    console.info(`[push:unconfigured] ${title} — ${body}`);
  }
}

let pushNotifier: PushNotifier = new LogPushNotifier();

export function setPushNotifier(n: PushNotifier): void {
  pushNotifier = n;
}

function short(v: unknown, n: number): string {
  return typeof v === 'string' ? v.slice(0, n) : '';
}

function base(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || p;
}

function labelFor(action: string, args: Record<string, unknown>): string {
  switch (action) {
    case 'files_move':
      return `Moved ${base(short(args.from, 60))} → ${base(short(args.to, 60)) || '…'}`;
    case 'files_restore':
      return `Restored ${base(short(args.name ?? args.path, 60)) || 'file'}`;
    case 'memory_update':
      return 'Edited a memory';
    case 'memory_delete':
      return 'Deleted a memory';
    case 'store_put':
      return `Saved ${short(args.key, 40) || 'a setting'}`;
    case 'store_delete':
      return `Cleared ${short(args.key, 40) || 'a setting'}`;
    case 'whatsapp_draft':
      return 'WhatsApp draft ready (not sent)';
    case 'browser_navigate':
    case 'browser_open_read': {
      try {
        const u = new URL(short(args.url, 120));
        return `Opened ${u.host}`;
      } catch {
        return 'Opened a page';
      }
    }
    default:
      return action.replace(/_/g, ' ');
  }
}

async function toast(title: string, text: string): Promise<void> {
  try {
    await computerTool.invoke({ action: 'notify', title, text });
  } catch {
    /* headless or offline — the queue, panel, and voice remain */
  }
}

async function fanOutApproval(req: ApprovalRequest): Promise<void> {
  await toast('Sofia needs approval', req.question);
  try {
    await pushNotifier.send('Sofia needs approval', req.question);
  } catch {
    /* push is best-effort; toast + voice + panel carry the request */
  }
}

let bridged = false;

/** Test seam — lets each test install a fresh bridge. */
export function __resetAutonomyBridge(): void {
  bridged = false;
}

export function ensureAutonomyBridge(): void {
  if (bridged) return;
  bridged = true;

  taskEvents.addEventListener('task:state', (e) => {
    const d = (e as CustomEvent).detail as {
      phase?: unknown;
      id?: unknown;
      goal?: unknown;
      index?: unknown;
      label?: unknown;
      question?: unknown;
    } | null;
    if (!d || d.phase !== 'paused') return;
    const index = typeof d.index === 'number' ? d.index : 0;
    const req = approvalQueue.request({
      taskId: typeof d.id === 'string' ? d.id : undefined,
      action: 'task-step',
      label: typeof d.label === 'string' ? d.label : `Step ${index + 1}`,
      question: typeof d.question === 'string' ? d.question : 'Approve this step?',
      detail: { goal: typeof d.goal === 'string' ? d.goal : '', index },
    });
    void fanOutApproval(req);
  });

  companion.afterReply = (action, args, reply) => {
    if (!reply.ok) return;
    if (action === 'notify' || action === 'confirm') return; // plumbing never toasts itself
    if (tierOf(action, args, { level: autonomyStore.get() }) !== 'notify') return;
    const undo = UNDOABLE_ACTIONS.has(action) ? ' — undo in Activity' : '';
    void toast('Sofia did it', `${labelFor(action, args)}${undo}`);
  };
}

/**
 * Settle the latest pending approval from explicit UI input and resume the
 * task. Falls back to plain `approveTask` when no queue request exists
 * (bridge off). User intent always wins over queue expiry: an expired
 * request stays expired in the audit record, but the tap still resumes —
 * expiry fails closed only for unattended waits, never vetoes a human.
 */
export function resolveTaskApproval(ok: boolean, via: 'ui' | 'voice-confirm' = 'ui'): boolean {
  const pend = approvalQueue.pending();
  const req = pend[pend.length - 1];
  if (req) {
    if (ok) approvalQueue.approve(req.id, { via });
    else approvalQueue.deny(req.id, { via });
  }
  return approveTask(ok);
}
