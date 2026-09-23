/**
 * Terminal — the engineering console anchored to the bottom-left.
 *
 * Two tabs:
 *   SYSTEM — what is happening inside the OS: state transitions, provider
 *            connects/failures, errors. Plus the command prompt.
 *   CHAT   — the voice conversation history (you ⇄ Sophia), with a clear button.
 */

import { MessageSquare, TerminalSquare, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { controlLayer } from '../sophia/control';
import type { LogLine, SophiaOS } from '../sophia/SophiaOS';
import type { Turn } from '../sophia/types';

const LEVEL_COLOR: Record<LogLine['level'], string> = {
  info: 'text-sky-200/55',
  event: 'text-indigo-200/75',
  cmd: 'text-cyan-200/90',
  error: 'text-rose-300/85',
};

function stamp(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

type Tab = 'system' | 'chat';

export function Terminal({ os, open, onToggle }: { os: SophiaOS; open: boolean; onToggle: () => void }) {
  const [tab, setTab] = useState<Tab>('system');
  const [lines, setLines] = useState<LogLine[]>(() => [...os.log]);
  const [turns, setTurns] = useState<Turn[]>(() => [...controlLayer.history]);
  const [cmd, setCmd] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onLog = (e: Event) => setLines((prev) => [...prev.slice(-199), (e as CustomEvent<LogLine>).detail]);
    const onTurn = () => setTurns([...controlLayer.history]);
    os.addEventListener('log', onLog);
    controlLayer.addEventListener('turn', onTurn);
    return () => {
      os.removeEventListener('log', onLog);
      controlLayer.removeEventListener('turn', onTurn);
    };
  }, [os]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [lines, turns, tab, open]);

  useEffect(() => {
    if (open && tab === 'system') {
      const t = setTimeout(() => inputRef.current?.focus(), 140);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open, tab]);

  const execute = (v: string) => {
    const text = v.trim();
    if (!text) return;
    if (text === 'help' || text === '?') {
      os.pushLog('info', '=== SOPHIA CONSOLE COMMANDS ===');
      os.pushLog('info', '• Display: "only particles" (hide rim), "full body" (show rim)');
      os.pushLog('info', '• Shapes: sphere, ring, waveform, torus, infinity, helix, hypercube, pyramid, star, galaxy, heart, shield, matrix, split, merge, dissolve, face, z, s, a, o');
      os.pushLog('info', '• States: state idle, state listening, state thinking, state speaking, state rendering, state ambient');
      os.pushLog('info', '• Presence: "wake up", "pause", "resume"');
      os.pushLog('info', '• Voice recovery: "retry" after adding server credentials');
      os.pushLog('info', '• "clear" empties this system log');
      return;
    }
    if (text === 'clear') {
      os.log.length = 0;
      setLines([]);
      return;
    }
    os.execCommand(text);
  };

  const run = (e: React.FormEvent) => {
    e.preventDefault();
    const v = cmd.trim();
    if (!v) return;
    execute(v);
    setHistory((h) => [v, ...h].slice(0, 30));
    setHistIdx(-1);
    setCmd('');
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(history.length - 1, histIdx + 1);
      if (next >= 0) {
        setHistIdx(next);
        setCmd(history[next]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = histIdx - 1;
      setHistIdx(next);
      setCmd(next < 0 ? '' : history[next]);
    }
  };

  const clearChat = () => {
    controlLayer.reset();
    setTurns([]);
    os.pushLog('info', 'chat history cleared');
  };

  const chatTurns = turns.filter((t) => t.role !== 'system');

  return (
    <>
      {open && (
        <section
          aria-label="Sophia terminal"
          className="panel-in panel-left absolute bottom-[112px] left-7 z-20 flex h-[320px] w-[420px] max-w-[calc(100vw-3.5rem)] flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#050811]/96 shadow-[0_30px_90px_rgba(0,0,0,0.7)] backdrop-blur-xl sm:left-11"
        >
          <header className="flex items-center justify-between border-b border-white/[0.06] px-3 pb-0 pt-2">
            <div className="flex items-end gap-1" role="tablist" aria-label="Console tabs">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'system'}
                onClick={() => setTab('system')}
                className={`flex items-center gap-1.5 rounded-t-lg border border-b-0 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.22em] transition-colors ${
                  tab === 'system'
                    ? 'border-white/[0.1] bg-white/[0.04] text-sky-200'
                    : 'border-transparent text-white/35 hover:text-white/65'
                }`}
              >
                <TerminalSquare size={11} strokeWidth={1.6} />
                System
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'chat'}
                onClick={() => setTab('chat')}
                className={`flex items-center gap-1.5 rounded-t-lg border border-b-0 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.22em] transition-colors ${
                  tab === 'chat'
                    ? 'border-white/[0.1] bg-white/[0.04] text-sky-200'
                    : 'border-transparent text-white/35 hover:text-white/65'
                }`}
              >
                <MessageSquare size={11} strokeWidth={1.6} />
                Chat
              </button>
            </div>
            <div className="flex items-center gap-1 pb-1">
              {tab === 'chat' && (
                <button
                  type="button"
                  onClick={clearChat}
                  aria-label="Clear chat history"
                  title="Clear chat history"
                  className="grid size-6 place-items-center rounded-full text-white/40 transition hover:bg-white/[0.06] hover:text-rose-300/90"
                >
                  <Trash2 size={12} strokeWidth={1.75} />
                </button>
              )}
              <button
                type="button"
                onClick={onToggle}
                aria-label="Close terminal"
                className="grid size-6 place-items-center rounded-full text-white/40 transition hover:bg-white/[0.06] hover:text-white/80"
              >
                <X size={13} strokeWidth={1.75} />
              </button>
            </div>
          </header>

          {tab === 'system' ? (
            <>
              <div
                ref={listRef}
                role="tabpanel"
                aria-label="System log"
                className="terminal-scroll flex-1 space-y-[3px] overflow-y-auto px-4 py-3 font-mono text-[10px] leading-[1.55]"
              >
                {lines.length === 0 && <p className="text-white/25">// waiting for events… (type &quot;help&quot; for commands)</p>}
                {lines.map((l) => (
                  <div key={l.id} className="flex gap-2">
                    <span className="shrink-0 text-white/20">{stamp(l.ts)}</span>
                    <span className={`${LEVEL_COLOR[l.level]} whitespace-pre-wrap break-words`}>{l.text}</span>
                  </div>
                ))}
              </div>
              <form onSubmit={run} className="flex items-center gap-2 border-t border-white/[0.06] px-4 py-2.5">
                <span className="font-mono text-[11px] text-sky-300/70">›</span>
                <input
                  ref={inputRef}
                  value={cmd}
                  onChange={(e) => setCmd(e.target.value)}
                  onKeyDown={onKey}
                  spellCheck={false}
                  autoComplete="off"
                  aria-label="Terminal command"
                  placeholder='try "waveform", "pause", "state rendering", "help"'
                  className="h-6 flex-1 bg-transparent font-mono text-[11px] tracking-wide text-white/85 placeholder:text-white/25 focus:outline-none"
                />
              </form>
            </>
          ) : (
            <div
              ref={listRef}
              role="tabpanel"
              aria-label="Voice chat history"
              className="terminal-scroll flex-1 space-y-3 overflow-y-auto px-4 py-3"
            >
              {chatTurns.length === 0 && (
                <p className="pt-6 text-center font-mono text-[10px] text-white/25">
                  No conversation yet.
                  <br />
                  <span className="text-white/18">Say “Hey Sophia” or press the mic to talk.</span>
                </p>
              )}
              {chatTurns.slice(-40).map((t, i) => (
                <div key={i} className={t.role === 'user' ? 'text-right' : 'text-left'}>
                  <p className="mb-[3px] flex items-baseline gap-2 text-[8px] font-light uppercase tracking-[0.3em] text-white/25"
                     style={{ justifyContent: t.role === 'user' ? 'flex-end' : 'flex-start' }}>
                    <span>{t.role === 'user' ? 'you' : 'sophia'}</span>
                    <span className="font-mono tracking-normal text-white/15">{stamp(t.ts)}</span>
                  </p>
                  <p
                    className={`inline-block max-w-[92%] text-left text-[12px] font-light leading-relaxed ${
                      t.role === 'user' ? 'text-white/80' : 'text-sky-100/85'
                    } ${t.final ? '' : 'opacity-60'}`}
                  >
                    {t.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <button
        type="button"
        aria-label={open ? 'Close terminal' : 'Open terminal'}
        aria-pressed={open}
        onClick={onToggle}
        title="Terminal"
        className={`dock-btn absolute bottom-[44px] left-7 z-10 sm:bottom-[52px] sm:left-11 ${
          open ? 'border-sky-300/40 text-sky-200' : ''
        }`}
      >
        <svg
          width="19"
          height="19"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="16" rx="2.5" />
          <path d="m7 9 3 3-3 3" />
          <path d="M13 15h4" />
        </svg>
      </button>
    </>
  );
}
