/**
 * electron/desktop-config.cjs — pure, testable desktop configuration.
 *
 * No electron import, no require calls (repo eslint forbids them, and the
 * preload must stay loader-free), no side effects. Every function is a pure
 * data transformation so `desktop-config.test.mjs` can prove it under plain
 * node without an Electron runtime or a display.
 *
 * `main.cjs` consumes these builders; it owns all side effects.
 */

'use strict';

/** Default Vite dev URL (the repo's dev contract is 0.0.0.0:8080). */
const DEFAULT_DEV_URL = 'http://127.0.0.1:8080';

/** Companion daemon port (matches `SOPHIA_COMPANION_PORT` default). */
const DEFAULT_COMPANION_PORT = 7788;

const DEFAULT_HOTKEY_MAIN = 'CommandOrControl+Shift+S';
const DEFAULT_HOTKEY_ORB = 'CommandOrControl+Shift+O';

/** IPC channel names — frozen so main, preload and tests share one source. */
const CHANNELS = Object.freeze({
  GET_PAIRING: 'sophia:get-pairing',
  SHOW_MAIN: 'sophia:show-main',
  HIDE_MAIN: 'sophia:hide-main',
  TOGGLE_MAIN: 'sophia:toggle-main',
  SHOW_ORB: 'sophia:show-orb',
  HIDE_ORB: 'sophia:hide-orb',
  TOGGLE_ORB: 'sophia:toggle-orb',
  /** Orb window → main window (mic, show-chat, …). */
  ORB_COMMAND: 'sophia:orb-command',
  /** Main window → orb window ({ state, status }). */
  MAIN_STATE: 'sophia:main-state',
  GET_LOGIN_ITEM: 'sophia:get-login-item',
  SET_LOGIN_ITEM: 'sophia:set-login-item',
});

function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Where the windows load the Sofia UI from.
 * `ELECTRON_START_URL` (dev launcher) → `SOPHIA_APP_URL` (served builds,
 * e.g. `npm run preview`) → the local Vite default. Anything non-http(s)
 * falls back to the default — never a blank window.
 */
function resolveAppUrl(env) {
  const e = env && typeof env === 'object' ? env : {};
  for (const key of ['ELECTRON_START_URL', 'SOPHIA_APP_URL']) {
    const v = typeof e[key] === 'string' ? e[key].trim() : '';
    if (v && isHttpUrl(v)) return v.replace(/\/+$/, '');
  }
  return DEFAULT_DEV_URL;
}

/** Append the compact-overlay flag for the orb window. */
function withOrbParam(appUrl) {
  const base = typeof appUrl === 'string' && appUrl ? appUrl : DEFAULT_DEV_URL;
  return base.includes('?') ? `${base}&orb=1` : `${base}?orb=1`;
}

/** Shared renderer hardening: isolated world, no Node in the page. */
function webPreferences(preloadPath) {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    // Explicitly off: the require-free preload (see preload.cjs) needs module
    // loading, which sandboxed preloads don't provide. The isolation boundary
    // (contextIsolation + no nodeIntegration + a minimal contextBridge) stays
    // intact; revisit if Electron ever ships ESM preload scripts.
    sandbox: false,
  };
}

function mainWindowOptions({ preloadPath, iconPath } = {}) {
  const opts = {
    title: 'Sofia',
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#04060f',
    webPreferences: webPreferences(preloadPath),
  };
  if (iconPath) opts.icon = iconPath;
  return opts;
}

/** Compact always-on-top companion orb: frameless, draggable, out of the way. */
function orbWindowOptions({ preloadPath, iconPath } = {}) {
  const opts = {
    title: 'Sofia Orb',
    width: 232,
    height: 96,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: webPreferences(preloadPath),
  };
  if (iconPath) opts.icon = iconPath;
  return opts;
}

function parsePort(value, fallback) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 65535) return n;
  return fallback;
}

function isValidToken(value) {
  return typeof value === 'string' && value.trim().length >= 8;
}

/**
 * Companion pairing from the environment. `token` is null unless explicitly
 * configured — main.cjs generates one when it manages the daemon itself.
 */
function pairingFromEnv(env) {
  const e = env && typeof env === 'object' ? env : {};
  const port = parsePort(e.SOPHIA_COMPANION_PORT, DEFAULT_COMPANION_PORT);
  const rawToken = typeof e.SOPHIA_COMPANION_TOKEN === 'string' ? e.SOPHIA_COMPANION_TOKEN.trim() : '';
  return { port, token: isValidToken(rawToken) ? rawToken : null };
}

/** Environment block for the daemon child process. */
function buildCompanionEnv({ port, token, dataDir, filesRoots, extra } = {}) {
  const env = {
    SOPHIA_COMPANION_PORT: String(parsePort(port, DEFAULT_COMPANION_PORT)),
  };
  if (isValidToken(token)) env.SOPHIA_COMPANION_TOKEN = token.trim();
  if (typeof dataDir === 'string' && dataDir.trim()) env.SOPHIA_DATA_DIR = dataDir.trim();
  if (typeof filesRoots === 'string' && filesRoots.trim()) env.SOPHIA_FILES_ROOTS = filesRoots.trim();
  if (extra && typeof extra === 'object') {
    for (const [k, v] of Object.entries(extra)) {
      if (typeof v === 'string') env[k] = v;
    }
  }
  return env;
}

/**
 * Locate the daemon script: explicit path → packaged resources →
 * development checkout. `exists` is injected (fs.existsSync) for tests.
 */
function resolveCompanionScript({ explicit, resourcesDir, devRoot } = {}, exists) {
  const has = typeof exists === 'function' ? exists : () => false;
  const join = (...parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');
  const candidates = [];
  if (typeof explicit === 'string' && explicit.trim()) candidates.push(explicit.trim());
  if (typeof resourcesDir === 'string' && resourcesDir) {
    candidates.push(join(resourcesDir, 'companion/server.mjs'));
  }
  if (typeof devRoot === 'string' && devRoot) {
    candidates.push(join(devRoot, 'companion/server.mjs'));
  }
  for (const c of candidates) {
    if (has(c)) return c;
  }
  return null;
}

/** First existing tray/window icon, or null (main degrades gracefully). */
function resolveTrayIcon(candidates, exists) {
  const has = typeof exists === 'function' ? exists : () => false;
  if (!Array.isArray(candidates)) return null;
  for (const c of candidates) {
    if (typeof c === 'string' && c && has(c)) return c;
  }
  return null;
}

const CANONICAL_MODIFIERS = new Map([
  ['commandorcontrol', 'CommandOrControl'],
  ['command', 'Command'],
  ['cmd', 'Command'],
  ['control', 'Control'],
  ['ctrl', 'Control'],
  ['option', 'Option'],
  ['alt', 'Alt'],
  ['altgr', 'AltGr'],
  ['shift', 'Shift'],
  ['super', 'Super'],
  ['meta', 'Meta'],
]);

const NAMED_KEYS = new Set([
  'plus', 'space', 'tab', 'capslock', 'numlock', 'scrolllock', 'backspace', 'delete',
  'insert', 'enter', 'return', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup',
  'pagedown', 'escape', 'esc', 'volumeup', 'volumedown', 'volumemute', 'medianexttrack',
  'mediaprevioustrack', 'mediastop', 'mediaplaypause', 'printscreen',
]);

function isKeySegment(seg) {
  if (/^[a-z0-9]$/i.test(seg)) return true;
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(seg)) return true;
  return NAMED_KEYS.has(seg.toLowerCase());
}

/**
 * Validate + normalise an Electron accelerator (`CommandOrControl+Shift+S`).
 * Returns the canonical form, or null when it can never register.
 */
function normaliseHotkey(raw) {
  if (typeof raw !== 'string') return null;
  const parts = raw.split('+').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const key = parts[parts.length - 1];
  if (!isKeySegment(key)) return null;
  const mods = [];
  for (const m of parts.slice(0, -1)) {
    const canon = CANONICAL_MODIFIERS.get(m.toLowerCase());
    if (!canon || mods.includes(canon)) return null;
    mods.push(canon);
  }
  const canonKey = key.length === 1 ? key.toUpperCase() : key;
  return [...mods, canonKey].join('+');
}

/** Settings object for `app.setLoginItemSettings`. */
function loginItemSettings({ openAtLogin, openAsHidden } = {}) {
  return {
    openAtLogin: openAtLogin === true,
    openAsHidden: openAsHidden === true,
  };
}

module.exports = {
  CHANNELS,
  DEFAULT_DEV_URL,
  DEFAULT_COMPANION_PORT,
  DEFAULT_HOTKEY_MAIN,
  DEFAULT_HOTKEY_ORB,
  isHttpUrl,
  resolveAppUrl,
  withOrbParam,
  webPreferences,
  mainWindowOptions,
  orbWindowOptions,
  parsePort,
  isValidToken,
  pairingFromEnv,
  buildCompanionEnv,
  resolveCompanionScript,
  resolveTrayIcon,
  normaliseHotkey,
  loginItemSettings,
};
