/**
 * settings/StatesSection.tsx — "Entity States (Simulation)".
 * Extracted verbatim from SettingsSheet (Phase 22 split).
 */

import { useState } from 'react';
import type { SophiaOS } from '../../sophia/SophiaOS';
import type { SophiaStateName } from '../../sophia/types';
import { AccordionSection } from './controls';

const STATE_OPTIONS: Array<{ id: SophiaStateName; label: string }> = [
  { id: 'idle', label: 'Idle' },
  { id: 'listening', label: 'Listen' },
  { id: 'thinking', label: 'Think' },
  { id: 'speaking', label: 'Speak' },
  { id: 'rendering', label: 'Render' },
  { id: 'wakeup', label: 'Wake Up' },
  { id: 'paused', label: 'Pause' },
  { id: 'completed', label: 'Complete' },
  { id: 'blocked', label: 'Blocked' },
];

export function StatesSection({
  os,
  state,
  isOpen,
  onToggle,
}: {
  os: SophiaOS;
  state: SophiaStateName;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  const triggerState = (st: SophiaStateName) => {
    if (st === 'wakeup') os.wakeUp('settings');
    else if (st === 'paused' || st === 'pause') os.pause();
    else {
      os.resume();
      os.state.setState(st, { reason: 'settings-trigger' });
    }
    rerender();
  };

  return (
    <AccordionSection
      title="Entity States (Simulation)"
      badge={state}
      isOpen={isOpen}
      onToggle={onToggle}
    >
      <p className="text-[8.5px] font-light text-white/40">
        Trigger states directly to preview audio reaction, halo pulsation, and physical morphs.
      </p>
      <div className="grid grid-cols-3 gap-1.5">
        {STATE_OPTIONS.map((st) => (
          <button
            key={st.id}
            type="button"
            onClick={() => triggerState(st.id)}
            className={`h-8 rounded-xl border text-[9px] font-normal uppercase tracking-wider transition-all duration-200 ${
              state === st.id
                ? 'border-sky-400/50 bg-sky-400/[0.22] text-sky-100 shadow-[0_0_12px_rgba(var(--th-glow),0.3)]'
                : 'border-white/[0.08] bg-white/[0.02] text-white/55 hover:border-white/20 hover:text-white'
            }`}
          >
            {st.label}
          </button>
        ))}
      </div>
    </AccordionSection>
  );
}
