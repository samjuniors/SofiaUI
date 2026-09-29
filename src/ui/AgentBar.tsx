/**
 * ui/AgentBar.tsx — Phase 22: the persistent "Sofia is driving" strip.
 *
 * While any agent task is live it pins a strip to the top of the screen:
 * a pulsing indicator, the goal, the current step in plain words, and a
 * big red Stop. Escape stops too (voice "stop" already barges in via
 * ControlLayer.tryDirectCommand). One bar no matter how many tasks run —
 * multi-task is rare, the newest task owns the headline.
 */

import { useEffect, useState } from 'react';
import { OctagonX, PauseCircle } from 'lucide-react';
import { taskEvents } from '../core/TaskLoop.ts';
import { cancelTask } from '../tools/task-tool.ts';
import { companion } from '../lib/companion-client.ts';

const TERMINAL = new Set(['done', 'failed', 'cancelled']);
const LIVE = new Set(['started', 'decided', 'step', 'retry', 'verified', 'paused', 'preview']);

interface TaskHeadline {
  id: string;
  goal: string;
  label: string;
  paused: boolean;
  question: string;
}

interface TaskDetail {
  id: string;
  phase: string;
  goal?: string;
  label?: string;
  question?: string;
  dismissed?: boolean;
}

export function AgentBar() {
  const [tasks, setTasks] = useState(() => new Map<string, TaskHeadline>());
  const [paired, setPaired] = useState(companion.status === 'connected');

  useEffect(() => {
    const onTask = (e: Event) => {
      const d = (e as CustomEvent).detail as TaskDetail;
      if (!d || typeof d.id !== 'string') return;
      setTasks((prev) => {
        const next = new Map(prev);
        if (TERMINAL.has(d.phase)) {
          next.delete(d.id);
          return next;
        }
        if (!LIVE.has(d.phase)) return prev;
        if (d.phase === 'preview' && d.dismissed === true) {
          const cur = next.get(d.id);
          if (cur) next.set(d.id, { ...cur, paused: false, question: '' });
          return next;
        }
        const cur = next.get(d.id) ?? {
          id: d.id,
          goal: '',
          label: 'starting…',
          paused: false,
          question: '',
        };
        next.set(d.id, {
          ...cur,
          goal: typeof d.goal === 'string' && d.goal ? d.goal : cur.goal,
          label:
            d.phase === 'step' && typeof d.label === 'string' && d.label
              ? d.label
              : d.phase === 'decided' && typeof d.label === 'string' && d.label && cur.label === 'starting…'
                ? d.label
                : cur.label,
          paused: d.phase === 'paused' || d.phase === 'preview' ? true : d.phase === 'step' ? false : cur.paused,
          question: typeof d.question === 'string' ? d.question : cur.question,
        });
        return next;
      });
    };
    const onKey = (e: KeyboardEvent) => {
      // Escape stops the agent. Inputs keep their own Esc behaviour.
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.defaultPrevented) return;
      // A dialog owns Esc while open (the receipts panel closes itself) —
      // Esc must never stop a task as a side effect of dismissing UI.
      if (document.querySelector('[role="dialog"]')) return;
      cancelTask();
    };
    const onStatus = () => setPaired(companion.status === 'connected');
    taskEvents.addEventListener('task:state', onTask);
    companion.addEventListener('status', onStatus);
    window.addEventListener('keydown', onKey);
    return () => {
      taskEvents.removeEventListener('task:state', onTask);
      companion.removeEventListener('status', onStatus);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const list = [...tasks.values()];
  if (list.length === 0) return null;
  const head = list[list.length - 1];

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`fixed left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-red-400/40 bg-[#160a10]/95 py-2 pl-4 pr-2 shadow-2xl backdrop-blur-md ${
        paired ? 'top-3' : 'top-16'
      }`}
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold tracking-wide text-red-100">
          Agent is controlling your PC{list.length > 1 ? ` (${list.length} tasks)` : ''}
        </p>
        <p className="truncate text-[11px] text-white/70" title={head.question || head.label}>
          {head.paused ? <PauseCircle size={12} className="mr-1 inline text-amber-300" /> : null}
          {head.paused && head.question ? head.question : head.label}
          {head.goal ? <span className="text-white/40"> — “{head.goal}”</span> : null}
        </p>
      </div>
      <button
        type="button"
        onClick={() => cancelTask()}
        title="Stop the agent now (Esc, or say “stop”)"
        className="flex shrink-0 items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-[12px] font-bold uppercase tracking-wider text-white shadow-lg shadow-red-900/50 transition hover:bg-red-500 active:scale-95"
      >
        <OctagonX size={15} />
        Stop
      </button>
    </div>
  );
}
