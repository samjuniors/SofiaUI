/**
 * ui/OrbOverlay.tsx — the compact desktop orb window (`?orb=1`).
 *
 * A frameless 232×96 always-on-top companion: live state dot, mic button
 * (relayed to the main window), and an expand button. Speaks to the main
 * window only through the `sophiaDesktop` bridge — never boots the full OS.
 */

import { useEffect, useState } from 'react';
import type { MainStateBroadcast } from '../types/desktop';

const STATE_COLORS: Record<string, string> = {
  idle: '#64748b',
  ambient: '#64748b',
  listening: '#38bdf8',
  thinking: '#a78bfa',
  speaking: '#34d399',
  rendering: '#f472b6',
  paused: '#fbbf24',
  completed: '#34d399',
  blocked: '#f87171',
  wakeup: '#fbbf24',
  focusing: '#38bdf8',
  transforming: '#a78bfa',
};

export function OrbOverlay() {
  const [broadcast, setBroadcast] = useState<MainStateBroadcast>({ state: 'idle', status: 'idle' });
  const bridge = typeof window !== 'undefined' ? window.sophiaDesktop : undefined;

  useEffect(() => {
    const b = window.sophiaDesktop;
    if (!b) return;
    return b.onMainState((s) => {
      if (s && typeof s.state === 'string') setBroadcast({ state: s.state, status: String(s.status ?? '') });
    });
  }, []);

  const color = STATE_COLORS[broadcast.state] ?? '#38bdf8';

  return (
    <div
      className="font-sophia fixed inset-0 flex select-none items-center gap-3 overflow-hidden rounded-2xl border border-white/10 bg-[#04060f]/85 px-3 text-white backdrop-blur-xl"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Live state dot */}
      <span className="relative grid size-11 shrink-0 place-items-center">
        <span
          className="absolute inset-0 rounded-full"
          style={{ background: `radial-gradient(circle, ${color}55 0%, transparent 70%)` }}
        />
        <span
          className="block size-4 rounded-full transition-colors duration-300"
          style={{ background: color, boxShadow: `0 0 12px 2px ${color}` }}
        />
      </span>

      <div className="min-w-0 flex-1 leading-tight">
        <p className="text-[11px] font-medium tracking-[0.18em] text-white/90">SOFIA</p>
        <p className="truncate font-mono text-[9px] text-white/45">
          {broadcast.state}
          {broadcast.status === 'live' ? ' · live' : ''}
        </p>
      </div>

      {/* Mic relay */}
      <button
        type="button"
        aria-label="Talk to Sofia"
        title="Talk to Sofia"
        onClick={() => bridge?.sendOrbCommand({ action: 'mic' })}
        className="grid size-9 shrink-0 place-items-center rounded-full border border-sky-400/40 bg-sky-400/15 text-sky-200 transition hover:bg-sky-400/30 active:scale-95"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0" />
          <path d="M12 19v3" />
        </svg>
      </button>

      {/* Expand to full window */}
      <button
        type="button"
        aria-label="Open full Sofia window"
        title="Open full window"
        onClick={() => bridge?.showMain()}
        className="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/60 transition hover:bg-white/[0.1] hover:text-white active:scale-95"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 3h6v6" />
          <path d="M9 21H3v-6" />
          <path d="m21 3-7 7" />
          <path d="m3 21 7-7" />
        </svg>
      </button>
    </div>
  );
}
