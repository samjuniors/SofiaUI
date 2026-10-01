/**
 * core/task-mirror.ts — Phase 27: the mirror (reflection learning), client side.
 *
 * After every task the critic's verdict becomes a confidence self-score —
 * derived from OBSERVED run facts (verdict, failures, skips), never from a
 * brain call, so the score is deterministic and auditable. The score is
 * banked as one `mirror` episode line:
 *
 *   Mirror task #12 conf=0.62 ok=1 steps=4 tools=computer,files
 *
 * `ok` is 1/0/x (done/failed/cancelled); `tools` is the failed-tool trail,
 * omitted when clean. Parsing, pattern mining, and calibration live in
 * memory/mirror.mjs (node side, shared by the self-improvement loop and
 * the eval battery); this file cannot import it (client/server boundary),
 * so the canonical line above is pinned byte-for-byte in BOTH test suites.
 *
 * Cancelled tasks bank conf=0.50/ok=x and are EXCLUDED from calibration —
 * a user stop carries no ground truth about the agent's judgment.
 */

export type MirrorVerdict = 'clean' | 'recovered' | 'failed' | 'cancelled';
export type MirrorOutcome = 'done' | 'failed' | 'cancelled';

export interface MirrorScoreInput {
  verdict: MirrorVerdict;
  stepsTotal: number;
  failedCount: number;
  skipped: number;
}

export interface MirrorScore {
  confidence: number;
  basis: string[];
}

function round2(n: number): number {
  return Math.round(Math.min(0.95, Math.max(0.05, n)) * 100) / 100;
}

/**
 * Confidence self-score from observed run facts. Pure. Never 0 or 1 —
 * a finished task always leaves room for an unnoticed mistake, and a
 * failed one may still have done part of the job.
 */
export function selfScore(input: MirrorScoreInput): MirrorScore {
  const failed = Math.max(0, input.failedCount);
  const skipped = Math.max(0, input.skipped);
  const steps = Math.max(0, input.stepsTotal);
  switch (input.verdict) {
    case 'failed':
      return { confidence: 0.15, basis: [`task failed — ${failed} failed step(s)`] };
    case 'cancelled':
      return { confidence: 0.5, basis: ['cancelled by user — outcome unknown'] };
    case 'recovered':
      return {
        // It finished — confidence degrades per failure but never craters
        // like an outright failure.
        confidence: Math.max(0.35, round2(0.9 - 0.15 * failed - 0.03 * skipped)),
        basis: [`${failed} failure(s) recovered over ${steps} steps`],
      };
    case 'clean':
    default:
      return {
        confidence: skipped > 0 ? 0.85 : 0.9,
        basis: skipped > 0 ? [`all attempted steps clean, ${skipped} skipped`] : [`all ${steps} steps first-try`],
      };
  }
}

export interface MirrorLineInput {
  taskEpisode: number;
  confidence: number;
  outcome: MirrorOutcome;
  stepsTotal: number;
  failedTools: string[];
}

/** Format one banked mirror line. Pure — the parse side is memory/mirror.mjs. */
export function formatMirrorLine(input: MirrorLineInput): string {
  const ep = Number.isInteger(input.taskEpisode) ? input.taskEpisode : 0;
  const conf = round2(input.confidence).toFixed(2);
  const ok = input.outcome === 'done' ? '1' : input.outcome === 'failed' ? '0' : 'x';
  const steps = Math.max(0, input.stepsTotal);
  const tools = input.failedTools.filter((t) => /^[a-z][a-z0-9_]*$/.test(t));
  return `Mirror task #${ep} conf=${conf} ok=${ok} steps=${steps}${tools.length ? ` tools=${tools.join(',')}` : ''}`;
}

export interface MirrorEntry {
  taskEpisode: number;
  at: number;
  confidence: number;
  outcome: MirrorOutcome;
  stepsTotal: number;
  failedTools: string[];
  goal: string;
}

export interface MirrorStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const MIRROR_STORAGE_KEY = 'sophia:mirror:v1';
const MIRROR_CAP = 200;

function defaultStorage(): MirrorStorage | null {
  return typeof localStorage !== 'undefined' ? localStorage : null;
}

/** Local ring of recent entries (the daemon's `mirror` episodes are the durable record). */
export function createMirrorStore(storage: MirrorStorage | null = defaultStorage()) {
  let entries: MirrorEntry[] = [];
  try {
    const raw = storage?.getItem(MIRROR_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) entries = parsed.filter((e): e is MirrorEntry => typeof e?.taskEpisode === 'number');
  } catch {
    entries = [];
  }
  const save = (): void => {
    try {
      storage?.setItem(MIRROR_STORAGE_KEY, JSON.stringify(entries));
    } catch {
      /* private mode — session-only */
    }
  };
  return {
    record(entry: MirrorEntry): void {
      entries = [...entries, entry].slice(-MIRROR_CAP);
      save();
    },
    list(): MirrorEntry[] {
      return [...entries];
    },
    clear(): void {
      entries = [];
      save();
    },
  };
}

export type MirrorStore = ReturnType<typeof createMirrorStore>;

export const mirrorStore = createMirrorStore();
