/**
 * tools/system-control.ts
 *
 * Device actions that run inside Sofia: in-app browser, search, music, clock.
 * Native OS exec is unavailable in the hosted preview — everything opens here.
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
    'Control Sofia on this device. Open the in-app browser to a URL, search the web, ' +
    'stream music on YouTube, open calculator or Spotify inside Sofia, or query the clock.',

  async invoke(rawArgs: Record<string, unknown>, _callId?: string): Promise<ToolResult> {
    const args = rawArgs as unknown as SystemControlArgs;

    if (!args.action) {
      return {
        success: false,
        error: 'missing_action',
        errorDetail: 'system_control requires an action parameter.',
      };
    }

    if (args.action === 'open_browser' || args.action === 'search_browser' || args.action === 'stream_media') {
      let url = String(args.url ?? '').trim();
      if (args.action === 'search_browser' && args.query) {
        url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query.trim())}`;
      } else if (args.action === 'stream_media' && args.query) {
        url = `https://www.youtube-nocookie.com/embed?listType=search&list=${encodeURIComponent(args.query.trim())}&autoplay=1`;
      } else if (!url && args.query) {
        url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query.trim())}`;
      }
      if (!url) url = 'sophia://home';
      openInSofiaBrowser(url, args.query);
      controlLayer.dispatchEvent(
        new CustomEvent('command:notification', {
          detail: { message: 'Opened in Sofia Browser', level: 'success', duration: 2500 },
        }),
      );
      return { success: true, data: { action: args.action, url, inApp: true } };
    }

    if (args.action === 'open_app') {
      const appName = String(args.app ?? '').trim().toLowerCase();
      const appMap: Record<string, { url: string; title: string }> = {
        browser: { url: 'sophia://home', title: 'Sofia Browser' },
        chrome: { url: 'sophia://home', title: 'Sofia Browser' },
        edge: { url: 'sophia://home', title: 'Sofia Browser' },
        calculator: { url: 'https://www.desmos.com/scientific', title: 'Calculator' },
        calc: { url: 'https://www.desmos.com/scientific', title: 'Calculator' },
        spotify: { url: 'https://open.spotify.com/embed', title: 'Spotify' },
        notepad: { url: 'https://en.wikipedia.org/wiki/Main_Page', title: 'Wikipedia' },
        explorer: { url: 'sophia://home', title: 'Sofia Browser' },
        files: { url: 'sophia://home', title: 'Sofia Browser' },
        terminal: { url: 'sophia://home', title: 'Sofia Browser' },
        cmd: { url: 'sophia://home', title: 'Sofia Browser' },
      };
      const dest = appMap[appName] ?? { url: 'sophia://home', title: 'Sofia Browser' };
      openInSofiaBrowser(dest.url, dest.title);
      controlLayer.dispatchEvent(
        new CustomEvent('command:notification', {
          detail: { message: `Opening ${dest.title}`, level: 'success', duration: 2500 },
        }),
      );
      return { success: true, data: { action: 'open_app', app: appName, url: dest.url, inApp: true } };
    }

    try {
      const res = await fetch('/api/sophia/system/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
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
      if (data?.inApp && data?.url) {
        openInSofiaBrowser(String(data.url), data.title);
      }
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
