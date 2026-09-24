/**
 * HUD — the little chrome that frames the substance.
 * Top-left brand, top-right health dot + settings, identity copy beneath
 * Sophia, the bottom-right voice dock, and the bottom-centre orb dock pad
 * that receives the mini-orb when content owns the centre stage.
 */

import { Settings } from 'lucide-react';
import { useEffect, useState, type RefObject } from 'react';
import { controlLayer } from '../sophia/control';
import type { StageLayout } from '../sophia/layout';
import type { SophiaStateName } from '../sophia/types';

export function Brand() {
  return (
    <header className="pointer-events-none absolute left-7 top-7 z-10 select-none sm:left-11 sm:top-9">
      <p className="text-[11px] font-light tracking-[0.34em] text-white/[0.88]">SAMJUNIORS OS</p>
      <p className="mt-[7px] text-[9.5px] font-light tracking-[0.44em] text-[#9aa5ff]/[0.72]">SOPHIA</p>
    </header>
  );
}

const HEALTH_META: Record<'ok' | 'warn' | 'error', { color: string; label: string }> = {
  ok: { color: '#2fe6a0', label: 'all systems working' },
  warn: { color: '#ffab4a', label: 'degraded — voice link connecting or offline' },
  error: { color: '#ff5468', label: 'problem — missing key, mic denied, voice backend or renderer failed' },
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
    <div className="absolute right-7 top-[26px] z-10 flex items-center gap-[24px] sm:right-11 sm:top-[30px]">
      <span
        title={meta.label}
        role="status"
        aria-label={`System health: ${meta.label}`}
        className={`block size-[7px] rounded-full transition-colors duration-700 ${active && health === 'ok' ? 'status-breathe' : ''} ${health === 'error' ? 'status-alert' : ''}`}
        style={{ background: meta.color, boxShadow: `0 0 10px 2px ${meta.color}66` }}
      />
      <button
        type="button"
        aria-label="Settings"
        aria-expanded={settingsOpen}
        onClick={onSettings}
        className="grid size-[32px] place-items-center text-white/60 transition-all duration-300 hover:text-white hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.45)] focus-visible:outline-none focus-visible:text-white"
      >
        <Settings size={18} strokeWidth={1.5} />
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
      className={`pointer-events-none absolute left-0 right-0 z-10 select-none px-6 text-center transition-opacity duration-500 ${
        docked ? 'opacity-0' : 'opacity-100'
      }`}
      style={{ top }}
    >
      <span className={`identity-rule mx-auto block h-px w-[30px] ${state === 'completed' ? 'identity-rule-done' : ''}`} />
      <h1 className="mt-[20px] text-[clamp(23px,2.05vw,31px)] font-extralight tracking-[0.1em] text-white/[0.93]">
        I’m Sophia.
      </h1>
      <p className="mt-[15px] text-[clamp(9.5px,0.8vw,11.5px)] font-light tracking-[0.4em] text-[#b3bcff]/[0.72]">
        [ ALWAYS WITH YOU ]
      </p>
      <p
        aria-live="polite"
        className={`mx-auto mt-[22px] max-w-[min(60ch,80vw)] truncate text-[10.5px] font-light tracking-[0.18em] transition-opacity duration-500 ${
          active ? 'opacity-100' : 'opacity-0'
        } ${state === 'completed' ? 'text-emerald-300/80' : 'text-white/45'}`}
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
  const micLabel = paused
    ? 'Sophia is paused — tap to wake'
    : micError
      ? 'Voice offline — tap to retry'
      : state === 'ambient' || state === 'idle'
        ? 'Talk to Sophia'
        : state === 'speaking' || state === 'thinking'
          ? 'Interrupt Sophia'
          : 'Listening — tap to pause';

  const showChat = audioAvailable === false || micError === true;

  return (
    <div className="absolute bottom-[44px] right-7 z-10 flex items-center gap-[20px] sm:bottom-[52px] sm:right-11">
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

      {/* Main Microphone — enabled / live / paused / error, all clickable */}
      <button
        ref={micRef}
        type="button"
        aria-label={micLabel}
        aria-pressed={on}
        title={micLabel}
        onClick={onMic}
        className={`mic-ring relative grid size-[48px] place-items-center transition-transform duration-150 ease-out active:scale-[0.96] focus-visible:outline-none ${
          micError ? 'mic-error' : paused ? 'mic-paused' : on ? 'mic-on' : 'mic-off'
        }`}
      >
        {on && !paused && !micError && <span className="mic-pulse" aria-hidden="true" />}
        <span className="relative grid size-[22px] place-items-center">
          <span className={`mic-glyph ${paused || micError ? 'opacity-0 scale-[0.25] blur-[4px]' : 'opacity-100 scale-100'}`}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5.6 11.5a6.4 6.4 0 0 0 12.8 0" />
              <path d="M12 18v3M9 21h6" />
            </svg>
          </span>
          <span className={`mic-glyph absolute inset-0 ${paused && !micError ? 'opacity-100 scale-100' : 'opacity-0 scale-[0.25] blur-[4px]'}`}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5.6 11.5a6.4 6.4 0 0 0 12.8 0" />
              <path d="M12 18v3M9 21h6" />
              <line x1="4" y1="4" x2="20" y2="20" />
            </svg>
          </span>
          <span className={`mic-glyph absolute inset-0 ${micError ? 'opacity-100 scale-100' : 'opacity-0 scale-[0.25] blur-[4px]'}`}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5.6 11.5a6.4 6.4 0 0 0 12.8 0" />
              <path d="M12 18v3M9 21h6" />
              <line x1="4" y1="4" x2="20" y2="20" />
            </svg>
          </span>
        </span>
        {micError && (
          <span className="status-alert absolute right-0.5 top-0.5 block size-[7px] rounded-full bg-rose-500 shadow-[0_0_8px_2px_rgba(244,63,94,0.7)]" />
        )}
        {paused && !micError && (
          <span className="absolute right-0.5 top-0.5 block size-[7px] rounded-full bg-amber-400/90 shadow-[0_0_8px_2px_rgba(251,191,36,0.55)]" />
        )}
      </button>
    </div>
  );
}
