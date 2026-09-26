/**
 * SofiaStatusPill — Real-time activity indicator pill for Sofia.
 * Displays Sofia's active state (listening, thinking, speaking, rendering, etc.)
 * with an emerald green active indicator dot, matching the user's design.
 */

import type { SophiaStateName } from '../sophia/types';

const STATE_MESSAGES: Record<SophiaStateName, string> = {
  listening: 'Listening to you...',
  thinking: 'Thinking...',
  speaking: 'Speaking...',
  rendering: 'Rendering...',
  focusing: 'Focusing...',
  wakeup: 'Waking up...',
  transforming: 'Transforming...',
  completed: 'Ready',
  blocked: 'Waiting for permission...',
  idle: 'Listening to you...',
  ambient: 'Listening to you...',
  pause: 'Paused',
  paused: 'Paused',
};

export interface SofiaStatusPillProps {
  state: SophiaStateName;
  paused?: boolean;
  onClick?: () => void;
  className?: string;
}

export function SofiaStatusPill({
  state,
  paused = false,
  onClick,
  className = '',
}: SofiaStatusPillProps) {
  const isPaused = paused || state === 'paused' || state === 'pause';
  const text = isPaused ? 'Paused' : STATE_MESSAGES[state] || 'Active';

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={onClick}
      title={
        isPaused
          ? 'Sofia is paused · Click to resume'
          : `Sofia is active · ${text} · Click to pause`
      }
      className={`group flex select-none items-center gap-2.5 rounded-full border border-white/[0.12] bg-[#0c1017]/85 px-3.5 py-1.5 shadow-[0_4px_18px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md transition-all duration-300 ${
        onClick
          ? 'cursor-pointer hover:border-white/25 hover:bg-[#0c1017]/95 hover:shadow-[0_4px_22px_rgba(16,185,129,0.15)] active:scale-[0.98]'
          : ''
      } ${className}`}
    >
      {/* Green active indicator dot with breathing glow */}
      <div className="relative flex size-2.5 items-center justify-center">
        {!isPaused && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/40 opacity-75 duration-1000" />
        )}
        <span
          className={`relative inline-flex size-2 rounded-full transition-all duration-300 ${
            isPaused
              ? 'bg-amber-400/80 shadow-[0_0_6px_#fbbf24]'
              : 'bg-emerald-400 shadow-[0_0_8px_#34d399] status-breathe'
          }`}
        />
      </div>

      {/* Sofia Brand Name */}
      <span className="text-[13px] font-semibold tracking-normal text-white">
        Sofia
      </span>

      {/* Subtle vertical separator */}
      <span className="h-3.5 w-px bg-white/20" aria-hidden="true" />

      {/* Real-time State Description */}
      <span className="max-w-[130px] truncate text-[12px] font-normal tracking-wide text-white/70 transition-all duration-200 sm:max-w-none">
        {text}
      </span>
    </div>
  );
}
