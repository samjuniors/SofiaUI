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
          errorDetail: errJson.error || `HTTP ${res.status} from system action endpoint`,
        };
      }

      const data = await res.json();

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
