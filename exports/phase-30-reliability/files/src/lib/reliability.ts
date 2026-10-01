/**
 * lib/reliability.ts — Phase 30: per-app reliability scores from the eval suite.
 *
 * `npm run eval:report` writes `public/eval-report.json` (gitignored,
 * machine-local): per-app pass rates aggregated by scripts/eval-apps.mjs.
 * This module fetches + validates that report for the Diagnostics card.
 * No report (fresh clone, never ran eval) → null → the card shows the
 * rerun hint instead of numbers. Numbers are never invented.
 */

export interface AppScore {
  app: string;
  pass: number;
  fail: number;
  skip: number;
  ran: number;
  /** 0–100, or null when nothing ran ("not run here", never 0%). */
  rate: number | null;
}

export interface ReliabilityReport {
  generatedAt: string;
  suite: string;
  platform: string;
  summary: { pass: number; failed: number; skip: number; ran: number; passRate: number };
  apps: AppScore[];
  failures: string[];
}

export const REPORT_URL = '/eval-report.json';

function validScore(v: unknown): v is AppScore {
  const o = v as AppScore | null;
  return (
    !!o &&
    typeof o.app === 'string' &&
    typeof o.pass === 'number' &&
    typeof o.fail === 'number' &&
    typeof o.skip === 'number' &&
    (o.rate === null || typeof o.rate === 'number')
  );
}

/** Parse + validate unknown JSON into a report, or null. Pure. */
export function parseReport(json: unknown): ReliabilityReport | null {
  try {
    const o = json as ReliabilityReport | null;
    if (!o || typeof o !== 'object') return null;
    if (typeof o.generatedAt !== 'string' || !Array.isArray(o.apps)) return null;
    if (!o.summary || typeof o.summary.passRate !== 'number') return null;
    const apps = o.apps.filter(validScore);
    if (apps.length !== o.apps.length) return null;
    return {
      generatedAt: o.generatedAt,
      suite: typeof o.suite === 'string' ? o.suite : 'unknown',
      platform: typeof o.platform === 'string' ? o.platform : 'unknown',
      summary: {
        pass: o.summary.pass ?? 0,
        failed: o.summary.failed ?? 0,
        skip: o.summary.skip ?? 0,
        ran: o.summary.ran ?? 0,
        passRate: o.summary.passRate,
      },
      apps,
      failures: Array.isArray(o.failures) ? o.failures.filter((f): f is string => typeof f === 'string') : [],
    };
  } catch {
    return null;
  }
}

/** Fetch the last eval report, or null when none exists yet. */
export async function fetchReport(url: string = REPORT_URL): Promise<ReliabilityReport | null> {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return parseReport(await r.json());
  } catch {
    return null;
  }
}

/** Human grade for a rate: emerald ≥95, amber ≥80, red below. */
export function gradeFor(rate: number | null): 'great' | 'ok' | 'bad' | 'none' {
  if (rate === null) return 'none';
  if (rate >= 95) return 'great';
  if (rate >= 80) return 'ok';
  return 'bad';
}
