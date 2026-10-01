/**
 * settings/controls.tsx — shared primitives for the settings accordion.
 * Extracted verbatim from SettingsSheet (Phase 22 split); no visual change.
 */

import { ChevronDown } from 'lucide-react';

export function SegRow<T extends string>({
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
      <div className="flex flex-wrap overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02] p-0.5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={`h-7 min-w-[70px] flex-1 rounded-lg text-[9px] font-normal tracking-[0.08em] transition-all duration-200 ${
              value === o.id
                ? 'border border-sky-400/30 bg-sky-400/[0.18] text-sky-100 shadow-[inset_0_0_10px_rgba(var(--th-glow),0.18)]'
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

export function ToggleRow({
  label,
  hint,
  on,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  on: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className={`flex items-center justify-between ${disabled ? 'opacity-40' : ''}`}>
      <div>
        <p className="text-[10px] font-normal uppercase tracking-[0.2em] text-white/70">{label}</p>
        {hint && <p className="text-[8.5px] font-light text-white/35">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={`relative h-5 w-9 rounded-full border transition-colors duration-200 ${
          on ? 'border-sky-400/50 bg-sky-400/30 shadow-[0_0_10px_rgba(var(--th-glow),0.3)]' : 'border-white/10 bg-white/5'
        }`}
      >
        <span
          className={`block size-3.5 rounded-full transition-transform duration-200 ${
            on ? 'translate-x-4 bg-sky-300 shadow-[0_0_6px_rgba(var(--th-glow-soft),0.8)]' : 'translate-x-0.5 bg-white/40'
          }`}
        />
      </button>
    </div>
  );
}

export function Slider({
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

export function AccordionSection({
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
