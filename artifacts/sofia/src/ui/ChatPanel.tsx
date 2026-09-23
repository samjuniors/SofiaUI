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
      className="panel-in absolute bottom-[92px] right-6 flex w-[318px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#060911]/92 shadow-[0_30px_90px_rgba(0,0,0,0.6)] backdrop-blur-xl sm:right-8"
    >
      <header className="flex items-center justify-between px-4 pb-2.5 pt-3.5">
        <div className="flex items-center gap-2">
          <p className="text-[9px] font-light uppercase tracking-[0.34em] text-white/45">Text fallback</p>
          <span
            className="block size-[4px] rounded-full"
            style={{
              background: status === 'live' ? '#43e0ff' : '#5c6b8c',
              boxShadow: `0 0 5px 1px ${status === 'live' ? 'rgba(67,224,255,0.6)' : 'rgba(92,107,140,0.4)'}`,
            }}
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="grid size-6 place-items-center rounded-full text-white/40 transition hover:bg-white/[0.06] hover:text-white/80"
        >
          <X size={13} strokeWidth={1.75} />
        </button>
      </header>

      {status !== 'live' && (
        <p className="mx-4 mb-1 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-[10px] font-light leading-relaxed tracking-wide text-white/35">
          Voice is primary. Connect Gemini Live or Deepgram in Settings to give this channel a mind.
        </p>
      )}

      <div ref={listRef} className="chat-scroll max-h-[240px] min-h-[72px] space-y-3 overflow-y-auto px-4 py-3">
        {turns.length === 0 && (
          <p className="pt-2 text-center text-[11px] font-light tracking-wide text-white/25">Nothing yet.</p>
        )}
        {turns.slice(-24).map((t, i) =>
          t.role === 'system' ? (
            <p key={i} className="text-center text-[10px] font-light tracking-wide text-white/28">
              {t.text}
            </p>
          ) : (
            <div key={i} className={t.role === 'user' ? 'text-right' : 'text-left'}>
              <p className="mb-[3px] text-[8px] font-light uppercase tracking-[0.3em] text-white/25">
                {t.role === 'user' ? 'you' : 'sophia'}
              </p>
              <p
                className={`inline-block max-w-[92%] text-left text-[12.5px] font-light leading-relaxed ${
                  t.role === 'user' ? 'text-white/80' : 'text-sky-100/85'
                } ${t.final ? '' : 'opacity-60'}`}
              >
                {t.text}
              </p>
            </div>
          ),
        )}
      </div>

      <form onSubmit={submit} className="flex items-center gap-2 border-t border-white/[0.06] px-3 py-2">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type to Sophia…"
          aria-label="Message Sophia"
          className="h-8 flex-1 bg-transparent text-[12.5px] font-light tracking-wide text-white/85 placeholder:text-white/25 focus:outline-none"
        />
        <button
          type="submit"
          aria-label="Send"
          className="grid size-8 place-items-center rounded-full text-white/45 transition hover:bg-white/[0.06] hover:text-sky-200 disabled:opacity-30"
          disabled={!text.trim()}
        >
          <Send size={14} strokeWidth={1.6} />
        </button>
      </form>
    </section>
  );
}
