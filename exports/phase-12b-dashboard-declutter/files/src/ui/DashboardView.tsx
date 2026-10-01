/**
 * ui/DashboardView.tsx — OS control-center view (Phase 12, decluttered 12b).
 *
 * Three roomy sections instead of a cramped settings dump:
 *   NOW — the running task + routines (live operations).
 *   SYSTEM — companion link, quick actions, system status.
 *   MEMORY — moments + compact memory/skills summaries (full editors stay
 *   in Settings, one click away).
 * The orb keeps animating behind; the rail flips back.
 */

import { useEffect, useState } from 'react';
import {
  Activity,
  BellRing,
  Brain,
  Command,
  Cpu,
  History,
  LayoutDashboard,
  MessageCircle,
  Mic,
  Orbit,
  PlugZap,
  Settings2,
  SlidersHorizontal,
  SquareTerminal,
  Stethoscope,
} from 'lucide-react';
import type { OSStatus } from '../sophia/SophiaOS';
import type { SophiaStateName } from '../sophia/types';
import { companion } from '../lib/companion-client';
import { memoryStore } from '../core/MemoryStore';
import { skillsRegistry } from '../core/SkillsRegistry';
import { TaskPanel } from './TaskPanel';
import { EpisodesPanel } from './EpisodesPanel';
import { ProactivePanel } from './ProactivePanel';
import { CompanionBlock } from './DailyPanel';

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
      className={`rounded-2xl border border-white/10 bg-white/[0.02] p-5 shadow-xl backdrop-blur-sm ${
        wide ? 'lg:col-span-2' : ''
      }`}
    >
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sky-300/80">{icon}</span>
        <h2 className="text-[10px] font-normal uppercase tracking-[0.24em] text-white/40">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.3em] text-white/35">{title}</h2>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'dim' }) {
  const color = tone === 'ok' ? 'text-emerald-200' : tone === 'warn' ? 'text-amber-200' : 'text-white/70';
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[11px] uppercase tracking-[0.18em] text-white/35">{label}</span>
      <span className={`truncate font-mono text-[11px] ${color}`}>{value}</span>
    </div>
  );
}

function SettingsLink({ onOpen, children }: { onOpen: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-3 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-sky-200/90 transition hover:bg-white/[0.07]"
    >
      {children}
    </button>
  );
}

function useStoreVersion(target: EventTarget): void {
  const [, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV((n) => n + 1);
    target.addEventListener('change', bump);
    companion.addEventListener('status', bump);
    return () => {
      target.removeEventListener('change', bump);
      companion.removeEventListener('status', bump);
    };
  }, [target]);
}

function MemoryTile({ onOpenSettings }: { onOpenSettings: () => void }) {
  useStoreVersion(memoryStore);
  const snap = memoryStore.snapshot();
  const prefs = Object.keys(snap.preferences).length;
  return (
    <div>
      <p className="text-[13px] text-white/85">
        {snap.userName ? (
          <>
            Remembers <span className="text-sky-200">{snap.userName}</span>
          </>
        ) : (
          'No name set yet'
        )}
      </p>
      <div className="mt-2 divide-y divide-white/[0.06]">
        <Row label="People" value={String(snap.people.length)} />
        <Row label="Preferences" value={String(prefs)} />
        <Row label="Instructions" value={String(snap.instructions.length)} />
      </div>
      <SettingsLink onOpen={onOpenSettings}>Edit in Settings →</SettingsLink>
    </div>
  );
}

function SkillsTile({ onOpenSettings }: { onOpenSettings: () => void }) {
  useStoreVersion(skillsRegistry);
  const counts = skillsRegistry.count();
  return (
    <div>
      <p className="text-[13px] text-white/85">
        <span className="font-mono text-sky-200">
          {counts.enabled}/{counts.total}
        </span>{' '}
        skills on{counts.companion > 0 && <span className="text-white/45"> · {counts.companion} from daemon</span>}
      </p>
      <div className="mt-2 divide-y divide-white/[0.06]">
        <Row
          label="Daemon"
          value={companion.connected ? 'linked' : 'not linked'}
          tone={companion.connected ? 'ok' : 'warn'}
        />
        <Row label="Voice + chat" value="follow these switches" tone="dim" />
      </div>
      <SettingsLink onOpen={onOpenSettings}>Manage in Settings →</SettingsLink>
    </div>
  );
}

function SystemCard({ state, status, health }: { state: SophiaStateName; status: OSStatus; health: string }) {
  useStoreVersion(companion);
  return (
    <div className="divide-y divide-white/[0.06]">
      <Row label="Sofia" value={state} tone="ok" />
      <Row label="Voice" value={status} />
      <Row label="Health" value={health} tone={health === 'ok' || health === 'healthy' ? 'ok' : 'dim'} />
      <Row
        label="Companion"
        value={companion.connected ? `:${companion.info.port} · ${companion.info.actions ?? 0} actions` : 'offline'}
        tone={companion.connected ? 'ok' : 'warn'}
      />
    </div>
  );
}

function QuickActions({
  onMic,
  onOpenChat,
  onOpenTerminal,
  onOpenDiagnostics,
  onOpenSettings,
  onBackToSofia,
}: {
  onMic: () => void;
  onOpenChat: () => void;
  onOpenTerminal: () => void;
  onOpenDiagnostics: () => void;
  onOpenSettings: () => void;
  onBackToSofia: () => void;
}) {
  const tiles = [
    { label: 'Talk', icon: <Mic size={18} />, run: onMic },
    { label: 'Chat', icon: <MessageCircle size={18} />, run: onOpenChat },
    { label: 'Terminal', icon: <SquareTerminal size={18} />, run: onOpenTerminal },
    { label: 'Diagnostics', icon: <Stethoscope size={18} />, run: onOpenDiagnostics },
    { label: 'Settings', icon: <Settings2 size={18} />, run: onOpenSettings },
    { label: 'Sofia', icon: <Orbit size={18} />, run: onBackToSofia },
  ];
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {tiles.map((t) => (
        <button
          key={t.label}
          type="button"
          onClick={t.run}
          className="flex flex-col items-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.03] px-2 py-4 text-white/65 transition hover:border-sky-400/30 hover:bg-white/[0.07] hover:text-white"
        >
          {t.icon}
          <span className="text-[10px] tracking-wide">{t.label}</span>
        </button>
      ))}
    </div>
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
  onBackToSofia,
}: {
  state: SophiaStateName;
  status: OSStatus;
  health: string;
  onMic: () => void;
  onOpenChat: () => void;
  onOpenTerminal: () => void;
  onOpenDiagnostics: () => void;
  onOpenSettings: () => void;
  onBackToSofia: () => void;
}) {
  const dot = STATE_DOT[state] ?? 'bg-white/40';
  const quick = { onMic, onOpenChat, onOpenTerminal, onOpenDiagnostics, onOpenSettings, onBackToSofia };
  return (
    <div className="fixed inset-0 z-20 overflow-y-auto bg-[#04060f]/95 backdrop-blur-md">
      <div className="mx-auto max-w-7xl space-y-8 px-6 py-8 pl-16 sm:px-10">
        <header className="flex flex-wrap items-center gap-3">
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
        </header>

        <Section title="Now">
          <Card icon={<Cpu size={13} />} title="Task" wide>
            <TaskPanel embedded />
          </Card>
          <Card icon={<BellRing size={13} />} title="Routines">
            <ProactivePanel />
          </Card>
        </Section>

        <Section title="System">
          <Card icon={<PlugZap size={13} />} title="Companion">
            <CompanionBlock />
          </Card>
          <Card icon={<Command size={13} />} title="Quick actions">
            <QuickActions {...quick} />
          </Card>
          <Card icon={<Activity size={13} />} title="System">
            <SystemCard state={state} status={status} health={health} />
          </Card>
        </Section>

        <Section title="Memory">
          <Card icon={<History size={13} />} title="Moments">
            <EpisodesPanel />
          </Card>
          <Card icon={<Brain size={13} />} title="Memory">
            <MemoryTile onOpenSettings={onOpenSettings} />
          </Card>
          <Card icon={<SlidersHorizontal size={13} />} title="Skills">
            <SkillsTile onOpenSettings={onOpenSettings} />
          </Card>
        </Section>

        <p className="text-center font-mono text-[10px] text-white/30">
          Press V or use the rail on the left to switch views.
        </p>
      </div>
    </div>
  );
}
