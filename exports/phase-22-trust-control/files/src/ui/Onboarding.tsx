/**
 * ui/Onboarding.tsx — Phase 22: the first-run wizard.
 *
 * Four steps, each one earning the next: pair the companion (PC control),
 * grant permissions (mic + notifications), verify hands (the skills link),
 * then a deterministic safe demo — a read-only look at the active window
 * and a screenshot, so the user sees Sofia perceive before she ever acts.
 * Every step is skippable; finishing (or skipping all) sets sophia:onboarded.
 */

import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  Hand,
  KeyRound,
  Loader2,
  Mic,
  MonitorSmartphone,
  Bell,
  PlugZap,
  ShieldCheck,
} from 'lucide-react';
import type { SophiaOS } from '../sophia/SophiaOS';
import { companion, type CompanionStatus } from '../lib/companion-client.ts';
import { setOnboarded } from '../lib/onboarded.ts';
import { HandsCard } from './HandsCard.tsx';

const STEPS = ['Pair', 'Permissions', 'Hands', 'Safe demo'] as const;

export function Onboarding({ os, onDone }: { os: SophiaOS; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<CompanionStatus>(companion.status);
  const [code, setCode] = useState('');
  const [pairing, setPairing] = useState(false);
  const [mic, setMic] = useState<'unknown' | 'granted' | 'blocked'>(() =>
    os.micStatus === 'capturing' ? 'granted' : os.micStatus === 'denied' ? 'blocked' : 'unknown',
  );
  const [micBusy, setMicBusy] = useState(false);
  const [notif, setNotif] = useState<'unknown' | 'granted' | 'blocked'>(() =>
    typeof Notification === 'undefined'
      ? 'blocked'
      : Notification.permission === 'granted'
        ? 'granted'
        : Notification.permission === 'denied'
          ? 'blocked'
          : 'unknown',
  );
  const [demo, setDemo] = useState<{
    windowName: string;
    shot: string;
    mime: string;
    error: string;
  } | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  useEffect(() => {
    const onStatus = () => setStatus(companion.status);
    companion.addEventListener('status', onStatus);
    return () => companion.removeEventListener('status', onStatus);
  }, []);

  const connected = status === 'connected';

  // Pairing done mid-wizard advances on its own — the user already proved intent.
  useEffect(() => {
    if (connected && step === 0) setStep(1);
  }, [connected, step]);

  const finish = () => {
    setOnboarded();
    onDone();
  };

  const pair = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setPairing(true);
    try {
      if (code.trim()) {
        companion.setPairing(code);
        setCode('');
      }
      await companion.connect();
    } finally {
      setPairing(false);
    }
  };

  const requestMic = async () => {
    setMicBusy(true);
    try {
      await os.audio.startCapture();
      setMic('granted');
    } catch {
      setMic('blocked');
    } finally {
      setMicBusy(false);
    }
  };

  const requestNotif = async () => {
    if (typeof Notification === 'undefined') {
      setNotif('blocked');
      return;
    }
    try {
      setNotif((await Notification.requestPermission()) === 'granted' ? 'granted' : 'blocked');
    } catch {
      setNotif('blocked');
    }
  };

  const runDemo = async () => {
    setDemoBusy(true);
    setDemo(null);
    try {
      const [win, shot] = await Promise.all([
        companion.send<{ window?: string; title?: string }>('get_active_window', {}),
        companion.send<{ b64?: string; screenshot_b64?: string; mime?: string }>('screenshot', {}),
      ]);
      if (!win.ok && !shot.ok) {
        setDemo({
          windowName: '',
          shot: '',
          mime: '',
          error: win.detail || win.error || 'The companion did not answer.',
        });
        return;
      }
      const b64 = shot.ok ? (shot.result?.b64 ?? shot.result?.screenshot_b64 ?? '') : '';
      setDemo({
        windowName: win.ok ? String(win.result?.window ?? win.result?.title ?? 'unknown window') : '(window unreadable)',
        shot: b64,
        mime: shot.result?.mime ?? 'image/png',
        error: '',
      });
    } finally {
      setDemoBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Sophia — setup"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-sky-400/25 bg-[#070b16] shadow-2xl">
        {/* Progress */}
        <div className="flex items-center gap-1.5 border-b border-white/10 px-5 pb-3 pt-4">
          {STEPS.map((label, i) => (
            <div key={label} className="flex flex-1 items-center gap-1.5">
              <div className="flex-1">
                <div
                  className={`h-1 rounded-full ${i < step ? 'bg-emerald-400' : i === step ? 'bg-sky-400' : 'bg-white/10'}`}
                />
                <p
                  className={`mt-1 text-[9px] uppercase tracking-[0.14em] ${
                    i === step ? 'text-sky-200' : i < step ? 'text-emerald-200/70' : 'text-white/35'
                  }`}
                >
                  {label}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-4">
          {step === 0 && (
            <div>
              <p className="flex items-center gap-2 text-[14px] font-semibold text-white">
                <MonitorSmartphone size={17} className="text-sky-300" />
                Pair your PC
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-white/60">
                Sofia drives your computer through the companion daemon — a tiny program that runs on your PC and
                nowhere else. Start it, then enter the pairing code it prints.
              </p>
              <p className="mt-2 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 font-mono text-[11px] text-sky-200/90">
                npm run companion
              </p>
              <form onSubmit={pair} className="mt-3 flex gap-2">
                <div className="relative flex-1">
                  <KeyRound size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-white/35" />
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="pairing code"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Pairing code"
                    className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2 pl-8 pr-2.5 font-mono text-[12px] text-white placeholder:text-white/30 focus:border-sky-400/50 focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={pairing || status === 'connecting'}
                  className="flex items-center gap-1.5 rounded-xl bg-sky-500 px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-sky-400 active:scale-95 disabled:opacity-50"
                >
                  {pairing || status === 'connecting' ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />}
                  Pair
                </button>
              </form>
              <p className="mt-2 text-[11px] text-white/45" role="status">
                {connected
                  ? 'Paired — Sofia can reach your PC.'
                  : status === 'connecting'
                    ? 'Connecting…'
                    : companion.lastError || 'Not paired yet.'}
              </p>
            </div>
          )}

          {step === 1 && (
            <div>
              <p className="flex items-center gap-2 text-[14px] font-semibold text-white">
                <ShieldCheck size={17} className="text-sky-300" />
                Permissions
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-white/60">
                Two optional grants. Everything still works over text without them.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
                  <Mic size={15} className="shrink-0 text-white/60" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] text-white/85">Microphone</p>
                    <p className="text-[11px] text-white/40">
                      {mic === 'granted' ? 'Granted — you can talk to Sofia.' : mic === 'blocked' ? 'Blocked — check the address-bar icon.' : 'For voice talk and the wake phrase.'}
                    </p>
                  </div>
                  {mic !== 'granted' && (
                    <button
                      type="button"
                      onClick={() => void requestMic()}
                      disabled={micBusy}
                      className="shrink-0 rounded-lg border border-sky-400/40 bg-sky-400/15 px-3 py-1.5 text-[11px] font-semibold text-sky-100 transition hover:bg-sky-400/25 active:scale-95 disabled:opacity-50"
                    >
                      {micBusy ? 'Asking…' : 'Allow'}
                    </button>
                  )}
                  {mic === 'granted' && <Check size={15} className="shrink-0 text-emerald-300" />}
                </div>
                <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
                  <Bell size={15} className="shrink-0 text-white/60" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] text-white/85">Notifications</p>
                    <p className="text-[11px] text-white/40">
                      {notif === 'granted' ? 'Granted.' : notif === 'blocked' ? 'Blocked or unavailable.' : 'For reminders and task results.'}
                    </p>
                  </div>
                  {notif !== 'granted' && notif !== 'blocked' && (
                    <button
                      type="button"
                      onClick={() => void requestNotif()}
                      className="shrink-0 rounded-lg border border-sky-400/40 bg-sky-400/15 px-3 py-1.5 text-[11px] font-semibold text-sky-100 transition hover:bg-sky-400/25 active:scale-95 disabled:opacity-50"
                    >
                      Enable
                    </button>
                  )}
                  {notif === 'granted' && <Check size={15} className="shrink-0 text-emerald-300" />}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <p className="flex items-center gap-2 text-[14px] font-semibold text-white">
                <Hand size={17} className="text-sky-300" />
                Hands check
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-white/60">
                This card is the live link between Sofia and your PC's skills. Green means she can act; run its test
                if you want proof.
              </p>
              <div className="mt-3">
                <HandsCard />
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <p className="flex items-center gap-2 text-[14px] font-semibold text-white">
                <Eye size={17} className="text-sky-300" />
                Safe demo — look, don't touch
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-white/60">
                One read-only glance: your active window's name plus a screenshot. Nothing clicks, types, or moves.
              </p>
              {!connected && (
                <p className="mt-2 rounded-xl border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-100/90">
                  The companion is offline — go back to step 1 to pair, or finish and explore without PC control.
                </p>
              )}
              {connected && !demo && (
                <button
                  type="button"
                  onClick={() => void runDemo()}
                  disabled={demoBusy}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-[12px] font-semibold text-white transition hover:bg-sky-400 active:scale-[0.99] disabled:opacity-50"
                >
                  {demoBusy ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                  {demoBusy ? 'Looking…' : 'Take a safe look'}
                </button>
              )}
              {demo && (
                <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
                  {demo.shot ? (
                    <img
                      src={`data:${demo.mime};base64,${demo.shot}`}
                      alt="Screenshot from the safe demo"
                      className="block max-h-44 w-full object-contain bg-black"
                      draggable={false}
                    />
                  ) : null}
                  <p className="bg-black/40 px-3 py-2 font-mono text-[11px] text-sky-200/90">
                    {demo.error || demo.windowName}
                  </p>
                  {!demo.error && (
                    <button
                      type="button"
                      onClick={() => void runDemo()}
                      disabled={demoBusy}
                      className="w-full border-t border-white/10 px-3 py-1.5 text-[11px] text-white/50 transition hover:bg-white/[0.04] hover:text-white disabled:opacity-50"
                    >
                      Look again
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div className="flex items-center gap-2 border-t border-white/10 px-5 py-3">
          {step > 0 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              className="flex items-center gap-1 rounded-xl border border-white/10 px-3 py-2 text-[12px] text-white/60 transition hover:bg-white/[0.06] hover:text-white"
            >
              <ArrowLeft size={13} />
              Back
            </button>
          ) : (
            <button
              type="button"
              onClick={finish}
              className="rounded-xl px-3 py-2 text-[12px] text-white/40 transition hover:bg-white/[0.06] hover:text-white"
            >
              Skip setup
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {step < STEPS.length - 1 ? (
              <>
                {step !== 0 && (
                  <button
                    type="button"
                    onClick={finish}
                    className="rounded-xl px-3 py-2 text-[12px] text-white/40 transition hover:bg-white/[0.06] hover:text-white"
                  >
                    Skip
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setStep((s) => s + 1)}
                  className="flex items-center gap-1 rounded-xl bg-sky-500 px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-sky-400 active:scale-95"
                >
                  Continue
                  <ArrowRight size={13} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={finish}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2 text-[12px] font-bold text-white shadow-lg shadow-emerald-900/50 transition hover:bg-emerald-500 active:scale-95"
              >
                <Check size={14} />
                Finish
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
