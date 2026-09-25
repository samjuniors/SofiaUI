/**
 * MicPermissionModal — Polite Microphone Permission Guidance.
 *
 * Appears when microphone access is denied or restricted.
 * Provides clear options:
 *   1. "Request Microphone Access" (triggers browser getUserMedia prompt)
 *   2. "Type Messages in Chat" (opens Chat panel)
 *   3. Dismiss
 */

import { Mic, MessageSquare, X, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import type { SophiaOS } from '../sophia/SophiaOS';

export function MicPermissionModal({
  os,
  onClose,
  onOpenChat,
}: {
  os: SophiaOS;
  onClose: () => void;
  onOpenChat: () => void;
}) {
  const [requesting, setRequesting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleRequestAccess = async () => {
    setRequesting(true);
    setErrorMsg(null);
    try {
      await os.audio.startCapture();
      os.pushLog('event', 'Microphone permission granted successfully.');
      onClose();
    } catch (err: any) {
      console.warn('[MicPermissionModal] Permission request result:', err);
      setErrorMsg('Microphone access is blocked in your browser settings. Please click the lock or camera icon in your browser address bar to allow microphone access.');
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="relative w-full max-w-md rounded-2xl border border-sky-400/30 bg-[#060a14] p-5 shadow-[0_0_40px_rgba(56,189,248,0.25)] text-white">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="grid size-8 place-items-center rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-300">
              <ShieldAlert size={18} />
            </div>
            <div>
              <h2 className="text-xs font-semibold tracking-[0.16em] uppercase text-white/95">
                Microphone Access
              </h2>
              <p className="text-[9px] text-sky-200/60 font-mono">Live Voice Permission</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="mt-4 space-y-3">
          <p className="text-[11px] leading-relaxed text-white/80">
            Sophia uses your microphone for real-time live voice conversation. Browser microphone access is currently restricted or denied.
          </p>

          {errorMsg && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[10px] text-amber-200 leading-normal">
              {errorMsg}
            </div>
          )}

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[10px] text-white/60 space-y-1 font-mono">
            <p className="text-sky-300 font-semibold text-[9.5px]">How to enable microphone:</p>
            <p>1. Click the <strong className="text-white">lock / shield icon</strong> in your browser address bar.</p>
            <p>2. Set <strong className="text-white">Microphone</strong> permission to <strong className="text-emerald-400">Allow</strong>.</p>
            <p>3. Click <strong>Request Microphone Access</strong> below.</p>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-5 space-y-2">
          <button
            type="button"
            onClick={handleRequestAccess}
            disabled={requesting}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-sky-400/50 bg-sky-500/20 py-2.5 text-[11px] font-semibold tracking-wider text-sky-100 hover:bg-sky-500/30 shadow-[0_0_15px_rgba(56,189,248,0.25)] transition-all disabled:opacity-50"
          >
            <Mic size={16} className={requesting ? 'animate-bounce text-sky-300' : 'text-sky-300'} />
            {requesting ? 'Requesting Permission…' : 'Request Microphone Access'}
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenChat();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-2 text-[10.5px] font-medium text-white/80 hover:bg-white/10 transition-all"
          >
            <MessageSquare size={15} className="text-sky-300" />
            Type Messages in Chat Instead
          </button>
        </div>

      </div>
    </div>
  );
}
