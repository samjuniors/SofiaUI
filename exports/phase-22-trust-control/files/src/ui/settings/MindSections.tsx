/**
 * settings/MindSections.tsx — Memory / Soul / Skills / Proactive accordions.
 * Extracted verbatim from SettingsSheet (Phase 22 split). Badges read live
 * stores; re-renders still come from the sheet's store listeners.
 */

import { memoryStore } from '../../core/MemoryStore';
import { soulStore, SOUL_PRESETS } from '../../core/Soul';
import { skillsRegistry } from '../../core/SkillsRegistry';
import { ambientScheduler } from '../../sophia/AmbientScheduler';
import { MemoryPanel, SoulPanel, SkillsPanel } from '../MindPanels';
import { EpisodesPanel } from '../EpisodesPanel';
import { ProactivePanel } from '../ProactivePanel';
import { AccordionSection } from './controls';

interface SectionProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function MemorySection({ isOpen, onToggle }: SectionProps) {
  return (
    <AccordionSection
      title="Memory & Facts"
      badge={(() => {
        const m = memoryStore.snapshot();
        if (m.userName) return m.userName;
        const n = m.people.length + Object.keys(m.preferences).length + m.instructions.length;
        return n === 0 ? 'Empty' : `${n} facts`;
      })()}
      isOpen={isOpen}
      onToggle={onToggle}
    >
      <MemoryPanel />
      <EpisodesPanel />
    </AccordionSection>
  );
}

export function SoulSection({ isOpen, onToggle }: SectionProps) {
  return (
    <AccordionSection
      title="Soul & Persona"
      badge={(() => {
        const s = soulStore.snapshot();
        return s.preset === 'custom' ? 'Custom' : SOUL_PRESETS[s.preset].label;
      })()}
      isOpen={isOpen}
      onToggle={onToggle}
    >
      <SoulPanel />
    </AccordionSection>
  );
}

export function SkillsSection({ isOpen, onToggle }: SectionProps) {
  return (
    <AccordionSection
      title="Skills & Capabilities"
      badge={(() => {
        const c = skillsRegistry.count();
        return `${c.enabled}/${c.total}`;
      })()}
      isOpen={isOpen}
      onToggle={onToggle}
    >
      <SkillsPanel />
    </AccordionSection>
  );
}

export function ProactiveSection({ isOpen, onToggle }: SectionProps) {
  return (
    <AccordionSection
      title="Proactive & Routines"
      badge={(() => {
        const all = ambientScheduler.list();
        const on = all.filter((s) => s.enabled).length;
        return `${on}/${all.length}`;
      })()}
      isOpen={isOpen}
      onToggle={onToggle}
    >
      <ProactivePanel />
    </AccordionSection>
  );
}
