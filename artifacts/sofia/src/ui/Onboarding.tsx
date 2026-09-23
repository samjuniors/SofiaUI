import { useEffect, useState } from 'react';

const KEY = 'sophia:onboarded';

export function Onboarding() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) !== '1') setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  if (!open) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* noop */
    }
    setOpen(false);
  };

  return (
    <aside
      role="dialog"
      aria-label="Welcome to Sophia"
      className="onboard panel-in absolute bottom-[118px] left-1/2 z-30 w-[min(340px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl border border-white/[0.1] bg-[#050811]/94 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.65)] backdrop-blur-xl sm:bottom-[132px]"
    >
      <p className="text-[8.5px] font-light uppercase tracking-[0.34em] text-sky-300/70">First look</p>
      <p className="mt-2 text-[13px] font-light leading-relaxed tracking-wide text-white/80">
        Idle is the bowed ribbon — a hanging multi-color arc with a slow oscillation, like Deepgram’s voice mark.
      </p>
      <p className="mt-2 text-[12px] font-light leading-relaxed text-white/45">
        Open Settings to try forms and themes. Space talks, P pauses, T types, click the orb to pause.
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="mt-3 h-9 w-full rounded-full border border-sky-300/30 bg-sky-400/[0.14] text-[11px] font-light tracking-[0.22em] text-sky-100 transition hover:border-sky-200/50 hover:bg-sky-400/[0.22]"
      >
        GOT IT
      </button>
    </aside>
  );
}
