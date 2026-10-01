/**
 * ui/ReliabilityCard.tsx — Phase 30: per-app reliability from the eval suite.
 *
 * Reads the machine-local `eval-report.json` (`npm run eval:report`) and
 * shows the overall pass rate plus one row per app. Apps that didn't run
 * here (e.g. desktop apps on a headless box) show "not run", never 0%.
 * No report → the rerun hint, never invented numbers.
 */

import { useEffect, useState } from 'react';
import { Gauge, RefreshCw } from 'lucide-react';
import { fetchReport, gradeFor, type ReliabilityReport } from '../lib/reliability';

const BAR: Record<string, string> = {
  great: 'bg-emerald-400',
  ok: 'bg-amber-400',
  bad: 'bg-red-400',
  none: 'bg-white/15',
};

function Row({ app, rate, pass, fail, skip }: { app: string; rate: number | null; pass: number; fail: number; skip: number }) {
  const g = gradeFor(rate);
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 truncate text-[11px] font-light text-white/70">{app}</span>
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${BAR[g]}`} style={{ width: `${rate ?? 0}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right text-[11px] font-semibold text-white/85">
        {rate === null ? <span className="font-light text-white/40">not run</span> : `${rate}%`}
      </span>
      <span className="hidden w-20 shrink-0 text-right text-[10px] font-light text-white/35 sm:block">
        {pass}✓ {fail > 0 ? `${fail}✗ ` : ''}{skip > 0 ? `${skip}–` : ''}
      </span>
    </div>
  );
}

export function ReliabilityCard() {
  const [report, setReport] = useState<ReliabilityReport | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchReport().then((r) => {
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
          <Gauge size={13} /> Reliability per app
        </p>
        <p className="mt-1.5 text-[11px] font-light text-white/50">
          No eval report on this machine yet. Run{' '}
          <code className="font-mono text-white/70">npm run eval:report</code> to score every app, then reopen
          Diagnostics.
        </p>
      </div>
    );
  }

  const g = gradeFor(report.summary.passRate);
  const when = new Date(report.generatedAt);
  return (
    <div className="rounded-xl border border-white/10 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white/85">
        <Gauge size={13} /> Reliability per app
        <span className="ml-auto flex items-center gap-1 font-light text-white/40">
          <RefreshCw size={11} />
          {Number.isNaN(when.getTime()) ? report.generatedAt : when.toLocaleString()} · {report.suite} ·{' '}
          {report.platform}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-white">{report.summary.passRate}%</span>
        <span className="text-[11px] font-light text-white/50">
          {report.summary.pass} pass · {report.summary.failed} fail · {report.summary.skip} skip
          {g === 'great' ? ' — all green' : g === 'ok' ? ' — mostly green' : g === 'bad' ? ' — needs attention' : ''}
        </span>
      </div>
      <div className="mt-2 space-y-1.5">
        {report.apps.map((a) => (
          <Row key={a.app} app={a.app} rate={a.rate} pass={a.pass} fail={a.fail} skip={a.skip} />
        ))}
      </div>
      {report.failures.length > 0 && (
        <p className="mt-2 truncate text-[10px] font-light text-red-200/70" title={report.failures.join(', ')}>
          Failing: {report.failures.join(', ')}
        </p>
      )}
    </div>
  );
}
