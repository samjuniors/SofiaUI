/**
 * electron/preload.cjs — the contextBridge between Sofia's UI and the desktop
 * shell. Exposes a minimal, purpose-built `window.sophiaDesktop` API; the
 * page itself keeps running with no Node access (contextIsolation).
 *
 * Zero require calls (repo eslint rule + sandbox hygiene): the electron
 * module arrives via dynamic import(). That import resolves in milliseconds,
 * but it IS asynchronous — so the bridge appears shortly after page scripts
 * start. All renderer call sites therefore read it lazily (optional chaining
 * at event time, never at module scope), and a `sophia:desktop-ready` window
 * event fires the moment the API lands for anyone who wants to await it.
 */
'use strict';

function buildApi(ipcRenderer) {
  const on = (channel, cb) => {
    const listener = (_event, payload) => {
      try {
        cb(payload);
      } catch {
        /* renderer callback threw — never break the bridge */
      }
    };
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
  const sendState = (state) => {
    if (!state || typeof state !== 'object') return;
    ipcRenderer.send(
      'sophia:main-state',
      JSON.parse(JSON.stringify({ state: state.state, status: state.status })),
    );
  };
  const sendCommand = (cmd) => {
    if (!cmd || typeof cmd !== 'object') return;
    ipcRenderer.send('sophia:orb-command', JSON.parse(JSON.stringify(cmd)));
  };

  return {
    /** Companion pairing bundled by main (null token = pair manually). */
    getPairing: () => ipcRenderer.invoke('sophia:get-pairing'),
    showMain: () => ipcRenderer.send('sophia:show-main'),
    hideMain: () => ipcRenderer.send('sophia:hide-main'),
    toggleMain: () => ipcRenderer.send('sophia:toggle-main'),
    showOrb: () => ipcRenderer.send('sophia:show-orb'),
    hideOrb: () => ipcRenderer.send('sophia:hide-orb'),
    toggleOrb: () => ipcRenderer.send('sophia:toggle-orb'),
    /** Orb window → main window relay. */
    sendOrbCommand: sendCommand,
    /** Main window listens for orb commands here. */
    onMainCommand: (cb) => on('sophia:orb-command', cb),
    /** Main window publishes { state, status } for the orb here. */
    sendMainState: sendState,
    /** Orb window listens for main state here. */
    onMainState: (cb) => on('sophia:main-state', cb),
    getLoginItem: () => ipcRenderer.invoke('sophia:get-login-item'),
    setLoginItem: (openAtLogin) => ipcRenderer.invoke('sophia:set-login-item', openAtLogin === true),
  };
}

import('electron').then(
  (mod) => {
    const electron = mod && mod.default ? mod.default : mod;
    const { contextBridge, ipcRenderer } = electron;
    if (!contextBridge || !ipcRenderer) throw new Error('electron bridge primitives missing');
    contextBridge.exposeInMainWorld('sophiaDesktop', buildApi(ipcRenderer));
    window.dispatchEvent(new Event('sophia:desktop-ready'));
  },
  (err) => {
    console.error('[sophia-desktop] preload bridge failed:', err && err.message ? err.message : err);
  },
);
