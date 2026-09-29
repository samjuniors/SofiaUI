/**
 * core/LatencyMeter.ts — voice-to-voice latency against the 800 ms budget.
 *
 * A turn starts when the user finishes speaking (or a transcript lands)
 * and completes at the first audio chunk of Sofia's reply. The meter
 * covers the measurable turns — modular cloud + local/airplane loops
 * (the Gemini Live bidi stream reports no turn boundaries).
 *
 * Injectable clock for tests; a `latencyMeter` singleton for the app.
 */

export const VOICE_LATENCY_BUDGET_MS = 800;
export const LATENCY_HISTORY_CAP = 20;

export interface LatencySample {
  at: number;
  route: string;
  /** Speech-end (or transcript) → brain answer ready. */
  brainMs: number;
  /** Brain ready → first audio out. */
  ttsMs: number;
  /** Speech-end → first audio. The number the budget judges. */
  voiceMs: number;
  withinBudget: boolean;
}

export interface LatencyStats {
  count: number;
  budgetMs: number;
  lastMs: number | null;
  avgMs: number | null;
  p50Ms: number | null;
  bestMs: number | null;
  worstMs: number | null;
  withinBudget: number;
}

export function latencyStatsFor(samples: LatencySample[]): LatencyStats {
  const ms = samples.map((s) => s.voiceMs).sort((a, b) => a - b);
  if (ms.length === 0) {
    return {
      count: 0,
      budgetMs: VOICE_LATENCY_BUDGET_MS,
      lastMs: null,
      avgMs: null,
      p50Ms: null,
      bestMs: null,
      worstMs: null,
      withinBudget: 0,
    };
  }
  const mid = Math.floor(ms.length / 2);
  const p50 = ms.length % 2 === 1 ? ms[mid] : Math.round((ms[mid - 1] + ms[mid]) / 2);
  return {
    count: ms.length,
    budgetMs: VOICE_LATENCY_BUDGET_MS,
    lastMs: samples[samples.length - 1].voiceMs,
    avgMs: Math.round(ms.reduce((a, b) => a + b, 0) / ms.length),
    p50Ms: p50,
    bestMs: ms[0],
    worstMs: ms[ms.length - 1],
    withinBudget: samples.filter((s) => s.withinBudget).length,
  };
}

export class LatencyMeter {
  private readonly now: () => number;
  private samples: LatencySample[] = [];
  private active: { route: string; t0: number; brainAt: number | null } | null = null;
  private listeners = new Set<() => void>();

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? Date.now;
  }

  // ─── Recording ────────────────────────────────────────────────────────

  /** A turn begins (user speech ended / transcript final). Restarts if one is live. */
  startTurn(route: string): void {
    this.active = { route: route || 'voice', t0: this.now(), brainAt: null };
  }

  setRoute(route: string): void {
    if (this.active && route) this.active.route = route;
  }

  /** The brain answered; the mouth takes it from here. */
  markBrain(): void {
    if (this.active) this.active.brainAt = this.now();
  }

  /** First audio is out — the turn completes into a sample. */
  markVoice(): void {
    const a = this.active;
    if (!a) return;
    this.active = null;
    const t = this.now();
    const brainMs = Math.max(0, (a.brainAt ?? t) - a.t0);
    const voiceMs = Math.max(0, t - a.t0);
    this.samples.push({
      at: t,
      route: a.route,
      brainMs,
      ttsMs: Math.max(0, voiceMs - brainMs),
      voiceMs,
      withinBudget: voiceMs <= VOICE_LATENCY_BUDGET_MS,
    });
    if (this.samples.length > LATENCY_HISTORY_CAP) {
      this.samples.splice(0, this.samples.length - LATENCY_HISTORY_CAP);
    }
    this.emit();
  }

  /** The turn died (interruption, error) — drop it, keep history. */
  cancel(): void {
    this.active = null;
  }

  get inFlight(): boolean {
    return this.active !== null;
  }

  // ─── Reading ──────────────────────────────────────────────────────────

  snapshot(): LatencySample[] {
    return this.samples.map((s) => ({ ...s }));
  }

  stats(): LatencyStats {
    return latencyStatsFor(this.samples);
  }

  reset(): void {
    this.samples = [];
    this.active = null;
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

/** The meter the voice pipeline writes and Diagnostics reads. */
export const latencyMeter = new LatencyMeter();
