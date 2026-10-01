/**
 * ui/GroundingCard.tsx — OCR grounding (Phase 6).
 *
 * Find on-screen text by its words, or scan every word box the daemon
 * sees. Coordinates are daemon-screen pixels. Lives in Diagnostics.
 */
import { useState } from 'react';
import { Crosshair, Loader2, ScanText, TriangleAlert } from 'lucide-react';
import {
  GroundingError,
  TESSERACT_SETUP_HINT,
  defaultGroundingCaller as grounding,
  groundScan,
  groundText,
  isTesseractError,
  type TextHit,
  type WordBox,
} from '../lib/grounding';

export function GroundingCard() {
  const [query, setQuery] = useState('');
  const [hit, setHit] = useState<TextHit | null>(null);
  const [miss, setMiss] = useState<string | null>(null);
  const [words, setWords] = useState<WordBox[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setupBlocked, setSetupBlocked] = useState(false);

  function fail(err: unknown) {
    if (isTesseractError(err)) {
      setSetupBlocked(true);
      setError(null);
    } else {
      setError(err instanceof GroundingError ? err.message : 'Grounding failed.');
    }
  }

  async function find(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    setBusy('find');
    setError(null);
    setHit(null);
    setMiss(null);
    try {
      const r = await groundText(grounding, query.trim());
      if (r.found) setHit(r);
      else setMiss(r.hint);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function scan() {
    setBusy('scan');
    setError(null);
    try {
      const r = await groundScan(grounding);
      setWords(r.words);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Crosshair size={15} className="text-sky-400" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-white/80">
            OCR Grounding
          </span>
        </div>
        <button
          type="button"
          onClick={() => void scan()}
          disabled={busy !== null}
          title="Scan every visible word"
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[9px] font-medium text-white/80 hover:border-sky-400/40 hover:bg-sky-400/10 hover:text-white disabled:opacity-50"
        >
          {busy === 'scan' ? <Loader2 size={12} className="animate-spin" /> : <ScanText size={12} />}
          {busy === 'scan' ? 'Scanning…' : 'Scan screen'}
        </button>
      </div>

      {setupBlocked && (
        <div className="mt-2.5 rounded-lg border border-amber-400/30 bg-amber-500/10 px-2.5 py-2">
          <p className="flex items-center gap-1.5 text-[10px] font-medium text-amber-200">
            <TriangleAlert size={12} /> Tesseract is not installed
          </p>
          <p className="mt-0.5 text-[9px] leading-relaxed text-white/65">{TESSERACT_SETUP_HINT}</p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2.5 rounded-lg border border-rose-400/30 bg-rose-500/10 px-2 py-1.5 text-[9px] text-rose-200">
          {error}
        </p>
      )}

      <form onSubmit={(e) => void find(e)} className="mt-2.5 flex items-center gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find text on screen…"
          aria-label="Text to find on screen"
          disabled={busy !== null}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 font-mono text-[11px] text-white placeholder:text-white/30 focus:border-sky-400/50 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy !== null || !query.trim()}
          className="flex items-center gap-1.5 rounded-lg border border-sky-400/30 bg-sky-400/10 px-2.5 py-1.5 text-[9px] font-medium text-sky-200 hover:bg-sky-400/20 disabled:opacity-50"
        >
          {busy === 'find' ? <Loader2 size={12} className="animate-spin" /> : <Crosshair size={12} />}
          {busy === 'find' ? 'Seeking…' : 'Find'}
        </button>
      </form>

      {hit && (
        <div className="mt-2.5 rounded-lg border border-emerald-400/25 bg-emerald-500/10 p-2.5">
          <p className="font-mono text-lg leading-none text-emerald-200">
            {hit.x}, {hit.y}
          </p>
          <p className="mt-1 font-mono text-[8.5px] text-white/55">
            “{hit.text}” · box {hit.box.w}×{hit.box.h} at {hit.box.x},{hit.box.y} · daemon-screen px
          </p>
        </div>
      )}
      {miss && <p className="mt-2.5 text-[9px] text-amber-200/80">{miss}</p>}

      {words !== null && (
        <div className="mt-2.5">
          <p className="pb-1 font-mono text-[8.5px] text-white/45">{words.length} words visible</p>
          {words.length === 0 ? (
            <p className="text-[9px] italic text-white/35">The screen reads blank.</p>
          ) : (
            <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto rounded-lg border border-white/5 bg-black/40 p-1.5">
              {words.slice(0, 60).map((w, i) => (
                <span
                  key={`${w.x}-${w.y}-${i}`}
                  title={`${w.x},${w.y} · ${w.w}×${w.h}`}
                  className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[9px] text-white/70"
                >
                  {w.text}
                </span>
              ))}
              {words.length > 60 && (
                <span className="px-1 py-0.5 font-mono text-[9px] text-white/35">+{words.length - 60} more</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
