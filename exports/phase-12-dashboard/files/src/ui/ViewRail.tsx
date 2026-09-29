/**
 * ui/ViewRail.tsx — view switcher rail (Phase 12).
 *
 * Slim icon rail pinned to the left edge: Sofia (immersive orb view)
 * or Dashboard (OS control-center view). One click flips the whole
 * interface; `V` does the same from the keyboard.
 */

import { LayoutDashboard, Orbit } from 'lucide-react';

export type AppView = 'sofia' | 'dashboard';

export function ViewRail({ view, onChange }: { view: AppView; onChange: (v: AppView) => void }) {
  const btn = (active: boolean) =>
    `rounded-xl p-2.5 transition-all duration-200 ${
      active
        ? 'bg-sky-400/20 text-sky-200 shadow-[0_0_14px_rgba(var(--th-glow),0.35)]'
        : 'text-white/45 hover:bg-white/[0.06] hover:text-white/85'
    }`;
  return (
    <nav
      aria-label="Switch interface view"
      className="fixed left-3 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-1 rounded-2xl border border-white/10 bg-[#070b16]/85 p-1.5 shadow-2xl backdrop-blur-md"
    >
      <button
        type="button"
        aria-label="Sofia view"
        title="Sofia view (V)"
        aria-pressed={view === 'sofia'}
        onClick={() => onChange('sofia')}
        className={btn(view === 'sofia')}
      >
        <Orbit size={18} />
      </button>
      <button
        type="button"
        aria-label="Dashboard view"
        title="Dashboard view (V)"
        aria-pressed={view === 'dashboard'}
        onClick={() => onChange('dashboard')}
        className={btn(view === 'dashboard')}
      >
        <LayoutDashboard size={18} />
      </button>
    </nav>
  );
}
