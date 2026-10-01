/**
 * ui/DailyWhatsApp.tsx — WhatsApp draft-first flow (Phase 4).
 *
 * Drafting never sends. Sending is enabled only for the exact drafted
 * recipient + text, and still asks for an inline confirmation. Until the
 * companion gains playwright-core + a Chrome profile, every action degrades
 * to a setup hint instead of a crash.
 */
import { useEffect, useState } from 'react';
import { Bell, ExternalLink, Loader2, MessageSquarePlus, Send, TriangleAlert } from 'lucide-react';
import {
  DailyError,
  WHATSAPP_SETUP_HINT,
  defaultCaller as daily,
  isSetupError,
  whatsappDraft,
  whatsappOpen,
  whatsappSend,
  whatsappUnread,
  type UnreadChat,
  type WhatsAppDraft,
} from '../lib/daily-skills';

export function DailyWhatsApp() {
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<WhatsAppDraft | null>(null);
  const [unread, setUnread] = useState<UnreadChat[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [setupBlocked, setSetupBlocked] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const chats = await whatsappUnread(daily);
        if (live) setUnread(chats);
      } catch (err) {
        if (!live) return;
        if (isSetupError(err)) setSetupBlocked(true);
        else setError(err instanceof DailyError ? err.message : 'Could not read unread chats.');
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  function fail(err: unknown) {
    if (isSetupError(err)) {
      setSetupBlocked(true);
      setError(null);
    } else {
      setError(err instanceof DailyError ? err.message : 'WhatsApp action failed.');
    }
  }

  async function doDraft() {
    setBusy('draft');
    setError(null);
    setNotice(null);
    setConfirming(false);
    try {
      const d = await whatsappDraft(daily, to, text);
      setDraft(d);
      setNotice(`Drafted for ${d.to} — review it in WhatsApp, then send.`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function doSend() {
    setBusy('send');
    setError(null);
    try {
      await whatsappSend(daily, draft, to, text, true);
      setNotice(`Sent to ${draft?.to}.`);
      setDraft(null);
      setText('');
      setConfirming(false);
    } catch (err) {
      if (err instanceof DailyError && err.needsConfirmation && !confirming) {
        setConfirming(true);
      } else {
        fail(err);
      }
    } finally {
      setBusy(null);
    }
  }

  async function doOpen() {
    setBusy('open');
    setError(null);
    try {
      await whatsappOpen(daily, to.trim() ? to : undefined);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  const draftMatches = draft !== null && draft.to.replace(/^\+/, '') === to.trim().replace(/[\s\-().]/g, '').replace(/^\+/, '') && draft.text === text;
  const totalUnread = (unread ?? []).reduce((n, c) => n + c.count, 0);

  const input =
    'w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 focus:border-sky-400/50 focus:outline-none disabled:opacity-50';

  return (
    <div className="flex flex-col gap-2">
      {/* Unread banner */}
      {unread && unread.length > 0 && (
        <div className="rounded-lg border border-sky-400/25 bg-sky-500/10 px-2.5 py-1.5">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-sky-200">
            <Bell size={12} /> {totalUnread} unread message{totalUnread === 1 ? '' : 's'}
          </p>
          <ul className="mt-0.5 flex max-h-16 flex-col gap-0.5 overflow-y-auto">
            {unread.map((c) => (
              <li key={c.chat} className="truncate text-[11px] text-white/65">
                {c.chat} · {c.count}
              </li>
            ))}
          </ul>
        </div>
      )}

      {setupBlocked && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2.5 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-200">
            <TriangleAlert size={12} /> WhatsApp is not set up yet
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-white/65">{WHATSAPP_SETUP_HINT}</p>
        </div>
      )}

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

      <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
        To · phone
        <input
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setConfirming(false);
          }}
          placeholder="+91 98765 43210"
          inputMode="tel"
          aria-label="Recipient phone number"
          disabled={busy !== null}
          className={input}
        />
      </label>

      <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
        Message
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setConfirming(false);
          }}
          placeholder="Type the message to draft…"
          rows={3}
          maxLength={4000}
          aria-label="Message text"
          disabled={busy !== null}
          className={`${input} resize-none`}
        />
      </label>

      {/* Draft-first actions */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={busy !== null || !to.trim() || !text.trim()}
          onClick={() => void doDraft()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-sky-400/40 bg-sky-500/20 px-2 py-1.5 text-[11px] font-medium text-sky-100 transition-colors hover:bg-sky-500/30 disabled:opacity-50"
        >
          {busy === 'draft' ? <Loader2 size={13} className="animate-spin" /> : <MessageSquarePlus size={13} />}
          1 · Draft message
        </button>
        <button
          type="button"
          aria-label="Open WhatsApp"
          title="Open WhatsApp on the companion"
          disabled={busy !== null}
          onClick={() => void doOpen()}
          className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/60 transition-colors hover:text-white disabled:opacity-50"
        >
          {busy === 'open' ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
        </button>
      </div>

      {confirming && draftMatches ? (
        <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-2 text-[11px]">
          <p className="text-amber-100">
            Send this drafted message to <span className="font-semibold">{draft?.to}</span>?
          </p>
          <p className="mt-0.5 line-clamp-2 text-white/60">“{text}”</p>
          <div className="mt-1.5 flex gap-1.5">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void doSend()}
              className="flex flex-1 items-center justify-center gap-1 rounded-md border border-rose-400/50 bg-rose-500/25 px-2 py-1 font-medium text-rose-100 hover:bg-rose-500/35 disabled:opacity-50"
            >
              {busy === 'send' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              Yes, send it
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-white/70 hover:text-white"
            >
              Keep as draft
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy !== null || !draftMatches}
          onClick={() => setConfirming(true)}
          title={draftMatches ? 'Send the drafted message' : 'Draft the exact message above first — sending never happens from a cold compose'}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-rose-400/40 bg-rose-500/15 px-2 py-1.5 text-[11px] font-medium text-rose-100 transition-colors hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === 'send' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          2 · Send drafted message
        </button>
      )}

      <p className="text-center text-[10px] leading-relaxed text-white/35">
        Drafting never sends. The send button wakes only for the exact drafted text — and still asks first.
      </p>
    </div>
  );
}
