/**
 * ui/ThemePicker.tsx — the four UI colour themes (Phase 5 Theatre).
 *
 * Swatch buttons that re-skin every panel instantly via `data-theme`.
 */
import { Check } from 'lucide-react';
import { UI_THEMES, themeById, type UiThemeId } from '../lib/themes';

export function ThemePicker({
  value,
  onChange,
}: {
  value: UiThemeId;
  onChange: (id: UiThemeId) => void;
}) {
  const active = themeById(value);
  return (
    <div>
      <p className="mb-2 text-[9px] font-normal uppercase tracking-[0.24em] text-white/40">
        Interface Theme
      </p>
      <div
        role="radiogroup"
        aria-label="Interface theme"
        className="grid grid-cols-4 gap-1 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1"
      >
        {UI_THEMES.map((t) => {
          const selected = t.id === active.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={selected}
              title={`${t.label} — ${t.hint}`}
              onClick={() => onChange(t.id)}
              className={`flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 transition-all duration-200 ${
                selected
                  ? 'border border-sky-400/30 bg-sky-400/[0.18] shadow-[inset_0_0_10px_rgba(var(--th-glow),0.18)]'
                  : 'border border-transparent hover:bg-white/[0.06]'
              }`}
            >
              <span
                aria-hidden="true"
                className="grid size-5 place-items-center rounded-full border border-white/20"
                style={{ background: `linear-gradient(135deg, ${t.swatch}, ${t.glow})` }}
              >
                {selected && <Check size={11} strokeWidth={3} className="text-white drop-shadow" />}
              </span>
              <span className={`text-[9.5px] font-normal tracking-[0.06em] ${selected ? 'text-sky-100' : 'text-white/45'}`}>
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[10px] text-white/35">{active.hint} · panels, dock and glows follow.</p>
    </div>
  );
}
