/**
 * ui/WakeWordBlock.tsx — wake-word control (Phase 8–9 UI).
 *
 * Hey-Sofia toggle plus editable trigger phrases. Lives in
 * Settings → Ear & Mouth (Voice System).
 */
import { useEffect, useState } from 'react';
import { Ear, RotateCcw } from 'lucide-react';
import type { SophiaOS } from '../sophia/SophiaOS';
import { DEFAULT_WAKE_WORDS, loadWakePrefs } from '../core/WakeWordDetection';

function currentPhrases(): string[] {
  const saved = loadWakePrefs().wakeWords;
  return Array.isArray(saved) && saved.length > 0 ? [...saved] : [...DEFAULT_WAKE_WORDS];
}

export function WakeWordBlock({ os }: { os: SophiaOS }) {
  const [wake, setWake] = useState(os.prefs.wake);
  const [phrases, setPhrases] = useState<string[]>(currentPhrases);
  const [draft, setDraft] = useState(() => currentPhrases().join(', '));
  const [notice, setNotice] = useState<string | null>(null);

  // Stay in sync with the System-section toggle (same pref, two switches).
  useEffect(() => {
    const onPrefs = () => {
      setWake(os.prefs.wake);
      setPhrases(currentPhrases());
    };
    os.addEventListener('prefs', onPrefs);
    return () => os.removeEventListener('prefs', onPrefs);
  }, [os]);

  function save() {
    const parsed = draft
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
    const next = parsed.length > 0 ? [...new Set(parsed)] : [...DEFAULT_WAKE_WORDS];
    os.setWakeWords(next);
    setPhrases(next);
    setDraft(next.join(', '));
    setNotice(parsed.length > 0 ? `Listening for ${next.length} phrase${next.length === 1 ? '' : 's'}.` : 'Empty list — defaults restored.');
  }

  function reset() {
    os.setWakeWords([...DEFAULT_WAKE_WORDS]);
    setPhrases([...DEFAULT_WAKE_WORDS]);
    setDraft(DEFAULT_WAKE_WORDS.join(', '));
    setNotice('Factory phrases restored.');
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Ear size={12} className="text-sky-300/80" />
          <div>
            <p className="text-[10px] font-normal uppercase tracking-[0.2em] text-white/70">Hey Sofia wake-word</p>
            <p className="text-[8.5px] font-light text-white/35">background microphone detection</p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={wake}
          aria-label="Hey Sofia wake-word detection"
          onClick={() => {
            os.savePrefs({ wake: !wake });
            setWake(!wake);
          }}
          className={`relative h-5 w-9 rounded-full border transition-colors duration-200 ${
            wake ? 'border-sky-400/50 bg-sky-400/30 shadow-[0_0_10px_rgba(var(--th-glow),0.3)]' : 'border-white/10 bg-white/5'
          }`}
        >
          <span
            className={`block size-3.5 rounded-full transition-transform duration-200 ${
              wake ? 'translate-x-4 bg-sky-300 shadow-[0_0_6px_rgba(var(--th-glow-soft),0.8)]' : 'translate-x-0.5 bg-white/40'
            }`}
          />
        </button>
      </div>

      {phrases.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label="Active wake phrases">
          {phrases.map((p) => (
            <span key={p} className="rounded-md border border-sky-400/25 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10px] text-sky-200">
              “{p}”
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setNotice(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
          }}
          placeholder="hey sofia, ok sophia"
          aria-label="Wake phrases, comma separated"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 font-mono text-[11px] text-white placeholder:text-white/30 focus:border-sky-400/50 focus:outline-none"
        />
        <button
          type="button"
          onClick={save}
          className="shrink-0 rounded-lg border border-sky-400/40 bg-sky-500/20 px-2.5 py-1.5 text-[11px] font-medium text-sky-100 transition-colors hover:bg-sky-500/30"
        >
          Save
        </button>
        <button
          type="button"
          onClick={reset}
          aria-label="Restore default wake phrases"
          title="Restore defaults"
          className="shrink-0 rounded-lg border border-white/10 bg-white/5 p-2 text-white/60 transition-colors hover:text-white"
        >
          <RotateCcw size={13} />
        </button>
      </div>
      {notice && (
        <p role="status" className="text-[10px] text-emerald-300/80">
          {notice}
        </p>
      )}
    </div>
  );
}
