/**
 * memory/mirror.mjs — Phase 27: the mirror (reflection learning), node side.
 *
 * After every task the client banks one `mirror` episode line:
 *
 *   Mirror task #12 conf=0.62 ok=1 steps=4 tools=computer,files
 *
 * `ok` is 1 (done), 0 (failed), or x (cancelled — no ground truth, so it
 * is recorded but EXCLUDED from calibration). `tools` is the failed-tool
 * trail, omitted when the run was clean. The format is produced by
 * src/core/task-mirror.ts, which cannot import this file (client/server
 * boundary); the canonical line above is pinned byte-for-byte in BOTH
 * test suites so the contract can never drift silently.
 *
 * This module parses those lines, mines recurring error patterns from
 * joined reflection causes, and scores calibration (Brier + buckets).
 * Pure — no I/O, no node builtins — so the weekly self-improvement loop
 * and the eval battery share it. Error causes here are
 * machine-generated (`tool: detail` from the critic), never raw
 * screen/web text, so pattern mining cannot be prompt-injected.
 */

/** Canonical contract line — also pinned in src/core/task-mirror.test.ts. */
export const CANONICAL_LINE = 'Mirror task #12 conf=0.62 ok=1 steps=4 tools=computer,files';

const LINE_RE = /^Mirror task #(\d+) conf=(\d+(?:\.\d+)?) ok=([10x]) steps=(\d+)(?: tools=([A-Za-z0-9_,]*))?/;

/**
 * Parse one banked mirror line. Pure.
 * @returns {{taskEpisode:number,conf:number,ok:1|0|null,steps:number,tools:string[]}|null}
 */
export function parseMirrorLine(text) {
  const m = LINE_RE.exec(String(text ?? '').trim());
  if (!m) return null;
  return {
    taskEpisode: Number(m[1]),
    conf: Number(m[2]),
    ok: m[3] === 'x' ? null : Number(m[3]),
    steps: Number(m[4]),
    tools: m[5] ? m[5].split(',').filter(Boolean) : [],
  };
}

/** Cause taxonomy, first match wins. Pure data. */
export const CAUSE_KINDS = [
  ['timeout', /timed?\s?out|deadline exceeded/i],
  ['missing', /not found|no such|missing|absent|couldn'?t find|ENOENT/i],
  ['denied', /denied|refus|forbidden|not allowed|permission|EACCES|needs? confirmation|\bgated?\b/i],
  ['invalid', /invalid|malformed|\bparse\b|syntax|schema|unknown action|bad request/i],
  ['verify', /verif|mismatch|expect|assert/i],
  ['busy', /busy|locked|already (running|in progress)|in use/i],
];

/**
 * Classify one critic cause (`tool: detail`) into a pattern key. Pure.
 * @returns {{tool:string,kind:string,key:string}}
 */
export function classifyCause(cause) {
  const text = String(cause ?? '').trim();
  // Colon form (`tool: detail`, from failureCause/attribution) or the banked
  // critic form (`step N tool — detail`, em dash, from critiqueTask text).
  const m =
    /^([a-z][a-z0-9_]*):\s*([\s\S]*)$/.exec(text) ??
    /^step \d+ ([a-z][a-z0-9_]*)[\s\-–—:]+([\s\S]*)$/.exec(text);
  const tool = m ? m[1] : 'unknown';
  const detail = (m ? m[2] : text).trim();
  for (const [kind, re] of CAUSE_KINDS) {
    if (re.test(detail)) return { tool, kind, key: `${tool}:${kind}` };
  }
  const fallback =
    detail
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .slice(0, 5)
      .join('-') || 'error';
  return { tool, kind: fallback, key: `${tool}:${fallback}` };
}

/**
 * Mine recurring patterns from failed-task causes. Pure.
 * @param {{cause:string,goal:string}[]} items — cause required, goal for skill matching
 * @param {{minCount?:number}} opts
 * @returns ranked [{key,tool,kind,count,sampleCause,goals}] (count desc)
 */
export function extractPatterns(items, { minCount = 1 } = {}) {
  const byKey = new Map();
  for (const it of items ?? []) {
    const cause = String(it?.cause ?? '').trim();
    if (!cause) continue;
    const { tool, kind, key } = classifyCause(cause);
    let p = byKey.get(key);
    if (!p) {
      p = { key, tool, kind, count: 0, sampleCause: cause.slice(0, 200), goals: [] };
      byKey.set(key, p);
    }
    p.count++;
    const goal = String(it?.goal ?? '').trim();
    if (goal && p.goals.length < 3 && !p.goals.includes(goal.slice(0, 160))) p.goals.push(goal.slice(0, 160));
  }
  return [...byKey.values()].filter((p) => p.count >= minCount).sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1));
}

/**
 * Calibration over parsed mirror lines: Brier score, mean gap
 * (positive = overconfident), and 0.2-wide buckets. Cancelled lines
 * (ok null) are excluded — no ground truth. Pure.
 */
export function calibrate(entries) {
  const buckets = [0, 1, 2, 3, 4].map((i) => ({ lo: i * 0.2, hi: (i + 1) * 0.2, n: 0, pred: 0, actual: 0 }));
  let n = 0;
  let excluded = 0;
  let se = 0;
  let sp = 0;
  let sa = 0;
  for (const e of entries ?? []) {
    const conf = e && typeof e.conf === 'number' ? Math.min(1, Math.max(0, e.conf)) : NaN;
    if (!Number.isFinite(conf) || (e.ok !== 1 && e.ok !== 0)) {
      excluded++;
      continue;
    }
    n++;
    se += (conf - e.ok) ** 2;
    sp += conf;
    sa += e.ok;
    const b = buckets[Math.min(4, Math.floor(conf * 5))];
    b.n++;
    b.pred += conf;
    b.actual += e.ok;
  }
  for (const b of buckets) {
    b.pred = b.n ? Math.round((b.pred / b.n) * 1000) / 1000 : 0;
    b.actual = b.n ? Math.round((b.actual / b.n) * 1000) / 1000 : 0;
  }
  return {
    n,
    excluded,
    brier: n ? Math.round((se / n) * 1000) / 1000 : null,
    gap: n ? Math.round((sp / n - sa / n) * 1000) / 1000 : null,
    buckets,
  };
}

/** One-line calibration summary for `--report`. Pure. */
export function calibrationLine(cal) {
  if (!cal || !cal.n) return 'mirror: no scored tasks yet';
  const lean = cal.gap > 0.05 ? 'overconfident' : cal.gap < -0.05 ? 'underconfident' : 'calibrated';
  return (
    `mirror: ${cal.n} scored, ${cal.excluded} excluded (cancelled) — ` +
    `Brier ${cal.brier}, gap ${cal.gap >= 0 ? '+' : ''}${cal.gap} (${lean})`
  );
}
