/**
 * ui/DesktopBlock.tsx — Settings → System desktop controls.
 * Renders nothing in plain browsers (no `sophiaDesktop` bridge).
 */

import { useEffect, useState } from 'react';

export function DesktopBlock() {
  const [bridge, setBridge] = useState(() =>
    typeof window !== 'undefined' ? window.sophiaDesktop : undefined,
  );
  const [loginItem, setLoginItem] = useState<boolean | null>(null);

  // The preload bridge lands asynchronously — pick it up whenever it arrives.
  useEffect(() => {
    if (window.sophiaDesktop) {
      setBridge(window.sophiaDesktop);
      return;
    }
    const onReady = () => setBridge(window.sophiaDesktop);
    window.addEventListener('sophia:desktop-ready', onReady);
    return () => window.removeEventListener('sophia:desktop-ready', onReady);
  }, []);

  useEffect(() => {
    if (!bridge) return;
    bridge
      .getLoginItem()
      .then((s) => setLoginItem(s.openAtLogin === true))
      .catch(() => setLoginItem(null));
  }, [bridge]);

  if (!bridge) return null;

  const toggleLogin = async () => {
    try {
      const s = await bridge.setLoginItem(!(loginItem === true));
      setLoginItem(s.openAtLogin === true);
    } catch {
      /* main declined — leave the switch where it was */
    }
  };

  return (
    <div className="space-y-2.5 rounded-xl border border-sky-500/20 bg-sky-950/20 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-normal uppercase tracking-[0.2em] text-sky-200">
          Desktop app
        </span>
        <span className="font-mono text-[8px] text-sky-300/70">electron shell</span>
      </div>

      <button
        type="button"
        onClick={() => bridge.showOrb()}
        className="h-8 w-full rounded-xl border border-sky-400/30 bg-sky-400/[0.1] text-[9.5px] tracking-[0.14em] text-sky-100 transition hover:bg-sky-400/[0.2] active:scale-[0.98]"
      >
        POP OUT ORB
      </button>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-normal uppercase tracking-[0.2em] text-white/70">
            Start at login
          </p>
          <p className="text-[8.5px] font-light text-white/35">launch Sofia with the computer</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={loginItem === true}
          aria-label="Start at login"
          disabled={loginItem === null}
          onClick={() => void toggleLogin()}
          className={`relative h-5 w-9 rounded-full border transition-colors duration-200 ${
            loginItem === true
              ? 'border-sky-400/50 bg-sky-400/30 shadow-[0_0_10px_rgba(var(--th-glow),0.3)]'
              : 'border-white/10 bg-white/5'
          } ${loginItem === null ? 'opacity-40' : ''}`}
        >
          <span
            className={`block size-3.5 rounded-full transition-transform duration-200 ${
              loginItem === true
                ? 'translate-x-4 bg-sky-300 shadow-[0_0_6px_rgba(var(--th-glow-soft),0.8)]'
                : 'translate-x-0.5 bg-white/40'
            }`}
          />
        </button>
      </div>
    </div>
  );
}
