/**
 * sophia/os/wake.ts — the "hey sofia" spotter lifecycle.
 * Extracted verbatim from SophiaOS (Phase 22 split). Owns the
 * WakeWordSpotter; the OS hosts it with prefs/status/state reads plus
 * the session entry it fires when the phrase lands.
 */

import { WakeWordSpotter } from '../voice/wake';
import { loadWakePrefs, saveWakePrefs, DEFAULT_WAKE_WORDS } from '../../core/WakeWordDetection';
import type { ActivationSource, SophiaStateName } from '../types';
import type { LogLine } from '../SophiaOS';
import type { OSStatus } from '../SophiaOS';
import type { Prefs } from './prefs';

export interface WakeHost {
  /** Stable identity (mutated in place) — safe to hold directly. */
  prefs: Prefs;
  getStatus: () => OSStatus;
  /** True when the mic is hard-denied (spotter would be pointless). */
  isMicDenied: () => boolean;
  stateIs: (...names: SophiaStateName[]) => boolean;
  pushLog: (level: LogLine['level'], text: string) => void;
  enterSession: (source: ActivationSource) => Promise<void>;
}

export class WakeArmer {
  private spotter: WakeWordSpotter | null = null;

  constructor(private readonly host: WakeHost) {}

  stop(): void {
    this.spotter?.stop();
  }

  suspend(): void {
    this.spotter?.suspend();
  }

  unblock(): void {
    this.spotter?.unblock();
  }

  maybeArm(): void {
    if (!this.host.prefs.wake) return;
    if (this.host.getStatus() === 'live' && !this.host.stateIs('ambient', 'idle', 'paused')) return;
    if (!this.spotter) {
      this.spotter = new WakeWordSpotter(() => {
        void this.host.enterSession('wake-word');
      });
    }
    this.spotter.unblock();
    this.spotter.start();
    this.host.pushLog('info', `wake-word spotter active (${this.getWords().map((w) => `"${w}"`).join(', ')})`);
  }

  /**
   * Watchdog hook (called on an interval from the app): if wake is wanted,
   * the mic isn't hard-denied, no session is live, and the spotter somehow
   * lost its recognizer (tab throttle, transient errors), re-arm it.
   */
  ensureArmed(): void {
    try {
      if (!this.host.prefs.wake || this.host.isMicDenied()) return;
      if (this.host.getStatus() === 'live' || !this.spotter || this.spotter.isArmed()) return;
      this.maybeArm();
    } catch {
      /* watchdog must never break the app */
    }
  }

  /** Phrases that wake her (configurable, persisted). */
  getWords(): string[] {
    const persisted = loadWakePrefs().wakeWords;
    return this.spotter?.getWakeWords() ?? (persisted?.length ? persisted : DEFAULT_WAKE_WORDS);
  }

  setWords(words: string[]): void {
    saveWakePrefs({ wakeWords: words, wakeWordEnabled: this.host.prefs.wake });
    this.spotter?.setWakeWords(words);
    this.host.pushLog('info', `wake phrases updated: ${words.length ? words.join(', ') : 'defaults'}`);
  }
}
