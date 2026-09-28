/**
 * tools/system-control.ts
 *
 * Device actions that run inside Sofia:
 * - Native desktop browser launch via /api/sophia/system/action
 * - In-app Sofia browser & media HUD panel
 */

import type { ITool, ToolResult, SystemControlArgs } from './types';
import { controlLayer } from '../sophia/control';
import { navigateBrowserTo } from '../lib/browser-bridge';

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
    'Control the device and Sofia. Open the desktop browser or in-app browser to a URL, search the web, ' +
    'stream music on YouTube, open applications, or query the clock.',

  async invoke(rawArgs: Record<string, unknown>, _callId?: string): Promise<ToolResult> {
    const args = rawArgs as unknown as SystemControlArgs;

    if (!args.action) {
      return {
        success: false,
        error: 'missing_action',
        errorDetail: 'system_control requires an action parameter.',
      };
    }

    // Normalize defaults so commands without explicit URLs always open Google
    const cleanArgs: SystemControlArgs = {
      action: args.action,
      url: args.url || (args.action === 'open_browser' && !args.query ? 'https://www.google.com' : undefined),
      query: args.query,
      app: args.app,
    };

    // Immediate HUD preview in Sofia UI
    if (args.action === 'open_browser' || args.action === 'search_browser' || args.action === 'stream_media') {
      let previewUrl = cleanArgs.url || 'https://www.google.com';
      if (cleanArgs.action === 'search_browser' && cleanArgs.query) {
        previewUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanArgs.query.trim())}`;
      } else if (cleanArgs.action === 'stream_media' && cleanArgs.query) {
        previewUrl = `https://www.youtube-nocookie.com/embed?listType=search&list=${encodeURIComponent(cleanArgs.query.trim())}&autoplay=1`;
      }
      openInSofiaBrowser(previewUrl, cleanArgs.query || 'Browser');
    } else if (args.action === 'open_app') {
      const appName = String(args.app ?? '').trim().toLowerCase();
      const appMap: Record<string, { url: string; title: string }> = {
        browser: { url: 'https://www.google.com', title: 'Sofia Browser' },
        chrome: { url: 'https://www.google.com', title: 'Sofia Browser' },
        edge: { url: 'https://www.google.com', title: 'Sofia Browser' },
        calculator: { url: 'https://www.desmos.com/scientific', title: 'Calculator' },
        calc: { url: 'https://www.desmos.com/scientific', title: 'Calculator' },
        spotify: { url: 'https://open.spotify.com/embed', title: 'Spotify' },
        notepad: { url: 'https://en.wikipedia.org/wiki/Main_Page', title: 'Wikipedia' },
      };
      const dest = appMap[appName] ?? { url: 'https://www.google.com', title: 'Sofia App' };
      openInSofiaBrowser(dest.url, dest.title);
    }

    try {
      const res = await fetch('/api/sophia/system/action', {
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

      // Emit notification to HUD so user sees the confirmation visually too
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
