/**
 * tools/observe-tool.ts — Phase 19: on-demand eyes for the voice brain.
 *
 * The model calls `observe` whenever it needs to SEE (before acting, to
 * read content, to verify). The companion screenshot travels to the live
 * session as a video frame via `observeFrameEvents` (the provider
 * forwards it); the function response carries only metadata — base64
 * pixels never ride an LLM function-response cycle.
 *
 * Companion offline → one-shot browser capture fallback (needs the screen
 * already shared via the Vision button; voice calls carry no click
 * gesture, so this never prompts — it just returns null).
 */

import type { ITool, ToolResult, GeminiFunctionDeclaration } from './types';
import { computerTool } from './computer-tool.ts';

/** Frame bus: the live provider forwards these into the model session. */
export const observeFrameEvents = new EventTarget();

export interface ObserveFrame {
  b64: string;
  mime: string;
  source: 'companion' | 'browser-capture';
}

function emitFrame(frame: ObserveFrame): void {
  observeFrameEvents.dispatchEvent(new CustomEvent('observe:frame', { detail: frame }));
}

export type ObserveFallback = () => Promise<{ b64: string; mime: string } | null>;

let fallbackOverride: ObserveFallback | null | undefined;

async function defaultFallback(): Promise<{ b64: string; mime: string } | null> {
  // Lazy: ScreenVisionBridge pulls the client control layer (browser-only).
  const { screenVisionBridge } = await import('../sophia/vision/ScreenVisionBridge');
  return screenVisionBridge.captureOnce();
}

/** Test seam — stub (or disable, with null) the browser-capture fallback. */
export function __setObserveFallback(fn: ObserveFallback | null | undefined): void {
  fallbackOverride = fn;
}

export const observeTool: ITool = {
  name: 'observe',
  description:
    'Look at the user\'s screen ONCE, on demand. Returns the active window, the UI tree ' +
    '(names, roles, bounds), and notes; the screenshot itself is attached as a video frame ' +
    'you can see. Call whenever you need to see — before acting, to read content, or to ' +
    'verify a result. Never ask the user to share their screen.',
  async invoke(): Promise<ToolResult> {
    const r = await computerTool.invoke({ action: 'observe' });
    if (r.success && r.data && typeof r.data === 'object') {
      const d = r.data as Record<string, unknown>;
      const b64 = typeof d.screenshot_b64 === 'string' ? d.screenshot_b64 : null;
      const mime = typeof d.mime === 'string' ? d.mime : 'image/png';
      if (b64) emitFrame({ b64, mime, source: 'companion' });
      const { screenshot_b64: _dropped, ...meta } = d;
      void _dropped;
      return {
        success: true,
        data: {
          ...meta,
          screenshot: b64 ? 'attached as a video frame you can see' : 'unavailable (headless)',
        },
      };
    }
    const fallback = fallbackOverride !== undefined ? fallbackOverride : defaultFallback;
    const shot = await (fallback ? fallback() : Promise.resolve(null));
    if (shot) {
      emitFrame({ b64: shot.b64, mime: shot.mime, source: 'browser-capture' });
      return {
        success: true,
        data: {
          source: 'browser-capture',
          screenshot: 'attached as a video frame you can see',
          note: 'Companion offline — single browser capture, no UI tree. Pair the companion for full vision.',
        },
      };
    }
    return {
      success: false,
      error: r.error ?? 'observe_failed',
      errorDetail:
        (typeof r.errorDetail === 'string' && r.errorDetail) ||
        'Could not see the screen: companion offline and no browser capture active.',
    };
  },
};

export const OBSERVE_SCHEMA: GeminiFunctionDeclaration = {
  name: 'observe',
  description:
    'Look at the user\'s screen ONCE, on demand. Returns the active window + UI tree + notes; ' +
    'the screenshot arrives as a video frame you can see. Call whenever you need to see.',
  parameters: {
    type: 'OBJECT',
    properties: {},
  },
};
