/**
 * ui/LatencyCard.tsx — voice-to-voice latency vs the 800 ms budget.
 *
 * Lives in Diagnostics; fills in as modular + local turns complete.
 */
import { useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';
import {
  VOICE_LATENCY_BUDGET_MS,
  latencyMeter,
  type LatencyStats,
} from '../core/LatencyMeter';

function Cell({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-black/40 p-1.5">
      <p className="text-[7.5px] text-white/40">{label}</p>
      <p className={`truncate font-mono text-[11px] ${accent ?? 'text-white/90'}`}>{value}</p>
    </div>
  );
}

export function LatencyCard() {
  const [stats, setStats] = useState<LatencyStats>(() => latencyMeter.stats());
  const [samples, setSamples] = useState(() => latencyMeter.snapshot());

  useEffect(() => latencyMeter.subscribe(() => {
    setStats(latencyMeter.stats());
    setSamples(latencyMeter.snapshot());
  }), []);

  const last = samples.length > 0 ? samples[samples.length - 1] : null;
  const recent = samples.slice(-12);
  const scale = Math.max(VOICE_LATENCY_BUDGET_MS * 1.25, ...recent.map((s) => s.voiceMs));
  const passRate = stats.count > 0 ? Math.round((100 * stats.withinBudget) / stats.count) : 0;

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gauge size={15} className="text-sky-400" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-white/80">
            Voice-to-Voice Latency
          </span>
        </div>
        <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-2 py-0.5 font-mono text-[8.5px] uppercase tracking-wider text-sky-200">
          {VOICE_LATENCY_BUDGET_MS} ms budget
        </span>
      </div>

      {stats.count === 0 ? (
        <p className="mt-2.5 text-[9px] leading-relaxed text-white/45">
          No measured turns yet — speak to Sofia and the meter fills in.
          Modular cloud + local turns only; the Live bidi stream reports no
          turn boundaries.
        </p>
      ) : (
        <>
          <div className="mt-2.5 flex items-end justify-between">
            <div>
              <p className="font-mono text-2xl leading-none text-white">
                {stats.lastMs}
                <span className="ml-1 text-[10px] text-white/40">ms</span>
              </p>
              <p className="mt-1 font-mono text-[8.5px] text-white/45">
                last turn · {last?.route} · brain {last?.brainMs}ms + mouth {last?.ttsMs}ms
              </p>
            </div>
            <span
              className={`rounded-full border px-2 py-0.5 font-mono text-[8.5px] uppercase tracking-wider ${
                last?.withinBudget
                  ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-300'
                  : 'border-rose-500/40 bg-rose-500/20 text-rose-300'
              }`}
            >
              {last?.withinBudget ? 'within' : 'over'}
            </span>
          </div>

          <div className="mt-2.5 grid grid-cols-4 gap-2 font-mono text-white/60">
            <Cell label="AVG" value={`${stats.avgMs}ms`} />
            <Cell label="P50" value={`${stats.p50Ms}ms`} />
            <Cell label="BEST" value={`${stats.bestMs}ms`} accent="text-emerald-300" />
            <Cell label="HITS" value={`${stats.withinBudget}/${stats.count}`} accent={passRate >= 80 ? 'text-emerald-300' : 'text-amber-300'} />
          </div>

          {/* Recent-turn sparkline with the budget line */}
          <div className="relative mt-2.5 h-10">
            <div
              aria-hidden="true"
              className="absolute left-0 right-0 border-t border-dashed border-white/25"
              style={{ top: `${100 - (100 * VOICE_LATENCY_BUDGET_MS) / scale}%` }}
            />
            <div className="absolute inset-0 flex items-end gap-1">
              {recent.map((s, i) => (
                <div
                  key={`${s.at}-${i}`}
                  title={`${s.voiceMs}ms · ${s.route}`}
                  className={`min-w-0 flex-1 rounded-sm ${s.withinBudget ? 'bg-emerald-400/70' : 'bg-rose-400/80'}`}
                  style={{ height: `${Math.max(8, (100 * s.voiceMs) / scale)}%` }}
                />
              ))}
            </div>
          </div>
          <p className="mt-1 text-right font-mono text-[7.5px] text-white/35">
            dashed line = {VOICE_LATENCY_BUDGET_MS}ms budget
          </p>
        </>
      )}
    </div>
  );
}
