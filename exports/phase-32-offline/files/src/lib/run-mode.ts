/**
 * lib/run-mode.ts — global Cloud/Auto/Offline switch (Phase 32).
 *
 * Pure store with zero imports: the single source of truth for whether Sofia
 * may reach the cloud. `airplane-mode` and the dashboard toggle both delegate
 * here so every surface agrees.
 *
 * - cloud:   always use cloud services (fail loudly when unreachable).
 * - offline: never touch the cloud; local models/endpoints only.
 * - auto:    cloud first, but trip to offline after repeated cloud failures
 *            and recover after a streak of cloud successes.
 */

/** How Sofia is allowed to reach the network right now. */
export type RunMode = 'auto' | 'cloud' | 'offline';

/** Consecutive cloud failures before Auto trips the whole app offline. */
export const CLOUD_FAILURE_TRIP = 2;
/** Consecutive cloud successes before a tripped Auto run-mode recovers. */
export const CLOUD_RECOVERY_SUCCESSES = 3;
/** localStorage key for the persisted choice (mode only; the trip is session-scoped). */
export const RUN_MODE_KEY = 'sophia:runmode:v1';

export interface RunModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function memoryStorage(): RunModeStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

function browserStorage(): RunModeStorage {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* Private mode / SSR: fall through to memory. */
  }
  return memoryStorage();
}

function isRunMode(v: unknown): v is RunMode {
  return v === 'auto' || v === 'cloud' || v === 'offline';
}

export class RunModeStore {
  private mode: RunMode = 'auto';
  private failures = 0;
  private recoveries = 0;
  private tripped = false;
  private readonly listeners = new Set<() => void>();

  private readonly storage: RunModeStorage;

  constructor(storage: RunModeStorage = browserStorage()) {
    this.storage = storage;
    const saved = storage.getItem(RUN_MODE_KEY);
    if (isRunMode(saved)) this.mode = saved;
  }

  getMode(): RunMode {
    return this.mode;
  }

  /** True when Auto has tripped the session offline (cleared by setMode or recovery). */
  get autoTripped(): boolean {
    return this.mode === 'auto' && this.tripped;
  }

  /** True when the whole app must stay off the cloud right now. */
  get offline(): boolean {
    return this.mode === 'offline' || this.autoTripped;
  }

  /** Readability alias for call sites guarding cloud calls. */
  get cloudAllowed(): boolean {
    return !this.offline;
  }

  setMode(next: RunMode): void {
    this.mode = next;
    this.failures = 0;
    this.recoveries = 0;
    this.tripped = false;
    try {
      this.storage.setItem(RUN_MODE_KEY, next);
    } catch {
      /* Storage unavailable: the in-memory choice still holds for the session. */
    }
    this.emit();
  }

  /** Record a cloud failure. In Auto, the 2nd consecutive failure trips offline. */
  reportCloudFailure(): void {
    if (this.mode !== 'auto' || this.tripped) return;
    this.failures += 1;
    this.recoveries = 0;
    if (this.failures >= CLOUD_FAILURE_TRIP) {
      this.tripped = true;
      this.emit();
    }
  }

  /** Record a cloud success. A streak of these recovers a tripped Auto session. */
  reportCloudSuccess(): void {
    this.failures = 0;
    if (this.mode === 'auto' && this.tripped) {
      this.recoveries += 1;
      if (this.recoveries >= CLOUD_RECOVERY_SUCCESSES) {
        this.tripped = false;
        this.recoveries = 0;
        this.emit();
      }
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    for (const fn of [...this.listeners]) {
      try {
        fn();
      } catch {
        /* A broken listener must never break the switch. */
      }
    }
  }
}

/** App-wide singleton (persists to localStorage in browsers). */
export const runMode = new RunModeStore();
