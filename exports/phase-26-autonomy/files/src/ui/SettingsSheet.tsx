/**
 * SettingsSheet — full control over Sophia's physical substance, voice, and brain.
 *
 * Shell + section accordions live in ./settings/ (Phase 22 split):
 * controls, voice-data, and one module per section. Includes:
 *   - Voice & Mouth Provider: ElevenLabs (High-Fidelity) vs Deepgram Aura (Fast)
 *   - Multiple Voice ID options: Presets, .env configured voice, and custom Voice ID input
 *   - Multi-Brain & Local LLMs: Ollama (Local), LM Studio (Local), Gemini, Grok, Claude, OpenAI
 *   - Display style: [ Full (Rim + Glow) ] vs [ Only Particles ]
 *   - Form: [ Sphere ] vs [ Ring ]
 *   - Interactive State triggers: Idle, Listening, Thinking, Speaking, Rendering, Ambient
 *   - Audio Agent Shape gallery: Waveform, Torus, Infinity, Helix, Hypercube,
 *     Pyramid, Star, Galaxy, Heart, Shield, Matrix, Split, Spiky, Face, Glyphs, etc.
 *   - Save as Default and Reset to Factory Settings
 */

import { Bookmark, Check, RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { OSStatus, SophiaOS } from '../sophia/SophiaOS';
import { controlLayer } from '../sophia/control';
import { memoryStore } from '../core/MemoryStore';
import { soulStore } from '../core/Soul';
import { skillsRegistry } from '../core/SkillsRegistry';
import { sophiaFetch } from '../lib/sophia-fetch.ts';
import { EnvSection } from './settings/EnvSection';
import { PerceptionSection } from './settings/PerceptionSection';
import { VoiceSection } from './settings/VoiceSection';
import { BrainSection } from './settings/BrainSection';
import { MemorySection, SoulSection, SkillsSection, ProactiveSection } from './settings/MindSections';
import { FormSection } from './settings/FormSection';
import { TuningSection } from './settings/TuningSection';
import { StatesSection } from './settings/StatesSection';
import { ShapesSection } from './settings/ShapesSection';
import { AtmoSection } from './settings/AtmoSection';
import { SystemSection } from './settings/SystemSection';
import { AutonomySection } from './settings/AutonomySection';

const STATUS_LABEL: Record<OSStatus, string> = {
  idle: 'Idle · Audio sleeping',
  connecting: 'Connecting voice session…',
  live: 'Live · Full duplex audio active',
  offline: 'Offline · Local fallback ready',
  denied: 'Microphone blocked by browser',
  error: 'Voice transport failed',
};

export function SettingsSheet({ os, status, onClose }: { os: SophiaOS; status: OSStatus; onClose: () => void }) {
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const state = os.state.current;

  // Collapsible accordion states
  const [sections, setSections] = useState({
    env: true,
    perception: true,
    voice: true,
    brain: false,
    memory: false,
    soul: false,
    skills: false,
    proactive: false,
    form: false,
    tuning: false,
    states: false,
    shapes: false,
    atmo: false,
    system: false,
    autonomy: false,
  });

  const toggleSection = (key: keyof typeof sections) => {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const [savedNotice, setSavedNotice] = useState(false);
  const [serverStatus, setServerStatus] = useState<any>(null);

  useEffect(() => {
    os.addEventListener('prefs', rerender);
    os.addEventListener('state', rerender);
    memoryStore.addEventListener('change', rerender);
    soulStore.addEventListener('change', rerender);
    skillsRegistry.addEventListener('change', rerender);
    return () => {
      os.removeEventListener('prefs', rerender);
      os.removeEventListener('state', rerender);
      memoryStore.removeEventListener('change', rerender);
      soulStore.removeEventListener('change', rerender);
      skillsRegistry.removeEventListener('change', rerender);
    };
  }, [os]);

  useEffect(() => {
    sophiaFetch('/api/sophia/status')
      .then((r) => r.json())
      .then((data) => setServerStatus(data))
      .catch(() => undefined);
  }, []);

  const handleSave = () => {
    try {
      localStorage.setItem('sophia:prefs', JSON.stringify(os.prefs));
      controlLayer.saveControlPrefs();
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2200);
    } catch {
      /* noop */
    }
  };

  const handleReset = () => {
    os.resetPrefs();
    controlLayer.voiceProfile = 'au-female';
    controlLayer.voiceName = 'Aoede';
    controlLayer.elevenLabsVoiceId = 'bMxLr8fP6hzNRRi9nJxU';
    controlLayer.dgVoice = 'aura-2-thalia-en';
    controlLayer.mouthProvider = 'elevenlabs';
    controlLayer.brainMode = 'auto';
    controlLayer.saveControlPrefs();
    rerender();
  };

  return (
    <>
      <button aria-label="Close settings" className="fixed inset-0 z-10 cursor-default" onClick={onClose} />
      <section
        aria-label="Settings"
        className="glass-panel panel-in panel-in-top-right fixed top-[70px] right-4 left-4 z-30 max-h-[calc(100vh-86px)] overflow-y-auto rounded-2xl p-4 sm:left-auto sm:right-11 sm:top-[76px] sm:w-[360px] sm:max-h-[calc(100vh-96px)]"
      >
        <div className="mb-3 flex items-center justify-between border-b border-white/[0.06] pb-2.5">
          <div className="flex items-center gap-2">
            <span className="block size-1.5 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(var(--th-glow),0.7)]" />
            <p className="text-[10px] font-normal uppercase tracking-[0.28em] text-white/70">Settings & Intelligence</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-2 py-0.5 font-mono text-[8.5px] uppercase tracking-wider text-sky-200">
              {state}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              className="grid size-6 place-items-center rounded-lg text-white/40 transition hover:bg-white/[0.06] hover:text-white"
            >
              <X size={13} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {/* ENVIRONMENT: GEMINI LIVE API & ASR BARGE-IN */}
          <EnvSection os={os} serverStatus={serverStatus} isOpen={sections.env} onToggle={() => toggleSection('env')} />

          {/* PERCEPTION & DECISION ENGINE */}
          <PerceptionSection isOpen={sections.perception} onToggle={() => toggleSection('perception')} />

          {/* SENSE: EAR & MOUTH (VOICE) */}
          <VoiceSection os={os} serverStatus={serverStatus} isOpen={sections.voice} onToggle={() => toggleSection('voice')} />

          {/* INTELLECT: BRAIN & LOCAL LLMS */}
          <BrainSection serverStatus={serverStatus} isOpen={sections.brain} onToggle={() => toggleSection('brain')} />

          {/* MIND: MEMORY */}
          <MemorySection isOpen={sections.memory} onToggle={() => toggleSection('memory')} />

          {/* MIND: SOUL */}
          <SoulSection isOpen={sections.soul} onToggle={() => toggleSection('soul')} />

          {/* MIND: SKILLS */}
          <SkillsSection isOpen={sections.skills} onToggle={() => toggleSection('skills')} />

          {/* MIND: PROACTIVE ROUTINES */}
          <ProactiveSection isOpen={sections.proactive} onToggle={() => toggleSection('proactive')} />

          {/* SECTION 1: BASE FORM & DISPLAY MODE */}
          <FormSection os={os} isOpen={sections.form} onToggle={() => toggleSection('form')} />

          {/* SECTION 2: SHAPE CORRECTION, BLOOM & SATURATION */}
          <TuningSection os={os} isOpen={sections.tuning} onToggle={() => toggleSection('tuning')} />

          {/* SECTION 3: STATES (REACTIVE PREVIEW) */}
          <StatesSection os={os} state={state} isOpen={sections.states} onToggle={() => toggleSection('states')} />

          {/* SECTION 4: SHAPES & SACRED GEOMETRY */}
          <ShapesSection os={os} isOpen={sections.shapes} onToggle={() => toggleSection('shapes')} />

          {/* SECTION 5: ATMOSPHERE & BACKGROUND MOTES */}
          <AtmoSection os={os} isOpen={sections.atmo} onToggle={() => toggleSection('atmo')} />

          {/* SECTION 6: SYSTEM & GESTURES */}
          <SystemSection os={os} isOpen={sections.system} onToggle={() => toggleSection('system')} />
          <AutonomySection isOpen={sections.autonomy} onToggle={() => toggleSection('autonomy')} />

          {/* SESSION STATUS */}
          <div className="border-t border-white/[0.06] pt-2.5">
            <p className="text-[9px] font-normal uppercase tracking-[0.24em] text-white/40">Session</p>
            <p className="mt-1 text-[10px] font-light tracking-wide text-white/50">{STATUS_LABEL[status]}</p>
            {os.isMicDisabledError && (
              <button
                type="button"
                onClick={() => {
                  os.resetMicError();
                  rerender();
                }}
                className="mt-2.5 h-7 w-full rounded-xl border border-rose-400/25 bg-rose-500/[0.08] text-[9.5px] font-normal tracking-[0.14em] text-rose-200 transition-all hover:bg-rose-500/[0.15] hover:border-rose-400/40 active:scale-[0.98]"
              >
                CLEAR VOICE ERROR & RETRY
              </button>
            )}
          </div>

          {/* SAVE & RESET ACTIONS */}
          <div className="border-t border-white/[0.08] pt-3 space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-xl border border-sky-400/40 bg-sky-500/[0.18] text-[9.5px] font-normal tracking-[0.14em] text-sky-100 transition-all hover:border-sky-400/60 hover:bg-sky-500/[0.28] active:scale-[0.98]"
              >
                {savedNotice ? (
                  <>
                    <Check size={12} className="text-emerald-400" />
                    <span className="text-emerald-300">SAVED TO STORAGE</span>
                  </>
                ) : (
                  <>
                    <Bookmark size={11} className="text-sky-300" />
                    <span>SAVE SETTINGS</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleReset}
                title="Reset all settings to factory default"
                className="flex h-8 items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 text-[9.5px] font-normal tracking-[0.14em] text-white/50 transition-all hover:border-white/20 hover:bg-white/[0.06] hover:text-white active:scale-[0.98]"
              >
                <RotateCcw size={11} />
                <span>RESET</span>
              </button>
            </div>
            <p className="text-center text-[8.5px] font-light text-white/30">
              Saved settings persist in localStorage and restore on launch
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
