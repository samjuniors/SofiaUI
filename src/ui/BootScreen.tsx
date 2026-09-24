import { useEffect, useState } from 'react';
import type { SophiaOS } from '../sophia/SophiaOS';

type Phase = 'init' | 'ready' | 'listening';

export function BootScreen({ os, onEnter }: { os: SophiaOS; onEnter: () => void }) {
  const [phase, setPhase] = useState<Phase>('init');
  const [hint, setHint] = useState('Initializing systems…');

  useEffect(() => {
    let gone = false;
    const t = window.setTimeout(() => {
      if (gone) return;
      setPhase('ready');
      setHint('Clap · say Hey Sophia · or click to enter');
      void os.prepareListen().then((ok) => {
        if (gone) return;
        setPhase('listening');
        setHint(
          ok
            ? 'Listening — clap, say Hey Sophia, or click'
            : 'Click to allow the microphone — then clap, speak, or tap',
        );
      });
    }, 1100);
    const onEntered = () => {
      if (!gone) onEnter();
    };
    os.addEventListener('entered', onEntered);
    return () => {
      gone = true;
      clearTimeout(t);
      os.removeEventListener('entered', onEntered);
    };
  }, [os, onEnter]);

  return (
    <div
      className="boot-screen absolute inset-0 z-40 flex flex-col items-center justify-center bg-[#04060f]/72 backdrop-blur-[10px]"
      role="dialog"
      aria-label="Sophia boot"
    >
      <button
        type="button"
        className="flex max-w-[min(420px,88vw)] flex-col items-center text-center"
        onClick={() => void os.enterSession('boot')}
      >
        <span className="boot-mark" aria-hidden="true" />
        <p className="mt-8 text-[10px] font-light uppercase tracking-[0.42em] text-sky-300/70">SamJuniors OS</p>
        <h1 className="mt-3 text-[clamp(28px,4vw,42px)] font-extralight tracking-[0.14em] text-white/92">
          Sophia
        </h1>
        <p className="boot-hint mt-5 text-[12px] font-light tracking-[0.12em] text-white/50">{hint}</p>
        <span
          className={`mt-8 h-px w-16 bg-gradient-to-r from-transparent via-sky-300/80 to-transparent ${
            phase === 'init' ? 'boot-scan' : 'opacity-80'
          }`}
        />
      </button>
    </div>
  );
}
