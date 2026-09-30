/**
 * tools/computer-tool.ts — Phase 10: real hands for voice + chat.
 *
 * ONE tool with an `action` enum that exposes the companion daemon's
 * computer-control surface to the LLM: launch desktop apps by name,
 * move/click/scroll the real mouse, type keys, find on-screen text,
 * read the active window, and operate the user's REAL Chrome in the SAME
 * tab (navigate, click text, type, read) — instead of opening fake
 * in-app browser pages.
 *
 * Safety is inherited, not reimplemented: the daemon's SafetyPolicy still
 * gates every call (app allowlist, risk classifier, kill switch, step
 * budget). When the daemon answers `confirmation_required` the tool fails
 * with that same key plus the daemon-issued `confirmation_id` so the UI
 * can ask the user out loud; ONLY the UI/voice-confirm handler redeems
 * the id — a model-supplied `confirm:true` is ignored by the daemon.
 *
 * Test seam: the companion call + vision flag go through an injectable
 * ComputerBackend; the real backend is loaded lazily so this module
 * never pulls the extensionless import chain into node test runs.
 */

import type { GeminiFunctionDeclaration, ITool, ToolResult } from './types';

export interface ComputerCallReply {
  ok: boolean;
  result?: unknown;
  error?: string;
  detail?: string;
  confirmation_id?: string;
}

export interface ComputerBackend {
  call(action: string, args?: Record<string, unknown>): Promise<ComputerCallReply>;
  visionActive(): boolean;
}

let backendOverride: ComputerBackend | null = null;

/** Test seam — inject a fake companion backend. */
export function __setComputerBackend(b: ComputerBackend | null): void {
  backendOverride = b;
}

async function loadBackend(): Promise<ComputerBackend> {
  if (backendOverride) return backendOverride;
  const [{ companion }, { screenVisionBridge }] = await Promise.all([
    import('../lib/companion-client'),
    import('../sophia/vision/ScreenVisionBridge'),
  ]);
  return {
    call: (action, args) => companion.send(action, args ?? {}),
    visionActive: () => screenVisionBridge.active,
  };
}

const MAX_TYPE = 1000;
const MAX_FIND = 200;
const MAX_URL = 2000;

/** Spoken by the model whenever the companion is offline — exact fix steps. */
const PAIR_HINT =
  'run `npm run companion` in the project folder (or `npm run dev:all` to start everything at once), ' +
  'then paste the pairing code it prints into the companion banner at the top of the app.';

/**
 * Friendly spoken names → companion allowlist ids. The daemon resolves
 * per-OS; unknown names pass through untouched (the daemon rejects what
 * it must, with a clear error).
 */
const APP_ALIASES: Record<string, string> = {
  'windows media player': 'wmplayer',
  'media player': 'wmplayer',
  wmplayer: 'wmplayer',
  paint: 'mspaint',
  mspaint: 'mspaint',
  'snipping tool': 'snippingtool',
  snippingtool: 'snippingtool',
  'task manager': 'taskmgr',
  taskmgr: 'taskmgr',
  calculator: 'calc',
  calc: 'calc',
  notepad: 'notepad',
  'file explorer': 'explorer',
  explorer: 'explorer',
  files: 'explorer',
  chrome: 'chrome',
  edge: 'msedge',
  msedge: 'msedge',
  spotify: 'spotify',
  'vs code': 'code',
  vscode: 'code',
  code: 'code',
  vlc: 'vlc',
  terminal: 'cmd',
  cmd: 'cmd',
  powershell: 'powershell',
  word: 'winword',
  winword: 'winword',
  excel: 'excel',
  outlook: 'outlook',
  firefox: 'firefox',
};

export function normalizeAppName(raw: string): string {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/\.(exe|app)$/, '');
  return APP_ALIASES[key] ?? key;
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

function fail(error: string, errorDetail: string): ToolResult {
  return { success: false, error, errorDetail };
}

export const computerTool: ITool = {
  name: 'computer',
  description:
    'Drive the user\'s REAL computer through the paired companion daemon. ' +
    'Launch desktop apps by name, move/click/scroll the real mouse, type keys, ' +
    'find on-screen text, read the active window, and operate the user\'s REAL Chrome ' +
    'in the SAME tab (navigate, click text, type, read). ' +
    'Prefer this tool whenever the user asks to open, click, move, scroll, type, press, ' +
    'see, or browse ANYTHING on their PC — system_control only drives Sofia\'s own in-app panels. ' +
    'Open local files by path with open_file. ' +
    'If any action fails with not_connected, the companion daemon is offline — read the errorDetail and tell the user exactly how to start it; never stay silent. ' +
    'Coordinates are physical screen pixels; use find_text to locate on-screen text before ' +
    'clicking when unsure. hotkey keys:"win" opens the Windows Start menu (win+e Explorer, win+r Run). ' +
    'On confirmation_required, ask the user out loud, then wait: ONLY the UI/voice-confirm ' +
    'handler redeems the issued confirmation_id. Never invent or guess an id. ' +
    'If Screen Vision is off and you need to see pixels, ask the user to tap the Vision (eye) button in the dock.',

  async invoke(rawArgs: Record<string, unknown>): Promise<ToolResult> {
    const action = String((rawArgs as { action?: unknown }).action ?? '');
    if (!action) return fail('missing_action', 'computer requires an action parameter.');

    const backend = await loadBackend();
    // One-time daemon-issued id, supplied ONLY by the UI/voice-confirm path
    // after the user approves. The daemon ignores model-set confirm:true.
    const cid = (rawArgs as { confirmation_id?: unknown }).confirmation_id;
    const withId = (args: Record<string, unknown>): Record<string, unknown> =>
      typeof cid === 'string' && cid ? { ...args, confirmation_id: cid } : args;

    // see — report what Sofia can currently perceive; never fails just
    // because the companion link is down (the vision flag is local).
    if (action === 'see') {
      const vision = backend.visionActive();
      const [win, cursor] = await Promise.all([
        backend.call('get_active_window'),
        backend.call('get_cursor'),
      ]);
      const connected = win.ok || cursor.ok;
      const title =
        win.ok && win.result && typeof win.result === 'object'
          ? String((win.result as { title?: unknown }).title ?? '')
          : '';
      const pos =
        cursor.ok && cursor.result && typeof cursor.result === 'object'
          ? (cursor.result as { x?: unknown; y?: unknown })
          : null;
      return {
        success: true,
        data: {
          action: 'see',
          vision,
          connected,
          window: title || null,
          cursor: pos,
          hint: !connected
            ? `Companion OFFLINE — you cannot touch the PC. Tell the user: ${PAIR_HINT}`
            : vision
              ? 'Screen Vision is LIVE — screen frames are streaming to you; describe what you see.'
              : 'Screen Vision is OFF — ask the user to tap the Vision (eye) button in the dock so you can see their screen.',
        },
      };
    }

    // Map the tool action onto one companion call.
    let callAction = '';
    let callArgs: Record<string, unknown> = {};
    switch (action) {
      case 'open_app': {
        const app = String((rawArgs as { app?: unknown }).app ?? '').trim();
        if (!app) return fail('missing_app', 'open_app requires an app name.');
        callAction = 'open_app';
        callArgs = withId({ app: normalizeAppName(app) });
        break;
      }
      case 'open_url': {
        const url = String((rawArgs as { url?: unknown }).url ?? '').trim().slice(0, MAX_URL);
        if (!/^https?:\/\//i.test(url)) return fail('bad_url', 'open_url requires an http(s) URL.');
        callAction = 'open_url';
        callArgs = withId({ url });
        break;
      }
      case 'open_file': {
        const path = String((rawArgs as { path?: unknown }).path ?? '').trim().slice(0, 500);
        if (!path) return fail('missing_path', 'open_file requires a local file path.');
        callAction = 'files_open';
        callArgs = withId({ path });
        break;
      }
      case 'click':
      case 'double_click':
      case 'right_click': {
        callAction = action;
        const x = num((rawArgs as { x?: unknown }).x);
        const y = num((rawArgs as { y?: unknown }).y);
        callArgs = withId(x !== undefined && y !== undefined ? { x, y } : {});
        break;
      }
      case 'move_mouse': {
        const x = num((rawArgs as { x?: unknown }).x);
        const y = num((rawArgs as { y?: unknown }).y);
        if (x === undefined || y === undefined) return fail('missing_coords', 'move_mouse requires x and y pixels.');
        callAction = 'move_mouse';
        callArgs = withId({ x, y });
        break;
      }
      case 'scroll': {
        callAction = 'scroll';
        callArgs = withId({ dy: num((rawArgs as { dy?: unknown }).dy) ?? 3 });
        break;
      }
      case 'type_text': {
        const text = String((rawArgs as { text?: unknown }).text ?? '').slice(0, MAX_TYPE);
        if (!text) return fail('missing_text', 'type_text requires text.');
        callAction = 'type_text';
        callArgs = withId({ text });
        break;
      }
      case 'hotkey': {
        const keys = String((rawArgs as { keys?: unknown }).keys ?? '').trim().slice(0, 60);
        if (!keys) return fail('missing_keys', 'hotkey requires keys, e.g. "ctrl+c" or "win".');
        callAction = 'hotkey';
        callArgs = withId({ keys });
        break;
      }
      case 'find_text': {
        const text = String((rawArgs as { text?: unknown }).text ?? '').trim().slice(0, MAX_FIND);
        if (!text) return fail('missing_text', 'find_text requires the on-screen text to find.');
        callAction = 'ground_text';
        callArgs = { text };
        break;
      }
      case 'active_window': {
        callAction = 'get_active_window';
        // list:true enumerates all top-level windows (title/pid/bounds)
        // for focus decisions; default returns just the foreground one.
        callArgs = (rawArgs as { list?: unknown }).list === true ? { list: true } : {};
        break;
      }
      case 'cursor': {
        callAction = 'get_cursor';
        callArgs = {};
        break;
      }
      case 'observe': {
        // Loop-only perception (the task tool calls this programmatically):
        // full observe payload including the screenshot base64. Deliberately
        // NOT in COMPUTER_SCHEMA — base64 pixels must never ride an LLM
        // function-response cycle.
        callAction = 'observe';
        callArgs = {};
        break;
      }
      case 'browser_go': {
        const url = String((rawArgs as { url?: unknown }).url ?? '').trim().slice(0, MAX_URL);
        if (!/^https?:\/\//i.test(url)) return fail('bad_url', 'browser_go requires an http(s) URL.');
        callAction = 'browser_navigate';
        callArgs = withId({ url });
        break;
      }
      case 'browser_click': {
        const text = String((rawArgs as { text?: unknown }).text ?? '').trim().slice(0, MAX_FIND);
        if (!text) return fail('missing_text', 'browser_click requires the visible text to click.');
        callAction = 'browser_click_text';
        callArgs = withId({ text });
        break;
      }
      case 'browser_type': {
        const text = String((rawArgs as { text?: unknown }).text ?? '').slice(0, MAX_TYPE);
        if (!text) return fail('missing_text', 'browser_type requires text.');
        const selector = String((rawArgs as { selector?: unknown }).selector ?? '').trim().slice(0, 200);
        callAction = 'browser_type';
        callArgs = withId(selector ? { text, selector } : { text });
        break;
      }
      case 'browser_read': {
        const url = String((rawArgs as { url?: unknown }).url ?? '').trim().slice(0, MAX_URL);
        if (!/^https?:\/\//i.test(url)) return fail('bad_url', 'browser_read requires an http(s) URL.');
        callAction = 'browser_open_read';
        callArgs = { url };
        break;
      }
      // DOM control via the Chrome extension (Phase 29): operates the
      // user's real tabs element-first (query → ref → click/type).
      case 'dom_query': {
        const selector = String((rawArgs as { selector?: unknown }).selector ?? '').trim().slice(0, 300);
        const text = String((rawArgs as { text?: unknown }).text ?? '').trim().slice(0, MAX_FIND);
        callAction = 'browser_dom_query';
        callArgs = withId({ ...(selector ? { selector } : {}), ...(text ? { text } : {}) });
        break;
      }
      case 'dom_click': {
        const ref = String((rawArgs as { ref?: unknown }).ref ?? '').trim().slice(0, 16);
        const text = String((rawArgs as { text?: unknown }).text ?? '').trim().slice(0, MAX_FIND);
        if (!ref && !text) return fail('missing_target', 'dom_click needs a ref from dom_query or visible text.');
        callAction = 'browser_dom_click';
        callArgs = withId({ ...(ref ? { ref } : { text }) });
        break;
      }
      case 'dom_type': {
        const keys = String((rawArgs as { keys?: unknown }).keys ?? (rawArgs as { text?: unknown }).text ?? '').slice(0, MAX_TYPE);
        if (!keys) return fail('missing_text', 'dom_type requires keys (or text) to type.');
        const ref = String((rawArgs as { ref?: unknown }).ref ?? '').trim().slice(0, 16);
        callAction = 'browser_dom_type';
        callArgs = withId({ keys, ...(ref ? { ref } : {}) });
        break;
      }
      case 'dom_read': {
        callAction = 'browser_dom_read';
        callArgs = withId({});
        break;
      }
      case 'notify': {
        callAction = 'notify';
        callArgs = {
          title: String((rawArgs as { title?: unknown }).title ?? 'Sofia').slice(0, 120),
          text: String((rawArgs as { text?: unknown }).text ?? '').slice(0, 500),
        };
        break;
      }
      default:
        return fail('invalid_action', `Unknown computer action "${action}".`);
    }

    const reply = await backend.call(callAction, callArgs);
    if (!reply.ok) {
      if (reply.error === 'not_connected' || reply.error === 'disconnected') {
        return fail(
          'not_connected',
          `Companion OFFLINE — you cannot touch the PC right now. Tell the user: ${PAIR_HINT}`,
        );
      }
      const detail = reply.detail || reply.error || 'The companion daemon rejected the action.';
      if (reply.error === 'confirmation_required') {
        // Surface the daemon-issued id for the UI/voice-confirm handler.
        // The model must ask out loud and wait — it cannot redeem this.
        return {
          success: false,
          error: 'confirmation_required',
          errorDetail:
            `${detail} Ask the user out loud for approval; the UI confirm handler redeems ` +
            `the issued confirmation_id${reply.confirmation_id ? ` (${reply.confirmation_id})` : ''} and retries.`,
          data: reply.confirmation_id ? { confirmation_id: reply.confirmation_id } : undefined,
        };
      }
      return fail(
        reply.error || 'companion_error',
        detail.includes('xdotool ENOENT')
          ? `${detail} — Linux needs X11 input tools: ask the user to run \`sudo apt install xdotool\` (Wayland sessions cannot be driven — switch to X11).`
          : detail,
      );
    }
    const result = reply.result && typeof reply.result === 'object' ? (reply.result as Record<string, unknown>) : {};
    return { success: true, data: { action, ...result } };
  },
};

export const COMPUTER_SCHEMA: GeminiFunctionDeclaration = {
  name: 'computer',
  description:
    'Drive the user\'s REAL computer: launch desktop apps, move/click/scroll the mouse, ' +
    'type keys, find on-screen text, read the active window, notify, and operate the ' +
    'user\'s REAL Chrome in the SAME tab. Prefer over system_control for anything on the user\'s PC.',
  parameters: {
    type: 'OBJECT',
    properties: {
      action: {
        type: 'STRING',
        enum: [
          'open_app',
          'open_url',
          'open_file',
          'click',
          'double_click',
          'right_click',
          'move_mouse',
          'scroll',
          'type_text',
          'hotkey',
          'find_text',
          'active_window',
          'cursor',
          'browser_go',
          'browser_click',
          'browser_type',
          'browser_read',
          'dom_query',
          'dom_click',
          'dom_type',
          'dom_read',
          'notify',
          'see',
        ] as unknown as string[],
        description: 'The computer action to perform.',
      },
      app: { type: 'STRING', description: 'App name for open_app, e.g. "windows media player", "notepad".' },
      url: { type: 'STRING', description: 'http(s) URL for open_url / browser_go / browser_read.' },
      path: { type: 'STRING', description: 'Local file path for open_file (sandboxed to user folders).' },
      x: { type: 'NUMBER', description: 'Screen pixel X for move_mouse / click variants.' },
      y: { type: 'NUMBER', description: 'Screen pixel Y for move_mouse / click variants.' },
      dy: { type: 'NUMBER', description: 'Scroll amount for scroll (positive = down).' },
      text: { type: 'STRING', description: 'Text for type_text / find_text / browser_click / browser_type / notify.' },
      ref: { type: 'STRING', description: 'Element ref from dom_query (e0, e1…) for dom_click / dom_type.' },
      keys: {
        type: 'STRING',
        description: 'Key combo for hotkey, e.g. "ctrl+c", "alt+tab", "win" (Start menu), "win+e", "win+r".',
      },
      selector: { type: 'STRING', description: 'Optional CSS selector for browser_type (default: first input).' },
      list: { type: 'BOOLEAN', description: 'For active_window: set true to enumerate all top-level windows (title/pid/bounds).' },
      title: { type: 'STRING', description: 'Notification title for notify.' },
      confirmation_id: {
        type: 'STRING',
        description:
          'One-time daemon-issued id for the approved retry. Only provide the exact id the ' +
          'UI/voice-confirm handler gave you after the user approved — never invent one.',
      },
    },
    required: ['action'],
  },
};
