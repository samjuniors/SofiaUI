/**
 * settings/AtmoSection.tsx — "Atmosphere & Dust Motes".
 * Extracted verbatim from SettingsSheet (Phase 22 split).
 */

import type { SophiaOS } from '../../sophia/SophiaOS';
import type { ShapeTune } from '../../sophia/VisualDirector';
import { AccordionSection, Slider } from './controls';

export function AtmoSection({
  os,
  isOpen,
  onToggle,
}: {
  os: SophiaOS;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const p = os.prefs;
  const setTune = (patch: Partial<ShapeTune>) => os.savePrefs({ tune: { ...p.tune, ...patch } });

  return (
    <AccordionSection
      title="Atmosphere & Dust Motes"
      badge="Environment"
      isOpen={isOpen}
      onToggle={onToggle}
    >
      <Slider label="Dust Mote Density" value={p.tune.dustAmount} min={0} max={200} step={5} format={(v) => `${Math.round(v)}`} onChange={(v) => setTune({ dustAmount: v })} />
      <Slider label="Mote Drift Speed" value={p.tune.dustSpeed} min={0.1} max={3.0} step={0.1} onChange={(v) => setTune({ dustSpeed: v })} />
      <Slider label="Background Intensity" value={p.tune.backgroundIntensity} min={0.0} max={1.0} step={0.02} onChange={(v) => setTune({ backgroundIntensity: v })} />
    </AccordionSection>
  );
}
