/**
 * core/judge-memory.ts — Phase 11c: the judge learns forever.
 *
 * Persists the SofiaJudge's calibration (reliability buckets + adaptive
 * evidence weights) across restarts: localStorage always, companion
 * store when paired. Newest copy wins; a newer local copy is pushed up
 * on load. Everything is best-effort — learning must never break
 * judging, so every failure degrades to judging uncalibrated.
 */

import type { CalibratorSnapshot } from './decision-judge.ts';

export interface JudgePersisted {
  v: 1;
  updatedAt: number;
  calib: CalibratorSnapshot;
}

export type JudgeStoreCaller = (
  action: string,
  params?: Record<string, unknown>,
) => Promise<{ ok: boolean; result?: { value?: unknown; found?: boolean }; error?: string }>;

export interface JudgeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const JUDGE_KEY = 'sofia.judge.calibration.v1';

function defaultStorage(): JudgeStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

async function defaultCaller(
  action: string,
  params: Record<string, unknown> = {},
): Promise<{ ok: boolean; result?: { value?: unknown; found?: boolean }; error?: string }> {
  if (typeof window === 'undefined') return { ok: false, error: 'transport_unavailable' };
  try {
    const { companion } = await import('../lib/companion-client');
    return companion.send<{ value?: unknown; found?: boolean }>(action, params);
  } catch {
    return { ok: false, error: 'transport_unavailable' };
  }
}

function asPersisted(val: unknown): JudgePersisted | null {
  if (!val || typeof val !== 'object') return null;
  const r = val as Record<string, unknown>;
  if (r.v !== 1 || typeof r.updatedAt !== 'number' || !r.calib || typeof r.calib !== 'object') {
    return null;
  }
  return { v: 1, updatedAt: r.updatedAt, calib: r.calib as CalibratorSnapshot };
}

export class JudgeMemory {
  private caller: JudgeStoreCaller | null | undefined;
  private storage: JudgeStorage | null;

  constructor(opts: { caller?: JudgeStoreCaller | null; storage?: JudgeStorage | null } = {}) {
    this.caller = opts.caller;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  }

  private async getCaller(): Promise<JudgeStoreCaller | null> {
    if (this.caller === undefined) this.caller = defaultCaller;
    return this.caller;
  }

  private readLocal(): JudgePersisted | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(JUDGE_KEY);
      return raw ? asPersisted(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  /** Newest of companion/local wins; a newer local copy is pushed up. */
  async load(): Promise<CalibratorSnapshot | null> {
    const local = this.readLocal();
    let remote: JudgePersisted | null = null;
    let reachable = false;
    const caller = await this.getCaller();
    if (caller) {
      try {
        const reply = await caller('store_get', { key: JUDGE_KEY });
        reachable = true;
        if (reply.ok && reply.result?.found) remote = asPersisted(reply.result.value);
      } catch {
        reachable = false;
      }
    }
    const winner = remote && (!local || remote.updatedAt >= local.updatedAt) ? remote : local;
    if (winner === local && local && reachable && caller) {
      if (!remote || local.updatedAt > remote.updatedAt) {
        try {
          await caller('store_put', { key: JUDGE_KEY, value: local });
        } catch {
          // Sync-up is a courtesy, never a failure.
        }
      }
    }
    return winner ? winner.calib : null;
  }

  /** Stamp and write everywhere; reports each leg separately. */
  async save(calib: CalibratorSnapshot): Promise<{ local: boolean; remote: boolean }> {
    const doc: JudgePersisted = { v: 1, updatedAt: Date.now(), calib };
    let local = false;
    let remote = false;
    if (this.storage) {
      try {
        this.storage.setItem(JUDGE_KEY, JSON.stringify(doc));
        local = true;
      } catch {
        local = false;
      }
    }
    const caller = await this.getCaller();
    if (caller) {
      try {
        const reply = await caller('store_put', { key: JUDGE_KEY, value: doc });
        remote = reply.ok === true;
      } catch {
        remote = false;
      }
    }
    return { local, remote };
  }
}
