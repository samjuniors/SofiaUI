/**
 * SettingsSheet — full control over Sophia's physical substance.
 *
 * Includes:
 *   - Display style: [ Full (Rim + Glow) ] vs [ Only Particles ] (NO RIM TOGGLE)
 *   - Form: [ Sphere ] vs [ Ring ]
 *   - Interactive State triggers: Idle, Listening, Thinking, Speaking, Rendering, Ambient
 *   - Audio Agent Shape gallery: Waveform, Torus, Infinity, Helix, Hypercube,
 *     Pyramid, Star, Galaxy, Heart, Shield, Matrix, Split, Face, Glyphs, etc.
 *   - Detailed shape corrections: size, rim, glow, color hue, particle scale, sparkle
 */

import { useEffect, useState } from 'react';
import type { DensityPref, OSStatus, ProviderPref, SophiaOS } from '../sophia/SophiaOS';
import { DEFAULT_TUNE, THEMES, type ShapeTune } from '../sophia/VisualDirector';
import type { SophiaForm } from '../sophia/ShapeGenerator';
import type { SophiaShape, SophiaStateName } from '../sophia/types';
import { ALL_SHAPES } from '../sophia/control';
import { pulse } from '../sophia/haptics';

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
      <p className="mb-2 text-[8.5px] font-light uppercase tracking-[0.34em] text-white/35">{label}</p>
      <div className="flex overflow-hidden rounded-full border border-white/[0.08] bg-white/[0.02]">
        {options.map((o, i) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={`h-7 flex-1 text-[9.5px] font-light tracking-[0.14em] transition-colors duration-200 ${
              i > 0 ? 'border-l border-white/[0.07]' : ''
            } ${value === o.id ? 'bg-sky-400/[0.18] text-sky-200 shadow-[inset_0_0_12px_rgba(56,189,248,0.15)] font-normal' : 'text-white/45 hover:text-white/80'}`}
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
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${disabled ? 'opacity-35' : ''}`}>
      <div>
        <p className="text-[11px] font-light tracking-wide text-white/75">{label}</p>
        <p className="mt-[1px] text-[9.5px] font-light tracking-wide text-white/30">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={`relative h-[18px] w-[32px] shrink-0 rounded-full border transition-colors duration-300 ${
          on ? 'border-sky-300/40 bg-sky-400/[0.22]' : 'border-white/[0.12] bg-white/[0.04]'
        }`}
      >
        <span
          className={`absolute top-1/2 block size-[12px] -translate-y-1/2 rounded-full bg-white/85 transition-all duration-300 ${
            on ? 'left-[17px]' : 'left-[3px]'
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
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-[10px] font-light tracking-wide text-white/55">
        <span>{label}</span>
        <span className="font-mono text-[9px] text-white/40">{format ? format(value) : value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="sophia-range h-1 w-full"
        aria-label={label}
      />
    </label>
  );
}

const SHAPE_LABELS: Record<SophiaShape, string> = {
  organic: 'Sphere',
  circle: 'Ring',
  waveform: 'Waveform',
  bow: 'Bow Arc',
  torus: 'Torus 3D',
  infinity: 'Infinity',
  helix: 'DNA Helix',
  hypercube: 'Hypercube',
  pyramid: 'Pyramid',
  star: 'Star',
  galaxy: 'Galaxy',
  heart: 'Heart',
  shield: 'Shield',
  matrix: 'Matrix Grid',
  split: 'Split Orbs',
  merge: 'Merge',
  dissolve: 'Dissolve',
  face: 'Face',
  'letter-z': 'Z Glyph',
  'letter-s': 'S Glyph',
  'letter-a': 'A Glyph',
  'letter-o': 'O Glyph',
};

const STATE_OPTIONS: Array<{ id: SophiaStateName; label: string }> = [
  { id: 'idle', label: 'Idle' },
  { id: 'listening', label: 'Listening' },
  { id: 'thinking', label: 'Thinking' },
  { id: 'rendering', label: 'Rendering' },
  { id: 'speaking', label: 'Speaking' },
  { id: 'pause', label: 'Pause' },
  { id: 'completed', label: 'Completed' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'wakeup', label: '✦ Wake Up' },
  { id: 'focusing', label: 'Focusing' },
];

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
          <circle cx="12" cy="12" r="7" {...common} />
          <circle cx="9.2" cy="11" r="0.8" fill={stroke} />
          <circle cx="14.8" cy="11" r="0.8" fill={stroke} />
          <path d="M9 15c1.2 1.4 4.8 1.4 6 0" {...common} />
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

  return (
    <>
      <button aria-label="Close settings" className="fixed inset-0 z-10 cursor-default" onClick={onClose} />
      <section
        aria-label="Settings"
        className="panel-in absolute right-6 top-[66px] z-20 max-h-[calc(100vh-100px)] w-[310px] overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#050811]/96 p-4 shadow-[0_30px_90px_rgba(0,0,0,0.7)] backdrop-blur-xl sm:right-8"
      >
        <div className="mb-3 flex items-center justify-between border-b border-white/[0.06] pb-2.5">
          <p className="text-[9.5px] font-light uppercase tracking-[0.36em] text-white/50">Sophia · Controls</p>
          <span className="font-mono text-[9px] uppercase tracking-wider text-sky-300/60">{state}</span>
        </div>

        <div className="space-y-4">
          {/* DISPLAY MODE: JUST PARTICLES VS FULL RIM/BODY */}
          <div>
            <p className="mb-2 text-[8.5px] font-light uppercase tracking-[0.34em] text-white/35">Display Mode</p>
            <div className="flex overflow-hidden rounded-full border border-white/[0.08] bg-white/[0.02]">
              <button
                type="button"
                onClick={() => setTune({ onlyParticles: false })}
                className={`h-7 flex-1 text-[9.5px] font-light tracking-[0.14em] transition-colors duration-200 ${
                  !p.tune.onlyParticles
                    ? 'bg-sky-400/[0.18] font-normal text-sky-200 shadow-[inset_0_0_12px_rgba(56,189,248,0.15)]'
                    : 'text-white/45 hover:text-white/80'
                }`}
              >
                Full (Rim + Body)
              </button>
              <button
                type="button"
                onClick={() => setTune({ onlyParticles: true })}
                className={`h-7 flex-1 border-l border-white/[0.07] text-[9.5px] font-light tracking-[0.14em] transition-colors duration-200 ${
                  p.tune.onlyParticles
                    ? 'bg-indigo-400/[0.22] font-normal text-indigo-200 shadow-[inset_0_0_14px_rgba(129,140,248,0.2)]'
                    : 'text-white/45 hover:text-white/80'
                }`}
              >
                ✨ Just Particles
              </button>
            </div>
            <p className="mt-1.5 text-[9px] font-light text-white/30">
              {p.tune.onlyParticles ? 'Showing pure holographic particle organism (rim & glass hidden)' : 'Showing complete SDF rim, inner membrane waves and particle mesh'}
            </p>
          </div>

          {/* RESIDENT FORM */}
          <SegRow<SophiaForm>
            label="Base Form"
            value={p.form}
            onChange={(form) => os.savePrefs({ form })}
            options={[
              { id: 'sphere', label: 'Sphere' },
              { id: 'ring', label: 'Ring' },
            ]}
          />

          {/* THEME PRESETS */}
          <div className="border-t border-white/[0.06] pt-3">
            <p className="mb-2 text-[8.5px] font-light uppercase tracking-[0.34em] text-white/35">Looks</p>
            <div className="grid grid-cols-1 gap-1.5">
              {THEMES.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => {
                    os.applyTheme(theme.id);
                    pulse('tap');
                    rerender();
                  }}
                  className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-left transition hover:border-sky-300/30 hover:bg-white/[0.04]"
                >
                  <span>
                    <span className="block text-[11px] font-light tracking-wide text-white/80">{theme.label}</span>
                    <span className="block text-[9px] font-light text-white/35">{theme.hint}</span>
                  </span>
                  <span
                    className={`size-2.5 rounded-full ${
                      theme.id === 'deepgram'
                        ? 'bg-sky-300'
                        : theme.id === 'studio'
                          ? 'bg-cyan-400'
                          : 'bg-emerald-400'
                    }`}
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          </div>

          {/* INTERACTIVE STATE ANIMATION CONTROLLER */}
          <div className="border-t border-white/[0.06] pt-3">
            <p className="mb-2 text-[8.5px] font-light uppercase tracking-[0.34em] text-white/35">Shape Animation State</p>
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
                    className={`h-7 rounded-lg border text-[9.5px] font-light tracking-wider transition-all duration-200 ${
                      active
                        ? isDone
                          ? 'border-emerald-400/55 bg-emerald-500/[0.22] font-normal text-emerald-100 shadow-[0_0_12px_rgba(52,211,153,0.28)]'
                          : isBlocked
                            ? 'border-rose-400/55 bg-rose-500/[0.22] font-normal text-rose-100 shadow-[0_0_12px_rgba(244,63,94,0.28)]'
                            : 'border-sky-300/45 bg-sky-400/[0.18] font-normal text-sky-100 shadow-[0_0_10px_rgba(56,189,248,0.2)]'
                        : 'border-white/[0.07] bg-white/[0.02] text-white/45 hover:border-white/20 hover:text-white/80'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* EXPANSIVE AUDIO AGENT SHAPE GALLERY */}
          <div className="border-t border-white/[0.06] pt-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[8.5px] font-light uppercase tracking-[0.34em] text-white/35">Shape Gallery</p>
              <span className="text-[8.5px] text-white/30">20+ geometries</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 max-h-[220px] overflow-y-auto pr-1 chat-scroll">
              {ALL_SHAPES.map((sh) => (
                <button
                  key={sh}
                  type="button"
                  onClick={() => triggerShape(sh)}
                  className="flex h-[52px] flex-col items-center justify-center gap-1 rounded-lg border border-white/[0.07] bg-white/[0.02] px-1 text-[9px] font-light tracking-wide text-white/55 transition hover:border-sky-300/30 hover:bg-white/[0.05] hover:text-sky-100"
                >
                  <ShapeThumb shape={sh} />
                  <span className="truncate">{SHAPE_LABELS[sh] || sh}</span>
                </button>
              ))}
            </div>
          </div>

          {/* SHAPE CORRECTION & FINE TUNING */}
          <div className="space-y-3 border-t border-white/[0.06] pt-3">
            <p className="text-[8.5px] font-light uppercase tracking-[0.34em] text-white/35">Shape Correction</p>
            <Slider label="Overall Size" value={p.tune.scale} min={0.8} max={1.2} step={0.01} onChange={(v) => setTune({ scale: v })} />
            <Slider label="Particle Point Size" value={p.tune.particleScale} min={0.6} max={2.2} step={0.05} onChange={(v) => setTune({ particleScale: v })} />
            <Slider label="Sparkle Intensity" value={p.tune.sparkle} min={0.0} max={2.0} step={0.05} onChange={(v) => setTune({ sparkle: v })} />
            {!p.tune.onlyParticles && (
              <Slider label="Rim Thickness" value={p.tune.rim} min={0.6} max={1.6} step={0.02} onChange={(v) => setTune({ rim: v })} />
            )}
            <Slider label="Glow / Bloom" value={p.tune.glow} min={0.5} max={1.6} step={0.02} onChange={(v) => setTune({ glow: v })} />
            <Slider
              label="Color Hue"
              value={p.tune.hue}
              min={-1}
              max={1}
              step={0.05}
              format={(v) => (v < -0.05 ? `Cyan ${Math.round(-v * 100)}%` : v > 0.05 ? `Violet ${Math.round(v * 100)}%` : 'Balanced')}
              onChange={(v) => setTune({ hue: v })}
            />
            <button
              type="button"
              onClick={() => setTune({ ...DEFAULT_TUNE })}
              className="mt-1 h-7 w-full rounded-full border border-white/[0.08] text-[9.5px] font-light tracking-[0.2em] text-white/45 transition hover:border-white/20 hover:text-white/80"
            >
              RESET CORRECTIONS
            </button>
          </div>

          {/* BACKGROUND — separate from Sophia's shape */}
          <div className="space-y-3 border-t border-white/[0.06] pt-3">
            <p className="text-[8.5px] font-light uppercase tracking-[0.34em] text-white/35">Background Aura</p>
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
            <p className="text-[9px] font-light leading-relaxed text-white/25">
              The aura changes by state but stays intentionally softer than the shape.
            </p>
          </div>

          {/* STRUCTURE & MESH DENSITY */}
          <div className="space-y-3 border-t border-white/[0.06] pt-3">
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
          </div>

          {/* VOICE TRANSPORT & SYSTEM */}
          <div className="space-y-3 border-t border-white/[0.06] pt-3">
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
            <p className="text-[9px] font-light leading-relaxed text-white/25">
              Minimal keeps the idle bow still and only breathes. Auto follows the system reduced-motion setting.
            </p>
            <ToggleRow
              label="Haptic & chime"
              hint="soft pulse on wake, pause, complete"
              on={p.haptics}
              onChange={(haptics) => os.savePrefs({ haptics })}
            />
          </div>

          <div className="border-t border-white/[0.06] pt-3">
            <p className="text-[9px] font-light uppercase tracking-[0.3em] text-white/30">Session</p>
            <p className="mt-1 text-[10px] font-light tracking-wide text-white/50">{STATUS_LABEL[status]}</p>
            {os.isMicDisabledError && (
              <button
                type="button"
                onClick={() => {
                  os.resetMicError();
                  rerender();
                }}
                className="mt-2 h-7 w-full rounded-full border border-rose-300/20 bg-rose-400/[0.06] text-[9px] tracking-[0.16em] text-rose-200/75 transition hover:bg-rose-400/[0.12] hover:text-rose-100"
              >
                CLEAR VOICE ERROR & RETRY
              </button>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
