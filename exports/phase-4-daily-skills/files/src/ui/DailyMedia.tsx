/**
 * ui/DailyMedia.tsx — media transport + volume (Phase 4).
 *
 * Play/pause/skip/stop plus volume, over the best-effort `media_*`
 * companion actions (status may be unknown on some platforms).
 */
import { useEffect, useState } from 'react';
import { Loader2, Music2, Pause, Play, SkipBack, SkipForward, Square, Volume1, Volume2, VolumeX } from 'lucide-react';
import {
  DailyError,
  defaultCaller as daily,
  mediaControl,
  mediaStatus,
  type MediaOp,
  type MediaStatus,
} from '../lib/daily-skills';

export function DailyMedia() {
  const [status, setStatus] = useState<MediaStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(50);

  async function refresh() {
    try {
      setStatus(await mediaStatus(daily));
    } catch (err) {
      setError(err instanceof DailyError ? err.message : 'Could not read media status.');
    }
  }

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const s = await mediaStatus(daily);
        if (live) setStatus(s);
      } catch (err) {
        if (live) setError(err instanceof DailyError ? err.message : 'Could not read media status.');
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  async function press(op: MediaOp, value?: number) {
    setBusy(op);
    setError(null);
    try {
      const r = await mediaControl(daily, op, value);
      if (typeof r.level === 'number') setLevel(r.level);
      await refresh();
    } catch (err) {
      setError(err instanceof DailyError ? err.message : 'That control did not work.');
    } finally {
      setBusy(null);
    }
  }

  const stateLabel =
    status?.playing === true ? 'Playing' : status?.playing === false ? 'Paused' : 'Unknown state';

  const btn =
    'grid size-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-white/80 transition-all hover:bg-white/10 hover:text-white active:scale-95 disabled:opacity-50';

  return (
    <div className="flex flex-col gap-2.5">
      {/* Now playing */}
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2">
        <span className={`grid size-8 shrink-0 place-items-center rounded-full ${status?.playing ? 'bg-sky-500/25 text-sky-200' : 'bg-white/5 text-white/40'}`}>
          <Music2 size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-white/90">{status?.source ?? 'No active source'}</p>
          <p className="text-[10px] text-white/45">{stateLabel}{status?.note ? ` · ${status.note}` : ''}</p>
        </div>
        {busy && <Loader2 size={14} className="shrink-0 animate-spin text-sky-300" />}
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-200">
          {error}
        </p>
      )}

      {/* Transport */}
      <div className="flex items-center justify-center gap-2" role="group" aria-label="Media transport">
        <button type="button" aria-label="Previous track" disabled={busy !== null} onClick={() => void press('previous')} className={btn}>
          <SkipBack size={16} />
        </button>
        <button
          type="button"
          aria-label={status?.playing ? 'Pause' : 'Play'}
          disabled={busy !== null}
          onClick={() => void press('play_pause')}
          className="grid size-12 place-items-center rounded-2xl border border-sky-400/40 bg-sky-500/20 text-sky-100 shadow-[0_0_18px_rgba(56,189,248,0.25)] transition-all hover:bg-sky-500/30 active:scale-95 disabled:opacity-50"
        >
          {status?.playing ? <Pause size={18} /> : <Play size={18} className="translate-x-[1px]" />}
        </button>
        <button type="button" aria-label="Next track" disabled={busy !== null} onClick={() => void press('next')} className={btn}>
          <SkipForward size={16} />
        </button>
        <button type="button" aria-label="Stop" disabled={busy !== null} onClick={() => void press('stop')} className={btn}>
          <Square size={14} />
        </button>
      </div>

      {/* Volume */}
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2">
        <button type="button" aria-label="Volume down" disabled={busy !== null} onClick={() => void press('volume_down')} className="text-white/60 hover:text-white disabled:opacity-50">
          <Volume1 size={15} />
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={level}
          aria-label="Volume level"
          disabled={busy !== null}
          onChange={(e) => setLevel(Number(e.target.value))}
          onPointerUp={() => void press('set_volume', level)}
          onKeyUp={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') void press('set_volume', level);
          }}
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-sky-400 disabled:opacity-50"
        />
        <button type="button" aria-label="Volume up" disabled={busy !== null} onClick={() => void press('volume_up')} className="text-white/60 hover:text-white disabled:opacity-50">
          <Volume2 size={15} />
        </button>
        <button type="button" aria-label="Mute" disabled={busy !== null} onClick={() => void press('mute')} className="text-white/60 hover:text-white disabled:opacity-50">
          <VolumeX size={15} />
        </button>
        <span className="w-8 shrink-0 text-right text-[11px] text-white/60">{level}%</span>
      </div>

      <p className="-mt-1 text-center text-[10px] text-white/35">
        Controls your PC's default player · status is best-effort per platform
      </p>
    </div>
  );
}
