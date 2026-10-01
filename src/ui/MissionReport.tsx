/**
 * ui/MissionReport.tsx — Phase 31: the after-action report for a finished task.
 *
 * Steps with evidence thumbnails, what changed on the PC (daemon receipts in
 * the task window, each with one-tap undo when reversible), duration, and
 * the critic's verdict line. Fed by the `task:report` event (see
 * core/mission-report.ts); undo reuses the receipts lib's allowlisted path.
 */

import { useState } from 'react';
import { Check, X, Circle, Undo2, Camera, FileDiff, Loader2 } from 'lucide-react';
import type { MissionReport as Report } from '../core/mission-report';
import { undoReceipt } from '../lib/receipts';

function StepIcon({ state }: { state: string }) {
  if (state === 'done') return <Check size={12} className="mt-0.5 shrink-0 text-emerald-300" />;
  if (state === 'failed') return <X size={12} className="mt-0.5 shrink-0 text-red-300" />;
  if (state === 'skipped') return <Circle size={12} className="mt-0.5 shrink-0 text-white/25" />;
  return <Loader2 size={12} className="mt-0.5 shrink-0 text-sky-300" />;
}

function secs(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function MissionReport({ report }: { report: Report }) {
  const [undone, setUndone] = useState<Set<number>>(new Set());
  const [undoing, setUndoing] = useState<number | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const undo = async (i: number) => {
    const c = report.changes[i];
    if (!c?.undo || undone.has(i)) return;
    setUndoing(i);
    try {
      const r = await undoReceipt({ ts: c.ts, action: c.action, ok: true, detail: c.detail, undo: c.undo });
      if (r.ok) {
        setUndone((prev) => new Set(prev).add(i));
        setFlash(`Undid: ${r.undone ?? c.action}`);
      } else {
        setFlash(r.error ?? 'Undo failed.');
      }
    } finally {
      setUndoing(null);
    }
  };

  const shots = report.steps.filter((s) => s.shotDataUrl);

  return (
    <div className="border-t border-white/[0.07] px-3.5 py-2.5">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-white/85">
        Mission report
        <span className="font-light text-white/40">
          {report.steps.length} steps · {secs(report.durationMs)} · {report.changes.length} change
          {report.changes.length === 1 ? '' : 's'}
          {report.undoable > 0 ? ` (${report.undoable} undoable)` : ''}
        </span>
      </div>

      {shots.length > 0 && (
        <div className="mt-2">
          <p className="flex items-center gap-1 text-[10px] font-medium text-white/50">
            <Camera size={11} /> Evidence
          </p>
          <div className="mt-1 flex gap-1.5 overflow-x-auto pb-1">
            {shots.map((s) => (
              <img
                key={s.index}
                src={s.shotDataUrl}
                alt={`Step ${s.index + 1} screenshot`}
                title={`Step ${s.index + 1}: ${s.tool}${s.error ? ` — ${s.error}` : ''}`}
                className="h-16 w-28 shrink-0 rounded-md border border-white/10 object-cover"
              />
            ))}
          </div>
        </div>
      )}

      <ol className="mt-2 max-h-32 space-y-1 overflow-y-auto">
        {report.steps.map((s) => (
          <li key={s.index} className="flex items-start gap-2 text-[11px] leading-snug">
            <StepIcon state={s.state} />
            <span className="text-white/80">
              {s.tool}
              {s.note ? <span className="text-white/50"> — {s.note}</span> : null}
              {s.error ? <span className="text-red-300/90"> — {s.error}</span> : null}
            </span>
          </li>
        ))}
        {report.steps.length === 0 && <li className="text-[11px] text-white/45">No steps ran.</li>}
      </ol>

      <div className="mt-2">
        <p className="flex items-center gap-1 text-[10px] font-medium text-white/50">
          <FileDiff size={11} /> What changed
        </p>
        {report.changes.length === 0 ? (
          <p className="mt-0.5 text-[11px] font-light text-white/45">Nothing on the PC — read-only task.</p>
        ) : (
          <ul className="mt-1 max-h-28 space-y-1 overflow-y-auto">
            {report.changes.map((c, i) => (
              <li key={`${c.ts}-${i}`} className="flex items-center gap-2 text-[11px] text-white/75">
                <span className="min-w-0 flex-1 truncate" title={c.detail}>
                  {c.detail}
                </span>
                {c.undo && !undone.has(i) && (
                  <button
                    type="button"
                    onClick={() => void undo(i)}
                    disabled={undoing === i}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-white/15 px-1.5 py-0.5 text-[10px] text-white/70 hover:bg-white/[0.06] disabled:opacity-50"
                  >
                    <Undo2 size={11} /> Undo
                  </button>
                )}
                {undone.has(i) && <span className="shrink-0 text-[10px] text-emerald-300/80">undone</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {flash && <p className="mt-1.5 text-[10px] text-sky-200/90">{flash}</p>}

      {report.criticText.trim() && (
        <p className="mt-2 border-t border-white/[0.07] pt-1.5 text-[10px] italic leading-snug text-white/45">
          {report.criticText.split('\n')[0]?.slice(0, 220)}
        </p>
      )}
    </div>
  );
}
