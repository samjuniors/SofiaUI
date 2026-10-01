/**
 * settings/FormSection.tsx — "Base Form & Display".
 * Extracted verbatim from SettingsSheet (Phase 22 split).
 */

import type { SophiaOS } from '../../sophia/SophiaOS';
import type { ShapeTune } from '../../sophia/VisualDirector';
import type { SophiaForm } from '../../sophia/ShapeGenerator';
import { ThemePicker } from '../ThemePicker';
import { AccordionSection, SegRow } from './controls';

export function FormSection({
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
    <AccordionSection title="Base Form & Display" badge={p.form} isOpen={isOpen} onToggle={onToggle}>
      <div>
        <p className="mb-2 text-[9px] font-normal uppercase tracking-[0.24em] text-white/40">Display Mode</p>
        <div className="flex overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02] p-0.5">
          <button
            type="button"
            onClick={() => setTune({ onlyParticles: false })}
            className={`h-7 flex-1 rounded-lg text-[9.5px] font-normal tracking-[0.08em] transition-all duration-200 ${
              !p.tune.onlyParticles
                ? 'border border-sky-400/30 bg-sky-400/[0.18] text-sky-100 shadow-[inset_0_0_10px_rgba(var(--th-glow),0.18)]'
                : 'text-white/45 hover:text-white/80'
            }`}
          >
            Full (Rim + Body)
          </button>
          <button
            type="button"
            onClick={() => setTune({ onlyParticles: true })}
            className={`h-7 flex-1 rounded-lg text-[9.5px] font-normal tracking-[0.08em] transition-all duration-200 ${
              p.tune.onlyParticles
                ? 'border border-sky-400/30 bg-sky-400/[0.18] text-sky-100 shadow-[inset_0_0_10px_rgba(var(--th-glow),0.18)]'
                : 'text-white/45 hover:text-white/80'
            }`}
          >
            Particles Only
          </button>
        </div>
      </div>

      <SegRow<SophiaForm>
        label="Base Form"
        value={p.form}
        onChange={(form) => os.savePrefs({ form })}
        options={[
          { id: 'sphere', label: 'Sphere' },
          { id: 'ring', label: 'Ring' },
        ]}
      />
      <ThemePicker value={p.theme} onChange={(theme) => os.savePrefs({ theme })} />
    </AccordionSection>
  );
}
