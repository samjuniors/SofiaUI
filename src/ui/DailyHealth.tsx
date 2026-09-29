/**
 * ui/DailyHealth.tsx — PC-health card (Phase 4).
 *
 * Score ring, CPU/memory bars, disks, battery, top processes and warnings,
 * refreshing every 30s while mounted.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, Battery, BatteryCharging, Cpu, HardDrive, Loader2, MemoryStick, RotateCw } from 'lucide-react';
import {
  DailyError,
  defaultCaller as daily,
  healthProcesses,
  healthSnapshot,
  scoreColor,
  type HealthSnapshot,
  type ProcessInfo,
} from '../lib/daily-skills';

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />
    </div>
  );
}

export function DailyHealth() {
  const [snap, setSnap] = useState<HealthSnapshot | null>(null);
  const [procs, setProcs] = useState<ProcessInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    async function load() {
      setBusy(true);
      setError(null);
      try {
        const [s, p] = await Promise.all([healthSnapshot(daily), healthProcesses(daily, 6)]);
        if (!live) return;
        setSnap(s);
        setProcs(p);
      } catch (err) {
        if (live) setError(err instanceof DailyError ? err.message : 'Could not read PC health.');
      } finally {
        if (live) setBusy(false);
      }
    }
    void load();
    const t = setInterval(() => {
      if (!document.hidden) void load();
    }, 30000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  if (error && !snap) {
    return (
      <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-200">
        {error}
      </p>
    );
  }

  if (!snap) {
    return (
      <p className="flex items-center gap-1.5 px-1 py-3 text-[11px] text-white/40">
        <Loader2 size={12} className="animate-spin" /> Reading PC health…
      </p>
    );
  }

  const color = scoreColor(snap.score);
  const ring = 2 * Math.PI * 15.5;

  return (
    <div className="flex flex-col gap-2.5">
      {/* Score + meters */}
      <div className="flex items-center gap-3">
        <div className="relative grid size-[68px] shrink-0 place-items-center" role="img" aria-label={`Health score ${snap.score} of 100`}>
          <svg viewBox="0 0 36 36" className="absolute inset-0 size-full -rotate-90">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              stroke={color}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${(snap.score / 100) * ring} ${ring}`}
              className="transition-all duration-500"
            />
          </svg>
          <div className="text-center">
            <p className="text-base font-semibold leading-none text-white" style={{ textShadow: `0 0 12px ${color}66` }}>
              {snap.score}
            </p>
            <p className="text-[8px] uppercase tracking-wider text-white/45">health</p>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-[11px]">
            <Cpu size={12} className="shrink-0 text-sky-300/80" />
            <span className="w-14 shrink-0 text-white/55">CPU · {snap.cpu.cores}c</span>
            <Bar pct={snap.cpu.loadPct} color="#38bdf8" />
            <span className="w-8 shrink-0 text-right text-white/75">{snap.cpu.loadPct}%</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <MemoryStick size={12} className="shrink-0 text-violet-300/80" />
            <span className="w-14 shrink-0 text-white/55">RAM · {snap.memory.totalGB}G</span>
            <Bar pct={snap.memory.usedPct} color="#a78bfa" />
            <span className="w-8 shrink-0 text-right text-white/75">{snap.memory.usedPct}%</span>
          </div>
          <p className="text-[10px] capitalize text-white/40">
            {snap.platform} · up {snap.uptime.human}
          </p>
        </div>
        <button
          type="button"
          aria-label="Refresh health"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void Promise.all([healthSnapshot(daily), healthProcesses(daily, 6)])
              .then(([s, p]) => {
                setSnap(s);
                setProcs(p);
                setError(null);
              })
              .catch((err: unknown) => setError(err instanceof DailyError ? err.message : 'Refresh failed.'))
              .finally(() => setBusy(false));
          }}
          className="shrink-0 rounded-md border border-white/10 bg-white/5 p-1.5 text-white/60 transition-colors hover:text-white disabled:opacity-50"
        >
          <RotateCw size={12} className={busy ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Warnings */}
      {snap.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1.5">
          {snap.warnings.map((w) => (
            <p key={w} className="flex items-start gap-1.5 text-[11px] text-amber-200">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {w}
            </p>
          ))}
        </div>
      )}

      {/* Disks + battery */}
      <div className="grid grid-cols-1 gap-1.5">
        {snap.disks.map((d) => (
          <div key={d.mount} className="flex items-center gap-1.5 text-[11px]">
            <HardDrive size={12} className="shrink-0 text-white/40" />
            <span className="w-16 shrink-0 truncate text-white/55">{d.mount}</span>
            <Bar pct={100 - d.pctFree} color={d.pctFree < 10 ? '#f87171' : '#34d399'} />
            <span className="shrink-0 text-white/75">{d.freeGB}G free</span>
          </div>
        ))}
        {snap.battery && (
          <div className="flex items-center gap-1.5 text-[11px] text-white/70">
            {snap.battery.charging ? <BatteryCharging size={12} className="text-emerald-300" /> : <Battery size={12} className="text-white/40" />}
            Battery {snap.battery.level}%{snap.battery.charging ? ' · charging' : ''}
          </div>
        )}
      </div>

      {/* Top processes */}
      {procs.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5">
          <p className="px-1 pb-1 text-[10px] uppercase tracking-wide text-white/40">Top memory</p>
          <ul className="flex flex-col gap-0.5">
            {procs.map((p) => (
              <li key={p.name} className="flex items-center gap-2 px-1 text-[11px]">
                <span className="min-w-0 flex-1 truncate text-white/70">{p.name}</span>
                <span className="shrink-0 text-white/45">{p.memMB >= 1024 ? `${(p.memMB / 1024).toFixed(1)} GB` : `${Math.round(p.memMB)} MB`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
