/**
 * core/task-analytics.ts — task outcomes, trends, regression alarm (Phase 36).
 *
 * Event-sourced: desktop tasks arrive via `task:report` on taskEvents,
 * orchestrated runs via recordGoalResult(). The store persists the last 500
 * records locally and computes the dashboard snapshot purely:
 * success rate, average steps, cost per task, memory assists, skills
 * learned/retired, weekly trend buckets, and a trailing-window alarm.
 */

export type TaskKind = 'desktop' | 'orchestrated';

export interface TaskRecord {
  id: string;
  kind: TaskKind;
  /** Goal, truncated to 200 chars at record time. */
  goal: string;
  ok: boolean;
  steps: number;
  costUsd: number;
  durationMs: number;
  ts: number;
  /** Desktop: recalled context was non-empty (orchestrated counts via curationApplied). */
  memoryHit: boolean;
  curationApplied: number;
}

export interface WeekBucket {
  week: string;
  total: number;
  done: number;
  rate: number | null;
  avgSteps: number | null;
  costUsd: number;
}

export interface AlarmState {
  raised: boolean;
  reason: string;
  currentRate: number | null;
  previousRate: number | null;
  samples: number;
}

export interface AnalyticsSnapshot {
  total: number;
  done: number;
  rate: number | null;
  avgSteps: number | null;
  costPerTask: number;
  totalCostUsd: number;
  memoryAssists: number;
  skillsLearned: number;
  skillsRetired: number;
  weeks: WeekBucket[];
  alarm: AlarmState;
}

export interface SkillInfo {
  /** Every skill id currently known. */
  ids: string[];
  /** Currently disabled ids (retired from duty, not deleted). */
  disabled: string[];
}

export const ANALYTICS_KEY = 'sophia:task-analytics:v1';
export const MAX_RECORDS = 500;
/** Alarm: trailing-7d vs prior-7d success rate. */
export const ALARM_MIN_SAMPLES = 5;
export const ALARM_DROP = 0.15;
const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO week key (UTC), e.g. 2026-W40. */
export function weekKey(ts: number): string {
  const d = new Date(ts);
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const year = thursday.getUTCFullYear();
  const jan4 = Date.UTC(year, 0, 4);
  const week = 1 + Math.round((thursday.getTime() - jan4) / (7 * DAY_MS));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function rateOf(done: number, total: number): number | null {
  return total > 0 ? done / total : null;
}

function avgOf(sum: number, n: number): number | null {
  return n > 0 ? sum / n : null;
}

export function computeAlarm(records: TaskRecord[], now: number): AlarmState {
  const cur = records.filter((r) => r.ts > now - 7 * DAY_MS && r.ts <= now);
  const prev = records.filter((r) => r.ts > now - 14 * DAY_MS && r.ts <= now - 7 * DAY_MS);
  const currentRate = rateOf(
    cur.filter((r) => r.ok).length,
    cur.length,
  );
  const previousRate = rateOf(
    prev.filter((r) => r.ok).length,
    prev.length,
  );
  if (cur.length < ALARM_MIN_SAMPLES || prev.length < ALARM_MIN_SAMPLES) {
    return {
      raised: false,
      reason: `needs ≥${ALARM_MIN_SAMPLES} tasks in each 7d window (now ${cur.length}/${prev.length})`,
      currentRate,
      previousRate,
      samples: cur.length + prev.length,
    };
  }
  const drop = (previousRate as number) - (currentRate as number);
  if (drop > ALARM_DROP) {
    return {
      raised: true,
      reason: `success rate fell ${Math.round(drop * 100)}pts week-over-week (${Math.round((previousRate as number) * 100)}% → ${Math.round((currentRate as number) * 100)}%)`,
      currentRate,
      previousRate,
      samples: cur.length + prev.length,
    };
  }
  return { raised: false, reason: 'within band', currentRate, previousRate, samples: cur.length + prev.length };
}

/** Pure snapshot over records + skill info. */
export function computeSnapshot(
  records: TaskRecord[],
  skills: SkillInfo,
  everSeen: string[],
  now: number,
): AnalyticsSnapshot {
  const total = records.length;
  const done = records.filter((r) => r.ok).length;
  const steps = records.reduce((a, r) => a + r.steps, 0);
  const totalCostUsd = records.reduce((a, r) => a + r.costUsd, 0);
  const memoryAssists =
    records.filter((r) => r.memoryHit).length + records.reduce((a, r) => a + r.curationApplied, 0);
  const byWeek = new Map<string, TaskRecord[]>();
  for (const r of records) {
    const k = weekKey(r.ts);
    const arr = byWeek.get(k) ?? [];
    arr.push(r);
    byWeek.set(k, arr);
  }
  const weeks: WeekBucket[] = [...byWeek.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 8)
    .map(([week, rs]) => ({
      week,
      total: rs.length,
      done: rs.filter((r) => r.ok).length,
      rate: rateOf(
        rs.filter((r) => r.ok).length,
        rs.length,
      ),
      avgSteps: avgOf(
        rs.reduce((a, r) => a + r.steps, 0),
        rs.length,
      ),
      costUsd: rs.reduce((a, r) => a + r.costUsd, 0),
    }))
    .sort((a, b) => (a.week < b.week ? -1 : 1));
  const known = new Set(skills.ids);
  return {
    total,
    done,
    rate: rateOf(done, total),
    avgSteps: avgOf(steps, total),
    costPerTask: total > 0 ? totalCostUsd / total : 0,
    totalCostUsd,
    memoryAssists,
    skillsLearned: everSeen.length,
    skillsRetired: skills.disabled.filter((id) => known.has(id)).length,
    weeks,
    alarm: computeAlarm(records, now),
  };
}

export interface AnalyticsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): AnalyticsStorage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* ignore */
  }
  return null;
}

function cleanRecord(r: unknown): TaskRecord | null {
  if (typeof r !== 'object' || r === null) return null;
  const o = r as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  if (o.kind !== 'desktop' && o.kind !== 'orchestrated') return null;
  if (typeof o.ts !== 'number' || !Number.isFinite(o.ts)) return null;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  return {
    id: o.id.slice(0, 120),
    kind: o.kind,
    goal: typeof o.goal === 'string' ? o.goal.slice(0, 200) : '',
    ok: o.ok === true,
    steps: Math.floor(num(o.steps)),
    costUsd: num(o.costUsd),
    durationMs: num(o.durationMs),
    ts: Math.floor(o.ts),
    memoryHit: o.memoryHit === true,
    curationApplied: Math.floor(num(o.curationApplied)),
  };
}

export class TaskAnalyticsStore extends EventTarget {
  private records: TaskRecord[] = [];
  private everSeen: string[] = [];
  private skills: SkillInfo = { ids: [], disabled: [] };
  private readonly storage: AnalyticsStorage | null;
  private readonly clock: () => number;

  constructor(storage: AnalyticsStorage | null = browserStorage(), clock: () => number = () => Date.now()) {
    super();
    this.storage = storage;
    this.clock = clock;
    try {
      const raw = storage?.getItem(ANALYTICS_KEY);
      if (raw) {
        const j = JSON.parse(raw) as { records?: unknown[]; everSeen?: unknown };
        this.records = (j.records ?? []).map(cleanRecord).filter((r): r is TaskRecord => !!r).slice(-MAX_RECORDS);
        if (Array.isArray(j.everSeen)) {
          this.everSeen = [...new Set(j.everSeen.filter((s): s is string => typeof s === 'string'))].slice(-500);
        }
      }
    } catch {
      /* corrupt cache — start clean */
    }
  }

  record(rec: Omit<TaskRecord, 'goal'> & { goal?: string }): TaskRecord {
    const full: TaskRecord = {
      ...rec,
      goal: (rec.goal ?? '').slice(0, 200),
      id: rec.id.slice(0, 120),
    };
    this.records.push(full);
    if (this.records.length > MAX_RECORDS) this.records.splice(0, this.records.length - MAX_RECORDS);
    this.persist();
    this.dispatchEvent(new CustomEvent('change'));
    return full;
  }

  /** Feed the current skill catalogue; learned = ever-seen ids. */
  noteSkills(skills: SkillInfo): void {
    this.skills = { ids: [...skills.ids], disabled: [...skills.disabled] };
    const seen = new Set(this.everSeen);
    for (const id of skills.ids) seen.add(id);
    this.everSeen = [...seen].slice(-500);
    this.persist();
    this.dispatchEvent(new CustomEvent('change'));
  }

  list(): TaskRecord[] {
    return [...this.records];
  }

  snapshot(): AnalyticsSnapshot {
    return computeSnapshot(this.records, this.skills, this.everSeen, this.clock());
  }

  clear(): void {
    this.records = [];
    this.everSeen = [];
    this.persist();
    this.dispatchEvent(new CustomEvent('change'));
  }

  private persist(): void {
    try {
      this.storage?.setItem(ANALYTICS_KEY, JSON.stringify({ records: this.records, everSeen: this.everSeen }));
    } catch {
      /* storage unavailable — in-memory only */
    }
  }
}

/** App-wide singleton (persists to localStorage in browsers). */
export const taskAnalytics = new TaskAnalyticsStore();
