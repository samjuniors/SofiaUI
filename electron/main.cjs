/**
 * electron/main.cjs — Sofia desktop presence.
 *
 * Tray icon + menu, global hotkeys, start-at-login, a full main window, a
 * compact always-on-top orb window, and a managed companion daemon whose
 * token is bundled straight into the renderer (no manual pairing code).
 *
 * NOTE: zero require calls in this file. The repo eslint config forbids
 * them and the preload must stay loader-free, so Electron and node builtins
 * arrive via dynamic import(). Run with `npm run electron:dev`
 * (Vite first) or `npm run electron:start` (ELECTRON_START_URL or the
 * default dev URL).
 */
'use strict';

/** CJS/ESM interop: prefer the default export when one exists. */
function preferDefault(mod) {
  return mod && mod.default ? mod.default : mod;
}

async function boot() {
  let electron;
  try {
    electron = preferDefault(await import('electron'));
  } catch {
    console.error('[sophia-desktop] electron is not installed.');
    console.error('[sophia-desktop] Run `npm i -D electron`, start `npm run dev`, then `npm run electron:dev`.');
    process.exitCode = 1;
    return;
  }

  const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, clipboard } = electron;
  const config = preferDefault(await import('./desktop-config.cjs'));
  const path = preferDefault(await import('node:path'));
  const fs = preferDefault(await import('node:fs'));
  const { spawn } = preferDefault(await import('node:child_process'));
  const { randomBytes } = preferDefault(await import('node:crypto'));
  const net = preferDefault(await import('node:net'));

  const C = config.CHANNELS;
  const appUrl = config.resolveAppUrl(process.env);
  const orbUrl = config.withOrbParam(appUrl);
  const preloadPath = path.join(__dirname, 'preload.cjs');
  const iconPath = config.resolveTrayIcon(
    [
      process.env.SOPHIA_TRAY_ICON,
      path.join(__dirname, 'tray.png'),
      path.join(app.getAppPath(), 'public', 'favicon.svg'),
    ],
    (p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    },
  );

  let mainWindow = null;
  let orbWindow = null;
  let tray = null;
  let quitting = false;

  // ── Companion daemon (managed child, bundled token) ──────────────────────

  const daemon = {
    child: null,
    port: config.DEFAULT_COMPANION_PORT,
    token: null,
    managed: false,
    restarts: 0,
  };

  /** True when something already answers on the companion port. */
  function portBusy(port) {
    return new Promise((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(true));
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(false)));
    });
  }

  function pairingSnapshot() {
    return { port: daemon.port, token: daemon.token, managed: daemon.managed };
  }

  async function startCompanion() {
    const fromEnv = config.pairingFromEnv(process.env);
    daemon.port = fromEnv.port;
    if (fromEnv.token) daemon.token = fromEnv.token;

    if (await portBusy(daemon.port)) {
      // Someone (probably the user's own `node companion/server.mjs`) already
      // owns the port: defer to it instead of spawning a second daemon.
      console.log(`[sophia-desktop] companion port ${daemon.port} is busy — deferring to the running daemon.`);
      daemon.managed = false;
      return;
    }

    const script = config.resolveCompanionScript(
      {
        explicit: process.env.SOPHIA_COMPANION_SCRIPT,
        resourcesDir: app.isPackaged ? process.resourcesPath : '',
        devRoot: app.isPackaged ? '' : app.getAppPath(),
      },
      (p) => {
        try {
          return fs.existsSync(p);
        } catch {
          return false;
        }
      },
    );
    if (!script) {
      console.warn('[sophia-desktop] companion script not found — renderer falls back to manual pairing.');
      daemon.managed = false;
      return;
    }

    if (!daemon.token) daemon.token = randomBytes(12).toString('base64url');
    const nodeBin = process.env.SOPHIA_NODE_PATH || 'node';
    const childEnv = {
      ...process.env,
      ...config.buildCompanionEnv({
        port: daemon.port,
        token: daemon.token,
        dataDir: process.env.SOPHIA_DATA_DIR,
        filesRoots: process.env.SOPHIA_FILES_ROOTS,
      }),
    };
    let child;
    try {
      child = spawn(nodeBin, [script], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      console.warn(`[sophia-desktop] could not spawn companion (${err.message}) — manual pairing fallback.`);
      daemon.managed = false;
      return;
    }
    child.on('error', (err) => {
      console.warn(`[sophia-desktop] companion process error (${err.message}) — manual pairing fallback.`);
      daemon.managed = false;
      daemon.child = null;
    });
    child.stdout.on('data', (d) => process.stdout.write(`[companion] ${d}`));
    child.stderr.on('data', (d) => process.stderr.write(`[companion] ${d}`));
    child.on('exit', (code) => {
      daemon.child = null;
      if (quitting) return;
      daemon.restarts += 1;
      if (daemon.restarts <= 2) {
        console.warn(`[sophia-desktop] companion exited (${code}) — restarting (${daemon.restarts}/2)…`);
        setTimeout(() => void startCompanion(), 1000);
      } else {
        console.warn('[sophia-desktop] companion keeps exiting — manual pairing fallback.');
        daemon.managed = false;
      }
    });
    daemon.child = child;
    daemon.managed = true;
    console.log(`[sophia-desktop] managed companion on 127.0.0.1:${daemon.port} (token bundled, not printed)`);
  }

  function stopCompanion() {
    if (daemon.child) {
      try {
        daemon.child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      daemon.child = null;
    }
    daemon.managed = false;
  }

  // ── Windows ──────────────────────────────────────────────────────────────

  function createMainWindow() {
    mainWindow = new BrowserWindow(config.mainWindowOptions({ preloadPath, iconPath }));
    mainWindow.once('ready-to-show', () => {
      if (!quitting) mainWindow.show();
    });
    mainWindow.on('close', (e) => {
      if (!quitting) {
        e.preventDefault();
        mainWindow.hide();
      }
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
    void mainWindow.loadURL(appUrl);
  }

  function createOrbWindow() {
    orbWindow = new BrowserWindow(config.orbWindowOptions({ preloadPath, iconPath }));
    orbWindow.on('close', (e) => {
      if (!quitting) {
        e.preventDefault();
        orbWindow.hide();
      }
    });
    orbWindow.on('closed', () => {
      orbWindow = null;
    });
    void orbWindow.loadURL(orbUrl);
  }

  function toggleWindow(win, create) {
    if (!win || win.isDestroyed()) {
      create();
      return;
    }
    if (win.isVisible()) win.hide();
    else {
      win.show();
      win.focus();
    }
  }

  // ── Tray ─────────────────────────────────────────────────────────────────

  function buildTrayMenu() {
    const login = app.getLoginItemSettings();
    return Menu.buildFromTemplate([
      { label: 'Show Sofia', click: () => toggleWindow(mainWindow, createMainWindow) },
      { label: 'Pop out orb', click: () => toggleWindow(orbWindow, createOrbWindow) },
      { type: 'separator' },
      {
        label: 'Start at login',
        type: 'checkbox',
        checked: login.openAtLogin === true,
        click: (item) => {
          app.setLoginItemSettings(config.loginItemSettings({ openAtLogin: item.checked }));
        },
      },
      {
        label: 'Copy pairing code',
        enabled: Boolean(daemon.token),
        click: () => {
          if (daemon.token) clipboard.writeText(daemon.token);
        },
      },
      { type: 'separator' },
      {
        label: 'Quit Sofia',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]);
  }

  function createTray() {
    if (!iconPath) {
      console.warn('[sophia-desktop] no tray icon found — running without a tray. See electron/README.md.');
      return;
    }
    try {
      const image = nativeImage.createFromPath(iconPath);
      tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
    } catch (err) {
      console.warn(`[sophia-desktop] tray unavailable (${err.message}).`);
      return;
    }
    tray.setToolTip('Sofia');
    tray.setContextMenu(buildTrayMenu());
    tray.on('click', () => toggleWindow(mainWindow, createMainWindow));
  }

  // ── Global hotkeys ───────────────────────────────────────────────────────

  function registerHotkeys() {
    const pairs = [
      [process.env.SOPHIA_HOTKEY_MAIN || config.DEFAULT_HOTKEY_MAIN, () => toggleWindow(mainWindow, createMainWindow), 'main'],
      [process.env.SOPHIA_HOTKEY_ORB || config.DEFAULT_HOTKEY_ORB, () => toggleWindow(orbWindow, createOrbWindow), 'orb'],
    ];
    for (const [raw, fn, label] of pairs) {
      const accelerator = config.normaliseHotkey(raw);
      if (!accelerator) {
        console.warn(`[sophia-desktop] ignoring invalid hotkey for ${label}: ${raw}`);
        continue;
      }
      try {
        if (!globalShortcut.register(accelerator, fn)) {
          console.warn(`[sophia-desktop] hotkey ${accelerator} is taken by another app.`);
        } else {
          console.log(`[sophia-desktop] hotkey ${accelerator} → toggle ${label}`);
        }
      } catch (err) {
        console.warn(`[sophia-desktop] hotkey ${accelerator} failed (${err.message}).`);
      }
    }
  }

  // ── IPC: renderer bridge ─────────────────────────────────────────────────

  function forwardTo(target, channel, payload) {
    try {
      if (target && !target.isDestroyed()) target.webContents.send(channel, payload);
    } catch {
      /* window went away mid-relay */
    }
  }

  ipcMain.handle(C.GET_PAIRING, () => pairingSnapshot());
  ipcMain.on(C.SHOW_MAIN, () => {
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
    else mainWindow.show();
  });
  ipcMain.on(C.HIDE_MAIN, () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  });
  ipcMain.on(C.TOGGLE_MAIN, () => toggleWindow(mainWindow, createMainWindow));
  ipcMain.on(C.SHOW_ORB, () => {
    if (!orbWindow || orbWindow.isDestroyed()) createOrbWindow();
    else orbWindow.show();
  });
  ipcMain.on(C.HIDE_ORB, () => {
    if (orbWindow && !orbWindow.isDestroyed()) orbWindow.hide();
  });
  ipcMain.on(C.TOGGLE_ORB, () => toggleWindow(orbWindow, createOrbWindow));
  ipcMain.on(C.ORB_COMMAND, (_event, cmd) => forwardTo(mainWindow, C.ORB_COMMAND, cmd));
  ipcMain.on(C.MAIN_STATE, (_event, state) => forwardTo(orbWindow, C.MAIN_STATE, state));
  ipcMain.handle(C.GET_LOGIN_ITEM, () => ({
    openAtLogin: app.getLoginItemSettings().openAtLogin === true,
  }));
  ipcMain.handle(C.SET_LOGIN_ITEM, (_event, openAtLogin) => {
    app.setLoginItemSettings(config.loginItemSettings({ openAtLogin }));
    if (tray) tray.setContextMenu(buildTrayMenu());
    return { openAtLogin: app.getLoginItemSettings().openAtLogin === true };
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
    else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('window-all-closed', () => {
    // Tray app: windows hide, the app persists. Quit from the tray menu.
  });

  app.on('before-quit', () => {
    quitting = true;
    try {
      globalShortcut.unregisterAll();
    } catch {
      /* noop */
    }
    stopCompanion();
  });

  await app.whenReady();
  await startCompanion();
  createMainWindow();
  createOrbWindow();
  createTray();
  registerHotkeys();
  console.log(`[sophia-desktop] Sofia is live → ${appUrl}`);
}

void boot().catch((err) => {
  console.error('[sophia-desktop] fatal:', err && err.message ? err.message : err);
  process.exitCode = 1;
});
