/**
 * settings/TuningSection.tsx — "Shape Fine Tuning & Color".
 * Extracted verbatim from SettingsSheet (Phase 22 split).
 */

import type { SophiaOS } from '../../sophia/SophiaOS';
import type { ShapeTune } from '../../sophia/VisualDirector';
import { AccordionSection, Slider } from './controls';

export function TuningSection({
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
      title="Shape Fine Tuning & Color"
      badge="Glow & Color"
      isOpen={isOpen}
      onToggle={onToggle}
    >
      <Slider label="Overall Size" value={p.tune.scale} min={0.8} max={1.2} step={0.01} onChange={(v) => setTune({ scale: v })} />
      <Slider label="Particle Point Size" value={p.tune.particleScale} min={0.6} max={2.2} step={0.05} onChange={(v) => setTune({ particleScale: v })} />
      <Slider label="Sparkle Intensity" value={p.tune.sparkle} min={0.0} max={2.0} step={0.05} onChange={(v) => setTune({ sparkle: v })} />
      {!p.tune.onlyParticles && (
        <Slider label="Rim Thickness" value={p.tune.rim} min={0.6} max={1.6} step={0.02} onChange={(v) => setTune({ rim: v })} />
      )}
      <Slider label="Shape Glow / Bloom" value={p.tune.glow} min={0.4} max={1.8} step={0.02} onChange={(v) => setTune({ glow: v })} />
      <Slider label="Color Hue (0° - 360°)" value={p.tune.hue} min={0} max={360} step={1} format={(v) => `${Math.round(v)}°`} onChange={(v) => setTune({ hue: v })} />
      <Slider label="Color Saturation" value={p.tune.saturation} min={0.4} max={2.0} step={0.05} onChange={(v) => setTune({ saturation: v })} />
    </AccordionSection>
  );
}
