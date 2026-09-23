/**
 * SamJuniors OS — Sophia.
 * An operating environment, not a page: the substance is the interface.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dockLayout, stageLayout, type StageLayout } from './sophia/layout';
import { getSophiaOS, type OSStatus } from './sophia/SophiaOS';
import type { SophiaStateName } from './sophia/types';
import { ChatPanel } from './ui/ChatPanel';
import { Brand, Dock, Identity, OrbDock, StatusCluster } from './ui/Hud';
import { BrowserPanel } from './ui/BrowserPanel';
import { Onboarding } from './ui/Onboarding';
import { SettingsSheet } from './ui/SettingsSheet';
import { Terminal } from './ui/Terminal';
import { controlLayer } from './sophia/control';

function isTyping(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

const STATE_ANNOUNCE: Record<SophiaStateName, string> = {
  idle: 'Sophia is here. Calm and stable presence.',
  listening: 'Sophia is listening. Receiving your voice.',
  thinking: 'Sophia is thinking. Reorganizing information.',
  rendering: 'Sophia is rendering. Assembling and building.',
  speaking: 'Sophia is speaking. Sharing voice with you.',
  pause: 'Sophia is paused. Taking a moment.',
  paused: 'Sophia is paused. Taking a moment.',
  completed: 'Task completed successfully. Returning to calm.',
  blocked: 'Sophia needs your help or permission to continue.',
  ambient: 'Sophia is present.',
  wakeup: 'Sophia is waking up.',
  focusing: 'Sophia is focusing.',
  transforming: 'Sophia is transforming.',
};


export default function App() {
  const os = useMemo(getSophiaOS, []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const micRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<SophiaStateName>(os.state.current);
  const [status, setStatus] = useState<OSStatus>(os.status);
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [micError, setMicError] = useState(os.isMicDisabledError);
  const [glFailed, setGlFailed] = useState(false);
  const [layout, setLayout] = useState<StageLayout>(() => stageLayout(window.innerWidth, window.innerHeight));

  /* ONLY full screen space like Browser / Workspace causes Sophia to dock at the bottom!
     Settings, Terminal, and Chat all leave Sophia in the center stage. */
  const docked = browserOpen;
  const paused = state === 'paused';

  useEffect(() => {
    os.setDocked(docked);
  }, [docked, os]);

  useEffect(() => {
    const onBrowserCmd = (e: Event) => {
      const open = Boolean((e as CustomEvent).detail?.open);
      setBrowserOpen(open);
    };
    controlLayer.addEventListener('command:browser', onBrowserCmd);
    return () => controlLayer.removeEventListener('command:browser', onBrowserCmd);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) os.attach(canvas);
    const onState = (e: Event) => setState((e as CustomEvent).detail.state);
    const onStatus = (e: Event) => {
      setStatus((e as CustomEvent).detail);
      setMicError(os.isMicDisabledError);
    };
    const onMicErr = () => {
      setMicError(true);
      // When mic is disabled due to missing keys or server offline, automatically open terminal so user sees the reason
      setTerminalOpen(true);
    };
    const onFail = () => setGlFailed(true);
    os.addEventListener('state', onState);
    os.addEventListener('status', onStatus);
    os.addEventListener('mic-error', onMicErr);
    os.addEventListener('renderer-failed', onFail);

    const measure = () => {
      const w = canvas?.clientWidth || window.innerWidth;
      const h = canvas?.clientHeight || window.innerHeight;
      setLayout(stageLayout(w, h));
      const r = micRef.current?.getBoundingClientRect();
      os.setFocusPoint(r ? r.left + r.width / 2 : w * 0.92, r ? r.top + r.height / 2 : h * 0.92, w, h);
    };
    measure();
    const ro = canvas ? new ResizeObserver(measure) : null;
    if (canvas) ro!.observe(canvas);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      os.removeEventListener('state', onState);
      os.removeEventListener('status', onStatus);
      os.removeEventListener('mic-error', onMicErr);
      os.removeEventListener('renderer-failed', onFail);
      os.detach();
    };
  }, [os]);

  const onMic = useCallback(() => {
    if (os.isPaused || os.isMicDisabledError || os.rendererFailed) return;
    const s = os.state.current;
    if (s === 'ambient' || s === 'idle') {
      void os.activate('mic-button');
    } else if (s === 'transforming' || s === 'wakeup') {
      return; // let the moment finish
    } else {
      // Clicking an active mic means PAUSE. It is not a degraded/error state.
      os.pause();
    }
  }, [os]);

  const toggleShapePause = useCallback(() => {
    if (os.isPaused) os.resume();
    else os.pause();
  }, [os]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (browserOpen) setBrowserOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        else if (terminalOpen) setTerminalOpen(false);
        else if (chatOpen) setChatOpen(false);
        else if (os.state.current !== 'ambient') os.deactivate('escape');
        return;
      }
      if (isTyping()) return;
      if (e.key === 'm' || e.key === 'M' || e.key === ' ') {
        e.preventDefault();
        onMic();
      }
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        if (os.isPaused) os.resume();
        else os.pause();
      }
      if (e.key === 't' || e.key === 'T' || e.key === '/') {
        e.preventDefault();
        setChatOpen(true);
      }
      if (e.key === '`' || e.key === '~') {
        e.preventDefault();
        setTerminalOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onMic, browserOpen, chatOpen, settingsOpen, terminalOpen, os]);

  const health = glFailed ? 'error' : os.health;
  const voiceUnavailable = micError || glFailed || status === 'denied' || status === 'error';

  const stageStyle = {
    left: layout.cx - layout.R,
    top: layout.cy - layout.R,
    width: layout.R * 2,
    height: layout.R * 2,
  } as const;
  const hitLayout = docked ? dockLayout(window.innerWidth, window.innerHeight) : layout;
  const hitRadius = docked ? 40 : hitLayout.R * 1.08;
  const shapeHitStyle = {
    left: hitLayout.cx - hitRadius,
    top: hitLayout.cy - hitRadius,
    width: hitRadius * 2,
    height: hitRadius * 2,
  } as const;

  return (
    <div className="font-sophia fixed inset-0 select-none overflow-hidden bg-[#04060f] text-white antialiased">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden="true" />
      {glFailed && <div className="sophia-fallback" style={stageStyle} aria-hidden="true" />}

      {/* The substance itself is a control: click to pause, click again to resume. */}
      {!glFailed && (
        <button
          type="button"
          aria-label={paused ? 'Resume Sophia' : 'Pause Sophia'}
          title={paused ? 'Resume Sophia' : 'Pause Sophia'}
          onClick={toggleShapePause}
          className="absolute z-[4] rounded-full bg-transparent outline-none focus-visible:ring-1 focus-visible:ring-sky-300/40"
          style={shapeHitStyle}
        />
      )}

      <Brand />
      <StatusCluster
        health={health}
        active={state !== 'ambient' || status === 'live'}
        settingsOpen={settingsOpen}
        onSettings={() => setSettingsOpen((v) => !v)}
      />
      <Identity layout={layout} state={state} docked={docked} />
      <OrbDock visible={docked && !glFailed} state={state} />

      {chatOpen && <ChatPanel status={status} onClose={() => setChatOpen(false)} onSend={(t) => os.sendText(t)} />}
      {settingsOpen && <SettingsSheet os={os} status={status} onClose={() => setSettingsOpen(false)} />}
      <Terminal os={os} open={terminalOpen} onToggle={() => setTerminalOpen((v) => !v)} />
      {browserOpen && <BrowserPanel onClose={() => setBrowserOpen(false)} />}
      {!settingsOpen && !chatOpen && !terminalOpen && !browserOpen && <Onboarding />}

      <Dock
        state={state}
        micRef={micRef}
        onMic={onMic}
        onChat={() => setChatOpen((v) => !v)}
        chatOpen={chatOpen}
        paused={paused}
        micError={voiceUnavailable}
        browserOpen={browserOpen}
        onToggleBrowser={() => setBrowserOpen((v) => !v)}
      />

      <p className="sr-only" role="status" aria-live="polite">
        {STATE_ANNOUNCE[state]} Voice transport {status}. System health {health}.
      </p>
    </div>
  );
}
