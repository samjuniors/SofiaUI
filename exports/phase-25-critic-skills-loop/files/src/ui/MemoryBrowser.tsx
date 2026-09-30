/**
 * ui/MemoryBrowser.tsx — Phase 24: the user's window into the 4 memory stores.
 * Browse/search facts, episodes, skills, working state, and the writes log;
 * edit or pin facts, delete anything, export everything as JSON, and trigger
 * consolidation manually. Lives in Settings → Memory & Facts.
 */
import { useEffect, useState } from 'react';
import { Brain, Download, Loader2, MoonStar, Pencil, Pin, PinOff, RotateCw, Trash2, X } from 'lucide-react';
import {
  MemoryError,
  defaultMemoryCaller as mem,
  deleteMemory,
  exportMemory,
  listMemories,
  memoryCounts,
  memoryWrites,
  runConsolidationNow,
  updateMemory,
  type MemoryStoreName,
} from '../lib/memory';

type Tab = 'semantic' | 'episodic' | 'procedural' | 'working' | 'writes';
type Row = Record<string, unknown>;

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'semantic', label: 'Facts' },
  { id: 'episodic', label: 'Episodes' },
  { id: 'procedural', label: 'How-tos' },
  { id: 'working', label: 'Working' },
  { id: 'writes', label: 'Writes' },
];

function age(ts: number, now: number = Date.now()): string {
  if (!ts) return 'unknown';
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Badge({ children, tone = 'dim' }: { children: React.ReactNode; tone?: 'dim' | 'warn' | 'good' }) {
  const color = tone === 'warn' ? 'border-amber-400/30 bg-amber-400/10 text-amber-200/90' : tone === 'good' ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200/90' : 'border-white/10 bg-white/5 text-white/45';
  return <span className={`rounded border px-1 py-px font-mono text-[9px] ${color}`}>{children}</span>;
}

function RowShell({ children, dim }: { children: React.ReactNode; dim?: boolean }) {
  return <li className={`rounded-md px-1.5 py-1.5 hover:bg-white/[0.04] ${dim ? 'opacity-55' : ''}`}>{children}</li>;
}

export function MemoryBrowser() {
  const [tab, setTab] = useState<Tab>('semantic');
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  async function load(into: Tab = tab, q: string = query, st: string = status) {
    setBusy('load');
    setError(null);
    try {
      if (into === 'writes') {
        setRows((await memoryWrites(mem, 30)) as unknown as Row[]);
      } else {
        const store = into as MemoryStoreName;
        setRows((await listMemories(mem, store, { ...(q.trim() ? { q: q.trim() } : {}), ...(st ? { status: st } : {}), limit: 30 })) as Row[]);
      }
      setCounts(await memoryCounts(mem));
    } catch (err) {
      setError(err instanceof MemoryError ? err.message : 'Could not load memory.');
      setRows([]);
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void load('semantic', '', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function switchTab(t: Tab) {
    setTab(t);
    setQuery('');
    setStatus('');
    setEditing(null);
    void load(t, '', '');
  }

  async function remove(store: MemoryStoreName, id: number | string) {
    setBusy(`del-${id}`);
    setError(null);
    setNotice(null);
    try {
      await deleteMemory(mem, store, id);
      setNotice('Deleted.');
      await load();
    } catch (err) {
      setError(err instanceof MemoryError ? err.message : 'Delete failed.');
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit(id: number) {
    if (!draft.trim()) return;
    setBusy(`edit-${id}`);
    setError(null);
    try {
      await updateMemory(mem, 'semantic', id, { text: draft.trim() });
      setEditing(null);
      setNotice('Fact updated.');
      await load();
    } catch (err) {
      setError(err instanceof MemoryError ? err.message : 'Update failed.');
    } finally {
      setBusy(null);
    }
  }

  async function togglePin(row: Row) {
    const id = row.id as number;
    setBusy(`pin-${id}`);
    try {
      await updateMemory(mem, 'semantic', id, { pinned: row.pinned !== true });
      await load();
    } catch (err) {
      setError(err instanceof MemoryError ? err.message : 'Pin failed.');
    } finally {
      setBusy(null);
    }
  }

  async function setSkillStatus(id: number, next: string) {
    setBusy(`skill-${id}`);
    try {
      await updateMemory(mem, 'procedural', id, { status: next });
      setNotice(next === 'retired' ? 'How-to retired.' : 'How-to activated.');
      await load();
    } catch (err) {
      setError(err instanceof MemoryError ? err.message : 'Update failed.');
    } finally {
      setBusy(null);
    }
  }

  async function runExport() {
    setBusy('export');
    setError(null);
    try {
      const dump = await exportMemory(mem, false);
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sofia-memory-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice('Memory exported.');
    } catch (err) {
      setError(err instanceof MemoryError ? err.message : 'Export failed.');
    } finally {
      setBusy(null);
    }
  }

  async function dream() {
    setBusy('dream');
    setError(null);
    setNotice(null);
    try {
      const r = await runConsolidationNow(mem, false);
      if (r.skipped) setNotice(`Consolidation skipped (${r.skipped}).`);
      else {
        const s = r.stats ?? {};
        setNotice(`Dreamed: ${s.merged ?? 0} merged · ${s.resolved ?? 0} resolved · ${s.flagged ?? 0} flagged · ${s.skillsProposed ?? 0} how-tos proposed.`);
      }
      await load();
    } catch (err) {
      setError(err instanceof MemoryError ? err.message : 'Consolidation failed.');
    } finally {
      setBusy(null);
    }
  }

  const iconBtn = 'rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white/80 disabled:opacity-40';
  const input = 'w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 focus:border-sky-400/50 focus:outline-none disabled:opacity-50';

  function factRow(r: Row) {
    const id = r.id as number;
    const untrusted = r.sourceTrust === 'untrusted';
    return (
      <RowShell key={id} dim={r.status !== 'active'}>
        {editing === id ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveEdit(id);
            }}
            className="flex gap-1.5"
          >
            <input aria-label="Edit fact" className={input} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy !== null} />
            <button type="submit" className={iconBtn} aria-label="Save fact" disabled={busy !== null || !draft.trim()}>
              {busy === `edit-${id}` ? <Loader2 size={12} className="animate-spin" /> : <Pencil size={12} />}
            </button>
            <button type="button" className={iconBtn} aria-label="Cancel edit" onClick={() => setEditing(null)}>
              <X size={12} />
            </button>
          </form>
        ) : (
          <>
            <p className="text-[11px] leading-snug text-white/80">{String(r.text ?? '')}</p>
            <p className="mt-1 flex flex-wrap items-center gap-1">
              <Badge>via {String(r.source ?? '?')}</Badge>
              {untrusted && <Badge tone="warn">unverified</Badge>}
              <Badge>{Math.round(Number(r.confidence ?? 0) * 100)}%</Badge>
              {r.status !== 'active' && <Badge tone={r.status === 'flagged' ? 'warn' : 'dim'}>{String(r.status)}</Badge>}
              {r.pinned === true && <Badge tone="good">pinned</Badge>}
              <span className="text-[10px] text-white/35">{age(Number(r.ts ?? 0))}</span>
              <span className="flex-1" />
              <button type="button" className={iconBtn} aria-label={r.pinned === true ? 'Unpin fact' : 'Pin fact'} title={r.pinned === true ? 'Unpin from peer card' : 'Pin to peer card'} disabled={busy !== null} onClick={() => void togglePin(r)}>
                {r.pinned === true ? <PinOff size={12} /> : <Pin size={12} />}
              </button>
              <button
                type="button"
                className={iconBtn}
                aria-label="Edit fact"
                disabled={busy !== null}
                onClick={() => {
                  setEditing(id);
                  setDraft(String(r.text ?? ''));
                }}
              >
                <Pencil size={12} />
              </button>
              <button type="button" className={iconBtn} aria-label="Delete fact" disabled={busy !== null} onClick={() => void remove('semantic', id)}>
                {busy === `del-${id}` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              </button>
            </p>
          </>
        )}
      </RowShell>
    );
  }

  function episodeRow(r: Row) {
    const id = r.id as number;
    const shots = Array.isArray(r.shots) ? r.shots.length : 0;
    return (
      <RowShell key={id}>
        <p className="text-[11px] leading-snug text-white/80">{String(r.summary || r.text || '')}</p>
        <p className="mt-1 flex flex-wrap items-center gap-1">
          <Badge>{String(r.kind ?? '?')}</Badge>
          {(r.outcome ?? 'none') !== 'none' && <Badge tone={r.outcome === 'done' ? 'good' : 'warn'}>{String(r.outcome)}</Badge>}
          {shots > 0 && <Badge>{shots} shot{shots === 1 ? '' : 's'}</Badge>}
          <span className="text-[10px] text-white/35">{age(Number(r.ts ?? 0))}</span>
          <span className="flex-1" />
          <button type="button" className={iconBtn} aria-label="Delete episode" disabled={busy !== null} onClick={() => void remove('episodic', id)}>
            {busy === `del-${id}` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          </button>
        </p>
      </RowShell>
    );
  }

  function skillRow(r: Row) {
    const id = r.id as number;
    return (
      <RowShell key={id} dim={r.status === 'retired'}>
        <p className="text-[11px] leading-snug text-white/80">{String(r.name ?? '')}</p>
        <p className="text-[10px] text-white/45">when: {String(r.trigger ?? '')}</p>
        {Array.isArray((r.steps as { failureModes?: unknown } | null)?.failureModes) &&
          ((r.steps as { failureModes: unknown[] }).failureModes.length > 0 ? (
            <p className="text-[10px] text-amber-200/70">
              fails when: {(r.steps as { failureModes: unknown[] }).failureModes.map(String).join('; ').slice(0, 160)}
            </p>
          ) : null)}
        <p className="mt-1 flex flex-wrap items-center gap-1">
          <Badge tone={r.status === 'active' ? 'good' : 'dim'}>{String(r.status ?? '?')}</Badge>
          <Badge>
            {typeof r.successRate === 'number'
              ? `${Math.round(r.successRate * 100)}% · ${Number(r.useCount ?? 0)}×`
              : `${Number(r.successCount ?? 0)}× won`}
          </Badge>
          <span className="flex-1" />
          {r.status !== 'active' && r.status !== 'retired' && (
            <button type="button" className="rounded px-1.5 py-0.5 text-[10px] text-emerald-200/80 hover:bg-white/10 disabled:opacity-40" disabled={busy !== null} onClick={() => void setSkillStatus(id, 'active')}>
              Activate
            </button>
          )}
          {r.status !== 'retired' && (
            <button type="button" className="rounded px-1.5 py-0.5 text-[10px] text-white/45 hover:bg-white/10 disabled:opacity-40" disabled={busy !== null} onClick={() => void setSkillStatus(id, 'retired')}>
              Retire
            </button>
          )}
          <button type="button" className={iconBtn} aria-label="Delete how-to" disabled={busy !== null} onClick={() => void remove('procedural', id)}>
            {busy === `del-${id}` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          </button>
        </p>
      </RowShell>
    );
  }

  function workingRow(r: Row) {
    const sid = String(r.sessionId ?? 'default');
    return (
      <RowShell key={sid}>
        <p className="text-[11px] leading-snug text-white/80">{String(r.goal || r.scratchpad || '(empty scratchpad)')}</p>
        <p className="mt-1 flex flex-wrap items-center gap-1">
          <Badge>{sid}</Badge>
          <span className="text-[10px] text-white/35">{age(Number(r.updatedAt ?? 0))}</span>
          <span className="flex-1" />
          <button type="button" className={iconBtn} aria-label="Clear working state" disabled={busy !== null} onClick={() => void remove('working', sid)}>
            {busy === `del-${sid}` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          </button>
        </p>
      </RowShell>
    );
  }

  function writeRow(r: Row, i: number) {
    return (
      <RowShell key={`${r.id ?? i}`}>
        <p className="text-[11px] leading-snug text-white/70">
          <span className="font-mono text-white/50">{String(r.store)}.{String(r.op)}</span> #{String(r.refId)} — {String(r.summary || '')}
        </p>
        <p className="mt-0.5 flex items-center gap-1 text-[10px] text-white/35">
          <span>{String(r.actor ?? '?')}</span>·<span>{age(Number(r.ts ?? 0))}</span>
        </p>
      </RowShell>
    );
  }

  const total = (counts.facts ?? 0) + (counts.episodes ?? 0) + (counts.skills ?? 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Brain size={12} className="text-violet-300/80" />
        <p className="flex-1 text-[9px] font-normal uppercase tracking-[0.24em] text-white/40">Memory Stores</p>
        {total > 0 && <span className="font-mono text-[9px] text-white/45">{total} items</span>}
        <button type="button" className={iconBtn} aria-label="Dream now (consolidate)" title="Run consolidation now" disabled={busy !== null} onClick={() => void dream()}>
          {busy === 'dream' ? <Loader2 size={12} className="animate-spin" /> : <MoonStar size={12} />}
        </button>
        <button type="button" className={iconBtn} aria-label="Export memory as JSON" title="Export all memory as JSON" disabled={busy !== null} onClick={() => void runExport()}>
          {busy === 'export' ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
        </button>
        <button type="button" className={iconBtn} aria-label="Refresh memory" disabled={busy !== null} onClick={() => void load()}>
          <RotateCw size={12} className={busy === 'load' ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex gap-1" role="tablist" aria-label="Memory stores">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            type="button"
            onClick={() => switchTab(t.id)}
            className={`rounded-md px-2 py-1 text-[11px] ${tab === t.id ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white/75'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'semantic' && (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void load('semantic', query, status);
          }}
        >
          <input aria-label="Search facts" className={input} placeholder="Search facts…" value={query} onChange={(e) => setQuery(e.target.value)} disabled={busy !== null} />
          <select aria-label="Fact status" className="rounded-lg border border-white/10 bg-black/40 px-1.5 text-[11px] text-white/70" value={status} onChange={(e) => { setStatus(e.target.value); void load('semantic', query, e.target.value); }} disabled={busy !== null}>
            <option value="">active</option>
            <option value="flagged">flagged</option>
            <option value="superseded">old</option>
          </select>
        </form>
      )}

      {error && <p className="rounded-md border border-red-400/30 bg-red-400/10 px-2 py-1.5 text-[11px] text-red-200">{error}</p>}
      {notice && <p className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 py-1.5 text-[11px] text-emerald-200">{notice}</p>}

      <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
        {rows.length === 0 && busy === null && <li className="px-1.5 py-2 text-[11px] text-white/35">Nothing here yet.</li>}
        {tab === 'semantic' && rows.map(factRow)}
        {tab === 'episodic' && rows.map(episodeRow)}
        {tab === 'procedural' && rows.map(skillRow)}
        {tab === 'working' && rows.map(workingRow)}
        {tab === 'writes' && rows.map(writeRow)}
      </ul>
    </div>
  );
}
