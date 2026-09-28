/**
 * BrowserPanel — real iframe browser, controllable by Sofia's voice.
 * navigateBrowserTo(url) is called by control_ui / play_music tool handlers.
 */

import { ArrowLeft, ArrowRight, ExternalLink, Globe, Maximize2, Minus, Monitor, Music, RotateCw, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { controlLayer } from '../sophia/control';
import { registerBrowserNavigate, unregisterBrowserNavigate } from '../lib/browser-bridge';

interface WindowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

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

/** Map music search queries to embed-friendly YouTube player */
function musicSearchUrl(query: string): string {
  const q = encodeURIComponent(query.trim() || 'relaxing music');
  return `https://www.youtube-nocookie.com/embed?listType=search&list=${q}&autoplay=1`;
}

/** Convert watch/search URLs to iframe-embeddable URLs where possible */
function convertToEmbedUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be')) {
      if (parsed.pathname === '/watch') {
        const v = parsed.searchParams.get('v');
        if (v) return `https://www.youtube-nocookie.com/embed/${v}?autoplay=1`;
      }
      if (parsed.pathname.startsWith('/embed/')) {
        return rawUrl;
      }
      if (parsed.pathname === '/results' && parsed.searchParams.has('search_query')) {
        const q = parsed.searchParams.get('search_query');
        return `https://www.youtube-nocookie.com/embed?listType=search&list=${encodeURIComponent(q || '')}&autoplay=1`;
      }
      if (parsed.hostname === 'youtu.be') {
        const id = parsed.pathname.slice(1);
        if (id) return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`;
      }
    }
  } catch {
    // not a valid URL yet
  }
  return rawUrl;
}

/** Make a URL navigable: add https:// if missing, or treat bare word as a Google search */
function resolveUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return 'https://www.google.com';
  let clean = trimmed;
  if (!/^https?:\/\//i.test(trimmed)) {
    if (/^[a-z0-9-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
      clean = `https://${trimmed}`;
    } else {
      clean = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
    }
  }
  return convertToEmbedUrl(clean);
}

export function BrowserPanel({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState('https://www.google.com');
  const [urlInput, setUrlInput] = useState('https://www.google.com');
  const [pageTitle, setPageTitle] = useState('Browser');
  const [loading, setLoading] = useState(false);
  const [rect, setRect] = useState<WindowRect>(initialRect);
  const [maximized, setMaximized] = useState(false);
  const restoreRect = useRef<WindowRect | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const historyStack = useRef<string[]>(['https://www.google.com']);
  const historyIdx = useRef(0);

  const gesture = useRef<
    | { kind: 'drag'; startX: number; startY: number; start: WindowRect }
    | { kind: 'resize'; edge: ResizeEdge; startX: number; startY: number; start: WindowRect }
    | null
  >(null);

  // Register global navigate function via bridge
  useEffect(() => {
    registerBrowserNavigate((newUrl: string, title?: string) => {
      const resolved = resolveUrl(newUrl);
      setUrl(resolved);
      setUrlInput(resolved);
      if (title) setPageTitle(title);
      setLoading(true);
      historyStack.current = historyStack.current.slice(0, historyIdx.current + 1);
      historyStack.current.push(resolved);
      historyIdx.current = historyStack.current.length - 1;
    });
    return () => unregisterBrowserNavigate();
  }, []);

  // Listen for voice navigation commands
  useEffect(() => {
    const onNav = (e: Event) => {
      const { url: navUrl, query, title } = (e as CustomEvent).detail as {
        url?: string; query?: string; title?: string;
      };
      const resolved = navUrl ? resolveUrl(navUrl) : resolveUrl(query || '');
      setUrl(resolved);
      setUrlInput(resolved);
      if (title) setPageTitle(title);
      setLoading(true);
    };
    controlLayer.addEventListener('command:navigate', onNav);
    return () => controlLayer.removeEventListener('command:navigate', onNav);
  }, []);

  useEffect(() => {
    const onResize = () => setRect((current) => clampRect(current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const navigate = (newUrl: string) => {
    const resolved = resolveUrl(newUrl);
    setUrl(resolved);
    setUrlInput(resolved);
    setLoading(true);
    historyStack.current = historyStack.current.slice(0, historyIdx.current + 1);
    historyStack.current.push(resolved);
    historyIdx.current = historyStack.current.length - 1;
  };

  const goBack = () => {
    if (historyIdx.current <= 0) return;
    historyIdx.current--;
    const prev = historyStack.current[historyIdx.current];
    setUrl(prev);
    setUrlInput(prev);
    setLoading(true);
  };

  const goForward = () => {
    if (historyIdx.current >= historyStack.current.length - 1) return;
    historyIdx.current++;
    const next = historyStack.current[historyIdx.current];
    setUrl(next);
    setUrlInput(next);
    setLoading(true);
  };

  const reload = () => {
    setLoading(true);
    if (iframeRef.current) {
      // eslint-disable-next-line no-self-assign
      iframeRef.current.src = iframeRef.current.src;
    }
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
    if (edge.includes('w')) { x += dx; w -= dx; }
    if (edge.includes('n')) { y += dy; h -= dy; }
    setRect(clampRect({ x, y, w, h }));
  };

  const endGesture = () => { gesture.current = null; };

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
    navigate(urlInput);
  };

  const quickNav = (searchUrl: string, title: string) => {
    setPageTitle(title);
    navigate(searchUrl);
  };

  const openInDesktopBrowser = async (targetUrl?: string) => {
    const dest = targetUrl || urlInput || url;
    try {
      await fetch('/api/sophia/system/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'open_browser', url: dest }),
      });
      controlLayer.dispatchEvent(
        new CustomEvent('command:notification', {
          detail: { message: 'Opened in your desktop browser.', level: 'success', duration: 2500 },
        })
      );
    } catch {
      window.open(dest, '_blank');
    }
  };

  // Display URL nicely
  const displayUrl = url.replace(/^https?:\/\//, '').replace(/\/$/, '');

  return (
    <section
      aria-label="Sofia Browser"
      className="glass-panel panel-in fixed z-30 flex select-none flex-col overflow-hidden rounded-2xl shadow-[0_30px_100px_rgba(0,0,0,0.85)]"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      onPointerMove={moveWindow}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
    >
      {/* Title bar */}
      <header
        className="flex h-10 shrink-0 cursor-move items-center justify-between border-b border-white/[0.06] bg-white/[0.02] px-3.5"
        onPointerDown={beginDrag}
        onDoubleClick={toggleMaximize}
      >
        <div className="pointer-events-none flex items-center gap-2">
          <Globe size={13} className="text-sky-400/80" />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.24em] text-white/50">Sofia Browser</span>
          <span className="hidden max-w-[200px] truncate font-mono text-[8.5px] text-white/25 sm:inline">{displayUrl}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => openInDesktopBrowser()}
            title="Open in your default desktop browser (Chrome/Edge)"
            aria-label="Open in Desktop Browser"
            className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-mono text-sky-300/80 bg-sky-500/10 hover:bg-sky-500/20 hover:text-sky-200 transition-colors"
          >
            <Monitor size={11} />
            <span className="hidden md:inline">Open in Real Browser</span>
            <ExternalLink size={10} />
          </button>
          <button type="button" onClick={onClose} aria-label="Minimize" className="grid size-7 cursor-pointer place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white transition-colors">
            <Minus size={13} strokeWidth={1.75} />
          </button>
          <button type="button" onClick={toggleMaximize} aria-label={maximized ? 'Restore' : 'Maximize'} className="grid size-7 cursor-pointer place-items-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white transition-colors">
            <Maximize2 size={12} strokeWidth={1.6} />
          </button>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-7 cursor-pointer place-items-center rounded-lg text-white/40 hover:bg-rose-500/20 hover:text-rose-200 transition-colors">
            <X size={13} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {/* Navigation bar */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-black/25 px-3">
        <div className="flex items-center gap-0.5 text-white/40">
          <button type="button" aria-label="Back" onClick={goBack} className="grid size-7 place-items-center rounded-lg hover:bg-white/[0.06] hover:text-white transition-colors">
            <ArrowLeft size={13} />
          </button>
          <button type="button" aria-label="Forward" onClick={goForward} className="grid size-7 place-items-center rounded-lg hover:bg-white/[0.06] hover:text-white transition-colors">
            <ArrowRight size={13} />
          </button>
          <button type="button" aria-label="Reload" onClick={reload} className="grid size-7 place-items-center rounded-lg hover:bg-white/[0.06] hover:text-white transition-colors">
            <RotateCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <form onSubmit={handleNavigate} className="flex flex-1 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-1 transition-all focus-within:border-sky-400/40 focus-within:bg-white/[0.05]">
          <Globe size={12} className="text-sky-400/60 shrink-0" />
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            spellCheck={false}
            aria-label="Web address or search"
            placeholder="Search or enter URL…"
            className="h-5 flex-1 select-text bg-transparent font-mono text-[11px] text-white/85 placeholder-white/20 focus:outline-none"
          />
        </form>
        {/* Quick-nav shortcuts */}
        <div className="hidden sm:flex items-center gap-1">
          <button
            type="button"
            title="Stream music on YouTube"
            onClick={() => quickNav(musicSearchUrl('lofi chill music'), 'Music')}
            className="grid size-7 place-items-center rounded-lg text-white/40 hover:bg-purple-500/20 hover:text-purple-300 transition-colors"
          >
            <Music size={13} />
          </button>
          <button
            type="button"
            title="Launch current page in external desktop browser"
            onClick={() => openInDesktopBrowser()}
            className="grid size-7 place-items-center rounded-lg text-white/40 hover:bg-sky-500/20 hover:text-sky-300 transition-colors"
          >
            <ExternalLink size={13} />
          </button>
        </div>
      </div>

      {/* Iframe content */}
      <div className="relative flex-1 overflow-hidden bg-white">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#04060f]">
            <div className="flex flex-col items-center gap-3">
              <div className="size-8 animate-spin rounded-full border-2 border-sky-400/20 border-t-sky-400" />
              <span className="font-mono text-[10px] text-white/30 uppercase tracking-widest">Loading</span>
            </div>
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={url}
          title={pageTitle}
          className="h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          onLoad={() => setLoading(false)}
          onError={() => setLoading(false)}
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>

      {/* Resize handles */}
      {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeEdge[]).map((edge) => {
        const vertical = edge === 'n' || edge === 's';
        const horizontal = edge === 'e' || edge === 'w';
        const style: CSSProperties = vertical
          ? { left: EDGE, right: EDGE, height: EDGE, [edge === 'n' ? 'top' : 'bottom']: 0 }
          : horizontal
            ? { top: EDGE, bottom: EDGE, width: EDGE, [edge === 'w' ? 'left' : 'right']: 0 }
            : { width: EDGE * 2, height: EDGE * 2, [edge.includes('n') ? 'top' : 'bottom']: 0, [edge.includes('w') ? 'left' : 'right']: 0 };
        const cursor = vertical ? 'ns-resize' : horizontal ? 'ew-resize' : edge === 'nw' || edge === 'se' ? 'nwse-resize' : 'nesw-resize';
        return <div key={edge} aria-hidden="true" className="absolute z-50" style={{ ...style, cursor }} onPointerDown={(e) => beginResize(edge, e)} />;
      })}
    </section>
  );
}