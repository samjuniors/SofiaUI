/**
 * ui/ModeToggle.tsx — global Cloud/Auto/Offline switch (Phase 32).
 *
 * Slim segmented control bound to the run-mode store, with a status pill that
 * shows the AUTO-TRIPPED state when Auto has taken the session offline after
 * repeated cloud failures. Lives in the dashboard header and Ear & Mouth.
 */
import { Cloud, Plane, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { runMode, type RunMode } from '../lib/run-mode.ts';

const OPTIONS: Array<{ id: RunMode; label: string; hint: string; Icon: typeof Cloud }> = [
  { id: 'auto', label: 'Auto', hint: 'Cloud first, offline fallback', Icon: Sparkles },
  { id: 'cloud', label: 'Cloud', hint: 'Always cloud (fails loudly)', Icon: Cloud },
  { id: 'offline', label: 'Offline', hint: 'Never touch the cloud', Icon: Plane },
];

export function ModeToggle({ compact = false }: { compact?: boolean }) {
  const [mode, setMode] = useState<RunMode>(() => runMode.getMode());
  const [tripped, setTripped] = useState(() => runMode.autoTripped);
  useEffect(
    () =>
      runMode.subscribe(() => {
        setMode(runMode.getMode());
        setTripped(runMode.autoTripped);
      }),
    [],
  );
  const offline = mode === 'offline' || tripped;
  const status = tripped ? 'Auto · offline' : mode === 'offline' ? 'Offline' : mode === 'cloud' ? 'Cloud' : 'Auto';
  return (
    <div className="flex items-center gap-2">
      <div
        className="grid grid-cols-3 gap-0.5 rounded-lg border border-white/10 bg-black/30 p-0.5"
        role="radiogroup"
        aria-label="Run mode"
      >
        {OPTIONS.map(({ id, label, hint, Icon }) => {
          const active = mode === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              title={hint}
              onClick={() => runMode.setMode(id)}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                active
                  ? id === 'offline'
                    ? 'bg-amber-500/25 text-amber-100'
                    : id === 'cloud'
                      ? 'bg-sky-500/25 text-sky-100'
                      : 'bg-emerald-500/25 text-emerald-100'
                  : 'text-white/45 hover:bg-white/[0.06] hover:text-white'
              }`}
            >
              <Icon size={11} />
              {!compact || active ? label : null}
            </button>
          );
        })}
      </div>
      <span
        className="flex items-center gap-1 text-[10px] text-white/50"
        title={
          tripped
            ? 'Auto tripped offline after repeated cloud failures — tap Auto again to retry the cloud'
            : (OPTIONS.find((o) => o.id === mode)?.hint ?? '')
        }
      >
        <span
          aria-hidden="true"
          className={`size-1.5 rounded-full ${offline ? 'bg-amber-400' : 'bg-emerald-400'}`}
        />
        {status}
      </span>
    </div>
  );
}
