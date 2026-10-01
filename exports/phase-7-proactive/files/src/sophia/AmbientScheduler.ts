/**
 * sophia/AmbientScheduler.ts — proactive routines (Phase 7).
 *
 * An EventTarget singleton that wakes on its own: interval rules (every N
 * ms) and daily rules (at HH:MM), silenced through quiet hours 22:30–07:45,
 * with delta-only alerts (a routine speaks only when its signature
 * changes). Built-ins: health-watch (enabled, every 4h) and
 * morning-briefing (disabled by default, 08:00).
 *
 * The scheduler never touches the network itself — hosts inject
 * `{healthCheck, briefing, alert}` (see `proactive-wiring.ts`), and tests
 * inject fakes with a stub clock + storage.
 */

export const TICK_MS = 30000;
export const PROACTIVE_STORAGE_KEY = 'sophia:proactive:v1';

/** Quiet hours: no routine runs (and no state advances) overnight. */
export const QUIET_START_MIN = 22 * 60 + 30; // 22:30
export const QUIET_END_MIN = 7 * 60 + 45; // 07:45

export const HEALTH_WATCH_ID = 'health-watch';
export const MORNING_BRIEFING_ID = 'morning-briefing';
export const HEALTH_SCORE_FLOOR = 70;

export function isQuietHours(date: Date = new Date()): boolean {
  const mins = date.getHours() * 60 + date.getMinutes();
  return mins >= QUIET_START_MIN || mins < QUIET_END_MIN;
}

export type ProactiveRule = { kind: 'daily'; timeOfDay: string } | { kind: 'interval'; everyMs: number };

export interface ProactiveRoutine {
  id: string;
  label: string;
  description: string;
  rule: ProactiveRule;
  enabled: boolean;
}

export type AlertLevel = 'info' | 'warning';

export interface HealthCheckResult {
  score: number;
  warnings: string[];
}

export interface ProactiveHandlers {
  healthCheck: () => Promise<HealthCheckResult>;
  /** Compose the morning briefing body. */
  briefing: () => Promise<string>;
  alert: (title: string, body: string, level: AlertLevel) => void;
}

interface RoutineState {
  enabled: boolean;
  lastRunAt: number | null;
  lastSignature?: string;
}

export interface RoutineStatus {
  routine: ProactiveRoutine;
  enabled: boolean;
  lastRunAt: number | null;
  lastSignature?: string;
  lastError: string | null;
  inFlight: boolean;
  nextRunAt: number | null;
}

export interface HealthNowResult extends HealthCheckResult {
  at: number;
  alerted: boolean;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const BUILTINS: ProactiveRoutine[] = [
  {
    id: MORNING_BRIEFING_ID,
    label: 'Morning briefing',
    description: 'A spoken-ready card each morning: the date, PC health, anything needing you.',
    rule: { kind: 'daily', timeOfDay: '08:00' },
    enabled: false,
  },
  {
    id: HEALTH_WATCH_ID,
    label: 'Health watch',
    description: 'Checks PC health every 4 hours; speaks up only when something changes.',
    rule: { kind: 'interval', everyMs: 4 * 3600_000 },
    enabled: true,
  },
];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function occurrenceToday(timeOfDay: string, now: Date): number | null {
  const m = TIME_RE.exec(timeOfDay);
  if (!m) return null;
  const d = new Date(now);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.getTime();
}

function noHandlers(): ProactiveHandlers {
  const missing = async (): Promise<never> => {
    throw new Error('proactive handlers not wired yet');
  };
  return { healthCheck: missing, briefing: missing, alert: () => undefined };
}

export interface AmbientSchedulerOptions {
  now?: () => number;
  storage?: StorageLike | null;
  handlers?: ProactiveHandlers;
  tickMs?: number;
}

export class AmbientScheduler extends EventTarget {
  private readonly now: () => number;
  private readonly storage: StorageLike | null;
  private readonly tickMs: number;
  private handlers: ProactiveHandlers;
  private states = new Map<string, RoutineState>();
  private errors = new Map<string, string>();
  private inflight = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: AmbientSchedulerOptions = {}) {
    super();
    this.now = opts.now ?? Date.now;
    this.tickMs = opts.tickMs ?? TICK_MS;
    this.handlers = opts.handlers ?? noHandlers();
    this.storage = opts.storage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : opts.storage;
    this.restore();
  }

  // ─── Configuration ────────────────────────────────────────────────────

  setHandlers(handlers: ProactiveHandlers): void {
    this.handlers = handlers;
  }

  list(): RoutineStatus[] {
    return BUILTINS.map((r) => this.statusOf(r));
  }

  status(id: string): RoutineStatus | null {
    const found = BUILTINS.find((r) => r.id === id);
    return found ? this.statusOf(found) : null;
  }

  enable(id: string): boolean {
    return this.setEnabled(id, true);
  }

  disable(id: string): boolean {
    return this.setEnabled(id, false);
  }

  private setEnabled(id: string, on: boolean): boolean {
    const state = this.states.get(id);
    if (!state) return false;
    state.enabled = on;
    this.persist();
    this.emit();
    return true;
  }

  /** Record a run (the scheduler calls this; tests re-arm intervals with it). */
  markRun(id: string, at?: number): void {
    const state = this.states.get(id);
    if (!state) return;
    state.lastRunAt = at ?? this.now();
    this.persist();
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.tick(), this.tickMs);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** One scheduling pass. Safe to call any time (boot, reconnect, tests). */
  async tick(): Promise<void> {
    if (isQuietHours(new Date(this.now()))) return;
    const runs: Array<Promise<void>> = [];
    for (const routine of BUILTINS) {
      const state = this.states.get(routine.id);
      if (!state?.enabled || this.inflight.has(routine.id)) continue;
      if (this.due(routine, state, this.now())) runs.push(this.run(routine.id, false));
    }
    await Promise.all(runs);
  }

  /** Run a routine right now, bypassing schedule and quiet hours (explicit user/tool ask). */
  async runNow(id: string): Promise<boolean> {
    const found = BUILTINS.find((r) => r.id === id);
    if (!found || this.inflight.has(id)) return false;
    await this.run(id, true);
    return true;
  }

  /** Immediate health check through the watch pipeline (delta alert included). */
  async healthNow(): Promise<HealthNowResult> {
    const found = BUILTINS.find((r) => r.id === HEALTH_WATCH_ID);
    if (!found) throw new Error('health-watch routine missing');
    const at = this.now();
    const result = await this.handlers.healthCheck();
    const state = this.states.get(HEALTH_WATCH_ID);
    const alerted = this.maybeAlertHealth(state, result);
    if (state) {
      state.lastRunAt = at;
      state.lastSignature = healthSignature(result);
      this.persist();
    }
    this.emit();
    return { ...result, at, alerted };
  }

  // ─── Internals ────────────────────────────────────────────────────────

  private statusOf(routine: ProactiveRoutine): RoutineStatus {
    const state = this.states.get(routine.id);
    return {
      routine,
      enabled: state?.enabled ?? routine.enabled,
      lastRunAt: state?.lastRunAt ?? null,
      lastSignature: state?.lastSignature,
      lastError: this.errors.get(routine.id) ?? null,
      inFlight: this.inflight.has(routine.id),
      nextRunAt: this.nextRun(routine, state, this.now()),
    };
  }

  private due(routine: ProactiveRoutine, state: RoutineState, nowMs: number): boolean {
    if (routine.rule.kind === 'interval') {
      if (state.lastRunAt === null) return true;
      return nowMs - state.lastRunAt >= routine.rule.everyMs;
    }
    const occ = occurrenceToday(routine.rule.timeOfDay, new Date(nowMs));
    if (occ === null) return false;
    if (nowMs < occ) return false;
    return state.lastRunAt === null || state.lastRunAt < occ;
  }

  private nextRun(routine: ProactiveRoutine, state: RoutineState | undefined, nowMs: number): number | null {
    if (!state?.enabled) return null;
    if (routine.rule.kind === 'interval') {
      if (state.lastRunAt === null) return nowMs;
      return state.lastRunAt + routine.rule.everyMs;
    }
    const occ = occurrenceToday(routine.rule.timeOfDay, new Date(nowMs));
    if (occ === null) return null;
    if (nowMs < occ && (state.lastRunAt === null || state.lastRunAt < occ)) return occ;
    if (state.lastRunAt !== null && state.lastRunAt >= occ) return occ + 86400_000;
    return nowMs;
  }

  private async run(id: string, force: boolean): Promise<void> {
    const routine = BUILTINS.find((r) => r.id === id);
    const state = this.states.get(id);
    if (!routine || !state) return;
    if (!force && (!state.enabled || isQuietHours(new Date(this.now())))) return;
    this.inflight.add(id);
    try {
      if (id === HEALTH_WATCH_ID) {
        const result = await this.handlers.healthCheck();
        this.maybeAlertHealth(state, result);
        state.lastSignature = healthSignature(result);
      } else if (id === MORNING_BRIEFING_ID) {
        const body = await this.handlers.briefing();
        this.handlers.alert('Morning briefing', body, 'info');
      }
      this.errors.delete(id);
    } catch (err) {
      this.errors.set(id, err instanceof Error ? err.message : String(err));
    } finally {
      // Advance even on failure: a dead companion backs off to the next
      // slot instead of retry-spamming every tick.
      state.lastRunAt = this.now();
      this.inflight.delete(id);
      this.persist();
      this.emit();
    }
  }

  /**
   * Delta-only health alert: speak when unhealthy AND the signature is new.
   * Returns whether an alert fired.
   */
  private maybeAlertHealth(state: RoutineState | undefined, result: HealthCheckResult): boolean {
    const unhealthy = result.score < HEALTH_SCORE_FLOOR || result.warnings.length > 0;
    const sig = healthSignature(result);
    if (!unhealthy || state?.lastSignature === sig) return false;
    const lines = [`Health score ${result.score}/100.`];
    for (const w of result.warnings.slice(0, 4)) lines.push(`• ${w}`);
    if (result.warnings.length > 4) lines.push(`• +${result.warnings.length - 4} more`);
    this.handlers.alert('Health watch', lines.join('\n'), 'warning');
    return true;
  }

  private emit(): void {
    this.dispatchEvent(new CustomEvent('change'));
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const routines: Record<string, RoutineState> = {};
      for (const [id, s] of this.states) routines[id] = { ...s };
      this.storage.setItem(PROACTIVE_STORAGE_KEY, JSON.stringify({ version: 1, routines }));
    } catch {
      /* storage unavailable — the routines live for today */
    }
  }

  private restore(): void {
    for (const b of BUILTINS) {
      this.states.set(b.id, { enabled: b.enabled, lastRunAt: null });
    }
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(PROACTIVE_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { routines?: Record<string, Partial<RoutineState>> };
      if (!data || typeof data.routines !== 'object') return;
      for (const b of BUILTINS) {
        const saved = data.routines[b.id];
        if (!saved) continue;
        this.states.set(b.id, {
          enabled: typeof saved.enabled === 'boolean' ? saved.enabled : b.enabled,
          lastRunAt: typeof saved.lastRunAt === 'number' ? saved.lastRunAt : null,
          lastSignature: typeof saved.lastSignature === 'string' ? saved.lastSignature : undefined,
        });
      }
    } catch {
      /* corrupt save — built-in defaults stand */
    }
  }
}

function healthSignature(result: HealthCheckResult): string {
  // Bucket, not raw score: a drift from 62→63 while unhealthy must not
  // re-alert. Recovery, relapse and warning-set changes all flip this.
  const bucket = result.score < HEALTH_SCORE_FLOOR ? 'low' : 'ok';
  return `${bucket}:${result.warnings.join(';')}`;
}

/** The scheduler the app wires, the tool drives and Settings displays. */
export const ambientScheduler = new AmbientScheduler();
