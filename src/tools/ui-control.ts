/**
 * tools/ui-control.ts
 *
 * Safe, validated UI-control tool.
 *
 * The LLM sends a structured UIControlArgs object.
 * This tool validates every field against a typed registry,
 * then dispatches a CustomEvent on controlLayer — the React layer
 * handles the actual DOM changes. The LLM never touches the DOM.
 */

import { controlLayer } from '../sophia/control';
import { navigateBrowserTo } from '../lib/browser-bridge';
import type { ITool, ToolResult, UIControlArgs, PanelName, UIActionType } from './types';

// ─── Validation constants ─────────────────────────────────────────────────────

const VALID_ACTIONS = new Set<UIActionType>([
  'set_state', 'open_panel', 'close_panel', 'toggle_panel', 'close_all_panels',
  'navigate_to_url', 'play_music', 'stop_music',
  'show_notification', 'set_volume', 'update_status_text',
]);

const VALID_PANELS = new Set<PanelName>([
  'browser', 'chat', 'settings', 'diagnostics', 'terminal',
]);

const VALID_STATES = new Set(['idle', 'listening', 'thinking', 'speaking', 'paused', 'wakeup']);

// ─── Tool ─────────────────────────────────────────────────────────────────────

export class UIControlTool implements ITool {
  readonly name = 'ui_control';
  readonly description =
    'Control the Sofia application UI using predefined, validated commands. ' +
    'Can set Sofia state (idle, listening, thinking, speaking), open/close/toggle panels, ' +
    'navigate the browser, play music, show notifications, and control volume. ' +
    'All commands are validated against a safe registry — no arbitrary code execution is possible.';

  async invoke(args: Record<string, unknown>): Promise<ToolResult> {
    const parsed = this.validate(args);
    if ('error' in parsed) return { success: false, error: parsed.error, errorDetail: parsed.detail };

    const cmd = parsed as UIControlArgs;

    switch (cmd.action) {
      case 'set_state': {
        const targetState = String(cmd.state ?? 'idle');
        controlLayer.dispatchEvent(new CustomEvent('command:state', { detail: { state: targetState } }));
        return { success: true, data: { action: 'set_state', state: targetState } };
      }

      case 'open_panel':
      case 'close_panel':
      case 'toggle_panel': {
        const target = cmd.panel ?? 'browser';
        const actionMap: Record<string, string> = {
          open_panel: 'open',
          close_panel: 'close',
          toggle_panel: 'toggle',
        };
        controlLayer.dispatchEvent(new CustomEvent('command:ui', {
          detail: { target, action: actionMap[cmd.action] },
        }));
        return { success: true, data: { action: cmd.action, target } };
      }

      case 'close_all_panels':
        controlLayer.dispatchEvent(new CustomEvent('command:ui', {
          detail: { target: 'all', action: 'close' },
        }));
        return { success: true, data: { action: 'close_all_panels' } };

      case 'navigate_to_url': {
        const url = String(cmd.url ?? '').trim();
        if (!url) return { success: false, error: 'missing_url' };
        controlLayer.dispatchEvent(new CustomEvent('command:ui', {
          detail: { target: 'browser', action: 'open' },
        }));
        controlLayer.dispatchEvent(new CustomEvent('command:navigate', {
          detail: { url, title: cmd.text },
        }));
        navigateBrowserTo(url, cmd.text);
        return { success: true, data: { action: 'navigate_to_url', url } };
      }

      case 'play_music': {
        const musicQuery = String(cmd.query ?? 'lofi chill music');
        const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(musicQuery)}`;
        controlLayer.dispatchEvent(new CustomEvent('command:ui', {
          detail: { target: 'browser', action: 'open' },
        }));
        controlLayer.dispatchEvent(new CustomEvent('command:navigate', {
          detail: { url: ytUrl, title: `Music: ${musicQuery}` },
        }));
        navigateBrowserTo(ytUrl, `Music: ${musicQuery}`);
        controlLayer.dispatchEvent(new CustomEvent('command:music', {
          detail: { action: 'play', query: musicQuery },
        }));
        return { success: true, data: { action: 'play_music', query: musicQuery } };
      }

      case 'stop_music':
        controlLayer.dispatchEvent(new CustomEvent('command:music', {
          detail: { action: 'stop' },
        }));
        return { success: true, data: { action: 'stop_music' } };

      case 'show_notification': {
        const message = String(cmd.message ?? '').trim();
        if (!message) return { success: false, error: 'missing_message' };
        controlLayer.dispatchEvent(new CustomEvent('command:notification', {
          detail: { message, level: cmd.level ?? 'info', duration: cmd.duration ?? 4000 },
        }));
        return { success: true, data: { action: 'show_notification', message } };
      }

      case 'set_volume': {
        const level = Math.max(0, Math.min(100, Number(cmd.volume ?? 50)));
        controlLayer.dispatchEvent(new CustomEvent('command:volume', { detail: { level } }));
        return { success: true, data: { action: 'set_volume', level } };
      }

      case 'update_status_text': {
        const text = String(cmd.text ?? '').trim();
        if (!text) return { success: false, error: 'missing_text' };
        controlLayer.dispatchEvent(new CustomEvent('command:status_text', {
          detail: { text, duration: cmd.duration ?? 5000 },
        }));
        return { success: true, data: { action: 'update_status_text', text } };
      }

      default:
        return { success: false, error: 'unknown_action', errorDetail: String(cmd.action) };
    }
  }

  private validate(args: Record<string, unknown>): UIControlArgs | { error: string; detail: string } {
    const action = String(args.action ?? '') as UIActionType;
    if (!VALID_ACTIONS.has(action)) {
      return { error: 'invalid_action', detail: `Action "${action}" is not in the UI control registry.` };
    }

    const state = args.state != null ? String(args.state) as UIControlArgs['state'] : undefined;
    if (state && !VALID_STATES.has(state)) {
      return { error: 'invalid_state', detail: `State "${state}" is not a valid Sofia state.` };
    }

    const panel = args.panel != null ? String(args.panel) as PanelName : undefined;
    if (panel && !VALID_PANELS.has(panel)) {
      return { error: 'invalid_panel', detail: `Panel "${panel}" is not a recognised panel.` };
    }

    const volume = args.volume != null ? Number(args.volume) : undefined;
    if (volume != null && (isNaN(volume) || volume < 0 || volume > 100)) {
      return { error: 'invalid_volume', detail: 'Volume must be 0–100.' };
    }

    return {
      action,
      state,
      panel,
      url: args.url != null ? String(args.url) : undefined,
      query: args.query != null ? String(args.query) : undefined,
      message: args.message != null ? String(args.message) : undefined,
      level: args.level as UIControlArgs['level'],
      volume,
      text: args.text != null ? String(args.text) : undefined,
      duration: args.duration != null ? Number(args.duration) : undefined,
    };
  }
}

export const uiControlTool = new UIControlTool();
