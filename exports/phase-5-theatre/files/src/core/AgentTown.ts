/**
 * core/AgentTown.ts — Iris, Vera, Atlas & Forge's shared task board.
 *
 * A tiny autonomous standup that never sleeps: agents claim backlog tasks
 * (preferring their specialty), work them to done, and new chores drift in
 * over time. Deterministic under an injected clock + RNG, persisted to
 * localStorage, silent when the tab is hidden.
 */

export type AgentId = 'iris' | 'vera' | 'atlas' | 'forge';

export interface TownAgent {
  id: AgentId;
  name: string;
  role: string;
  color: string;
  specialties: string[];
  /** Progress per tick, before the specialty bonus. */
  pace: number;
}

export const TOWN_AGENTS: TownAgent[] = [
  { id: 'iris', name: 'Iris', role: 'Scout', color: '#7dd3fc', specialties: ['research', 'watch'], pace: 34 },
  { id: 'vera', name: 'Vera', role: 'Maker', color: '#f0abfc', specialties: ['build', 'craft'], pace: 30 },
  { id: 'atlas', name: 'Atlas', role: 'Keeper', color: '#fbbf24', specialties: ['organize', 'plan'], pace: 28 },
  { id: 'forge', name: 'Forge', role: 'Runner', color: '#6ee7b7', specialties: ['chore', 'fix'], pace: 38 },
];

export type TaskState = 'backlog' | 'doing' | 'done';

export interface TownTask {
  id: string;
  title: string;
  tag: string;
  effort: number;
  progress: number;
  state: TaskState;
  agent: AgentId | null;
  createdAt: number;
  doneAt?: number;
}

export interface TownLog {
  id: number;
  at: number;
  text: string;
}

export interface TownSnapshot {
  tasks: TownTask[];
  log: TownLog[];
  tick: number;
  paused: boolean;
}

export const TOWN_STORAGE_KEY = 'sophia:agent-town:v1';
export const TOWN_TICK_MS = 2000;
const LOG_CAP = 30;
const DONE_CAP = 12;

const TASK_IDEAS: Array<{ title: string; tag: string }> = [
  { title: 'Polish the orb shader', tag: 'craft' },
  { title: 'File yesterday’s memories', tag: 'organize' },
  { title: 'Scout the morning headlines', tag: 'research' },
  { title: 'Tune the wake-word ears', tag: 'fix' },
  { title: 'Sketch a new orb form', tag: 'build' },
  { title: 'Plan the evening briefing', tag: 'plan' },
  { title: 'Sweep the dust motes', tag: 'chore' },
  { title: 'Watch the PC health dials', tag: 'watch' },
  { title: 'Transcribe the voice backlog', tag: 'chore' },
  { title: 'Draft tomorrow’s standup', tag: 'plan' },
  { title: 'Research faster STT models', tag: 'research' },
  { title: 'Repair the intellicentre links', tag: 'fix' },
  { title: 'Carve a new catchphrase', tag: 'craft' },
  { title: 'Rehearse the good-morning scene', tag: 'build' },
];

export interface TownOptions {
  now?: () => number;
  random?: () => number;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  autoSeed?: boolean;
}

export function agentById(id: AgentId | null | undefined): TownAgent {
  return TOWN_AGENTS.find((a) => a.id === id) ?? TOWN_AGENTS[0];
}

export class AgentTown {
  private tasks: TownTask[] = [];
  private log: TownLog[] = [];
  private tickCount = 0;
  private nextTask = 1;
  private nextLog = 1;
  private ideaCursor = 0;
  private paused = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;

  constructor(opts: TownOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.storage = opts.storage === undefined ? null : opts.storage;
    if (opts.storage === undefined && typeof localStorage !== 'undefined') {
      this.storage = localStorage;
    }
    if (!this.restore() && opts.autoSeed !== false) this.seed();
  }

  // ─── Observation ──────────────────────────────────────────────────────

  snapshot(): TownSnapshot {
    return {
      tasks: this.tasks.map((t) => ({ ...t })),
      log: [...this.log],
      tick: this.tickCount,
      paused: this.paused,
    };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private emit() {
    this.persist();
    for (const fn of this.listeners) fn();
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────

  start() {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      this.tick();
    }, TOWN_TICK_MS);
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  pause() {
    this.paused = true;
    this.emit();
  }

  resume() {
    this.paused = false;
    this.emit();
  }

  reset() {
    this.tasks = [];
    this.log = [];
    this.tickCount = 0;
    this.nextTask = 1;
    this.nextLog = 1;
    this.ideaCursor = 0;
    this.paused = false;
    this.seed();
    this.emit();
  }

  // ─── Board ────────────────────────────────────────────────────────────

  addTask(title: string, tag = 'chore'): TownTask {
    const clean = title.trim().slice(0, 80);
    if (!clean) throw new Error('Give the task a title.');
    const task: TownTask = {
      id: `t${this.nextTask++}`,
      title: clean,
      tag: tag.trim().toLowerCase().slice(0, 16) || 'chore',
      effort: 100,
      progress: 0,
      state: 'backlog',
      agent: null,
      createdAt: this.now(),
    };
    this.tasks.push(task);
    this.emit();
    return { ...task };
  }

  /** Advance the simulation one step. Returns true if anything changed. */
  tick(): boolean {
    if (this.paused) return false;
    this.tickCount++;
    let changed = false;

    // 1. Working agents make progress.
    for (const task of this.tasks) {
      if (task.state !== 'doing' || !task.agent) continue;
      const agent = agentById(task.agent);
      const bonus = agent.specialties.includes(task.tag) ? 1.5 : 1;
      task.progress = Math.min(task.effort, task.progress + agent.pace * bonus);
      changed = true;
      if (task.progress >= task.effort) {
        task.state = 'done';
        task.doneAt = this.now();
        this.say(`${agent.name} finished “${task.title}”.`);
      }
    }
    // Trim old completions (keep newest).
    const done = this.tasks.filter((t) => t.state === 'done');
    if (done.length > DONE_CAP) {
      const drop = new Set(done.slice(0, done.length - DONE_CAP).map((t) => t.id));
      this.tasks = this.tasks.filter((t) => !drop.has(t.id));
    }

    // 2. Idle agents claim backlog work, specialty-first.
    const busy = new Set(this.tasks.filter((t) => t.state === 'doing' && t.agent).map((t) => t.agent as AgentId));
    for (const agent of TOWN_AGENTS) {
      if (busy.has(agent.id)) continue;
      const backlog = this.tasks.filter((t) => t.state === 'backlog');
      if (backlog.length === 0) break;
      const match =
        backlog.find((t) => agent.specialties.includes(t.tag)) ??
        backlog[Math.floor(this.random() * backlog.length)];
      match.state = 'doing';
      match.agent = agent.id;
      busy.add(agent.id);
      changed = true;
      this.say(`${agent.name} picked up “${match.title}”.`);
    }

    // 3. New chores drift in every few ticks.
    if (this.tickCount % 4 === 0) {
      const idea = this.nextIdea();
      if (idea) {
        this.tasks.push({
          id: `t${this.nextTask++}`,
          title: idea.title,
          tag: idea.tag,
          effort: 100,
          progress: 0,
          state: 'backlog',
          agent: null,
          createdAt: this.now(),
        });
        changed = true;
      }
    }

    if (changed) this.emit();
    return changed;
  }

  // ─── Internals ────────────────────────────────────────────────────────

  private say(text: string) {
    this.log.push({ id: this.nextLog++, at: this.now(), text });
    if (this.log.length > LOG_CAP) this.log.splice(0, this.log.length - LOG_CAP);
  }

  private nextIdea(): { title: string; tag: string } | null {
    for (let i = 0; i < TASK_IDEAS.length; i++) {
      const idea = TASK_IDEAS[(this.ideaCursor + i) % TASK_IDEAS.length];
      const live = this.tasks.some((t) => t.title === idea.title && t.state !== 'done');
      if (!live) {
        this.ideaCursor = (this.ideaCursor + i + 1) % TASK_IDEAS.length;
        return idea;
      }
    }
    return null;
  }

  private seed() {
    const at = this.now();
    const titles: Array<[string, string]> = [
      ['Scout the morning headlines', 'research'],
      ['File yesterday’s memories', 'organize'],
      ['Polish the orb shader', 'craft'],
      ['Sweep the dust motes', 'chore'],
      ['Tune the wake-word ears', 'fix'],
    ];
    for (const [title, tag] of titles) {
      this.tasks.push({
        id: `t${this.nextTask++}`,
        title,
        tag,
        effort: 100,
        progress: 0,
        state: 'backlog',
        agent: null,
        createdAt: at,
      });
    }
    this.say('The town bell rings — standup begins.');
  }

  private persist() {
    if (!this.storage) return;
    try {
      this.storage.setItem(
        TOWN_STORAGE_KEY,
        JSON.stringify({
          tasks: this.tasks,
          log: this.log,
          tick: this.tickCount,
          nextTask: this.nextTask,
          nextLog: this.nextLog,
          ideaCursor: this.ideaCursor,
        }),
      );
    } catch {
      /* storage unavailable — the town lives for today */
    }
  }

  private restore(): boolean {
    if (!this.storage) return false;
    try {
      const raw = this.storage.getItem(TOWN_STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw) as {
        tasks?: unknown;
        log?: unknown;
        tick?: unknown;
        nextTask?: unknown;
        nextLog?: unknown;
        ideaCursor?: unknown;
      };
      if (!Array.isArray(data.tasks) || !Array.isArray(data.log)) return false;
      const states = new Set(['backlog', 'doing', 'done']);
      const ids = new Set(TOWN_AGENTS.map((a) => a.id));
      this.tasks = (data.tasks as TownTask[]).filter(
        (t) => t && typeof t.title === 'string' && states.has(t.state),
      ).map((t) => ({
        id: String(t.id),
        title: t.title.slice(0, 80),
        tag: typeof t.tag === 'string' ? t.tag.slice(0, 16) : 'chore',
        effort: 100,
        progress: Math.min(100, Math.max(0, Number(t.progress) || 0)),
        state: t.state,
        agent: ids.has(t.agent as AgentId) ? (t.agent as AgentId) : null,
        createdAt: Number(t.createdAt) || 0,
        doneAt: typeof t.doneAt === 'number' ? t.doneAt : undefined,
      }));
      // A reloaded town never resumes mid-task confusion: doing → backlog.
      for (const t of this.tasks) {
        if (t.state === 'doing') {
          t.state = 'backlog';
          t.agent = null;
        }
      }
      this.log = (data.log as TownLog[]).filter((l) => l && typeof l.text === 'string').slice(-LOG_CAP);
      this.tickCount = Number(data.tick) || 0;
      this.nextTask = Number(data.nextTask) || this.tasks.length + 1;
      this.nextLog = Number(data.nextLog) || this.log.length + 1;
      this.ideaCursor = Number(data.ideaCursor) || 0;
      return true;
    } catch {
      return false;
    }
  }
}

/** The town the UI lives in. */
export const agentTown = new AgentTown();
