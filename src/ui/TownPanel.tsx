/**
 * ui/TownPanel.tsx — Agent Town's shared task board (Phase 5 Theatre).
 *
 * Iris, Vera, Atlas & Forge claim chores, work them to done, and narrate
 * the standup below. The town runs while the Theatre is open.
 */
import { useEffect, useState } from 'react';
import { ListTodo, Pause, Play, Plus, RotateCcw, ScrollText } from 'lucide-react';
import {
  TOWN_AGENTS,
  agentTown,
  type AgentId,
  type TownSnapshot,
  type TownTask,
} from '../core/AgentTown';

function AgentCard({ id, snap }: { id: AgentId; snap: TownSnapshot }) {
  const agent = TOWN_AGENTS.find((a) => a.id === id)!;
  const job = snap.tasks.find((t) => t.state === 'doing' && t.agent === id);
  const pct = job ? Math.round((100 * job.progress) / job.effort) : 0;
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5">
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: agent.color, boxShadow: `0 0 8px ${agent.color}` }}
        />
        <p className="text-[11px] font-semibold text-white/90">{agent.name}</p>
        <p className="text-[10px] text-white/40">{agent.role}</p>
        {job && <p className="ml-auto text-[10px] tabular-nums text-white/50">{pct}%</p>}
      </div>
      {job ? (
        <div className="mt-1">
          <p className="truncate text-[10px] text-white/60">{job.title}</p>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: agent.color }}
            />
          </div>
        </div>
      ) : (
        <p className="mt-1 truncate text-[10px] italic text-white/35">Idle — sipping tea.</p>
      )}
    </div>
  );
}

function TaskRow({ task }: { task: TownTask }) {
  const agent = TOWN_AGENTS.find((a) => a.id === task.agent);
  return (
    <li
      className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] ${
        task.state === 'done' ? 'text-white/40 line-through' : 'text-white/75'
      }`}
    >
      {agent ? (
        <span
          aria-hidden="true"
          title={agent.name}
          className="size-1.5 shrink-0 rounded-full"
          style={{ background: agent.color }}
        />
      ) : (
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-white/20" />
      )}
      <span className="min-w-0 flex-1 truncate">{task.title}</span>
      <span className="shrink-0 rounded bg-white/[0.06] px-1 py-px text-[9px] uppercase tracking-wide text-white/40">
        {task.tag}
      </span>
    </li>
  );
}

export function TownPanel() {
  const [snap, setSnap] = useState<TownSnapshot>(() => agentTown.snapshot());
  const [draft, setDraft] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    agentTown.start();
    const off = agentTown.subscribe(() => setSnap(agentTown.snapshot()));
    setSnap(agentTown.snapshot());
    return () => {
      off();
      agentTown.stop();
    };
  }, []);

  const backlog = snap.tasks.filter((t) => t.state === 'backlog');
  const doing = snap.tasks.filter((t) => t.state === 'doing');
  const done = snap.tasks.filter((t) => t.state === 'done').reverse();

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!draft.trim()) return;
    try {
      agentTown.addTask(draft);
      setDraft('');
    } catch {
      /* validated above */
    }
  }

  const column = (title: string, count: number, tasks: TownTask[], empty: string) => (
    <div className="min-w-0 flex-1">
      <p className="px-1 pb-1 text-[10px] uppercase tracking-wide text-white/40">
        {title} · {count}
      </p>
      <ul className="flex max-h-36 flex-col gap-0.5 overflow-y-auto rounded-lg border border-white/[0.07] bg-white/[0.02] p-1">
        {tasks.length === 0 && <li className="px-1 py-1 text-[10px] italic text-white/30">{empty}</li>}
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} />
        ))}
      </ul>
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      {/* Agents */}
      <div className="grid grid-cols-2 gap-1.5">
        {TOWN_AGENTS.map((a) => (
          <AgentCard key={a.id} id={a.id} snap={snap} />
        ))}
      </div>

      {/* Board */}
      <div>
        <div className="flex items-center gap-1.5 px-0.5 pb-1">
          <ListTodo size={12} className="text-sky-300/80" />
          <p className="flex-1 text-[10px] uppercase tracking-wide text-white/40">Shared board</p>
          <button
            type="button"
            aria-label={snap.paused ? 'Resume the town' : 'Pause the town'}
            onClick={() => (snap.paused ? agentTown.resume() : agentTown.pause())}
            className="rounded-md border border-white/10 bg-white/5 p-1 text-white/60 transition-colors hover:text-white"
          >
            {snap.paused ? <Play size={11} /> : <Pause size={11} />}
          </button>
          {confirmReset ? (
            <span className="flex items-center gap-1 text-[10px]">
              <button
                type="button"
                onClick={() => {
                  agentTown.reset();
                  setConfirmReset(false);
                }}
                className="rounded border border-rose-400/40 bg-rose-500/20 px-1.5 py-0.5 text-rose-100"
              >
                Reset
              </button>
              <button
                type="button"
                aria-label="Cancel reset"
                onClick={() => setConfirmReset(false)}
                className="rounded px-1 py-0.5 text-white/50 hover:text-white"
              >
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              aria-label="Reset the town"
              title="Reset the town"
              onClick={() => setConfirmReset(true)}
              className="rounded-md border border-white/10 bg-white/5 p-1 text-white/60 transition-colors hover:text-white"
            >
              <RotateCcw size={11} />
            </button>
          )}
        </div>
        <div className="flex gap-1.5">
          {column('Backlog', backlog.length, backlog, 'All clear.')}
          {column('Doing', doing.length, doing, 'Nobody working.')}
          {column('Done', done.length, done, 'Nothing yet.')}
        </div>
        {snap.paused && (
          <p className="pt-1 text-center text-[10px] italic text-amber-200/70">
            The town holds its breath — paused.
          </p>
        )}
      </div>

      {/* Add a chore */}
      <form onSubmit={submit} className="flex items-center gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Pin a chore to the board…"
          aria-label="New chore title"
          maxLength={80}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 focus:border-sky-400/50 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          aria-label="Add chore"
          className="rounded-lg border border-sky-400/40 bg-sky-500/20 p-2 text-sky-100 transition-colors hover:bg-sky-500/30 disabled:opacity-50"
        >
          <Plus size={13} />
        </button>
      </form>

      {/* Standup feed */}
      <div>
        <div className="flex items-center gap-1.5 px-0.5 pb-1">
          <ScrollText size={12} className="text-sky-300/80" />
          <p className="text-[10px] uppercase tracking-wide text-white/40">Standup</p>
        </div>
        <ul className="flex max-h-24 flex-col-reverse gap-0.5 overflow-y-auto rounded-lg border border-white/[0.07] bg-white/[0.02] p-1.5">
          {snap.log
            .slice(-8)
            .reverse()
            .map((l) => (
              <li key={l.id} className="truncate text-[10px] text-white/55">
                {l.text}
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}
