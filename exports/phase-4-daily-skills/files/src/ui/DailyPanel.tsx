/**
 * ui/DailyPanel.tsx — the Daily skills panel (Phase 4).
 *
 * Tabbed Files · Health · Media · WhatsApp over the companion link, plus
 * the shared `CompanionBlock` pairing strip (also reused in Settings).
 */
import { useEffect, useState } from 'react';
import { Activity, Folder, Loader2, MessageCircle, Music2, PlugZap, Unplug, X } from 'lucide-react';
import { companion, type CompanionStatus } from '../lib/companion-client';
import { DailyFiles } from './DailyFiles';
import { DailyHealth } from './DailyHealth';
import { DailyMedia } from './DailyMedia';
import { DailyWhatsApp } from './DailyWhatsApp';

type DailyTab = 'files' | 'health' | 'media' | 'whatsapp';

const TABS: Array<{ id: DailyTab; label: string; icon: typeof Folder }> = [
  { id: 'files', label: 'Files', icon: Folder },
  { id: 'health', label: 'Health', icon: Activity },
  { id: 'media', label: 'Media', icon: Music2 },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
];

/** Pairing strip: connect/disconnect + status. Shared with Settings. */
export function CompanionBlock() {
  const [status, setStatus] = useState<CompanionStatus>(companion.status);
  const [actions, setActions] = useState(companion.info.actions ?? 0);
  const [port, setPort] = useState(companion.info.port);
  const [lastError, setLastError] = useState(companion.lastError);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onStatus = () => {
      setStatus(companion.status);
      setActions(companion.info.actions ?? 0);
      setPort(companion.info.port);
      setLastError(companion.lastError);
    };
    companion.addEventListener('status', onStatus);
    return () => companion.removeEventListener('status', onStatus);
  }, []);

  async function doConnect(e?: React.FormEvent) {
    e?.preventDefault();
    if (!code.trim()) {
      // Retry with the stored/desktop pairing when the field is empty.
      setBusy(true);
      try {
        await companion.connect();
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      companion.setPairing(code);
      setCode('');
      await companion.connect();
    } finally {
      setBusy(false);
    }
  }

  if (status === 'connected') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-2 py-1.5">
        <span className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
        </span>
        <p className="min-w-0 flex-1 truncate text-[11px] text-emerald-100">
          Companion · :{port}{actions ? ` · ${actions} actions` : ''}
        </p>
        <button
          type="button"
          onClick={() => companion.disconnect()}
          className="flex shrink-0 items-center gap-1 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/60 hover:text-white"
        >
          <Unplug size={11} /> Disconnect
        </button>
      </div>
    );
  }

  if (status === 'connecting' || busy) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-sky-400/25 bg-sky-500/10 px-2 py-1.5 text-[11px] text-sky-200">
        <Loader2 size={12} className="animate-spin" /> Connecting to the companion…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-amber-400/25 bg-amber-500/[0.07] p-2">
      <p className="text-[11px] leading-snug text-amber-100/90">
        {lastError || 'Daily skills need the companion daemon.'}
      </p>
      <form onSubmit={(e) => void doConnect(e)} className="flex items-center gap-1.5">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Pairing code (or retry saved)"
          aria-label="Companion pairing code"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] text-white placeholder:font-sans placeholder:text-white/30 focus:border-sky-400/50 focus:outline-none"
        />
        <button
          type="submit"
          className="flex shrink-0 items-center gap-1 rounded-md border border-sky-400/40 bg-sky-500/20 px-2 py-1 text-[11px] font-medium text-sky-100 hover:bg-sky-500/30"
        >
          <PlugZap size={12} /> Connect
        </button>
      </form>
      <p className="text-[10px] leading-snug text-white/40">
        Run <code className="font-mono text-white/60">node companion/server.mjs</code> on this PC — it prints the code.
      </p>
    </div>
  );
}

export function DailyPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<DailyTab>('files');
  const [connected, setConnected] = useState(companion.connected);

  useEffect(() => {
    const onStatus = () => setConnected(companion.connected);
    companion.addEventListener('status', onStatus);
    if (!companion.connected && companion.status === 'disconnected') {
      void companion.connect();
    }
    return () => companion.removeEventListener('status', onStatus);
  }, []);

  return (
    <section
      aria-label="Daily skills panel"
      className="fixed bottom-[98px] right-4 z-30 flex max-h-[74vh] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#070b16]/95 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:right-11 sm:w-[400px]"
    >
      <header className="flex items-center gap-2 border-b border-white/[0.07] px-3 py-2">
        <span className="grid size-7 place-items-center rounded-lg bg-sky-500/15 text-sky-300">
          <Folder size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-semibold text-white">Daily</h2>
          <p className="truncate text-[10px] text-white/40">Files · Health · Media · WhatsApp</p>
        </div>
        <button
          type="button"
          aria-label="Close Daily panel"
          onClick={onClose}
          className="rounded-md p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={14} />
        </button>
      </header>

      <div className="flex flex-col gap-2 overflow-y-auto p-2.5">
        <CompanionBlock />

        <div role="tablist" aria-label="Daily skills" className="grid grid-cols-4 gap-1 rounded-xl border border-white/[0.07] bg-white/[0.03] p-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`flex items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-sky-500/25 text-sky-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                    : 'text-white/50 hover:bg-white/[0.06] hover:text-white'
                }`}
              >
                <Icon size={12} />
                {t.label}
              </button>
            );
          })}
        </div>

        {connected ? (
          <div key={tab} role="tabpanel">
            {tab === 'files' && <DailyFiles />}
            {tab === 'health' && <DailyHealth />}
            {tab === 'media' && <DailyMedia />}
            {tab === 'whatsapp' && <DailyWhatsApp />}
          </div>
        ) : (
          <p className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-4 text-center text-[11px] leading-relaxed text-white/45">
            Connect the companion above to browse files, check PC health,
            <br />
            control media and draft WhatsApp messages.
          </p>
        )}
      </div>
    </section>
  );
}
