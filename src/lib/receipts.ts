/**
 * lib/receipts.ts — Phase 22: read the daemon's audit log as receipts, and
 * reverse the reversible ones.
 *
 * The daemon writes one JSON line per action to actions.log.jsonl with a
 * human `detail` plus a machine `undo` (files_move / files_trash /
 * files_restore only — everything else is honestly not reversible).
 *
 * Undo safety: the Undo tap IS the explicit user approval, so when the
 * daemon gates an undo (re-trashing a restored file is ALWAYS_CONFIRM) we
 * redeem the confirmation_id through the UI confirm path and retry once —
 * the same path a spoken "yes" takes. No silent auto-confirm anywhere else.
 */

import { companion } from './companion-client.ts';

export interface UndoOp {
  action: string;
  args: Record<string, unknown>;
}

export interface ActionReceipt {
  ts: number;
  action: string;
  ok: boolean;
  error?: string;
  detail?: string;
  undo?: UndoOp;
}

/** The only undo targets the daemon ever issues. Refuse anything else. */
const UNDO_ALLOWLIST = new Set(['files_move', 'files_trash', 'files_restore']);

function isReceipt(v: unknown): v is ActionReceipt {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.ts === 'number' &&
    typeof r.action === 'string' &&
    typeof r.ok === 'boolean' &&
    (r.undo === undefined ||
      (typeof r.undo === 'object' &&
        r.undo !== null &&
        typeof (r.undo as UndoOp).action === 'string'))
  );
}

export async function fetchRecentActions(limit = 20): Promise<{ receipts: ActionReceipt[]; error?: string }> {
  const reply = await companion.send<{ receipts?: unknown }>('actions_recent', { limit });
  if (!reply.ok) {
    return {
      receipts: [],
      error:
        reply.error === 'not_connected'
          ? 'Companion offline — receipts live on your PC.'
          : reply.detail || reply.error || 'Could not read receipts.',
    };
  }
  const raw = reply.result?.receipts;
  if (!Array.isArray(raw)) return { receipts: [], error: 'Daemon answered without receipts.' };
  return { receipts: raw.filter(isReceipt) };
}

/**
 * Reverse one receipt. Returns ok:false with a human `error` when the
 * receipt is not reversible or the daemon refuses.
 */
export async function undoReceipt(
  receipt: ActionReceipt,
): Promise<{ ok: boolean; error?: string; undone?: string }> {
  const undo = receipt.undo;
  if (!undo || !UNDO_ALLOWLIST.has(undo.action)) {
    return { ok: false, error: 'Not reversible — only file moves, trashes, and restores can be undone.' };
  }
  const args = undo.action === 'files_move' ? { from: '', to: '', ...undo.args } : { path: '', ...undo.args };
  let reply = await companion.send(undo.action, args);
  if (!reply.ok && reply.error === 'confirmation_required' && reply.confirmation_id) {
    // The Undo tap is explicit approval: redeem through the UI confirm
    // path, then retry the exact same op once.
    const redemption = await companion.confirm(reply.confirmation_id);
    if (!redemption.ok) {
      return { ok: false, error: `Approval failed: ${redemption.error ?? 'unknown'}.` };
    }
    reply = await companion.send(undo.action, { ...args, confirmation_id: reply.confirmation_id });
  }
  if (!reply.ok) {
    return { ok: false, error: reply.detail || reply.error || 'Undo failed.' };
  }
  return { ok: true, undone: receipt.detail || receipt.action };
}
