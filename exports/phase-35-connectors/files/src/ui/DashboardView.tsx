/**
 * ui/DashboardView.tsx — OS command center (Phase 12, promoted to the main
 * Sofia interface in Phase 32).
 *
 * Full-width roomy sections:
 *   NOW — the running task + routines (live operations).
 *   SYSTEM — companion link, quick actions, system status, Ear & Mouth.
 *   COMMAND — full-face skills, tools and MCP boards (no more "edit in
 *   Settings" links for the things the user touches daily).
 *   MEMORY — moments + compact memory summary.
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
  Network,
  Orbit,
  PlugZap,
  Puzzle,
  Settings2,
  SquareTerminal,
  Stethoscope,
  Wrench,
} from 'lucide-react';
import type { OSStatus } from '../sophia/SophiaOS';
import type { SophiaStateName } from '../sophia/types';
import { companion } from '../lib/companion-client';
import { memoryStore } from '../core/MemoryStore';
import { skillsRegistry } from '../core/SkillsRegistry';
import { toolRegistry } from '../tools/registry';
import { TaskPanel } from './TaskPanel';
import { EpisodesPanel } from './EpisodesPanel';
import { ProactivePanel } from './ProactivePanel';
import { CompanionBlock } from './DailyPanel';
import { AirplanePanel } from './AirplanePanel';
import { ModeToggle } from './ModeToggle';

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

function Switch({ on, label, onFlip }: { on: boolean; label: string; onFlip: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onFlip}
      className={`relative h-4 w-7 shrink-0 rounded-full border transition-colors duration-200 ${
        on ? 'border-emerald-400/50 bg-emerald-400/30' : 'border-white/10 bg-white/5'
      }`}
    >
      <span
        className={`block size-3 rounded-full transition-transform duration-200 ${
          on ? 'translate-x-3 bg-emerald-300' : 'translate-x-0.5 bg-white/40'
        }`}
      />
    </button>
  );
}

function SkillsBoard() {
  useStoreVersion(skillsRegistry);
  const counts = skillsRegistry.count();
  const skills = skillsRegistry
    .list()
    .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
  return (
    <div>
      <p className="text-[13px] text-white/85">
        <span className="font-mono text-sky-200">
          {counts.enabled}/{counts.total}
        </span>{' '}
        skills on{counts.companion > 0 && <span className="text-white/45"> · {counts.companion} from daemon</span>}
      </p>
      <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1">
        {skills.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-2 py-1.5"
          >
            <span
              aria-hidden="true"
              title={s.source}
              className={`size-1.5 shrink-0 rounded-full ${s.source === 'companion' ? 'bg-violet-400' : 'bg-sky-400'}`}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] text-white/85">{s.label}</p>
              <p className="truncate text-[10px] text-white/40" title={s.description}>
                {s.category} · {s.uses} uses
              </p>
            </div>
            {s.locked ? (
              <span className="shrink-0 text-[9px] uppercase tracking-[0.14em] text-white/30">always on</span>
            ) : (
              <Switch on={s.enabled} label={`${s.label} enabled`} onFlip={() => skillsRegistry.setEnabled(s.id, !s.enabled)} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ToolsBoard() {
  useStoreVersion(skillsRegistry);
  const tools = toolRegistry.list();
  const on = tools.filter((t) => skillsRegistry.isEnabled(t.name)).length;
  return (
    <div>
      <p className="text-[13px] text-white/85">
        <span className="font-mono text-sky-200">
          {on}/{tools.length}
        </span>{' '}
        tools on
      </p>
      <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1">
        {tools.map((t) => {
          const enabled = skillsRegistry.isEnabled(t.name);
          return (
            <li
              key={t.name}
              className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[11px] text-white/85">{t.name}</p>
                <p className="truncate text-[10px] text-white/40" title={t.description || undefined}>
                  {t.description || '—'}
                </p>
              </div>
              <Switch
                on={enabled}
                label={`${t.name} enabled`}
                onFlip={() => skillsRegistry.setEnabled(t.name, !enabled)}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface McpServerInfo {
  id: string;
  name: string;
  status: string;
  scopes: string[];
  tools: string[];
}

interface McpRegistryEntry {
  id: string;
  name: string;
  description: string;
  scopes: string[];
  needsSecrets: boolean;
  needsDirs: boolean;
}

function McpBoard() {
  useStoreVersion(companion);
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<McpRegistryEntry[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const online = companion.connected;

  async function refresh() {
    setMsg(null);
    try {
      const r = await companion.send<{ connectors: McpServerInfo[] }>('connector_list', {}, 15000);
      if (r.ok && r.result) setServers(r.result.connectors);
      else setMsg(r.detail || r.error || 'List failed.');
    } catch {
      setMsg('Daemon unreachable.');
    }
  }

  useEffect(() => {
    if (online) void refresh();
    else setServers([]);
  }, [online]);

  async function search() {
    setBusy(true);
    setMsg(null);
    setLink(null);
    try {
      const r = await companion.send<{ entries: McpRegistryEntry[] }>('connector_search', { query }, 15000);
      if (r.ok && r.result) setResults(r.result.entries);
      else setMsg(r.detail || r.error || 'Search failed.');
    } catch {
      setMsg('Daemon unreachable.');
    } finally {
      setBusy(false);
    }
  }

  async function propose(e: McpRegistryEntry) {
    let dirs: string[] = [];
    if (e.needsDirs) {
      const raw = window.prompt('Absolute directories, comma-separated (the server sees only these):', '');
      if (raw === null) return;
      dirs = raw
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);
      if (dirs.length === 0) {
        setMsg('Filesystem needs at least one directory.');
        return;
      }
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await companion.send<{ link: string }>(
        'connector_propose',
        { entryId: e.id, ...(dirs.length > 0 ? { dirs } : {}) },
        15000,
      );
      if (r.ok && r.result) {
        setLink(r.result.link);
        setMsg(`Consent link ready for ${e.name} — open it to approve.`);
      } else {
        setMsg(r.detail || r.error || 'Propose failed.');
      }
    } catch {
      setMsg('Daemon unreachable.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await companion.send('connector_revoke', { connectorId: id }, 20000);
      if (r.ok) {
        setMsg('Revoked — server stopped, secrets deleted.');
        await refresh();
      } else {
        setMsg(r.detail || r.error || 'Revoke failed.');
      }
    } catch {
      setMsg('Daemon unreachable.');
    } finally {
      setBusy(false);
    }
  }

  if (!online) {
    return (
      <div>
        <Row label="Servers" value="companion offline" tone="warn" />
        <p className="mt-2 text-[11px] text-white/50">Start the companion daemon to use MCP connectors.</p>
      </div>
    );
  }
  const active = servers.filter((s) => s.status === 'active');
  return (
    <div className="flex flex-col gap-2">
      <div className="divide-y divide-white/[0.06]">
        <Row label="Servers" value={`${active.length} connected`} tone={active.length > 0 ? 'ok' : 'dim'} />
      </div>
      {servers.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
          {servers.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-2 py-1.5"
            >
              <span
                aria-hidden="true"
                className={`size-1.5 shrink-0 rounded-full ${s.status === 'active' ? 'bg-emerald-400' : 'bg-white/25'}`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] text-white/85">{s.name}</p>
                <p className="truncate font-mono text-[10px] text-white/40" title={s.scopes.join(', ')}>
                  {s.tools.length} tools · {s.status}
                </p>
              </div>
              {s.status === 'active' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void revoke(s.id)}
                  className="shrink-0 rounded-md border border-rose-400/30 bg-rose-500/15 px-2 py-1 text-[10px] text-rose-200 transition-colors hover:bg-rose-500/25 disabled:opacity-50"
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search();
          }}
          placeholder="Search registry (blank = all)"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-white/85 placeholder:text-white/25 focus:border-sky-400/50 focus:outline-none"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void search()}
          className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/75 transition-colors hover:text-white disabled:opacity-50"
        >
          Search
        </button>
      </div>
      {results.length > 0 && (
        <ul className="max-h-36 space-y-1 overflow-y-auto pr-1">
          {results.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] text-white/85">{e.name}</p>
                <p className="truncate text-[10px] text-white/40" title={e.description}>
                  {e.description}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void propose(e)}
                className="shrink-0 rounded-md border border-sky-400/30 bg-sky-500/15 px-2 py-1 text-[10px] text-sky-200 transition-colors hover:bg-sky-500/25 disabled:opacity-50"
              >
                Propose
              </button>
            </li>
          ))}
        </ul>
      )}
      {link && (
        <div className="rounded-lg border border-emerald-400/25 bg-emerald-500/10 p-2">
          <p className="text-[10px] uppercase tracking-[0.14em] text-emerald-200/80">
            One-click consent link (10 min, loopback only)
          </p>
          <div className="mt-1 flex gap-1.5">
            <input
              readOnly
              value={link}
              onFocus={(e) => e.target.select()}
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 font-mono text-[10px] text-emerald-100"
            />
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-md bg-emerald-500/25 px-2 py-1 text-[10px] font-medium text-emerald-100 hover:bg-emerald-500/35"
            >
              Open
            </a>
          </div>
        </div>
      )}
      {msg && (
        <p className="truncate text-[10px] text-white/55" title={msg}>
          {msg}
        </p>
      )}
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
          <div className="ml-auto">
            <ModeToggle />
          </div>
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
          <Card icon={<Mic size={13} />} title="Ear & Mouth" wide>
            <AirplanePanel serverStatus={null} />
          </Card>
        </Section>

        <Section title="Command">
          <Card icon={<Puzzle size={13} />} title="Skills" wide>
            <SkillsBoard />
          </Card>
          <Card icon={<Wrench size={13} />} title="Tools">
            <ToolsBoard />
          </Card>
          <Card icon={<Network size={13} />} title="MCP">
            <McpBoard />
          </Card>
        </Section>

        <Section title="Memory">
          <Card icon={<History size={13} />} title="Moments">
            <EpisodesPanel />
          </Card>
          <Card icon={<Brain size={13} />} title="Memory">
            <MemoryTile onOpenSettings={onOpenSettings} />
          </Card>
        </Section>

        <p className="text-center font-mono text-[10px] text-white/30">
          Press V or use the rail on the left to switch views.
        </p>
      </div>
    </div>
  );
}
