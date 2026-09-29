/**
 * Desktop bridge types — `window.sophiaDesktop`, exposed by
 * `electron/preload.cjs` via contextBridge. Absent in plain browsers;
 * every call site must treat it as optional.
 */

export interface DesktopPairing {
  port: number;
  /** Null when main could not manage the daemon — pair manually. */
  token: string | null;
  managed: boolean;
}

export interface OrbCommand {
  action: 'mic' | 'show-chat' | 'show-main' | string;
  [key: string]: unknown;
}

export interface MainStateBroadcast {
  state: string;
  status: string;
}

export interface SophiaDesktopBridge {
  getPairing(): Promise<DesktopPairing>;
  showMain(): void;
  hideMain(): void;
  toggleMain(): void;
  showOrb(): void;
  hideOrb(): void;
  toggleOrb(): void;
  /** Orb window → main window relay. */
  sendOrbCommand(cmd: OrbCommand): void;
  /** Main window listens for orb commands; returns an unsubscribe fn. */
  onMainCommand(cb: (cmd: OrbCommand) => void): () => void;
  /** Main window publishes state for the orb. */
  sendMainState(state: MainStateBroadcast): void;
  /** Orb window listens for main state; returns an unsubscribe fn. */
  onMainState(cb: (s: MainStateBroadcast) => void): () => void;
  getLoginItem(): Promise<{ openAtLogin: boolean }>;
  setLoginItem(openAtLogin: boolean): Promise<{ openAtLogin: boolean }>;
}

declare global {
  interface Window {
    sophiaDesktop?: SophiaDesktopBridge;
  }
  interface WindowEventMap {
    /** Fired once the async preload bridge has landed. */
    'sophia:desktop-ready': Event;
  }
}

export {};
