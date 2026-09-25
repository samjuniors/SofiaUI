/**
 * ChatPanel — the keyboard fallback.
 * Voice is primary; this small channel rides the same ControlLayer,
 * so text and speech share one brain and one history.
 */

import { Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { controlLayer } from '../sophia/control';
import type { OSStatus } from '../sophia/SophiaOS';
import type { Turn } from '../sophia/types';

export function ChatPanel({
  status,
  onClose,
  onSend,
}: {
  status: OSStatus;
  onClose: () => void;
  onSend: (text: string) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>(() => [...controlLayer.history]);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const on = () => setTurns([...controlLayer.history]);
    controlLayer.addEventListener('turn', on);
    return () => controlLayer.removeEventListener('turn', on);
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns]);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    setText('');
    onSend(v);
  };

  return (
    <section
      aria-label="Text fallback"
      className="glass-panel panel-in panel-in-bottom-right fixed bottom-[98px] right-4 left-4 z-30 flex max-h-[calc(100vh-120px)] flex-col overflow-hidden rounded-2xl sm:left-auto sm:right-11 sm:bottom-[108px] sm:w-[330px]"
    >
      <header className="flex items-center justify-between border-b border-white/[0.06] px-4 pb-2.5 pt-3">
        <div className="flex items-center gap-2">
          <p className="text-[9.5px] font-normal uppercase tracking-[0.24em] text-white/50">Text Conversation</p>
          <span
            className="block size-[5px] rounded-full"
            style={{
              background: status === 'live' ? '#38bdf8' : '#64748b',
              boxShadow: `0 0 6px 1px ${status === 'live' ? 'rgba(56,189,248,0.7)' : 'rgba(100,116,139,0.3)'}`,
            }}
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="grid size-6 place-items-center rounded-lg text-white/40 transition hover:bg-white/[0.06] hover:text-white"
        >
          <X size={13} strokeWidth={1.75} />
        </button>
      </header>

      {status === 'live' ? (
        <div className="m-3 mb-0 flex items-center justify-between rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 py-1.5 text-[9.5px] font-mono tracking-wide text-sky-200 shadow-[inset_0_0_8px_rgba(56,189,248,0.15)]">
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)] animate-pulse" />
            <span>Gemini Live WebSocket Stream Active</span>
          </span>
          <span className="text-[8px] text-sky-300/60 font-semibold">gemini-3.8-live</span>
        </div>
      ) : (
        <div className="m-3 mb-0 rounded-xl border border-sky-400/20 bg-sky-400/[0.04] px-3 py-2 text-[10px] font-light leading-relaxed tracking-wide text-sky-200/70">
          Connecting to Gemini Live stream… Type any message below to converse.
        </div>
      )}

      <div ref={listRef} className="chat-scroll max-h-[250px] min-h-[80px] space-y-3 overflow-y-auto p-4">
        {turns.length === 0 && (
          <p className="pt-3 text-center text-[11px] font-light tracking-wide text-white/30">
            No messages yet. Send a query below.
          </p>
        )}
        {turns.slice(-24).map((t, i) =>
          t.role === 'system' ? (
            <p key={`turn-${t.ts}-${i}`} className="text-center font-mono text-[9.5px] font-light text-white/30">
              {t.text}
            </p>
          ) : (
            <div key={`turn-${t.ts}-${i}`} className={t.role === 'user' ? 'text-right' : 'text-left'}>
              <p className="mb-1 text-[8px] font-normal uppercase tracking-[0.25em] text-white/30">
                {t.role === 'user' ? 'you' : 'sophia'}
              </p>
              <div
                className={`inline-block max-w-[90%] px-3.5 py-2 text-left text-[12px] font-normal leading-relaxed ${
                  t.role === 'user'
                    ? 'rounded-2xl rounded-tr-sm border border-white/[0.08] bg-white/[0.06] text-white/90'
                    : 'rounded-2xl rounded-tl-sm border border-sky-400/25 bg-sky-400/[0.08] text-sky-100 shadow-[0_0_12px_rgba(56,189,248,0.08)]'
                } ${t.final ? '' : 'opacity-65'}`}
              >
                {t.text}
              </div>
            </div>
          ),
        )}
      </div>

      <form onSubmit={submit} className="flex items-center gap-2 border-t border-white/[0.06] bg-black/20 p-2 px-3">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message Sophia…"
          aria-label="Message Sophia"
          className="h-8 flex-1 bg-transparent text-[12px] font-light tracking-wide text-white/90 placeholder:text-white/30 focus:outline-none"
        />
        <button
          type="submit"
          aria-label="Send message"
          className="grid size-8 place-items-center rounded-xl border border-transparent text-white/40 transition-all hover:border-sky-400/30 hover:bg-sky-400/15 hover:text-sky-200 active:scale-90 disabled:opacity-30 disabled:hover:bg-transparent"
          disabled={!text.trim()}
        >
          <Send size={13} strokeWidth={1.75} />
        </button>
      </form>
    </section>
  );
}
