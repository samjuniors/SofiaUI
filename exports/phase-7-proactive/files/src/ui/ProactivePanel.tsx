/**
 * ui/ProactivePanel.tsx — proactive routines (Phase 7).
 *
 * Health watch + morning briefing with toggles, last/next run and a
 * manual Run now. Lives in Settings → Proactive & Routines.
 */
import { useEffect, useState } from 'react';
import { BellRing, Loader2, MoonStar, Play } from 'lucide-react';
import {
  QUIET_END_MIN,
  QUIET_START_MIN,
  ambientScheduler,
  isQuietHours,
  type ProactiveRule,
  type RoutineStatus,
} from '../sophia/AmbientScheduler';

function ruleText(rule: ProactiveRule): string {
  if (rule.kind === 'daily') return `Daily at ${rule.timeOfDay}`;
  const mins = Math.round(rule.everyMs / 60000);
  if (mins < 60) return `Every ${mins}m`;
  const hours = mins / 60;
  return Number.isInteger(hours) ? `Every ${hours}h` : `Every ${hours.toFixed(1)}h`;
}

function ageAgo(ts: number | null): string {
  if (!ts) return 'never';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function nextHint(ts: number | null): string {
  if (!ts) return '';
  const diff = ts - Date.now();
  if (diff <= 0) return 'due';
  const m = Math.floor(diff / 60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.floor(h / 24)}d`;
}

function minsLabel(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function RoutineRow({ status, busy, onRun }: { status: RoutineStatus; busy: boolean; onRun: () => void }) {
  const { routine } = status;
  const on = status.enabled;
  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={`${on ? 'Disable' : 'Enable'} ${routine.label}`}
          disabled={busy}
          onClick={() => (on ? ambientScheduler.disable(routine.id) : ambientScheduler.enable(routine.id))}
          className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-200 disabled:opacity-50 ${
            on ? 'border-sky-400/50 bg-sky-400/30' : 'border-white/10 bg-white/5'
          }`}
        >
          <span
            className={`block size-3.5 rounded-full transition-transform duration-200 ${
              on ? 'translate-x-4 bg-sky-300' : 'translate-x-0.5 bg-white/40'
            }`}
          />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-white/85">{routine.label}</p>
          <p className="truncate text-[10px] text-white/40">
            {ruleText(routine.rule)} · ran {ageAgo(status.lastRunAt)}
            {on && status.nextRunAt ? ` · next ${nextHint(status.nextRunAt)}` : ''}
          </p>
        </div>
        <button
          type="button"
          aria-label={`Run ${routine.label} now`}
          title="Run now"
          disabled={busy || status.inFlight}
          onClick={onRun}
          className="rounded-md border border-white/10 bg-white/5 p-1.5 text-white/60 transition-colors hover:text-white disabled:opacity-50"
        >
          {busy || status.inFlight ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
        </button>
      </div>
      <p className="mt-1 text-[10px] leading-snug text-white/45">{routine.description}</p>
      {status.lastError && (
        <p role="alert" className="mt-1 truncate text-[10px] text-rose-300/90" title={status.lastError}>
          Last run failed: {status.lastError}
        </p>
      )}
    </div>
  );
}

export function ProactivePanel() {
  const [list, setList] = useState<RoutineStatus[]>(() => ambientScheduler.list());
  const [running, setRunning] = useState<string | null>(null);

  useEffect(() => {
    const onChange = () => setList(ambientScheduler.list());
    ambientScheduler.addEventListener('change', onChange);
    // Catch up once when the panel opens (cheap; schedule still applies).
    void ambientScheduler.tick().then(onChange);
    return () => ambientScheduler.removeEventListener('change', onChange);
  }, []);

  async function runNow(id: string) {
    setRunning(id);
    try {
      await ambientScheduler.runNow(id);
    } finally {
      setRunning(null);
      setList(ambientScheduler.list());
    }
  }

  const quiet = isQuietHours();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <BellRing size={12} className="text-sky-300/80" />
        <p className="flex-1 text-[9px] font-normal uppercase tracking-[0.24em] text-white/40">
          Routines
        </p>
      </div>

      {list.map((s) => (
        <RoutineRow key={s.routine.id} status={s} busy={running === s.routine.id} onRun={() => void runNow(s.routine.id)} />
      ))}

      <p className="flex items-center gap-1.5 text-[10px] leading-snug text-white/35">
        <MoonStar size={11} className="shrink-0" />
        Quiet {minsLabel(QUIET_START_MIN)}–{minsLabel(QUIET_END_MIN)}
        {quiet ? ' · quiet now, routines resume after' : ' · awake now'}.
        Health alerts fire only when something changes.
      </p>
    </div>
  );
}
