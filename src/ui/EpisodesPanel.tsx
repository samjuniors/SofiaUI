/**
 * ui/EpisodesPanel.tsx — searchable episodic memory (Phase 6).
 *
 * Recent moments, full-text search and pin-a-moment, over the companion
 * `episodes_*` actions. Lives in Settings → Memory & Facts.
 */
import { useEffect, useState } from 'react';
import { History, Loader2, Pin, RotateCw, Search, X } from 'lucide-react';
import {
  EpisodeError,
  addEpisode,
  defaultEpisodeCaller as episodes,
  episodeAge,
  recentEpisodes,
  searchEpisodes,
  type Episode,
  type EpisodeEngine,
} from '../lib/episodes';

const ROLES = ['note', 'milestone', 'reminder', 'quote'];

function EpisodeRow({ episode }: { episode: Episode }) {
  return (
    <li className="rounded-md px-1.5 py-1 hover:bg-white/[0.04]">
      <p className="text-[11px] leading-snug text-white/80">{episode.text}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-white/35">
        <span className="rounded bg-white/[0.06] px-1 py-px uppercase tracking-wide">{episode.role}</span>
        {episodeAge(episode.ts)}
      </p>
    </li>
  );
}

export function EpisodesPanel() {
  const [recent, setRecent] = useState<Episode[]>([]);
  const [hits, setHits] = useState<Episode[] | null>(null);
  const [engine, setEngine] = useState<EpisodeEngine>('unknown');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [role, setRole] = useState('note');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadRecent() {
    setBusy('recent');
    setError(null);
    try {
      const r = await recentEpisodes(episodes, 8);
      setRecent(r.episodes);
      setEngine(r.engine);
    } catch (err) {
      setError(err instanceof EpisodeError ? err.message : 'Could not load moments.');
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void loadRecent();
  }, []);

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) {
      setHits(null);
      return;
    }
    setBusy('search');
    setError(null);
    try {
      const r = await searchEpisodes(episodes, query.trim());
      setHits(r.hits);
      setEngine(r.engine);
    } catch (err) {
      setError(err instanceof EpisodeError ? err.message : 'Search failed.');
    } finally {
      setBusy(null);
    }
  }

  async function pinMoment(e?: React.FormEvent) {
    e?.preventDefault();
    if (!draft.trim()) return;
    setBusy('add');
    setError(null);
    setNotice(null);
    try {
      await addEpisode(episodes, draft.trim(), role);
      setDraft('');
      setNotice('Moment pinned.');
      await loadRecent();
    } catch (err) {
      setError(err instanceof EpisodeError ? err.message : 'Could not pin that moment.');
    } finally {
      setBusy(null);
    }
  }

  const input =
    'w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 focus:border-sky-400/50 focus:outline-none disabled:opacity-50';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <History size={12} className="text-sky-300/80" />
        <p className="flex-1 text-[9px] font-normal uppercase tracking-[0.24em] text-white/40">
          Episodic Memory
        </p>
        {engine !== 'unknown' && (
          <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-px font-mono text-[9px] text-white/45">
            {engine}
          </span>
        )}
        <button
          type="button"
          aria-label="Refresh moments"
          disabled={busy !== null}
          onClick={() => void loadRecent()}
          className="rounded-md border border-white/10 bg-white/5 p-1 text-white/60 transition-colors hover:text-white disabled:opacity-50"
        >
          <RotateCw size={11} className={busy === 'recent' ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Search */}
      <form onSubmit={(e) => void runSearch(e)} className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-white/35" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search past moments…"
            aria-label="Search moments"
            disabled={busy !== null}
            className={`${input} pl-7 pr-7`}
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery('');
                setHits(null);
              }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={busy !== null}
          className="rounded-lg border border-sky-400/40 bg-sky-500/20 px-2.5 py-1.5 text-[11px] text-sky-100 transition-colors hover:bg-sky-500/30 disabled:opacity-50"
        >
          {busy === 'search' ? <Loader2 size={13} className="animate-spin" /> : 'Find'}
        </button>
      </form>

      {error && (
        <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-200">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2 py-1.5 text-[11px] text-emerald-200">
          {notice}
        </p>
      )}

      {/* Results / recent */}
      {hits !== null ? (
        <ul className="flex max-h-44 flex-col gap-0.5 overflow-y-auto rounded-lg border border-white/[0.07] bg-white/[0.02] p-1">
          {hits.length === 0 && <li className="px-1.5 py-2 text-[11px] text-white/40">No moments match.</li>}
          {hits.map((h, i) => (
            <EpisodeRow key={h.id ?? `${h.ts}-${i}`} episode={h} />
          ))}
        </ul>
      ) : (
        <ul className="flex max-h-44 flex-col gap-0.5 overflow-y-auto rounded-lg border border-white/[0.07] bg-white/[0.02] p-1">
          {busy === 'recent' && recent.length === 0 && (
            <li className="flex items-center gap-1.5 px-1.5 py-2 text-[11px] text-white/40">
              <Loader2 size={12} className="animate-spin" /> Remembering…
            </li>
          )}
          {busy !== 'recent' && recent.length === 0 && !error && (
            <li className="px-1.5 py-2 text-[11px] text-white/40">No moments yet — pin the first one below.</li>
          )}
          {recent.map((h, i) => (
            <EpisodeRow key={h.id ?? `${h.ts}-${i}`} episode={h} />
          ))}
        </ul>
      )}

      {/* Pin a moment */}
      <form onSubmit={(e) => void pinMoment(e)} className="flex items-center gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Pin a moment to remember…"
          aria-label="New moment text"
          maxLength={500}
          disabled={busy !== null}
          className={`${input} flex-1`}
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          aria-label="Moment kind"
          disabled={busy !== null}
          className="shrink-0 rounded-lg border border-white/10 bg-black/40 px-1.5 py-1.5 text-[11px] text-white/70 focus:border-sky-400/50 focus:outline-none disabled:opacity-50"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy !== null || !draft.trim()}
          aria-label="Pin moment"
          className="shrink-0 rounded-lg border border-sky-400/40 bg-sky-500/20 p-2 text-sky-100 transition-colors hover:bg-sky-500/30 disabled:opacity-50"
        >
          {busy === 'add' ? <Loader2 size={13} className="animate-spin" /> : <Pin size={13} />}
        </button>
      </form>
    </div>
  );
}
