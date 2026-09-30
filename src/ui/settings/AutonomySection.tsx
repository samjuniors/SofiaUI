/**
 * settings/AutonomySection.tsx — "Autonomy" (Phase 26).
 *
 * The user's autonomy level: careful / balanced / bold. It only moves
 * actions between AUTO and NOTIFY — GATE is immutable, and credentials
 * and payments ALWAYS ask, on every level. Persisted in localStorage.
 */

import { useState } from 'react';
import { AccordionSection, SegRow } from './controls';
import { autonomyStore, type AutonomyLevel } from '../../policy/autonomy';

const BLURB: Record<AutonomyLevel, string> = {
  careful: 'Narrate more: opening apps and pages tells you first.',
  balanced: 'The default: visible side effects report in, the rest just runs.',
  bold: 'Fewer interruptions: moves, drafts, and memory edits run silent.',
};

export function AutonomySection({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
  const [level, setLevel] = useState<AutonomyLevel>(() => autonomyStore.get());
  return (
    <AccordionSection title="Autonomy" badge={level} isOpen={isOpen} onToggle={onToggle}>
      <SegRow<AutonomyLevel>
        label="Autonomy level"
        value={level}
        onChange={(next) => {
          autonomyStore.set(next);
          setLevel(next);
        }}
        options={[
          { id: 'careful', label: 'Careful' },
          { id: 'balanced', label: 'Balanced' },
          { id: 'bold', label: 'Bold' },
        ]}
      />
      <p className="mt-1 text-[10px] font-light leading-snug text-white/50">{BLURB[level]}</p>
      <p className="mt-2 rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-2.5 py-1.5 text-[10px] font-light leading-snug text-amber-100/80">
        Always asks, on every level: sending messages, payments, deleting, credentials, installing, and terminal
        commands. This setting can never turn those off.
      </p>
    </AccordionSection>
  );
}
