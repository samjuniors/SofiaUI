/**
 * ui/TargetPreview.tsx — Phase 22: see where it will click BEFORE it clicks.
 *
 * The browser cannot draw on the OS screen, so risky steps pause and show
 * the next best thing: the fresh screenshot from the approval pause with
 * the resolved click point (and element box / drag path) drawn over it.
 * Approve lets the step run, Deny cancels the task. Nothing here executes
 * anything — it only resolves the pause the TaskLoop is already waiting on.
 */

import { useEffect, useState } from 'react';
import { Check, Crosshair, ShieldAlert, X } from 'lucide-react';
import { taskEvents } from '../core/TaskLoop.ts';
import { resolveTaskApproval } from '../policy/autonomy-wiring.ts';

interface PreviewShot {
  b64: string;
  mime: string;
  width: number;
  height: number;
}

interface PreviewTarget {
  x: number;
  y: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
  toX?: number;
  toY?: number;
}

interface PreviewScreen {
  width: number;
  height: number;
  offsetX?: number;
  offsetY?: number;
}

interface PreviewState {
  id: string;
  label: string;
  question: string;
  reason: string;
  target: PreviewTarget | null;
  shot: PreviewShot | null;
  screen: PreviewScreen | null;
}

const TERMINAL = new Set(['done', 'failed', 'cancelled']);

function isPreviewTarget(v: unknown): v is PreviewTarget {
  if (!v || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  return typeof t.x === 'number' && typeof t.y === 'number';
}

/** Physical pixel → screenshot pixel along one axis. */
function toShot(phys: number, offset: number, screenLen: number, shotLen: number): number {
  if (!screenLen || !shotLen) return 0;
  return ((phys - offset) * shotLen) / screenLen;
}

export function TargetPreview() {
  const [preview, setPreview] = useState<PreviewState | null>(null);

  useEffect(() => {
    const onTask = (e: Event) => {
      const d = (e as CustomEvent).detail as Record<string, unknown> & { id: string; phase: string };
      if (!d || typeof d.id !== 'string') return;
      if (TERMINAL.has(d.phase)) {
        setPreview((p) => (p && p.id === d.id ? null : p));
        return;
      }
      if (d.phase !== 'preview') return;
      if (d.dismissed === true) {
        setPreview((p) => (p && (p.id === d.id || d.index === undefined) ? null : p));
        return;
      }
      const shot = d.shot as PreviewState['shot'];
      const screen = d.screen as PreviewState['screen'];
      setPreview({
        id: d.id,
        label: typeof d.label === 'string' ? d.label : 'a step',
        question: typeof d.question === 'string' ? d.question : 'Approve this step?',
        reason: typeof d.reason === 'string' ? d.reason : 'confirm',
        target: isPreviewTarget(d.target) ? (d.target as PreviewTarget) : null,
        shot: shot && typeof shot.b64 === 'string' ? shot : null,
        screen: screen && typeof screen.width === 'number' ? screen : null,
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Deny (don't just close): the loop is parked on this decision and
      // Esc must resolve it, not leave it hanging behind a hidden modal.
      setPreview((p) => {
        if (p) {
          e.preventDefault();
          resolveTaskApproval(false);
        }
        return p;
      });
    };
    taskEvents.addEventListener('task:state', onTask);
    window.addEventListener('keydown', onKey);
    return () => {
      taskEvents.removeEventListener('task:state', onTask);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!preview) return null;

  const { shot, screen, target } = preview;
  const canDraw =
    shot !== null &&
    screen !== null &&
    target !== null &&
    screen.width > 0 &&
    screen.height > 0 &&
    shot.width > 0 &&
    shot.height > 0;
  const ox = screen?.offsetX ?? 0;
  const oy = screen?.offsetY ?? 0;
  const px = canDraw ? toShot(target.x, ox, screen.width, shot.width) : 0;
  const py = canDraw ? toShot(target.y, oy, screen.height, shot.height) : 0;
  const hasDrag =
    canDraw && typeof target.toX === 'number' && typeof target.toY === 'number';
  const tx = hasDrag ? toShot(target.toX as number, ox, screen.width, shot.width) : 0;
  const ty = hasDrag ? toShot(target.toY as number, oy, screen.height, shot.height) : 0;
  const box = canDraw && target.bounds
    ? {
        x: toShot(target.bounds.x, ox, screen.width, shot.width),
        y: toShot(target.bounds.y, oy, screen.height, shot.height),
        w: (target.bounds.width * shot.width) / screen.width,
        h: (target.bounds.height * shot.height) / screen.height,
      }
    : null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Approve agent step"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={() => resolveTaskApproval(false)}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-amber-300/30 bg-[#0a0f1e] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-white/10 px-5 py-4">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-amber-300">
            {preview.reason === 'daemon-gate' ? <ShieldAlert size={17} /> : <Crosshair size={17} />}
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-white">
              {preview.reason === 'daemon-gate' ? 'Gated step — your call' : 'Check the target, then approve'}
            </p>
            <p className="mt-0.5 text-[12px] leading-snug text-white/70">{preview.question}</p>
            <p className="mt-1 font-mono text-[11px] text-sky-300/80">{preview.label}</p>
          </div>
        </div>

        <div className="relative bg-black">
          {shot ? (
            <>
              <img
                src={`data:${shot.mime || 'image/png'};base64,${shot.b64}`}
                alt="Screenshot showing where the agent will act"
                className="block max-h-[46vh] w-full object-contain"
                draggable={false}
              />
              {canDraw && (
                <svg
                  viewBox={`0 0 ${shot.width} ${shot.height}`}
                  preserveAspectRatio="none"
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  aria-hidden="true"
                >
                  {box && (
                    <rect
                      x={box.x}
                      y={box.y}
                      width={Math.max(box.w, 8)}
                      height={Math.max(box.h, 8)}
                      fill="rgba(251,191,36,0.12)"
                      stroke="#fbbf24"
                      strokeWidth={shot.width / 480}
                      strokeDasharray={`${shot.width / 120} ${shot.width / 160}`}
                    />
                  )}
                  {hasDrag && (
                    <line
                      x1={px}
                      y1={py}
                      x2={tx}
                      y2={ty}
                      stroke="#f87171"
                      strokeWidth={shot.width / 320}
                      strokeDasharray={`${shot.width / 96} ${shot.width / 160}`}
                    />
                  )}
                  <circle cx={px} cy={py} r={shot.width / 90} fill="none" stroke="#f87171" strokeWidth={shot.width / 320} />
                  <circle cx={px} cy={py} r={shot.width / 300} fill="#f87171" />
                  <line x1={px - shot.width / 45} y1={py} x2={px + shot.width / 45} y2={py} stroke="#f87171" strokeWidth={shot.width / 480} />
                  <line x1={px} y1={py - shot.width / 45} x2={px} y2={py + shot.width / 45} stroke="#f87171" strokeWidth={shot.width / 480} />
                  {hasDrag && <circle cx={tx} cy={ty} r={shot.width / 200} fill="none" stroke="#f87171" strokeWidth={shot.width / 320} />}
                </svg>
              )}
              {!target && (
                <p className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-[11px] text-white/80">
                  This step has no single screen target (typing / app-level action).
                </p>
              )}
            </>
          ) : (
            <p className="px-5 py-8 text-center text-[12px] text-white/60">
              No screenshot for this step — approve on the description above, or deny to cancel.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-3">
          <span className="mr-auto text-[11px] text-white/40">Esc denies</span>
          <button
            type="button"
            onClick={() => resolveTaskApproval(false)}
            className="flex items-center gap-1.5 rounded-xl border border-red-400/40 bg-red-600/20 px-4 py-2 text-[12px] font-semibold text-red-100 transition hover:bg-red-600/35 active:scale-95"
          >
            <X size={14} />
            Deny
          </button>
          <button
            type="button"
            onClick={() => resolveTaskApproval(true)}
            autoFocus
            className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2 text-[12px] font-bold text-white shadow-lg shadow-emerald-900/50 transition hover:bg-emerald-500 active:scale-95"
          >
            <Check size={14} />
            Approve &amp; run
          </button>
        </div>
      </div>
    </div>
  );
}
