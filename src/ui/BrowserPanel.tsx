/**
 * BrowserPanel — draggable and resizable OS workspace.
 * The window always preserves a small bottom strip for Sophia's live mini-orb.
 */

import { ArrowLeft, ArrowRight, Globe, Maximize2, Minus, RotateCw, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

interface BrowserTab {
  id: string;
  title: string;
  url: string;
}

interface WindowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const TABS: BrowserTab[] = [
  { id: 'home', title: 'SamJuniors OS Hub', url: 'https://os.samjuniors.internal/workspace' },
  { id: 'docs', title: 'Sophia Architecture', url: 'https://docs.sophia.ai/voice-first' },
  { id: 'research', title: 'Spatial Presence', url: 'https://research.samjuniors.io/spatial-audio-2026' },
];

const EDGE = 7;
const MARGIN = 12;
const RESERVED_DOCK = 116;

function clampRect(rect: WindowRect): WindowRect {
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const maxW = Math.max(300, viewportW - MARGIN * 2);
  const maxH = Math.max(240, viewportH - RESERVED_DOCK - MARGIN * 2);
  const minW = Math.min(480, maxW);
  const minH = Math.min(300, maxH);
  const w = Math.max(minW, Math.min(maxW, rect.w));
  const h = Math.max(minH, Math.min(maxH, rect.h));
  const x = Math.max(MARGIN, Math.min(viewportW - w - MARGIN, rect.x));
  const y = Math.max(MARGIN, Math.min(viewportH - RESERVED_DOCK - h, rect.y));
  return { x, y, w, h };
}

function initialRect(): WindowRect {
  const w = Math.min(1080, window.innerWidth - 48);
  const h = Math.min(720, window.innerHeight - RESERVED_DOCK - 36);
  return clampRect({ x: (window.innerWidth - w) / 2, y: 18, w, h });
}

export function BrowserPanel({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState('home');
  const [urlInput, setUrlInput] = useState(TABS[0].url);
  const [isSearching, setIsSearching] = useState(false);
  const [rect, setRect] = useState<WindowRect>(initialRect);
  const [maximized, setMaximized] = useState(false);
  const restoreRect = useRef<WindowRect | null>(null);
  const gesture = useRef<
    | { kind: 'drag'; startX: number; startY: number; start: WindowRect }
    | { kind: 'resize'; edge: ResizeEdge; startX: number; startY: number; start: WindowRect }
    | null
  >(null);

  useEffect(() => {
    const onResize = () => setRect((current) => clampRect(current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const switchTab = (tab: BrowserTab) => {
    setActiveTab(tab.id);
    setUrlInput(tab.url);
  };

  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button, input')) return;
    gesture.current = { kind: 'drag', startX: event.clientX, startY: event.clientY, start: rect };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const beginResize = (edge: ResizeEdge, event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    gesture.current = { kind: 'resize', edge, startX: event.clientX, startY: event.clientY, start: rect };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveWindow = (event: ReactPointerEvent<HTMLElement>) => {
    const active = gesture.current;
    if (!active) return;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (active.kind === 'drag') {
      setRect(clampRect({ ...active.start, x: active.start.x + dx, y: active.start.y + dy }));
      return;
    }
    const edge = active.edge;
    let { x, y, w, h } = active.start;
    if (edge.includes('e')) w += dx;
    if (edge.includes('s')) h += dy;
    if (edge.includes('w')) {
      x += dx;
      w -= dx;
    }
    if (edge.includes('n')) {
      y += dy;
      h -= dy;
    }
    setRect(clampRect({ x, y, w, h }));
  };

  const endGesture = () => {
    gesture.current = null;
  };

  const toggleMaximize = () => {
    if (maximized && restoreRect.current) {
      setRect(clampRect(restoreRect.current));
      restoreRect.current = null;
      setMaximized(false);
      return;
    }
    restoreRect.current = rect;
    setRect(clampRect({ x: MARGIN, y: MARGIN, w: window.innerWidth, h: window.innerHeight }));
    setMaximized(true);
  };

  const handleNavigate = (event: React.FormEvent) => {
    event.preventDefault();
    setIsSearching(true);
    window.setTimeout(() => setIsSearching(false), 300);
  };

  return (
    <section
      aria-label="SamJuniors OS Browser"
      className="glass-panel panel-in fixed z-30 flex select-none flex-col overflow-hidden rounded-2xl shadow-[0_30px_100px_rgba(0,0,0,0.85)]"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      onPointerMove={moveWindow}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
    >
      <header
        className="flex h-10 shrink-0 cursor-move items-center justify-between border-b border-white/[0.06] bg-white/[0.02] px-3.5"
        onPointerDown={beginDrag}
        onDoubleClick={toggleMaximize}
      >
        <div className="pointer-events-none flex items-center gap-2">
          <Globe size={13} className="text-sky-400/80" />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.24em] text-white/50">Workspace Environment</span>
          <span className="hidden font-mono text-[8.5px] text-white/25 sm:inline">drag · resize</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onClose} aria-label="Minimize workspace" className="grid size-7 cursor-pointer place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white transition-colors">
            <Minus size={13} strokeWidth={1.75} />
          </button>
          <button type="button" onClick={toggleMaximize} aria-label={maximized ? 'Restore workspace' : 'Maximize workspace'} className="grid size-7 cursor-pointer place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white transition-colors">
            <Maximize2 size={12} strokeWidth={1.6} />
          </button>
          <button type="button" onClick={onClose} aria-label="Close workspace" className="grid size-7 cursor-pointer place-items-center rounded-lg text-white/40 hover:bg-rose-500/20 hover:text-rose-200 transition-colors">
            <X size={13} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      <div className="flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-white/[0.06] px-3.5">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => switchTab(tab)}
            className={`flex h-7 shrink-0 items-center gap-2 rounded-xl px-3 font-mono text-[9.5px] tracking-wide transition-all ${
              activeTab === tab.id
                ? 'border border-white/[0.12] bg-white/[0.08] text-white shadow-[0_2px_8px_rgba(0,0,0,0.3)]'
                : 'text-white/40 hover:bg-white/[0.03] hover:text-white/80'
            }`}
          >
            <Globe size={10} className={activeTab === tab.id ? 'text-sky-300' : 'text-white/35'} />
            <span className="max-w-[150px] truncate">{tab.title}</span>
          </button>
        ))}
      </div>

      <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-white/[0.06] bg-black/25 px-3.5">
        <div className="flex items-center gap-1 text-white/40">
          <button type="button" aria-label="Back" className="grid size-7 place-items-center rounded-lg hover:bg-white/[0.06] hover:text-white transition-colors"><ArrowLeft size={13} /></button>
          <button type="button" aria-label="Forward" className="grid size-7 place-items-center rounded-lg hover:bg-white/[0.06] hover:text-white transition-colors"><ArrowRight size={13} /></button>
          <button type="button" aria-label="Reload" onClick={() => { setIsSearching(true); window.setTimeout(() => setIsSearching(false), 250); }} className="grid size-7 place-items-center rounded-lg hover:bg-white/[0.06] hover:text-white transition-colors">
            <RotateCw size={13} className={isSearching ? 'animate-spin' : ''} />
          </button>
        </div>
        <form onSubmit={handleNavigate} className="flex flex-1 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-1 transition-all focus-within:border-sky-400/40 focus-within:bg-white/[0.05]">
          <Globe size={12} className="text-sky-400/60" />
          <input value={urlInput} onChange={(event) => setUrlInput(event.target.value)} spellCheck={false} aria-label="Web address" className="h-5 flex-1 select-text bg-transparent font-mono text-[11px] text-white/85 focus:outline-none" />
        </form>
        <span className="hidden items-center gap-1.5 rounded-full border border-sky-400/25 bg-sky-400/10 px-2.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wider text-sky-200 md:flex">
          <span className="block size-1.5 rounded-full bg-sky-400 animate-pulse" /> Sophia Docked
        </span>
      </div>

      <div className="chat-scroll relative flex-1 select-text overflow-y-auto p-6">
        {activeTab === 'home' && (
          <div className="mx-auto max-w-4xl space-y-5">
            <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-transparent p-6">
              <span className="inline-block rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-[9px] uppercase tracking-widest text-sky-200">Dedicated workspace</span>
              <h2 className="mt-3 text-2xl font-extralight tracking-wide text-white">The centre stage is available.</h2>
              <p className="mt-2 max-w-2xl text-sm font-light leading-relaxed text-white/60">Sophia remains alive in the reserved dock below. Drag this title bar, resize any edge or corner, or double-click the bar to maximize without covering her dock.</p>
              <button type="button" onClick={onClose} className="mt-5 rounded-xl border border-sky-400/40 bg-sky-400/15 px-4 py-2 text-xs font-normal tracking-wider text-sky-100 transition-all hover:bg-sky-400/25 active:scale-95">Return Sophia to Center</button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {[
                ['Presence', 'Living mini-orb', 'Her audio state and glow remain active while you work.'],
                ['Voice', 'One continuous session', 'Listening, thinking and speaking continue from the dock.'],
                ['Window', 'Drag and resize', 'This behaves like a true OS window, not a fixed overlay.'],
              ].map(([label, title, body]) => (
                <div key={label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                  <p className="text-[9px] font-mono uppercase tracking-wider text-sky-400/70">{label}</p>
                  <h3 className="mt-1 text-sm font-normal text-white">{title}</h3>
                  <p className="mt-2 text-xs font-light leading-relaxed text-white/45">{body}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        {activeTab === 'docs' && (
          <div className="mx-auto max-w-3xl space-y-4 font-light text-white/78">
            <h2 className="text-xl font-normal text-white">Voice Health & Degradation</h2>
            <div className="space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 text-xs leading-relaxed">
              <p><strong className="text-white">Green:</strong> available or live.</p>
              <p><strong className="text-white">Orange:</strong> connection is being checked; click the mic to complete the check.</p>
              <p><strong className="text-white">Red:</strong> a real fault such as a missing server key, denied microphone, or renderer failure. Terminal → System shows the exact reason.</p>
              <p><strong className="text-white">Pause:</strong> a user choice, not degradation. It stops the physical microphone and bows Sophia without turning health red.</p>
            </div>
          </div>
        )}
        {activeTab === 'research' && (
          <div className="mx-auto max-w-3xl space-y-4 font-light text-white/78">
            <h2 className="text-xl font-normal text-white">Spatial Presence</h2>
            <div className="space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 text-xs leading-relaxed">
              <p>Sophia yields the centre only to full workspace surfaces. Settings, Terminal and Chat leave her centered.</p>
              <p>In the dock, point size, bloom, displacement and orbit intensity recalibrate for the smaller form rather than merely scaling a large render down.</p>
            </div>
          </div>
        )}
      </div>

      {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeEdge[]).map((edge) => {
        const vertical = edge === 'n' || edge === 's';
        const horizontal = edge === 'e' || edge === 'w';
        const style: CSSProperties = vertical
          ? { left: EDGE, right: EDGE, height: EDGE, [edge === 'n' ? 'top' : 'bottom']: 0 }
          : horizontal
            ? { top: EDGE, bottom: EDGE, width: EDGE, [edge === 'w' ? 'left' : 'right']: 0 }
            : { width: EDGE * 2, height: EDGE * 2, [edge.includes('n') ? 'top' : 'bottom']: 0, [edge.includes('w') ? 'left' : 'right']: 0 };
        const cursor = vertical ? 'ns-resize' : horizontal ? 'ew-resize' : edge === 'nw' || edge === 'se' ? 'nwse-resize' : 'nesw-resize';
        return <div key={edge} aria-hidden="true" className="absolute z-50" style={{ ...style, cursor }} onPointerDown={(event) => beginResize(edge, event)} />;
      })}
    </section>
  );
}