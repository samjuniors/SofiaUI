/**
 * electron/desktop-config.test.mjs — desktop presence without a display.
 * Pure config builders + the repo's standing rule: no require() calls inside
 * electron/*.cjs (repo eslint forbids them; the preload must stay loader-free).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './desktop-config.cjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('app URL prefers explicit dev URL, then served builds, then default', () => {
  assert.equal(config.resolveAppUrl({ ELECTRON_START_URL: 'http://127.0.0.1:9999/' }), 'http://127.0.0.1:9999');
  assert.equal(config.resolveAppUrl({ SOPHIA_APP_URL: 'http://127.0.0.1:8081' }), 'http://127.0.0.1:8081');
  assert.equal(
    config.resolveAppUrl({ ELECTRON_START_URL: 'http://a:1', SOPHIA_APP_URL: 'http://b:2' }),
    'http://a:1',
  );
  assert.equal(config.resolveAppUrl({}), config.DEFAULT_DEV_URL);
  assert.equal(config.resolveAppUrl(null), config.DEFAULT_DEV_URL);
});

test('app URL rejects non-http(s) values', () => {
  assert.equal(config.resolveAppUrl({ ELECTRON_START_URL: 'file:///etc/passwd' }), config.DEFAULT_DEV_URL);
  assert.equal(config.resolveAppUrl({ ELECTRON_START_URL: 'javascript:alert(1)' }), config.DEFAULT_DEV_URL);
  assert.equal(config.resolveAppUrl({ ELECTRON_START_URL: 'not a url' }), config.DEFAULT_DEV_URL);
});

test('orb param appends without breaking existing queries', () => {
  assert.equal(config.withOrbParam('http://127.0.0.1:8080'), 'http://127.0.0.1:8080?orb=1');
  assert.equal(config.withOrbParam('http://127.0.0.1:8080/?x=2'), 'http://127.0.0.1:8080/?x=2&orb=1');
  assert.ok(config.withOrbParam('').endsWith('?orb=1'));
});

test('main window is a full stage, shown only when ready', () => {
  const o = config.mainWindowOptions({ preloadPath: '/x/preload.cjs', iconPath: '/x/icon.png' });
  assert.equal(o.width, 1280);
  assert.equal(o.show, false);
  assert.equal(o.autoHideMenuBar, true);
  assert.equal(o.icon, '/x/icon.png');
  assert.equal(o.webPreferences.preload, '/x/preload.cjs');
  assert.equal(o.webPreferences.contextIsolation, true);
  assert.equal(o.webPreferences.nodeIntegration, false);
});

test('orb window stays compact, frameless and always on top', () => {
  const o = config.orbWindowOptions({ preloadPath: '/x/preload.cjs' });
  assert.ok(o.width <= 260 && o.height <= 120);
  assert.equal(o.frame, false);
  assert.equal(o.transparent, true);
  assert.equal(o.alwaysOnTop, true);
  assert.equal(o.skipTaskbar, true);
  assert.equal(o.resizable, false);
  assert.equal(o.show, false);
  assert.equal(o.webPreferences.contextIsolation, true);
});

test('ports parse strictly with fallback', () => {
  assert.equal(config.parsePort('7788', 1), 7788);
  assert.equal(config.parsePort(7788, 1), 7788);
  assert.equal(config.parsePort('abc', 1), 1);
  assert.equal(config.parsePort('0', 1), 1);
  assert.equal(config.parsePort('70000', 1), 1);
  assert.equal(config.parsePort('', 1), 1);
});

test('pairing prefers env, tolerates absence', () => {
  assert.deepEqual(
    config.pairingFromEnv({ SOPHIA_COMPANION_PORT: '7799', SOPHIA_COMPANION_TOKEN: 'secret-token-1' }),
    { port: 7799, token: 'secret-token-1' },
  );
  assert.deepEqual(config.pairingFromEnv({}), { port: 7788, token: null });
  // short tokens are not real secrets
  assert.equal(config.pairingFromEnv({ SOPHIA_COMPANION_TOKEN: 'abc' }).token, null);
  assert.equal(config.isValidToken('  secret-token-1  '), true);
  assert.equal(config.isValidToken('short'), false);
});

test('companion env block carries port, token and roots', () => {
  const env = config.buildCompanionEnv({
    port: 7788,
    token: 'secret-token-1',
    dataDir: '/tmp/sophia',
    filesRoots: '/tmp/a,/tmp/b',
  });
  assert.equal(env.SOPHIA_COMPANION_PORT, '7788');
  assert.equal(env.SOPHIA_COMPANION_TOKEN, 'secret-token-1');
  assert.equal(env.SOPHIA_DATA_DIR, '/tmp/sophia');
  assert.equal(env.SOPHIA_FILES_ROOTS, '/tmp/a,/tmp/b');
  const bare = config.buildCompanionEnv({});
  assert.equal(bare.SOPHIA_COMPANION_PORT, '7788');
  assert.ok(!('SOPHIA_COMPANION_TOKEN' in bare));
});

test('companion script resolves explicit → resources → dev checkout', () => {
  const exists = (p) => p === '/res/companion/server.mjs';
  assert.equal(
    config.resolveCompanionScript({ explicit: '/nope.mjs', resourcesDir: '/res', devRoot: '/dev' }, exists),
    '/res/companion/server.mjs',
  );
  assert.equal(
    config.resolveCompanionScript({ resourcesDir: '/res', devRoot: '/dev' }, () => true),
    '/res/companion/server.mjs',
  );
  assert.equal(
    config.resolveCompanionScript({ devRoot: '/dev' }, (p) => p === '/dev/companion/server.mjs'),
    '/dev/companion/server.mjs',
  );
  assert.equal(config.resolveCompanionScript({ devRoot: '/dev' }, () => false), null);
});

test('tray icon takes the first candidate that exists', () => {
  const exists = (p) => p === '/b.png';
  assert.equal(config.resolveTrayIcon(['/a.png', '/b.png'], exists), '/b.png');
  assert.equal(config.resolveTrayIcon(['/a.png'], () => false), null);
  assert.equal(config.resolveTrayIcon(null, () => true), null);
});

test('hotkeys normalise to canonical accelerators', () => {
  assert.equal(config.normaliseHotkey('CommandOrControl+Shift+S'), 'CommandOrControl+Shift+S');
  assert.equal(config.normaliseHotkey('ctrl+shift+s'), 'Control+Shift+S');
  assert.equal(config.normaliseHotkey('cmd+o'), 'Command+O');
  assert.equal(config.normaliseHotkey(config.DEFAULT_HOTKEY_MAIN), 'CommandOrControl+Shift+S');
  assert.equal(config.normaliseHotkey(config.DEFAULT_HOTKEY_ORB), 'CommandOrControl+Shift+O');
});

test('hotkeys reject anything that can never register', () => {
  assert.equal(config.normaliseHotkey(''), null);
  assert.equal(config.normaliseHotkey(null), null);
  assert.equal(config.normaliseHotkey('S'), null);
  assert.equal(config.normaliseHotkey('Shift+'), null);
  assert.equal(config.normaliseHotkey('Hyper+Shift+S'), null);
  assert.equal(config.normaliseHotkey('Shift+Shift+S'), null);
  assert.equal(config.normaliseHotkey('Ctrl+;'), null);
});

test('login-item settings are strict booleans', () => {
  assert.deepEqual(config.loginItemSettings({ openAtLogin: true }), { openAtLogin: true, openAsHidden: false });
  assert.deepEqual(config.loginItemSettings({ openAtLogin: 'yes' }), { openAtLogin: false, openAsHidden: false });
  assert.deepEqual(config.loginItemSettings({}), { openAtLogin: false, openAsHidden: false });
});

test('IPC channels are namespaced and unique', () => {
  const values = Object.values(config.CHANNELS);
  assert.ok(values.length >= 10);
  assert.ok(values.every((v) => v.startsWith('sophia:')));
  assert.equal(new Set(values).size, values.length);
  assert.ok(Object.isFrozen(config.CHANNELS));
});

test('no require() calls inside electron runtime files (repo eslint rule)', () => {
  for (const file of ['main.cjs', 'preload.cjs', 'desktop-config.cjs']) {
    const src = readFileSync(join(HERE, file), 'utf8');
    // Strip comments first — only real calls count.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    assert.ok(
      !/\brequire\s*\(/.test(code),
      `${file} must not call require() — use dynamic import() so the preload stays loader-free`,
    );
  }
});
