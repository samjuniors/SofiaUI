/**
 * tools/system-control.ts
 *
 * Direct Device & Native OS Control Tool for Sofia.
 *
 * Allows Sofia to:
 * - Open the user's REAL desktop browser (Chrome, Edge, Firefox, Brave) to any website.
 * - Search on the real desktop browser (Google search).
 * - Stream music or videos on YouTube or Spotify in the desktop browser.
 * - Launch native desktop applications (Notepad, Calculator, Explorer, Terminal).
 * - Retrieve accurate system local time, timezone, and device diagnostic info.
 */

import type { ITool, ToolResult, SystemControlArgs } from './types';
import { controlLayer } from '../sophia/control';

export const systemControlTool: ITool = {
  name: 'system_control',
  description:
    'Control the user device and operating system. ' +
    'Open the real desktop browser to any URL, search the web in the desktop browser, ' +
    'stream music or video on YouTube/Spotify, launch native desktop apps (calculator, notepad, explorer), ' +
    'or query real-time system clock/time. Always call this when the user asks to open something on their device or real browser.',

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
          errorDetail: errJson.error || `HTTP ${res.status} from system action endpoint`,
        };
      }

      const data = await res.json();

      // If browser action, also update and open the in-app browser panel
      if (cleanArgs.action === 'open_browser' || cleanArgs.action === 'search_browser' || cleanArgs.action === 'stream_media') {
        const targetUrl = data.url || 'https://www.google.com';
        controlLayer.dispatchEvent(
          new CustomEvent('command:ui', {
            detail: { target: 'browser', action: 'open' },
          })
        );
        controlLayer.dispatchEvent(
          new CustomEvent('command:navigate', {
            detail: { url: targetUrl, title: cleanArgs.query || 'Browser' },
          })
        );
      }

      // Emit notification to HUD so user sees the confirmation visually too
      if (data.message) {
        controlLayer.dispatchEvent(
          new CustomEvent('command:notification', {
            detail: { message: data.message, level: 'success', duration: 3500 },
          })
        );
      }

      return {
        success: true,
        data,
      };
    } catch (err: any) {
      return {
        success: false,
        error: 'network_error',
        errorDetail: err?.message || 'Could not communicate with device controller',
      };
    }
  },
};
