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
import { BootScreen } from './ui/BootScreen';
import { BrowserPanel } from './ui/BrowserPanel';
import { DiagnosticsModal } from './ui/DiagnosticsModal';
import { MicPermissionModal } from './ui/MicPermissionModal';
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
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [micModalOpen, setMicModalOpen] = useState(false);
  const [glFailed, setGlFailed] = useState(false);
  const [booted, setBooted] = useState(false);
  const [layout, setLayout] = useState<StageLayout>(() => stageLayout(window.innerWidth, window.innerHeight));

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
    const onStatus = (e: Event) => setStatus((e as CustomEvent).detail);
    const onMicStatus = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.status === 'denied') {
        setMicModalOpen(true);
      }
    };
    const onFail = () => setGlFailed(true);
    const onEntered = () => setBooted(true);

    os.addEventListener('state', onState);
    os.addEventListener('status', onStatus);
    os.addEventListener('mic-status', onMicStatus);
    os.addEventListener('renderer-failed', onFail);
    os.addEventListener('entered', onEntered);

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
      os.removeEventListener('mic-status', onMicStatus);
      os.removeEventListener('renderer-failed', onFail);
      os.removeEventListener('entered', onEntered);
      os.detach();
    };
  }, [os]);

  const onMic = useCallback(() => {
    if (os.rendererFailed) return;
    if (os.audio.micStatus === 'denied') {
      setMicModalOpen(true);
      return;
    }
    if (os.isPaused || paused) {
      os.resume();
      void os.enterSession('mic-button');
    } else {
      os.pause();
    }
  }, [os, paused]);

  const toggleShapePause = useCallback(() => {
    if (os.isPaused || paused) {
      os.resume();
      void os.enterSession('mic-button');
    } else {
      os.pause();
    }
  }, [os, paused]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (diagnosticsOpen) setDiagnosticsOpen(false);
        else if (browserOpen) setBrowserOpen(false);
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
        setChatOpen((v) => !v);
      }
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        setDiagnosticsOpen((v) => !v);
      }
      if (e.key === '`' || e.key === '~') {
        e.preventDefault();
        setTerminalOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onMic, browserOpen, chatOpen, settingsOpen, terminalOpen, diagnosticsOpen, os]);

  const health = glFailed ? 'error' : os.health;

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
    <div
      className={`font-sophia fixed inset-0 select-none overflow-hidden bg-[#04060f] text-white antialiased transition-all duration-700 ease-out ${
        paused ? 'sophia-paused' : ''
      }`}
    >
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
        onDiagnostics={() => setDiagnosticsOpen(true)}
      />
      <Identity layout={layout} state={state} docked={docked} />
      <OrbDock visible={docked && !glFailed} state={state} />

      {chatOpen && (
        <ChatPanel status={status} onClose={() => setChatOpen(false)} onSend={(t) => os.sendText(t)} />
      )}
      {!booted && (
        <div className="absolute inset-0 z-50">
          <BootScreen os={os} onEnter={() => setBooted(true)} />
        </div>
      )}
      {booted && settingsOpen && <SettingsSheet os={os} status={status} onClose={() => setSettingsOpen(false)} />}
      {booted && <Terminal os={os} open={terminalOpen} onToggle={() => setTerminalOpen((v) => !v)} />}
      {browserOpen && <BrowserPanel onClose={() => setBrowserOpen(false)} />}
      {diagnosticsOpen && <DiagnosticsModal os={os} onClose={() => setDiagnosticsOpen(false)} />}
      {micModalOpen && (
        <MicPermissionModal
          os={os}
          onClose={() => setMicModalOpen(false)}
          onOpenChat={() => setChatOpen(true)}
        />
      )}

      <Dock
        state={state}
        micRef={micRef}
        onMic={onMic}
        onChat={() => setChatOpen((v) => !v)}
        chatOpen={chatOpen}
        paused={paused}
        browserOpen={browserOpen}
        onToggleBrowser={() => setBrowserOpen((v) => !v)}
      />

      <p className="sr-only" role="status" aria-live="polite">
        {STATE_ANNOUNCE[state]} Voice transport {status}. System health {health}.
      </p>
    </div>
  );
}
