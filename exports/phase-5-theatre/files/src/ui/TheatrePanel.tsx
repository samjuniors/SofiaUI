/**
 * ui/TheatrePanel.tsx — the Theatre (Phase 5).
 *
 * Two tabs: the World Monitor (dot globe + news wire) and Agent Town
 * (Iris, Vera, Atlas & Forge's shared board).
 */
import { useState } from 'react';
import { Earth, Sparkles, Users, X } from 'lucide-react';
import { WorldPanel } from './WorldPanel';
import { TownPanel } from './TownPanel';

type TheatreTab = 'world' | 'town';

const TABS: Array<{ id: TheatreTab; label: string; icon: typeof Earth }> = [
  { id: 'world', label: 'World', icon: Earth },
  { id: 'town', label: 'Town', icon: Users },
];

export function TheatrePanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<TheatreTab>('world');

  return (
    <section
      aria-label="Theatre panel"
      className="fixed bottom-[98px] right-4 z-30 flex max-h-[76vh] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#070b16]/95 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:right-11 sm:w-[420px]"
    >
      <header className="flex items-center gap-2 border-b border-white/[0.07] px-3 py-2">
        <span className="grid size-7 place-items-center rounded-lg bg-sky-500/15 text-sky-300">
          <Sparkles size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-semibold text-white">Theatre</h2>
          <p className="truncate text-[10px] text-white/40">World Monitor · Agent Town</p>
        </div>
        <button
          type="button"
          aria-label="Close Theatre panel"
          onClick={onClose}
          className="rounded-md p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={14} />
        </button>
      </header>

      <div className="flex flex-col gap-2 overflow-y-auto p-2.5">
        <div role="tablist" aria-label="Theatre" className="grid grid-cols-2 gap-1 rounded-xl border border-white/[0.07] bg-white/[0.03] p-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`flex items-center justify-center gap-1.5 rounded-lg px-1 py-1.5 text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-sky-500/25 text-sky-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                    : 'text-white/50 hover:bg-white/[0.06] hover:text-white'
                }`}
              >
                <Icon size={12} />
                {t.label}
              </button>
            );
          })}
        </div>

        <div key={tab} role="tabpanel">
          {tab === 'world' ? <WorldPanel /> : <TownPanel />}
        </div>
      </div>
    </section>
  );
}
