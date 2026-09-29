/**
 * tools/system-control.ts
 *
 * Device actions that run inside Sofia:
 * - Decision engine for music and browser session reuse
 * - Native desktop browser launch via /api/sophia/system/action
 * - In-app Sofia browser & media HUD panel
 * - Interactive scrolling, tab navigation, and playback control
 */

import type { ITool, ToolResult, SystemControlArgs } from './types';
import { controlLayer } from '../sophia/control';
import { navigateBrowserTo } from '../lib/browser-bridge';
import { decisionEngine } from '../sophia/decision-engine';
import { sophiaFetch } from '../lib/sophia-fetch.ts';

function openInSofiaBrowser(url: string, title?: string) {
  controlLayer.dispatchEvent(
    new CustomEvent('command:ui', { detail: { target: 'browser', action: 'open' } }),
  );
  controlLayer.dispatchEvent(
    new CustomEvent('command:navigate', { detail: { url, title } }),
  );
  navigateBrowserTo(url, title);
}

export const systemControlTool: ITool = {
  name: 'system_control',
  description:
    'Control Sofia\'s own in-app experience (Sofia browser panel, ambient music, HUD) plus real desktop browser search and real desktop app launches. ' +
    'For mouse, keyboard, local files, and real Chrome control, use the computer tool instead. ' +
    'Open or navigate the browser, intelligently stream music or play ambient soundscapes, ' +
    'scroll web pages (up/down/top/bottom), interact with active pages (press tab/enter, play/pause), ' +
    'launch desktop apps, or query system clock/time.',

  async invoke(rawArgs: Record<string, unknown>, _callId?: string): Promise<ToolResult> {
    const args = rawArgs as unknown as SystemControlArgs & {
      direction?: 'up' | 'down' | 'top' | 'bottom';
      interactType?: 'click' | 'type' | 'press_key' | 'play_pause';
      key?: string;
    };

    if (!args.action) {
      return {
        success: false,
        error: 'missing_action',
        errorDetail: 'system_control requires an action parameter.',
      };
    }

    // 1. Interactive browser scrolling
    if (args.action === ('scroll_browser' as any)) {
      const dir = args.direction || 'down';
      controlLayer.dispatchEvent(
        new CustomEvent('command:browser_scroll', { detail: { direction: dir } }),
      );
      controlLayer.dispatchEvent(
        new CustomEvent('command:notification', {
          detail: { message: `Scrolled ${dir}`, level: 'info', duration: 1500 },
        }),
      );
      return { success: true, data: { action: 'scroll_browser', direction: dir } };
    }

    // 2. Interactive page control (press tab, enter, play/pause media)
    if (args.action === ('browser_interact' as any)) {
      const interactType = args.interactType || 'play_pause';
      controlLayer.dispatchEvent(
        new CustomEvent('command:browser_interact', {
          detail: { action: interactType, key: args.key },
        }),
      );
      return { success: true, data: { action: 'browser_interact', interactType } };
    }

    // 3. Intelligent Music Decision
    if (args.action === 'stream_media') {
      const musicDec = decisionEngine.decideMusic(args.query);

      // In-app ambient audio (no intrusive new tab or popups)
      if (musicDec.action === 'inapp_ambient') {
        controlLayer.dispatchEvent(
          new CustomEvent('command:notification', {
            detail: { message: musicDec.message, level: 'success', duration: 3500 },
          }),
        );
        return {
          success: true,
          data: {
            action: 'inapp_ambient',
            provider: 'inapp_ambient',
            message: musicDec.message,
          },
        };
      }

      // If user has Spotify preferred or asked for Spotify
      if (musicDec.provider === 'spotify') {
        openInSofiaBrowser(musicDec.url || 'https://open.spotify.com/embed', 'Spotify');
        try {
          await sophiaFetch('/api/sophia/system/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'open_app', app: 'spotify' }),
          });
        } catch {
          // ignore
        }
        return { success: true, data: musicDec };
      }

      // Default smart music: In-app embedded player without opening new OS window
      if (musicDec.url) {
        openInSofiaBrowser(musicDec.url, musicDec.query || 'Music');
        return { success: true, data: musicDec };
      }
    }

    // 4. Browser session reuse: If browser panel is already active, navigate existing tab instead of opening new ones
    if (decisionEngine.isBrowserActive()) {
      if (args.action === 'search_browser' && args.query) {
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query.trim())}`;
        openInSofiaBrowser(searchUrl, args.query);
        controlLayer.dispatchEvent(
          new CustomEvent('command:notification', {
            detail: { message: `Searching: ${args.query}`, level: 'info', duration: 2500 },
          }),
        );
        return { success: true, data: { action: 'search_browser', url: searchUrl, reused: true } };
      }

      if (args.action === 'open_browser' && args.url && !args.url.includes('google.com')) {
        openInSofiaBrowser(args.url, 'Browser');
        return { success: true, data: { action: 'open_browser', url: args.url, reused: true } };
      }
    }

    // Normalize defaults so commands without explicit URLs always open Google
    const cleanArgs: SystemControlArgs = {
      action: args.action,
      url: args.url || (args.action === 'open_browser' && !args.query ? 'https://www.google.com' : undefined),
      query: args.query,
      app: args.app,
    };

    // Immediate HUD preview in Sofia UI
    if (args.action === 'open_browser' || args.action === 'search_browser') {
      let previewUrl = cleanArgs.url || 'https://www.google.com';
      if (cleanArgs.action === 'search_browser' && cleanArgs.query) {
        previewUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanArgs.query.trim())}`;
      }
      openInSofiaBrowser(previewUrl, cleanArgs.query || 'Browser');
    } else if (args.action === 'open_app') {
      // Real launch on the user's PC via the computer tool (companion
      // daemon: allowlisted, policy-gated, cross-platform). No fake
      // in-app preview — if the companion is down, the honest
      // not_connected error tells the model exactly what to say.
      const { computerTool } = await import('./computer-tool');
      return computerTool.invoke({
        action: 'open_app',
        app: String(args.app ?? ''),
      });
    }

    try {
      const res = await sophiaFetch('/api/sophia/system/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanArgs),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        return {
          success: false,
          error: 'device_action_failed',
          errorDetail: (errJson as { error?: string }).error || `HTTP ${res.status} from system action endpoint`,
        };
      }

      const data = await res.json();

      if (data.message) {
        controlLayer.dispatchEvent(
          new CustomEvent('command:notification', {
            detail: { message: data.message, level: 'success', duration: 3500 },
          }),
        );
      }
      return { success: true, data };
    } catch (err: unknown) {
      return {
        success: false,
        error: 'network_error',
        errorDetail: err instanceof Error ? err.message : 'Could not complete the action',
      };
    }
  },
};
