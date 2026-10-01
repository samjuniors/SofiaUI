/**
 * ui/ReceiptsPanel.tsx — Phase 22: "what did it do, and can I take it back?"
 *
 * Newest-first list of daemon audit receipts with per-row Undo for the
 * reversible ones (file move / trash / restore). Read-only otherwise —
 * rows for clicks, typing, and app launches are history, labelled as such
 * by the absence of an Undo button.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, History, RefreshCw, Undo2, X } from 'lucide-react';
import { fetchRecentActions, undoReceipt, type ActionReceipt } from '../lib/receipts.ts';

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function ReceiptsPanel({ onClose }: { onClose: () => void }) {
  const [receipts, setReceipts] = useState<ActionReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyTs, setBusyTs] = useState<number | null>(null);
  const [flash, setFlash] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    const { receipts: rows, error: err } = await fetchRecentActions(25);
    setReceipts(rows);
    if (err) setError(err);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Esc closes (inputs unaffected). Registered after AgentBar's, and the
  // bar ignores Esc when default is prevented — closing the panel must
  // never stop a running task.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onUndo = async (r: ActionReceipt) => {
    setBusyTs(r.ts);
    setFlash('');
    setError('');
    const res = await undoReceipt(r);
    setBusyTs(null);
    if (!res.ok) {
      setError(res.error ?? 'Undo failed.');
      return;
    }
    setFlash(`Undid: ${res.undone ?? r.action}`);
    await refresh();
  };

  return (
    <div
      role="dialog"
      aria-label="Agent activity receipts"
      className="fixed bottom-[110px] right-7 z-40 flex max-h-[52vh] w-[340px] flex-col rounded-2xl border border-white/15 bg-[#070b16]/95 shadow-2xl backdrop-blur-md sm:right-11"
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <History size={15} className="shrink-0 text-sky-300" />
        <p className="text-[12px] font-semibold text-white">Agent activity</p>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          title="Refresh receipts"
          aria-label="Refresh receipts"
          className="ml-auto grid size-7 place-items-center rounded-lg border border-white/10 text-white/60 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          type="button"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close receipts"
          className="grid size-7 place-items-center rounded-lg border border-white/10 text-white/60 transition hover:bg-white/[0.06] hover:text-white"
        >
          <X size={13} />
        </button>
      </div>

      {flash && (
        <p className="flex items-center gap-1.5 border-b border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-[11px] text-emerald-200">
          <Check size={12} className="shrink-0" />
          {flash}
        </p>
      )}
      {error && (
        <p role="alert" className="border-b border-red-400/20 bg-red-400/10 px-4 py-2 text-[11px] text-red-200">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {loading && receipts.length === 0 && (
          <p className="px-3 py-6 text-center text-[12px] text-white/50">Reading receipts…</p>
        )}
        {!loading && receipts.length === 0 && !error && (
          <p className="px-3 py-6 text-center text-[12px] text-white/50">
            Nothing yet — actions the agent takes on your PC will appear here.
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {receipts.map((r) => (
            <li
              key={`${r.ts}-${r.action}`}
              className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2"
            >
              <span
                title={r.ok ? 'succeeded' : `failed: ${r.error ?? 'unknown'}`}
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.ok ? 'bg-emerald-400' : 'bg-red-400'}`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] text-white/85" title={r.detail || r.action}>
                  {r.detail || r.action.replaceAll('_', ' ')}
                </p>
                <p className="text-[10px] text-white/40">
                  {timeAgo(r.ts)}
                  {!r.ok && r.error ? ` · failed: ${r.error}` : ''}
                </p>
              </div>
              {r.undo && (
                <button
                  type="button"
                  onClick={() => void onUndo(r)}
                  disabled={busyTs !== null}
                  title={`Undo: ${r.detail || r.action}`}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-amber-300/30 bg-amber-400/10 px-2 py-1 text-[11px] font-medium text-amber-200 transition hover:bg-amber-400/20 active:scale-95 disabled:opacity-40"
                >
                  <Undo2 size={12} />
                  {busyTs === r.ts ? '…' : 'Undo'}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <p className="border-t border-white/10 px-4 py-2 text-[10px] text-white/35">
        Only file moves, trashes, and restores can be undone. Typed text is never logged.
      </p>
    </div>
  );
}
