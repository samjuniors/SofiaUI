/**
 * SettingsSheet — full control over Sophia's physical substance.
 *
 * Includes:
 *   - Collapsible sections for organized, clutter-free navigation
 *   - Display style: [ Full (Rim + Glow) ] vs [ Only Particles ]
 *   - Form: [ Sphere ] vs [ Ring ]
 *   - Interactive State triggers: Idle, Listening, Thinking, Speaking, Rendering, Ambient
 *   - Audio Agent Shape gallery: Waveform, Torus, Infinity, Helix, Hypercube,
 *     Pyramid, Star, Galaxy, Heart, Shield, Matrix, Split, Face, Glyphs, etc.
 *   - Detailed shape corrections: size, rim, glow, color hue, saturation, particle scale, sparkle
 *   - Atmosphere & Dust motes controls
 *   - Save as Default and Reset to Factory Settings
 */

import { Bookmark, Check, ChevronDown, RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DensityPref, OSStatus, ProviderPref, SophiaOS } from '../sophia/SophiaOS';
import { DEFAULT_TUNE, type ShapeTune } from '../sophia/VisualDirector';
import type { SophiaForm } from '../sophia/ShapeGenerator';
import type { SophiaShape, SophiaStateName } from '../sophia/types';
import { ALL_SHAPES } from '../sophia/control';

function SegRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-[9px] font-normal uppercase tracking-[0.24em] text-white/40">{label}</p>
      <div className="flex overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02] p-0.5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={`h-7 flex-1 rounded-lg text-[9.5px] font-normal tracking-[0.1em] transition-all duration-200 ${
              value === o.id
                ? 'border border-sky-400/30 bg-sky-400/[0.18] text-sky-100 shadow-[inset_0_0_10px_rgba(56,189,248,0.18)]'
                : 'text-white/45 hover:text-white/80'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  on,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <div>
        <p className="text-[11px] font-normal tracking-wide text-white/90">{label}</p>
        <p className="text-[9.5px] font-light text-white/40">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={`relative h-5 w-9 rounded-full border transition-colors duration-200 ${
          on ? 'border-sky-400/50 bg-sky-400/30 shadow-[0_0_10px_rgba(56,189,248,0.3)]' : 'border-white/10 bg-white/5'
        }`}
      >
        <span
          className={`block size-3.5 rounded-full transition-transform duration-200 ${
            on ? 'translate-x-4 bg-sky-300 shadow-[0_0_6px_rgba(125,211,252,0.8)]' : 'translate-x-0.5 bg-white/40'
          }`}
        />
      </button>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const display = format ? format(value) : value.toFixed(2);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-normal uppercase tracking-[0.2em] text-white/55">{label}</span>
        <span className="font-mono text-[9px] text-sky-300/80">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="sophia-range w-full"
      />
    </div>
  );
}

function AccordionSection({
  title,
  badge,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  badge?: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-white/[0.06] pt-2.5">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between py-1 text-left transition hover:opacity-100"
      >
        <div className="flex items-center gap-2">
          <p className="text-[9.5px] font-normal uppercase tracking-[0.22em] text-white/70">{title}</p>
          {badge && (
            <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-1.5 py-0.2 font-mono text-[8px] uppercase tracking-wider text-sky-200">
              {badge}
            </span>
          )}
        </div>
        <ChevronDown
          size={13}
          className={`text-white/40 transition-transform duration-200 ${isOpen ? 'rotate-180 text-sky-300' : ''}`}
        />
      </button>
      {isOpen && <div className="mt-2.5 space-y-3 pb-1">{children}</div>}
    </div>
  );
}

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

const SHAPE_LABELS: Record<SophiaShape, string> = {
  organic: 'Sphere',
  circle: 'Ring',
  waveform: 'Waveform',
  bow: 'Bow',
  torus: 'Torus',
  infinity: 'Infinity',
  helix: 'DNA Helix',
  hypercube: 'Tesseract',
  pyramid: 'Pyramid',
  star: 'Star',
  galaxy: 'Galaxy',
  heart: 'Heart',
  shield: 'Shield',
  matrix: 'Matrix',
  split: 'Split',
  merge: 'Merge',
  dissolve: 'Dissolve',
  face: 'Face',
  'letter-z': 'Glyph Z',
  'letter-s': 'Glyph S',
  'letter-a': 'Glyph A',
  'letter-o': 'Glyph O',
};

function ShapeThumb({ shape }: { shape: SophiaShape }) {
  const stroke = 'rgba(160,210,255,0.85)';
  const common = {
    fill: 'none' as const,
    stroke,
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <svg viewBox="0 0 24 24" className="size-[18px] shrink-0" aria-hidden="true">
      {shape === 'organic' && <circle cx="12" cy="12" r="7" fill="rgba(90,180,255,0.18)" stroke={stroke} strokeWidth="1.3" />}
      {shape === 'circle' && <circle cx="12" cy="12" r="7" {...common} />}
      {shape === 'waveform' && <path d="M3 12c1.5-6 3-6 4.5 0s3 6 4.5 0 3-6 4.5 0 3 6 4.5 0" {...common} />}
      {shape === 'bow' && <path d="M4 10c4 8 12 8 16 0" {...common} />}
      {shape === 'torus' && (
        <>
          <ellipse cx="12" cy="12" rx="8" ry="4.2" {...common} />
          <ellipse cx="12" cy="12" rx="3.2" ry="1.6" {...common} />
        </>
      )}
      {shape === 'infinity' && <path d="M5 12c0-3 3-5 5-5 4 0 4 10 8 10 2 0 5-2 5-5s-3-5-5-5c-4 0-4 10-8 10-2 0-5-2-5-5z" {...common} />}
      {shape === 'helix' && <path d="M8 4c6 2 6 4 0 6s-6 4 0 6 6 4 0 6" {...common} />}
      {shape === 'hypercube' && (
        <>
          <rect x="5" y="6" width="10" height="10" {...common} />
          <rect x="9" y="8" width="10" height="10" {...common} />
        </>
      )}
      {shape === 'pyramid' && <path d="M12 4 20 19H4z" {...common} />}
      {shape === 'star' && <path d="M12 3.5 14.4 9l6 .4-4.6 3.8 1.5 5.8L12 15.7 6.7 19l1.5-5.8L3.6 9.4l6-.4z" {...common} />}
      {shape === 'galaxy' && (
        <>
          <ellipse cx="12" cy="12" rx="8" ry="3.2" transform="rotate(-28 12 12)" {...common} />
          <circle cx="12" cy="12" r="1.6" fill={stroke} />
        </>
      )}
      {shape === 'heart' && <path d="M12 19s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z" {...common} />}
      {shape === 'shield' && <path d="M12 3 20 7v6c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V7z" {...common} />}
      {shape === 'matrix' && (
        <>
          <path d="M6 6h12v12H6z" {...common} />
          <path d="M6 12h12M12 6v12" {...common} />
        </>
      )}
      {shape === 'split' && (
        <>
          <circle cx="8" cy="12" r="4" {...common} />
          <circle cx="16" cy="12" r="4" {...common} />
        </>
      )}
      {shape === 'merge' && <path d="M5 8c4 0 4 8 7 8s3-8 7-8" {...common} />}
      {shape === 'dissolve' && (
        <>
          <circle cx="8" cy="9" r="1.2" fill={stroke} />
          <circle cx="14" cy="7" r="1" fill={stroke} />
          <circle cx="17" cy="13" r="1.4" fill={stroke} />
          <circle cx="10" cy="16" r="1.1" fill={stroke} />
          <circle cx="12" cy="11" r="1.6" fill={stroke} />
        </>
      )}
      {shape === 'face' && (
        <>
          <circle cx="12" cy="12" r="7.5" {...common} />
          <circle cx="9.5" cy="10.5" r="0.8" fill={stroke} />
          <circle cx="14.5" cy="10.5" r="0.8" fill={stroke} />
          <path d="M9 14.5c1.5 1.2 4.5 1.2 6 0" {...common} />
        </>
      )}
      {shape.startsWith('letter-') && (
        <text x="12" y="16.5" textAnchor="middle" fontSize="11" fill={stroke} fontFamily="Inter, sans-serif">
          {shape.slice(-1).toUpperCase()}
        </text>
      )}
    </svg>
  );
}

const STATUS_LABEL: Record<OSStatus, string> = {
  idle: 'ambient — idle',
  connecting: 'opening session…',
  live: 'live session',
  offline: 'providers offline (check server)',
  denied: 'microphone permission denied',
  error: 'voice backend unavailable / key missing',
};

export function SettingsSheet({ os, status, onClose }: { os: SophiaOS; status: OSStatus; onClose: () => void }) {
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const p = os.prefs;
  const state = os.state.current;

  // Collapsible accordion states
  const [sections, setSections] = useState({
    form: true,
    tuning: true,
    states: false,
    shapes: false,
    atmo: false,
    system: false,
  });

  const toggleSection = (key: keyof typeof sections) => {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    os.addEventListener('prefs', rerender);
    os.addEventListener('state', rerender);
    return () => {
      os.removeEventListener('prefs', rerender);
      os.removeEventListener('state', rerender);
    };
  }, [os]);

  const setTune = (patch: Partial<ShapeTune>) => os.savePrefs({ tune: { ...p.tune, ...patch } });

  const triggerShape = (sh: SophiaShape) => {
    os.execCommand(`shape ${sh}`);
  };

  const triggerState = (st: SophiaStateName) => {
    if (st === 'wakeup') os.wakeUp('settings');
    else if (st === 'paused' || st === 'pause') os.pause();
    else {
      os.resume();
      os.state.setState(st, { reason: 'settings-trigger' });
    }
    rerender();
  };

  const handleSave = () => {
    try {
      localStorage.setItem('sophia:prefs', JSON.stringify(os.prefs));
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2200);
    } catch {
      /* noop */
    }
  };

  const handleReset = () => {
    os.resetPrefs();
    rerender();
  };

  return (
    <>
      <button aria-label="Close settings" className="fixed inset-0 z-10 cursor-default" onClick={onClose} />
      <section
        aria-label="Settings"
        className="glass-panel panel-in panel-in-top-right fixed top-[70px] right-4 left-4 z-30 max-h-[calc(100vh-86px)] overflow-y-auto rounded-2xl p-4 sm:left-auto sm:right-11 sm:top-[76px] sm:w-[340px] sm:max-h-[calc(100vh-96px)]"
      >
        <div className="mb-3 flex items-center justify-between border-b border-white/[0.06] pb-2.5">
          <div className="flex items-center gap-2">
            <span className="block size-1.5 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.7)]" />
            <p className="text-[10px] font-normal uppercase tracking-[0.28em] text-white/70">Settings & Controls</p>
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
          {/* SECTION 1: BASE FORM & DISPLAY MODE */}
          <AccordionSection
            title="Base Form & Display"
            badge={p.form}
            isOpen={sections.form}
            onToggle={() => toggleSection('form')}
          >
            <div>
              <p className="mb-2 text-[9px] font-normal uppercase tracking-[0.24em] text-white/40">Display Mode</p>
              <div className="flex overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02] p-0.5">
                <button
                  type="button"
                  onClick={() => setTune({ onlyParticles: false })}
                  className={`h-7 flex-1 rounded-lg text-[9.5px] font-normal tracking-[0.08em] transition-all duration-200 ${
                    !p.tune.onlyParticles
                      ? 'border border-sky-400/30 bg-sky-400/[0.18] text-sky-100 shadow-[inset_0_0_10px_rgba(56,189,248,0.18)]'
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
                      ? 'border border-sky-400/30 bg-sky-400/[0.18] text-sky-100 shadow-[inset_0_0_10px_rgba(56,189,248,0.18)]'
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
          </AccordionSection>

          {/* SECTION 2: SHAPE CORRECTION, BLOOM & SATURATION */}
          <AccordionSection
            title="Shape Fine Tuning & Color"
            badge="Glow & Color"
            isOpen={sections.tuning}
            onToggle={() => toggleSection('tuning')}
          >
            <Slider label="Overall Size" value={p.tune.scale} min={0.8} max={1.2} step={0.01} onChange={(v) => setTune({ scale: v })} />
            <Slider label="Particle Point Size" value={p.tune.particleScale} min={0.6} max={2.2} step={0.05} onChange={(v) => setTune({ particleScale: v })} />
            <Slider label="Sparkle Intensity" value={p.tune.sparkle} min={0.0} max={2.0} step={0.05} onChange={(v) => setTune({ sparkle: v })} />
            {!p.tune.onlyParticles && (
              <Slider label="Rim Thickness" value={p.tune.rim} min={0.6} max={1.6} step={0.02} onChange={(v) => setTune({ rim: v })} />
            )}
            <Slider label="Shape Glow / Bloom" value={p.tune.glow} min={0.4} max={1.8} step={0.02} onChange={(v) => setTune({ glow: v })} />
            <Slider
              label="Color Hue"
              value={p.tune.hue}
              min={-1}
              max={1}
              step={0.05}
              format={(v) => (v < -0.05 ? `Cyan ${Math.round(-v * 100)}%` : v > 0.05 ? `Violet ${Math.round(v * 100)}%` : 'Balanced')}
              onChange={(v) => setTune({ hue: v })}
            />
            <Slider
              label="Color Saturation"
              value={p.tune.saturation ?? 1.0}
              min={0.0}
              max={2.0}
              step={0.05}
              format={(v) => (v === 0 ? 'Monochrome' : `${Math.round(v * 100)}%`)}
              onChange={(v) => setTune({ saturation: v })}
            />
          </AccordionSection>

          {/* SECTION 3: INTERACTIVE STATE ANIMATIONS */}
          <AccordionSection
            title="Interactive States"
            badge={state}
            isOpen={sections.states}
            onToggle={() => toggleSection('states')}
          >
            <p className="text-[9px] font-normal uppercase tracking-[0.24em] text-white/40">Trigger State Animation</p>
            <div className="grid grid-cols-3 gap-1.5">
              {STATE_OPTIONS.map((opt) => {
                const active = state === opt.id || (opt.id === 'pause' && state === 'paused') || (opt.id === 'paused' && state === 'pause');
                const isDone = opt.id === 'completed';
                const isBlocked = opt.id === 'blocked';
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => triggerState(opt.id)}
                    className={`h-7 rounded-lg border text-[9.5px] tracking-wider transition-all duration-200 ${
                      active
                        ? isDone
                          ? 'border-emerald-400/50 bg-emerald-500/[0.2] font-normal text-emerald-100 shadow-[0_0_12px_rgba(52,211,153,0.25)]'
                          : isBlocked
                            ? 'border-rose-400/50 bg-rose-500/[0.2] font-normal text-rose-100 shadow-[0_0_12px_rgba(244,63,94,0.25)]'
                            : 'border-sky-400/40 bg-sky-400/[0.2] font-normal text-sky-100 shadow-[0_0_10px_rgba(56,189,248,0.2)]'
                        : 'border-white/[0.07] bg-white/[0.02] font-light text-white/50 hover:border-white/20 hover:text-white/80'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </AccordionSection>

          {/* SECTION 4: 20+ SHAPE GALLERY */}
          <AccordionSection
            title="Shape Gallery"
            badge="20+ shapes"
            isOpen={sections.shapes}
            onToggle={() => toggleSection('shapes')}
          >
            <div className="grid grid-cols-3 gap-1.5 max-h-[200px] overflow-y-auto pr-1 chat-scroll">
              {ALL_SHAPES.map((sh) => (
                <button
                  key={sh}
                  type="button"
                  onClick={() => triggerShape(sh)}
                  className="flex h-[52px] flex-col items-center justify-center gap-1 rounded-xl border border-white/[0.07] bg-white/[0.02] px-1 text-[9px] font-normal tracking-wide text-white/60 transition-all duration-200 hover:border-sky-400/30 hover:bg-white/[0.05] hover:text-sky-100 active:scale-95"
                >
                  <ShapeThumb shape={sh} />
                  <span className="truncate max-w-[80px]">{SHAPE_LABELS[sh] || sh}</span>
                </button>
              ))}
            </div>
          </AccordionSection>

          {/* SECTION 5: ATMOSPHERE & DUST */}
          <AccordionSection
            title="Atmosphere & Dust"
            isOpen={sections.atmo}
            onToggle={() => toggleSection('atmo')}
          >
            <ToggleRow
              label="Aura animation"
              hint="soft drifting atmosphere"
              on={p.tune.backgroundEnabled}
              onChange={(backgroundEnabled) => setTune({ backgroundEnabled })}
            />
            <div className={p.tune.backgroundEnabled ? '' : 'pointer-events-none opacity-30'}>
              <div className="space-y-3">
                <Slider
                  label="Aura strength"
                  value={p.tune.backgroundIntensity}
                  min={0}
                  max={1.25}
                  step={0.05}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(backgroundIntensity) => setTune({ backgroundIntensity })}
                />
                <Slider
                  label="Aura motion"
                  value={p.tune.backgroundMotion}
                  min={0.15}
                  max={1.5}
                  step={0.05}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(backgroundMotion) => setTune({ backgroundMotion })}
                />
              </div>
            </div>

            <div className="pt-2 border-t border-white/[0.04]">
              <ToggleRow
                label="Dust visible"
                hint="scattered ambient motes"
                on={p.tune.dustVisible}
                onChange={(dustVisible) => setTune({ dustVisible })}
              />
              <div className={p.tune.dustVisible ? 'mt-2 space-y-3' : 'pointer-events-none opacity-30 mt-2 space-y-3'}>
                <Slider
                  label="Dust speed"
                  value={p.tune.dustSpeed}
                  min={0}
                  max={2.0}
                  step={0.05}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(dustSpeed) => setTune({ dustSpeed })}
                />
                <Slider
                  label="Dust amount"
                  value={p.tune.dustAmount}
                  min={0}
                  max={2.0}
                  step={0.05}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(dustAmount) => setTune({ dustAmount })}
                />
              </div>
            </div>
          </AccordionSection>

          {/* SECTION 6: SYSTEM & VOICE */}
          <AccordionSection
            title="System & Voice"
            isOpen={sections.system}
            onToggle={() => toggleSection('system')}
          >
            <SegRow<DensityPref>
              label="Particle Mesh Density"
              value={p.density}
              onChange={(density) => os.savePrefs({ density })}
              options={[
                { id: 'auto', label: 'Auto' },
                { id: 'low', label: 'Low' },
                { id: 'medium', label: 'Med' },
                { id: 'high', label: 'High' },
              ]}
            />
            {!p.tune.onlyParticles && (
              <>
                <ToggleRow
                  label="Orbit Rings & Nodes"
                  hint="travelling satellite dots"
                  on={p.tune.orbits}
                  disabled={p.form === 'ring'}
                  onChange={(orbits) => setTune({ orbits })}
                />
                <ToggleRow
                  label="Inner Membrane Waves"
                  hint="flowing liquid light"
                  on={p.tune.waves}
                  disabled={p.form === 'ring'}
                  onChange={(waves) => setTune({ waves })}
                />
              </>
            )}
            <ToggleRow
              label="Ambient Rotation"
              hint="slow micro-swirl"
              on={p.tune.spin}
              onChange={(spin) => setTune({ spin })}
            />
            <SegRow<ProviderPref>
              label="Voice Transport"
              value={p.provider}
              onChange={(provider) => os.savePrefs({ provider })}
              options={[
                { id: 'auto', label: 'Auto' },
                { id: 'gemini-live', label: 'Gemini' },
                { id: 'deepgram', label: 'Deepgram' },
              ]}
            />
            <ToggleRow
              label="Wake Phrase"
              hint={'"Hey Sophia"'}
              on={p.wake}
              onChange={(wake) => os.savePrefs({ wake })}
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
