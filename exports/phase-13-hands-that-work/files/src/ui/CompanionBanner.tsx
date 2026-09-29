/**
 * ui/CompanionBanner.tsx — Phase 13: the companion link, impossible to miss.
 *
 * Slim global banner, visible in every view while the companion daemon is
 * unreachable: one-line status, pairing-code field + Pair, retry for the
 * saved pairing, and the exact terminal command. Vanishes once paired.
 */

import { useEffect, useState } from 'react';
import { PlugZap, RefreshCw, Unplug } from 'lucide-react';
import { companion, type CompanionStatus } from '../lib/companion-client';

export function CompanionBanner() {
  const [status, setStatus] = useState<CompanionStatus>(companion.status);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onStatus = () => setStatus(companion.status);
    companion.addEventListener('status', onStatus);
    return () => companion.removeEventListener('status', onStatus);
  }, []);

  if (status === 'connected' || status === 'connecting') return null;

  const pair = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    try {
      if (code.trim()) {
        companion.setPairing(code);
        setCode('');
      }
      await companion.connect();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="alert"
      className="fixed left-1/2 top-3 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-2xl border border-amber-400/30 bg-[#0a0f1e]/95 px-4 py-2 shadow-2xl backdrop-blur-md"
    >
      <p className="flex items-center gap-1.5 text-[11px] text-amber-100/90">
        <Unplug size={13} className="shrink-0" />
        Companion offline — Sofia can’t touch your PC.
      </p>
      <form onSubmit={(e) => void pair(e)} className="flex items-center gap-1.5">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Pairing code"
          aria-label="Companion pairing code"
          autoComplete="off"
          spellCheck={false}
          className="w-32 rounded-md border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] text-white placeholder:font-sans placeholder:text-white/30 focus:border-sky-400/50 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-1 rounded-md border border-sky-400/40 bg-sky-500/20 px-2 py-1 text-[11px] font-medium text-sky-100 hover:bg-sky-500/30 disabled:opacity-50"
        >
          <PlugZap size={12} /> Pair
        </button>
        <button
          type="button"
          onClick={() => void pair()}
          disabled={busy}
          title="Retry saved pairing"
          aria-label="Retry saved pairing"
          className="rounded-md border border-white/10 bg-white/5 p-1.5 text-white/60 hover:text-white disabled:opacity-50"
        >
          <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
        </button>
      </form>
      <p className="w-full text-center font-mono text-[9.5px] leading-snug text-white/40">
        terminal: <code className="text-white/60">npm run companion</code> (or{' '}
        <code className="text-white/60">npm run dev:all</code>) → paste the code it prints
      </p>
    </div>
  );
}
