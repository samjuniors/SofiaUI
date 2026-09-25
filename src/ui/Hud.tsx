/**
 * HUD — the little chrome that frames the substance.
 * Top-left brand, top-right health dot + settings, identity copy beneath
 * Sophia, the bottom-right voice dock, and the bottom-centre orb dock pad
 * that receives the mini-orb when content owns the centre stage.
 */

import { Mic, MicOff, Settings } from 'lucide-react';
import { useEffect, useState, type RefObject } from 'react';
import { controlLayer } from '../sophia/control';
import type { StageLayout } from '../sophia/layout';
import type { SophiaStateName } from '../sophia/types';

export function Brand() {
  return (
    <header className="pointer-events-none absolute left-7 top-7 z-10 select-none sm:left-11 sm:top-9">
      <div className="flex items-center gap-2">
        <span className="block size-1.5 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.7)]" />
        <p className="text-[11px] font-normal tracking-[0.32em] text-white/90">SAMJUNIORS OS</p>
      </div>
      <p className="mt-[5px] pl-3.5 text-[9px] font-light tracking-[0.42em] text-sky-200/60">SOPHIA</p>
    </header>
  );
}

const HEALTH_META: Record<'ok' | 'warn' | 'error', { color: string; label: string }> = {
  ok: { color: '#2fe6a0', label: 'All systems operational' },
  warn: { color: '#ffab4a', label: 'Degraded — voice link connecting or offline' },
  error: { color: '#ff5468', label: 'Fault — missing key, mic denied, or renderer failed' },
};

export function StatusCluster({
  health,
  active,
  onSettings,
  settingsOpen,
}: {
  health: 'ok' | 'warn' | 'error';
  active: boolean;
  onSettings: () => void;
  settingsOpen: boolean;
}) {
  const meta = HEALTH_META[health];
  return (
    <div className="status-cluster absolute right-7 top-[26px] z-10 flex items-center gap-3 transition-all duration-500 sm:right-11 sm:top-[30px]">
      <div
        title={meta.label}
        role="status"
        aria-label={`System health: ${meta.label}`}
        className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 backdrop-blur-md transition-colors"
      >
        <span
          className={`block size-[6px] rounded-full transition-colors duration-500 ${active && health === 'ok' ? 'status-breathe' : ''} ${health === 'error' ? 'status-alert' : ''}`}
          style={{ background: meta.color, boxShadow: `0 0 8px 1px ${meta.color}88` }}
        />
        <span className="hidden font-mono text-[9px] uppercase tracking-wider text-white/45 sm:inline">
          {health === 'ok' ? 'Online' : health === 'warn' ? 'Checking' : 'Fault'}
        </span>
      </div>
      <button
        type="button"
        aria-label="Settings"
        aria-expanded={settingsOpen}
        onClick={onSettings}
        className={`grid size-[36px] place-items-center rounded-xl border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50 ${
          settingsOpen
            ? 'border-sky-400/40 bg-sky-400/15 text-sky-200 shadow-[0_0_12px_rgba(56,189,248,0.25)]'
            : 'border-white/[0.08] bg-white/[0.02] text-white/60 hover:border-white/20 hover:bg-white/[0.06] hover:text-white'
        }`}
      >
        <Settings size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
}

const STATE_WORD: Record<SophiaStateName, string> = {
  ambient: '',
  idle: 'IDLE',
  wakeup: 'WAKING',
  focusing: 'FOCUSING',
  listening: 'LISTENING',
  thinking: 'THINKING',
  speaking: 'SPEAKING',
  rendering: 'RENDERING',
  transforming: 'TRANSFORMING',
  pause: 'PAUSE',
  paused: 'PAUSE',
  completed: 'COMPLETED',
  blocked: 'BLOCKED',
};

function useLatestLine(state: SophiaStateName): string {
  const [line, setLine] = useState('');
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { role: string; text: string };
      if (d.role === 'system') return;
      setLine(d.text);
    };
    controlLayer.addEventListener('turn', on);
    return () => controlLayer.removeEventListener('turn', on);
  }, []);
  useEffect(() => {
    if (state === 'ambient') {
      const t = setTimeout(() => setLine(''), 900);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [state]);
  return line;
}

export function Identity({
  layout,
  state,
  docked,
}: {
  layout: StageLayout;
  state: SophiaStateName;
  docked: boolean;
}) {
  const line = useLatestLine(state);
  const active = state !== 'ambient';
  const top = layout.cy + layout.ringR + Math.max(10, Math.min(16, layout.R * 0.08));
  return (
    <section
      aria-label="Sophia"
      aria-hidden={docked}
      className={`identity-hud pointer-events-none absolute left-0 right-0 z-10 select-none px-6 text-center transition-all duration-500 ease-out ${
        docked ? 'opacity-0 translate-y-3' : 'opacity-100 translate-y-0'
      }`}
      style={{ top }}
    >
      <span className={`identity-rule mx-auto block h-px w-[32px] ${state === 'completed' ? 'identity-rule-done' : ''}`} />
      <h1 className="mt-[18px] text-[clamp(24px,2.2vw,33px)] font-extralight tracking-[0.08em] text-white/95">
        I’m Sophia.
      </h1>
      <p className="mt-[12px] text-[clamp(9.5px,0.8vw,11.5px)] font-light tracking-[0.38em] text-[#9cb5ff]/70">
        [ ALWAYS WITH YOU ]
      </p>
      <p
        aria-live="polite"
        className={`mx-auto mt-[18px] max-w-[min(60ch,80vw)] truncate text-[11px] font-normal tracking-[0.16em] transition-opacity duration-300 ${
          active ? 'opacity-100' : 'opacity-0'
        } ${state === 'completed' ? 'text-emerald-300' : 'text-white/45'}`}
      >
        {line || STATE_WORD[state]}
      </p>
    </section>
  );
}

/** Bottom-centre landing pad the mini-orb settles onto while content owns the stage. */
export function OrbDock({ visible, state }: { visible: boolean; state: SophiaStateName }) {
  return (
    <div
      aria-hidden={!visible}
      className={`orb-dock pointer-events-none absolute bottom-0 left-1/2 z-[5] -translate-x-1/2 transition-all duration-700 ${
        visible ? 'opacity-100' : 'translate-y-3 opacity-0'
      }`}
    >
      <div className="orb-dock-glow" />
      <div className="orb-dock-base" />
      <p className="orb-dock-label">{STATE_WORD[state] || 'SOPHIA'}</p>
    </div>
  );
}

export function Dock({
  state,
  micRef,
  onMic,
  onChat,
  chatOpen,
  paused,
  micError,
  audioAvailable,
  browserOpen,
  onToggleBrowser,
}: {
  state: SophiaStateName;
  micRef: RefObject<HTMLButtonElement | null>;
  onMic: () => void;
  onChat: () => void;
  chatOpen: boolean;
  paused: boolean;
  micError?: boolean;
  audioAvailable?: boolean;
  browserOpen?: boolean;
  onToggleBrowser?: () => void;
}) {
  const on = state !== 'ambient' && state !== 'paused' && state !== 'idle' && state !== 'completed';
  const isMicDisabled = paused || micError === true || audioAvailable === false;
  const micLabel = paused
    ? 'System paused · Click to enable microphone & resume'
    : micError
      ? 'Microphone disabled (missing backend keys) · Click to retry'
      : state === 'speaking' || state === 'thinking'
        ? 'Sophia is active · Click to pause system'
        : 'Microphone active · Click to pause system';

  const showChat = audioAvailable === false || micError === true;

  return (
    <div className="dock-cluster absolute bottom-[44px] right-7 z-10 flex items-center gap-[20px] transition-all duration-500 sm:bottom-[52px] sm:right-11">
      {/* Fullscreen Browser/Workspace launcher */}
      {onToggleBrowser && (
        <button
          type="button"
          aria-label={browserOpen ? 'Minimize workspace' : 'Open fullscreen workspace'}
          title="Fullscreen Workspace (Docks Sophia)"
          onClick={onToggleBrowser}
          className={`dock-btn ${browserOpen ? 'text-sky-300 drop-shadow-[0_0_12px_rgba(56,189,248,0.5)]' : ''}`}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
            <path d="M2 12h20" />
          </svg>
        </button>
      )}

      {/* Text fallback chat — ONLY visible when there is no audio available */}
      {showChat && (
        <button
          type="button"
          aria-label="Type to Sophia"
          aria-expanded={chatOpen}
          onClick={onChat}
          className={`dock-btn ${chatOpen ? 'text-sky-300 drop-shadow-[0_0_10px_rgba(56,189,248,0.5)]' : ''}`}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 14.5a2 2 0 0 1-2 2H9l-4.5 3.5V16.5H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
            <circle cx="8.6" cy="10.5" r="0.55" fill="currentColor" />
            <circle cx="12" cy="10.5" r="0.55" fill="currentColor" />
            <circle cx="15.4" cy="10.5" r="0.55" fill="currentColor" />
          </svg>
        </button>
      )}

      {/* Main Microphone Button — polished toggle for active vs paused/disabled system */}
      <button
        type="button"
        aria-label={micLabel}
        aria-pressed={!isMicDisabled}
        title={micLabel}
        onClick={onMic}
        className={`group relative grid size-[48px] place-items-center rounded-2xl border transition-all duration-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50 active:scale-95 ${
          micError
            ? 'border-rose-500/50 bg-rose-500/[0.20] text-rose-100 shadow-[0_0_18px_rgba(244,63,94,0.40),inset_0_1px_0_rgba(255,255,255,0.18)] hover:border-rose-400 hover:bg-rose-500/[0.30] hover:text-white'
            : paused
              ? 'border-white/[0.12] bg-white/[0.04] text-white/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:border-sky-400/40 hover:bg-white/[0.10] hover:text-white'
              : 'border-sky-400/40 bg-sky-500/[0.16] text-sky-100 shadow-[0_0_20px_rgba(56,189,248,0.38),inset_0_1px_0_rgba(255,255,255,0.22)] hover:border-sky-400/70 hover:bg-sky-500/[0.26] hover:text-white'
        }`}
      >
        {/* Error indicator dot */}
        {micError && (
          <span
            title="Microphone disabled"
            className="status-alert absolute -right-0.5 -top-0.5 block size-[8px] rounded-full bg-rose-500 shadow-[0_0_10px_2px_rgba(244,63,94,0.85)]"
          />
        )}

        {/* Live speaking/listening indicator halo dot when active and running */}
        {!isMicDisabled && on && (
          <span className="absolute -right-0.5 -top-0.5 block size-[8px] rounded-full bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.9)]" />
        )}

        <div className="relative z-10 transition-transform duration-300 group-hover:scale-110">
          {isMicDisabled ? (
            <MicOff
              size={22}
              strokeWidth={2.2}
              className={`transition-all duration-200 ${
                micError
                  ? 'text-white drop-shadow-[0_0_6px_rgba(244,63,94,0.6)]'
                  : 'text-white/60 group-hover:text-white'
              }`}
              aria-hidden="true"
            />
          ) : (
            <Mic
              size={22}
              strokeWidth={2.2}
              className="text-sky-200 transition-all duration-200 group-hover:scale-105 group-hover:text-white"
              aria-hidden="true"
            />
          )}
        </div>
      </button>
    </div>
  );
}
