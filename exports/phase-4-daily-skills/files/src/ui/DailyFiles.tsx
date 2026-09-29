/**
 * ui/DailyFiles.tsx — companion file browser (Phase 4).
 *
 * Browse roots, search, preview, open, rename, trash (two-step confirm)
 * and restore from the session's trash list.
 */
import { useEffect, useState } from 'react';
import {
  ChevronRight,
  CornerUpLeft,
  ExternalLink,
  FileText,
  Folder,
  Loader2,
  Pencil,
  RotateCw,
  Search,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import {
  DailyError,
  defaultCaller as daily,
  findFiles,
  formatBytes,
  listFiles,
  listRoots,
  openFile,
  readFile,
  renameFile,
  restoreFile,
  trashFile,
  truncate,
  type FileEntry,
  type FileHit,
  type TrashRecord,
} from '../lib/daily-skills';

function splitPath(path: string): { segs: string[]; sep: string } {
  const sep = path.includes('\\') ? '\\' : '/';
  return { segs: path.split(/[\\/]+/).filter(Boolean), sep };
}

function baseName(path: string): string {
  const { segs } = splitPath(path);
  return segs[segs.length - 1] ?? path;
}

function prefixOf(path: string, index: number): string {
  const { segs, sep } = splitPath(path);
  const head = segs.slice(0, index + 1).join(sep);
  if (sep === '/') return `/${head}`;
  return head.endsWith(':') ? `${head}${sep}` : head;
}

interface Preview {
  path: string;
  bytes: number;
  text: string;
}

export function DailyFiles() {
  const [roots, setRoots] = useState<string[]>([]);
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<FileHit[] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmTrash, setConfirmTrash] = useState<string | null>(null);
  const [trashed, setTrashed] = useState<TrashRecord[]>([]);

  async function showDir(dir: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await listFiles(daily, dir);
      setPath(r.path);
      setEntries(r.entries);
      setHits(null);
      setPreview(null);
    } catch (err) {
      setError(err instanceof DailyError ? err.message : 'Could not list that folder.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let live = true;
    (async () => {
      setBusy(true);
      try {
        const r = await listRoots(daily);
        if (!live) return;
        setRoots(r);
        if (r.length > 0) await showDir(r[0]);
      } catch (err) {
        if (live) setError(err instanceof DailyError ? err.message : 'Could not reach the companion.');
      } finally {
        if (live) setBusy(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) {
      setHits(null);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const found = await findFiles(daily, query.trim());
      setHits(found);
      setPreview(null);
    } catch (err) {
      setError(err instanceof DailyError ? err.message : 'Search failed.');
    } finally {
      setBusy(false);
    }
  }

  async function openPreview(entryPath: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await readFile(daily, entryPath);
      setPreview(r);
    } catch (err) {
      setError(err instanceof DailyError ? err.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  }

  async function doOpen(entryPath: string) {
    setError(null);
    setNotice(null);
    try {
      await openFile(daily, entryPath);
      setNotice(`Opened ${baseName(entryPath)}.`);
    } catch (err) {
      setError(err instanceof DailyError ? err.message : 'Could not open that file.');
    }
  }

  async function doRename(entry: FileEntry) {
    const next = renameValue.trim();
    if (!next) return;
    setBusy(true);
    setError(null);
    try {
      await renameFile(daily, path, entry.name, next);
      setRenaming(null);
      setNotice(`Renamed to ${next}.`);
      await showDir(path);
    } catch (err) {
      setError(err instanceof DailyError ? err.message : 'Rename failed.');
    } finally {
      setBusy(false);
    }
  }

  async function doTrash(entry: FileEntry) {
    const sep = path.includes('\\') ? '\\' : '/';
    const full = `${path.replace(/[\\/]+$/, '')}${sep}${entry.name}`;
    setBusy(true);
    setError(null);
    try {
      const rec = await trashFile(daily, full, true);
      setTrashed((t) => [rec, ...t].slice(0, 8));
      setConfirmTrash(null);
      setNotice(`Moved ${entry.name} to trash.`);
      await showDir(path);
    } catch (err) {
      if (err instanceof DailyError && err.needsConfirmation) {
        // Should not happen (we confirm inline), but stay safe.
        setConfirmTrash(entry.name);
      } else {
        setError(err instanceof DailyError ? err.message : 'Trash failed.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function doRestore(rec: TrashRecord) {
    setBusy(true);
    setError(null);
    try {
      await restoreFile(daily, rec.trashPath);
      setTrashed((t) => t.filter((x) => x.trashPath !== rec.trashPath));
      setNotice(`Restored ${baseName(rec.trashed)}.`);
      await showDir(path);
    } catch (err) {
      setError(err instanceof DailyError ? err.message : 'Restore failed.');
    } finally {
      setBusy(false);
    }
  }

  const { segs } = splitPath(path);
  const searching = hits !== null;

  return (
    <div className="flex flex-col gap-2">
      {/* Roots + refresh */}
      <div className="flex items-center gap-1.5">
        <div className="flex flex-1 flex-wrap gap-1">
          {roots.map((r) => (
            <button
              key={r}
              type="button"
              disabled={busy}
              onClick={() => void showDir(r)}
              className={`rounded-md border px-1.5 py-0.5 text-[10px] transition-colors disabled:opacity-50 ${
                path === r || path.startsWith(r)
                  ? 'border-sky-400/50 bg-sky-500/20 text-sky-200'
                  : 'border-white/10 bg-white/5 text-white/60 hover:text-white'
              }`}
            >
              {truncate(baseName(r) || r, 14)}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label="Refresh folder"
          disabled={busy || !path}
          onClick={() => void showDir(path)}
          className="rounded-md border border-white/10 bg-white/5 p-1 text-white/60 transition-colors hover:text-white disabled:opacity-50"
        >
          <RotateCw size={12} />
        </button>
      </div>

      {/* Breadcrumb */}
      {path && !preview && (
        <div className="flex flex-wrap items-center gap-0.5 text-[10px] text-white/50">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const parent = segs.length > 1 ? prefixOf(path, segs.length - 2) : path;
              void showDir(parent);
            }}
            className="flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            <CornerUpLeft size={11} /> Up
          </button>
          {segs.map((s, i) => (
            <span key={`${i}-${s}`} className="flex items-center gap-0.5">
              <ChevronRight size={10} className="text-white/25" />
              <button
                type="button"
                disabled={busy}
                onClick={() => void showDir(prefixOf(path, i))}
                className={`rounded px-0.5 py-0.5 hover:bg-white/10 hover:text-white disabled:opacity-50 ${
                  i === segs.length - 1 ? 'text-sky-200' : ''
                }`}
              >
                {truncate(s, 18)}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search */}
      <form onSubmit={(e) => void runSearch(e)} className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-white/35" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files…"
            aria-label="Search files"
            className="w-full rounded-lg border border-white/10 bg-black/40 py-1.5 pl-7 pr-7 text-xs text-white placeholder:text-white/30 focus:border-sky-400/50 focus:outline-none"
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
          disabled={busy}
          className="rounded-lg border border-sky-400/40 bg-sky-500/20 px-2.5 py-1.5 text-[11px] text-sky-100 transition-colors hover:bg-sky-500/30 disabled:opacity-50"
        >
          Find
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

      {/* Preview */}
      {preview ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 flex-1 truncate text-[11px] font-medium text-white/85">
              {baseName(preview.path)}{' '}
              <span className="font-normal text-white/40">· {formatBytes(preview.bytes)}</span>
            </p>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/60 hover:text-white"
            >
              Back
            </button>
          </div>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-black/50 p-2 text-[11px] leading-relaxed text-white/80">
            {truncate(preview.text, 8000) || '(empty file)'}
          </pre>
        </div>
      ) : searching ? (
        <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
          {hits.length === 0 && <li className="px-1 py-2 text-[11px] text-white/40">No matches.</li>}
          {hits.map((h) => (
            <li key={h.path}>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (h.dir) void showDir(h.path);
                  else void openPreview(h.path);
                }}
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] text-white/75 hover:bg-white/10 hover:text-white disabled:opacity-50"
              >
                {h.dir ? <Folder size={12} className="shrink-0 text-sky-300/80" /> : <FileText size={12} className="shrink-0 text-white/40" />}
                <span className="min-w-0 flex-1 truncate">{h.path}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
          {busy && entries.length === 0 && (
            <li className="flex items-center gap-1.5 px-1 py-2 text-[11px] text-white/40">
              <Loader2 size={12} className="animate-spin" /> Loading…
            </li>
          )}
          {!busy && entries.length === 0 && path && (
            <li className="px-1 py-2 text-[11px] text-white/40">Empty folder.</li>
          )}
          {entries.map((e) => (
            <li key={e.name} className="group rounded-md hover:bg-white/[0.07]">
              {renaming === e.name ? (
                <form
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    void doRename(e);
                  }}
                  className="flex items-center gap-1 px-1.5 py-1"
                >
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(ev) => setRenameValue(ev.target.value)}
                    aria-label="New name"
                    className="min-w-0 flex-1 rounded border border-sky-400/50 bg-black/50 px-1.5 py-0.5 text-[11px] text-white focus:outline-none"
                  />
                  <button type="submit" disabled={busy} className="rounded px-1.5 py-0.5 text-[11px] text-emerald-300 hover:bg-white/10 disabled:opacity-50">
                    Save
                  </button>
                  <button type="button" onClick={() => setRenaming(null)} className="rounded px-1.5 py-0.5 text-[11px] text-white/50 hover:bg-white/10">
                    Cancel
                  </button>
                </form>
              ) : confirmTrash === e.name ? (
                <div className="flex items-center gap-1 px-1.5 py-1 text-[11px]">
                  <span className="min-w-0 flex-1 truncate text-amber-200">Trash “{e.name}”?</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void doTrash(e)}
                    className="rounded border border-rose-400/40 bg-rose-500/20 px-1.5 py-0.5 text-rose-100 hover:bg-rose-500/30 disabled:opacity-50"
                  >
                    Trash
                  </button>
                  <button type="button" onClick={() => setConfirmTrash(null)} className="rounded px-1.5 py-0.5 text-white/60 hover:bg-white/10">
                    Keep
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1 px-1.5 py-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (e.dir) {
                        const sep = path.includes('\\') ? '\\' : '/';
                        void showDir(`${path.replace(/[\\/]+$/, '')}${sep}${e.name}`);
                      } else {
                        const sep = path.includes('\\') ? '\\' : '/';
                        void openPreview(`${path.replace(/[\\/]+$/, '')}${sep}${e.name}`);
                      }
                    }}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11px] text-white/80 hover:text-white disabled:opacity-50"
                  >
                    {e.dir ? <Folder size={12} className="shrink-0 text-sky-300/80" /> : <FileText size={12} className="shrink-0 text-white/40" />}
                    <span className="truncate">{e.name}</span>
                  </button>
                  <span className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    {!e.dir && (
                      <button
                        type="button"
                        aria-label={`Open ${e.name}`}
                        title="Open in default app"
                        disabled={busy}
                        onClick={() => {
                          const sep = path.includes('\\') ? '\\' : '/';
                          void doOpen(`${path.replace(/[\\/]+$/, '')}${sep}${e.name}`);
                        }}
                        className="rounded p-1 text-white/45 hover:bg-white/10 hover:text-white disabled:opacity-50"
                      >
                        <ExternalLink size={12} />
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`Rename ${e.name}`}
                      disabled={busy}
                      onClick={() => {
                        setRenaming(e.name);
                        setRenameValue(e.name);
                      }}
                      className="rounded p-1 text-white/45 hover:bg-white/10 hover:text-white disabled:opacity-50"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Trash ${e.name}`}
                      disabled={busy}
                      onClick={() => setConfirmTrash(e.name)}
                      className="rounded p-1 text-white/45 hover:bg-white/10 hover:text-rose-300 disabled:opacity-50"
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Session trash */}
      {trashed.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5">
          <p className="px-1 pb-1 text-[10px] uppercase tracking-wide text-white/40">Recently trashed · restore</p>
          <div className="flex flex-col gap-0.5">
            {trashed.map((t) => (
              <div key={t.trashPath} className="flex items-center gap-1.5 px-1 text-[11px]">
                <span className="min-w-0 flex-1 truncate text-white/65">{baseName(t.trashed)}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void doRestore(t)}
                  className="flex items-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-white/70 hover:text-white disabled:opacity-50"
                >
                  <Undo2 size={11} /> Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
