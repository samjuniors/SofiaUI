/**
 * settings/SystemSection.tsx — "System & Gestures".
 * Extracted verbatim from SettingsSheet (Phase 22 split).
 */

import { useState } from 'react';
import type { DensityPref, SophiaOS } from '../../sophia/SophiaOS';
import { DesktopBlock } from '../DesktopBlock';
import { CompanionBlock } from '../DailyPanel';
import { DevicesPanel } from '../DevicesPanel';
import { AccordionSection, SegRow, ToggleRow } from './controls';

export function SystemSection({
  os,
  isOpen,
  onToggle,
}: {
  os: SophiaOS;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const p = os.prefs;
  const [devicesOpen, setDevicesOpen] = useState(false);

  return (
    <>
    <AccordionSection title="System & Gestures" badge={p.motion} isOpen={isOpen} onToggle={onToggle}>
      <DesktopBlock />
      <CompanionBlock />
      <ToggleRow
        label="Hey Sofia wake-word"
        hint="background microphone detection"
        on={p.wake}
        onChange={(wake) => os.savePrefs({ wake })}
      />
      <SegRow<DensityPref>
        label="Particle Mesh Density"
        value={p.density}
        onChange={(density) => os.savePrefs({ density })}
        options={[
          { id: 'auto', label: 'Auto' },
          { id: 'high', label: 'High (60k)' },
          { id: 'medium', label: 'Med (35k)' },
          { id: 'low', label: 'Low (15k)' },
        ]}
      />
      <SegRow
        label="Motion"
        value={p.motion}
        onChange={(motion) => os.savePrefs({ motion })}
        options={[
          { id: 'auto', label: 'Auto' },
          { id: 'full', label: 'Full' },
          { id: 'reduce', label: 'Minimal' },
        ]}
      />
      <ToggleRow
        label="Haptic & chime"
        hint="soft pulse on wake, pause, complete"
        on={p.haptics}
        onChange={(haptics) => os.savePrefs({ haptics })}
      />
    </AccordionSection>
    <AccordionSection title="Devices & Sessions" isOpen={devicesOpen} onToggle={() => setDevicesOpen((v) => !v)}>
      <DevicesPanel />
    </AccordionSection>
    </>
  );
}
