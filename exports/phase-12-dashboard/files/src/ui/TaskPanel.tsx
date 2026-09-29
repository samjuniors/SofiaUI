/**
 * ui/TaskPanel.tsx — Phase 11a: the visible prefrontal cortex.
 *
 * Floating step-log card for the running task: live plan steps with
 * states, replan notes, approval questions with Approve/Deny, cancel,
 * and the final summary. Listens to taskEvents — no props needed.
 */

import { useEffect, useState } from 'react';
import { Check, Circle, ListTodo, Loader2, X } from 'lucide-react';
import { taskEvents } from '../core/TaskLoop';
import { approveTask, cancelTask } from '../tools/task-tool';

interface StepView {
  index: number;
  label: string;
  needsConfirm: boolean;
  state: 'pending' | 'active' | 'done' | 'failed';
}

interface PanelState {
  id: string;
  goal: string;
  steps: StepView[];
  terminal: 'done' | 'failed' | 'cancelled' | null;
  summary: string;
  question: string | null;
  note: string | null;
}

const TERMINAL_PHASES = new Set(['done', 'failed', 'cancelled']);

export function TaskPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const [view, setView] = useState<PanelState | null>(null);

  useEffect(() => {
    const onState = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        phase: string;
        id: string;
        goal?: string;
        steps?: Array<{ index: number; label: string; needsConfirm: boolean }>;
        index?: number;
        pass?: boolean;
        reason?: string | null;
        question?: string;
        summary?: string;
      };
      setView((prev) => {
        if (d.phase === 'started') {
          return { id: d.id, goal: d.goal ?? '', steps: [], terminal: null, summary: '', question: null, note: null };
        }
        if (!prev || prev.id !== d.id) return prev;
        switch (d.phase) {
          case 'planned':
            return {
              ...prev,
              steps: (d.steps ?? []).map((s) => ({ ...s, state: 'pending' as const })),
              question: null,
              note: null,
            };
          case 'step':
            return {
              ...prev,
              steps: prev.steps.map((s) => (s.index === d.index ? { ...s, state: 'active' as const } : s)),
              question: null,
            };
          case 'verified':
            return {
              ...prev,
              steps: prev.steps.map((s) =>
                s.index === d.index ? { ...s, state: d.pass ? ('done' as const) : ('failed' as const) } : s,
              ),
            };
          case 'replan':
            return { ...prev, note: d.reason ? `Replanning: ${d.reason}` : 'Replanning…' };
          case 'paused':
            return { ...prev, question: d.question ?? 'Approve this step?' };
          default:
            if (TERMINAL_PHASES.has(d.phase)) {
              return {
                ...prev,
                terminal: d.phase as PanelState['terminal'],
                summary: d.summary ?? '',
                question: null,
              };
            }
            return prev;
        }
      });
    };
    taskEvents.addEventListener('task:state', onState);
    return () => taskEvents.removeEventListener('task:state', onState);
  }, []);

  if (!view) {
    if (!embedded) return null;
    return (
      <div
        role="status"
        className="w-full rounded-2xl border border-dashed border-white/15 px-3.5 py-6 text-center"
      >
        <p className="text-[12px] text-white/50">No task running.</p>
        <p className="mt-1 text-[11px] text-white/35">
          Ask Sofia to do something multi-step and watch it unfold here.
        </p>
      </div>
    );
  }

  const running = !view.terminal;
  const ring =
    view.terminal === 'done'
      ? 'border-emerald-400/40'
      : view.terminal === 'failed'
        ? 'border-red-400/40'
        : view.terminal === 'cancelled'
          ? 'border-white/15'
          : 'border-sky-400/40';

  return (
    <div
      role="status"
      aria-label={view.terminal ? `Task ${view.terminal}` : 'Task running'}
      className={
        embedded
          ? `w-full rounded-2xl border bg-[#070b16]/92 shadow-2xl backdrop-blur-md transition-all ${ring}`
          : `fixed bottom-[110px] right-7 z-30 w-[320px] rounded-2xl border bg-[#070b16]/92 shadow-2xl backdrop-blur-md transition-all sm:right-11 ${ring}`
      }
    >
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-3.5 py-2.5">
        <ListTodo size={14} className={running ? 'text-sky-300' : 'text-white/50'} />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-white/90" title={view.goal}>
          {view.goal}
        </span>
        {running ? (
          <button
            type="button"
            onClick={() => cancelTask()}
            className="rounded-md border border-white/10 px-2 py-0.5 text-[10px] text-white/60 hover:border-red-400/40 hover:text-red-300"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            aria-label="Dismiss task card"
            onClick={() => setView(null)}
            className="rounded-md p-1 text-white/50 hover:bg-white/[0.06] hover:text-white"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <ol className="max-h-48 space-y-1 overflow-y-auto px-3.5 py-2.5">
        {view.steps.map((s) => (
          <li key={s.index} className="flex items-start gap-2 text-[11px] leading-snug">
            {s.state === 'active' ? (
              <Loader2 size={12} className="mt-0.5 shrink-0 animate-spin text-sky-300" />
            ) : s.state === 'done' ? (
              <Check size={12} className="mt-0.5 shrink-0 text-emerald-300" />
            ) : s.state === 'failed' ? (
              <X size={12} className="mt-0.5 shrink-0 text-red-300" />
            ) : (
              <Circle size={12} className="mt-0.5 shrink-0 text-white/25" />
            )}
            <span className={s.state === 'pending' ? 'text-white/45' : 'text-white/85'}>
              {s.label}
              {s.needsConfirm && <span className="ml-1 text-amber-300/80">(asks first)</span>}
            </span>
          </li>
        ))}
        {view.steps.length === 0 && running && (
          <li className="flex items-center gap-2 text-[11px] text-white/45">
            <Loader2 size={12} className="animate-spin text-sky-300" /> Planning…
          </li>
        )}
      </ol>

      {view.note && !view.terminal && (
        <p className="border-t border-white/[0.07] px-3.5 py-2 text-[10px] italic text-amber-200/80">{view.note}</p>
      )}

      {view.question && (
        <div className="border-t border-amber-400/20 bg-amber-950/20 px-3.5 py-2.5">
          <p className="text-[11px] text-amber-100/90">{view.question}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => approveTask(true)}
              className="flex-1 rounded-lg border border-emerald-400/50 bg-emerald-950/50 px-2 py-1 text-[11px] font-medium text-emerald-200 hover:bg-emerald-900/50"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => approveTask(false)}
              className="flex-1 rounded-lg border border-white/15 px-2 py-1 text-[11px] text-white/70 hover:bg-white/[0.06]"
            >
              Deny
            </button>
          </div>
        </div>
      )}

      {view.terminal && (
        <p className="border-t border-white/[0.07] px-3.5 py-2.5 text-[11px] leading-snug text-white/75">{view.summary}</p>
      )}
    </div>
  );
}
