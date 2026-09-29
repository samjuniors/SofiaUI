/**
 * ui/DashboardView.tsx — OS control-center view (Phase 12).
 *
 * Everything that is always present, in one place: the running task,
 * Sofia's live status, durable memory, episodic moments, skills and
 * routines — plus shortcuts to chat, terminal, diagnostics and
 * settings. The orb keeps animating behind; the rail flips back.
 */

import {
  Brain,
  Cpu,
  History,
  LayoutDashboard,
  MessageCircle,
  Mic,
  Settings2,
  SlidersHorizontal,
  SquareTerminal,
  Stethoscope,
  BellRing,
} from 'lucide-react';
import type { OSStatus } from '../sophia/SophiaOS';
import type { SophiaStateName } from '../sophia/types';
import { TaskPanel } from './TaskPanel';
import { MemoryPanel, SkillsPanel } from './MindPanels';
import { EpisodesPanel } from './EpisodesPanel';
import { ProactivePanel } from './ProactivePanel';

function Card({
  icon,
  title,
  children,
  wide,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <section
      aria-label={title}
      className={`rounded-2xl border border-white/10 bg-white/[0.02] p-4 shadow-xl backdrop-blur-sm ${
        wide ? 'lg:col-span-2' : ''
      }`}
    >
      <div className="mb-3 flex items-center gap-1.5">
        <span className="text-sky-300/80">{icon}</span>
        <h2 className="text-[9px] font-normal uppercase tracking-[0.24em] text-white/40">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function IconBtn({
  label,
  title,
  onClick,
  active,
  children,
}: {
  label: string;
  title: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-xl border p-2.5 transition-all ${
        active
          ? 'border-sky-400/50 bg-sky-400/20 text-sky-200'
          : 'border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.08] hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

const STATE_DOT: Record<string, string> = {
  idle: 'bg-sky-300',
  listening: 'bg-emerald-300',
  thinking: 'bg-amber-300',
  rendering: 'bg-violet-300',
  speaking: 'bg-cyan-300',
  blocked: 'bg-rose-300',
};

export function DashboardView({
  state,
  status,
  health,
  onMic,
  onOpenChat,
  onOpenTerminal,
  onOpenDiagnostics,
  onOpenSettings,
}: {
  state: SophiaStateName;
  status: OSStatus;
  health: string;
  onMic: () => void;
  onOpenChat: () => void;
  onOpenTerminal: () => void;
  onOpenDiagnostics: () => void;
  onOpenSettings: () => void;
}) {
  const dot = STATE_DOT[state] ?? 'bg-white/40';
  return (
    <div className="fixed inset-0 z-20 overflow-y-auto bg-[#04060f]/92 backdrop-blur-md">
      <div className="mx-auto max-w-6xl px-6 py-6 pl-16 sm:pl-16">
        {/* Header: title + live status + shortcuts */}
        <header className="mb-4 flex flex-wrap items-center gap-3">
          <span className="text-sky-300/90">
            <LayoutDashboard size={20} />
          </span>
          <h1 className="text-lg font-light tracking-wide text-white/90">Dashboard</h1>
          <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/70">
            <span className={`size-1.5 rounded-full ${dot}`} />
            {state}
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] text-white/50">
            voice {status}
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] text-white/50">
            health {health}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <IconBtn label="Talk to Sofia" title="Mic (M)" onClick={onMic}>
              <Mic size={16} />
            </IconBtn>
            <IconBtn label="Open chat" title="Chat (T)" onClick={onOpenChat}>
              <MessageCircle size={16} />
            </IconBtn>
            <IconBtn label="Open terminal" title="Terminal (`)" onClick={onOpenTerminal}>
              <SquareTerminal size={16} />
            </IconBtn>
            <IconBtn label="Open diagnostics" title="Diagnostics (D)" onClick={onOpenDiagnostics}>
              <Stethoscope size={16} />
            </IconBtn>
            <IconBtn label="Open settings" title="Settings" onClick={onOpenSettings}>
              <Settings2 size={16} />
            </IconBtn>
          </div>
        </header>

        {/* Widget grid — every always-present panel, one screen */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <Card icon={<Cpu size={12} />} title="Task" wide>
            <TaskPanel embedded />
          </Card>
          <Card icon={<Brain size={12} />} title="Memory & Facts">
            <MemoryPanel />
          </Card>
          <Card icon={<History size={12} />} title="Moments">
            <EpisodesPanel />
          </Card>
          <Card icon={<SlidersHorizontal size={12} />} title="Skills">
            <SkillsPanel />
          </Card>
          <Card icon={<BellRing size={12} />} title="Routines">
            <ProactivePanel />
          </Card>
        </div>

        <p className="mt-4 text-center font-mono text-[10px] text-white/30">
          Press V or use the rail on the left to switch views.
        </p>
      </div>
    </div>
  );
}
