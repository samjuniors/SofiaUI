/**
 * ui/TaskInsightsCard.tsx — Phase 36: task dashboard + frozen held-out score.
 *
 * TaskInsights reads the event-sourced analytics store (desktop mission
 * reports + orchestrated runs): success rate, average steps, cost per
 * task, memory assists, skills learned/retired, weekly trend, and the
 * trailing-window regression alarm. No records → the empty state, never
 * invented numbers.
 *
 * HeldoutCard reads the machine-local eval-heldout-report.json
 * (`npm run eval:heldout`) and reports the frozen battery separately.
 * No report → the rerun hint.
 */

import { useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck, Siren, TrendingUp } from 'lucide-react';
import { taskAnalytics, type WeekBucket } from '../core/task-analytics';
import { fetchReport, gradeFor, type ReliabilityReport } from '../lib/reliability';

export const HELDOUT_REPORT_URL = '/eval-heldout-report.json';

function useAnalyticsVersion(): void {
  const [, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV((n) => n + 1);
    taskAnalytics.addEventListener('change', bump);
    return () => taskAnalytics.removeEventListener('change', bump);
  }, []);
}

function money(usd: number): string {
  return `$${usd.toFixed(usd < 1 && usd > 0 ? 4 : 2)}`;
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">{label}</p>
      <p className="mt-0.5 font-mono text-base text-white/90">{value}</p>
      {sub && <p className="truncate text-[10px] font-light text-white/40">{sub}</p>}
    </div>
  );
}

const BAR: Record<string, string> = {
  great: 'bg-emerald-400',
  ok: 'bg-amber-400',
  bad: 'bg-red-400',
  none: 'bg-white/15',
};

function WeekRow({ week }: { week: WeekBucket }) {
  const g = gradeFor(week.rate === null ? null : Math.round(week.rate * 100));
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 font-mono text-[10px] text-white/45">{week.week}</span>
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${BAR[g]}`} style={{ width: `${(week.rate ?? 0) * 100}%` }} />
      </div>
      <span className="w-12 shrink-0 text-right font-mono text-[10px] text-white/70">
        {week.rate === null ? '—' : `${Math.round(week.rate * 100)}%`}
      </span>
      <span className="hidden w-24 shrink-0 text-right text-[10px] font-light text-white/35 sm:block">
        {week.done}/{week.total} · {money(week.costUsd)}
      </span>
    </div>
  );
}

export function TaskInsights() {
  useAnalyticsVersion();
  const s = taskAnalytics.snapshot();

  if (s.total === 0) {
    return (
      <div className="rounded-xl border border-white/10 p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-white/85">
          <TrendingUp size={13} /> Task insights
        </p>
        <p className="mt-1.5 text-[11px] font-light text-white/50">
          No tasks recorded yet. Run a desktop task or an <code className="font-mono text-white/70">orchestrate</code>{' '}
          goal and this board fills in — success rate, steps, cost, memory assists, and the weekly trend.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white/85">
        <TrendingUp size={13} /> Task insights
        <span className="ml-auto font-light text-white/40">
          {s.total} task{s.total === 1 ? '' : 's'} on this machine
        </span>
      </div>

      {s.alarm.raised ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-red-400/30 bg-red-400/10 px-2.5 py-2 text-[11px] text-red-200">
          <Siren size={13} className="mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold">Regression alarm.</span> {s.alarm.reason}
          </span>
        </p>
      ) : (
        <p className="mt-2 text-[10px] font-light text-white/35">{s.alarm.reason === 'within band' ? 'No regression — trailing 7 days within band.' : s.alarm.reason}</p>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric
          label="Success rate"
          value={s.rate === null ? '—' : `${Math.round(s.rate * 100)}%`}
          sub={`${s.done}/${s.total} done`}
        />
        <Metric label="Avg steps" value={s.avgSteps === null ? '—' : s.avgSteps.toFixed(1)} sub="per task" />
        <Metric label="Cost / task" value={money(s.costPerTask)} sub={`${money(s.totalCostUsd)} tracked total`} />
        <Metric label="Memory assists" value={String(s.memoryAssists)} sub="recalls + curations" />
        <Metric label="Skills learned" value={String(s.skillsLearned)} sub="ever seen" />
        <Metric label="Skills retired" value={String(s.skillsRetired)} sub="currently disabled" />
      </div>

      {s.weeks.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Weekly trend</p>
          {s.weeks.map((w) => (
            <WeekRow key={w.week} week={w} />
          ))}
        </div>
      )}
      <p className="mt-2 text-[10px] font-light text-white/30">
        Desktop brain calls are untracked — cost reflects orchestrated runs only.
      </p>
    </div>
  );
}

export function HeldoutCard() {
  const [report, setReport] = useState<ReliabilityReport | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchReport(HELDOUT_REPORT_URL).then((r) => {
      if (live) {
        setReport(r);
        setSeen(true);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  if (!seen) return null;

  if (!report) {
    return (
      <div className="rounded-xl border border-white/10 p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-white/85">
          <ShieldCheck size={13} /> Held-out battery
        </p>
        <p className="mt-1.5 text-[11px] font-light text-white/50">
          Not run on this machine yet. Run <code className="font-mono text-white/70">npm run eval:heldout</code> to
          score the 30 frozen tasks the self-improvement loop can never see.
        </p>
      </div>
    );
  }

  const g = gradeFor(report.summary.passRate);
  const when = new Date(report.generatedAt);
  return (
    <div className="rounded-xl border border-white/10 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white/85">
        <ShieldCheck size={13} /> Held-out battery
        <span className="ml-auto flex items-center gap-1 font-light text-white/40">
          <RefreshCw size={11} />
          {Number.isNaN(when.getTime()) ? report.generatedAt : when.toLocaleString()}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-white">{report.summary.passRate}%</span>
        <span className="text-[11px] font-light text-white/50">
          {report.summary.pass} pass · {report.summary.failed} fail · {report.summary.ran} ran
          {g === 'great' ? ' — frozen set green' : ' — needs attention'}
        </span>
      </div>
      {report.failures.length > 0 && (
        <p className="mt-2 truncate text-[10px] font-light text-red-200/70" title={report.failures.join(', ')}>
          Failing: {report.failures.join(', ')}
        </p>
      )}
      <p className="mt-2 text-[10px] font-light text-white/30">
        Reported separately — self-improve refuses held-out data by name, suite, and row.
      </p>
    </div>
  );
}
