/**
 * core/decision-judge.ts — Phase 11b: Sofia Decision Core (our own Jev).
 *
 * What Jev does, rebuilt as our own method — no API, no model calls, no
 * cost, offline-friendly: typed questions over state in, schema-valid
 * judgments with calibrated confidence out.
 *
 * The method, in one paragraph: every judgment fuses small deterministic
 * EVIDENCE functions over structured state with a log-odds (logit) pool —
 * the same principled fusion behind naive Bayes and logistic regression —
 * then a bucket calibrator bends raw probabilities toward OBSERVED outcome
 * frequencies, exactly the property Jev trains for and the one that lets
 * code branch on confidence instead of vibes. Because outputs are computed
 * numbers over fixed schemas, hallucination is impossible by construction,
 * every judgment is explainable (each evidence carries a `why`), and each
 * call costs microseconds.
 *
 * Three production questions ship with evidence packs (the TaskLoop's
 * needs: plan safety scoring, step verification, recovery choice). Only
 * the plan gate is calibrated — it has clean ground truth (the task
 * later succeeded or failed). Verification has no independent ground
 * truth, so calibrating it would only reinforce the heuristic; recovery
 * outcomes are confounded by later steps. That restraint is deliberate.
 */

export interface SystemOneJudge {
  choice(state: string, id: string, options: string[]): Promise<{ choice: string; confidence: number }>;
  score(
    state: string,
    id: string,
    levels: string[],
  ): Promise<{ score: number; confidence: number; ticket?: CalibrationTicket }>;
  noul(state: string, id: string, statement: string): Promise<{ noul: number }>;
  report?(ticket: CalibrationTicket, outcome: 0 | 1): void;
}

// ─── Evidence fusion ────────────────────────────────────────────────────

export interface Evidence {
  /** Importance of this evidence (0 = ignore). */
  weight: number;
  /** This evidence's own probability estimate. */
  p: number;
  /** Human-readable reason, for the step log and debugging. */
  why: string;
}

const clampP = (p: number): number => Math.min(1 - 1e-6, Math.max(1e-6, p));
const logit = (p: number): number => Math.log(clampP(p) / (1 - clampP(p)));
const sigmoid = (l: number): number => 1 / (1 + Math.exp(-l));

export interface Fused {
  p: number;
  /** 0..1 — do the evidences agree with each other? */
  agreement: number;
}

/** Logarithmic opinion pool: prior + weight × logit(p) per evidence. */
export function fuseEvidence(prior: number, evidences: Evidence[]): Fused {
  let l = logit(prior);
  let wSum = 0;
  for (const e of evidences) {
    const w = Math.max(0, e.weight);
    l += w * logit(e.p);
    wSum += w;
  }
  const p = sigmoid(l);
  if (wSum === 0) return { p, agreement: 0.5 };
  let variance = 0;
  for (const e of evidences) {
    const w = Math.max(0, e.weight);
    variance += w * (e.p - p) * (e.p - p);
  }
  variance /= wSum;
  return { p, agreement: Math.min(1, Math.max(0, 1 - Math.sqrt(variance) * 2.5)) };
}

/** Confidence: extreme + agreed-upon + experienced = trustworthy. */
export function confidenceOf(p: number, agreement: number, samples = 8): number {
  const extremity = Math.abs(2 * clampP(p) - 1);
  const history = samples / (samples + 4);
  return Math.min(
    0.99,
    Math.max(0.01, (0.35 + 0.65 * extremity) * (0.4 + 0.6 * agreement) * (0.5 + 0.5 * history)),
  );
}

// ─── Calibration ────────────────────────────────────────────────────────

export interface CalibrationTicket {
  question: string;
  p: number;
}

const BUCKETS = 10;

/**
 * Bucketed reliability calibration: predictions are filed into 10
 * probability buckets per question; `adjusted` blends the raw prediction
 * with the bucket's Laplace-smoothed observed rate, trusting observations
 * more as they accumulate. Snapshot/restore persist it (memory-only in 11b).
 */
export class BucketCalibrator {
  private hits = new Map<string, { n: number[]; k: number[] }>();

  pending(question: string, p: number): CalibrationTicket {
    return { question, p: clampP(p) };
  }

  resolve(ticket: CalibrationTicket, outcome: 0 | 1): void {
    let row = this.hits.get(ticket.question);
    if (!row) {
      row = { n: Array(BUCKETS).fill(0), k: Array(BUCKETS).fill(0) };
      this.hits.set(ticket.question, row);
    }
    const b = Math.min(BUCKETS - 1, Math.floor(ticket.p * BUCKETS));
    row.n[b]++;
    row.k[b] += outcome;
  }

  samples(question: string, p: number): number {
    const row = this.hits.get(question);
    if (!row) return 0;
    return row.n[Math.min(BUCKETS - 1, Math.floor(clampP(p) * BUCKETS))];
  }

  adjusted(question: string, p: number): number {
    const row = this.hits.get(question);
    const cp = clampP(p);
    if (!row) return cp;
    const b = Math.min(BUCKETS - 1, Math.floor(cp * BUCKETS));
    const n = row.n[b];
    if (n === 0) return cp;
    const rate = (row.k[b] + 1) / (n + 2);
    const w = n / (n + 6);
    return (1 - w) * cp + w * rate;
  }

  snapshot(): Record<string, { n: number[]; k: number[] }> {
    return Object.fromEntries(this.hits);
  }

  restore(snap: Record<string, { n: number[]; k: number[] }>): void {
    for (const [q, row] of Object.entries(snap ?? {})) {
      if (row && Array.isArray(row.n) && Array.isArray(row.k) && row.n.length === BUCKETS && row.k.length === BUCKETS) {
        this.hits.set(q, { n: [...row.n], k: [...row.k] });
      }
    }
  }
}

// ─── State parsing (the TaskLoop ↔ judge contract) ──────────────────────

export interface ParsedJudgeState {
  goal: string;
  planLines: string[];
  stepActions: string[];
  stepsExpect: boolean[];
  stepsConfirm: boolean[];
  step: string;
  args: Record<string, unknown>;
  observation: Record<string, unknown>;
  expect: { windowContains?: string; textVisible?: string } | null;
  failure: string;
  replansLeft: number;
}

const EMPTY_STATE: ParsedJudgeState = {
  goal: '',
  planLines: [],
  stepActions: [],
  stepsExpect: [],
  stepsConfirm: [],
  step: '',
  args: {},
  observation: {},
  expect: null,
  failure: '',
  replansLeft: 0,
};

function parseJsonObject(val: string): Record<string, unknown> | null {
  try {
    const j = JSON.parse(val) as unknown;
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseJudgeState(state: string): ParsedJudgeState {
  const out: ParsedJudgeState = { ...EMPTY_STATE, args: {}, observation: {} };
  let inPlan = false;
  for (const line of state.split('\n')) {
    const t = line.trim();
    if (/^plan:\s*$/i.test(t)) {
      inPlan = true;
      continue;
    }
    if (inPlan && /^\d+\.\s/.test(t)) {
      out.planLines.push(t);
      continue;
    }
    inPlan = false;
    const m = line.match(/^(goal|steps|step|args|observation|expect|failure|replans left):\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2];
    if (key === 'goal') out.goal = val;
    else if (key === 'step') out.step = val;
    else if (key === 'failure') out.failure = val;
    else if (key === 'replans left') out.replansLeft = Number(val) || 0;
    else if (key === 'args') out.args = parseJsonObject(val) ?? {};
    else if (key === 'observation') out.observation = parseJsonObject(val) ?? {};
    else if (key === 'expect') {
      const j = parseJsonObject(val);
      out.expect = j
        ? {
            ...(typeof j.windowContains === 'string' ? { windowContains: j.windowContains } : {}),
            ...(typeof j.textVisible === 'string' ? { textVisible: j.textVisible } : {}),
          }
        : null;
    } else if (key === 'steps') {
      try {
        const arr = JSON.parse(val) as unknown;
        if (Array.isArray(arr)) {
          for (const s of arr) {
            if (s && typeof s === 'object') {
              const r = s as Record<string, unknown>;
              if (typeof r.action === 'string') out.stepActions.push(r.action);
              out.stepsExpect.push(r.expect === true);
              out.stepsConfirm.push(r.needsConfirm === true);
            }
          }
        }
      } catch {
        // malformed steps line — evidence packs degrade to plan-line counts
      }
    }
  }
  return out;
}

// ─── Evidence packs ─────────────────────────────────────────────────────

const RISK_WORDS = [
  'delete',
  'trash',
  'remove',
  'erase',
  'format',
  'wipe',
  'send',
  'pay',
  'purchase',
  'buy',
  'transfer',
  'order',
  'post',
  'publish',
  'uninstall',
  'kill',
  'shutdown',
  'restart',
];

const ev = (weight: number, p: number, why: string): Evidence => ({ weight, p, why });

function planEvidence(st: ParsedJudgeState): Evidence[] {
  const out: Evidence[] = [];
  const n = st.planLines.length || st.stepActions.length;
  if (n <= 4) out.push(ev(1.5, 0.72, `short plan (${n} steps)`));
  else if (n > 6) out.push(ev(1.5, 0.38, `long plan (${n} steps)`));
  const total = st.stepsExpect.length;
  if (total > 0) {
    const withExp = st.stepsExpect.filter(Boolean).length;
    if (withExp === total) out.push(ev(2, 0.8, 'every step declares what to verify'));
    else if (withExp === 0) out.push(ev(2, 0.4, 'no step declares what to verify'));
    else out.push(ev(1, 0.6, `${withExp}/${total} steps declare what to verify`));
  }
  const risky = RISK_WORDS.some((w) => st.goal.toLowerCase().includes(w));
  const hasConfirm = st.stepsConfirm.some(Boolean);
  if (risky && !hasConfirm) out.push(ev(2.5, 0.25, 'risky goal with no approval step'));
  else if (risky) out.push(ev(1.5, 0.7, 'risky goal has an approval step'));
  return out;
}

function verifyEvidence(st: ParsedJudgeState): Evidence[] {
  const out: Evidence[] = [ev(0.5, 0.62, 'step executed without errors')];
  const obs = st.observation;
  const window = typeof obs.window === 'string' ? obs.window : '';
  if (st.expect?.windowContains) {
    const hit = window.toLowerCase().includes(st.expect.windowContains.toLowerCase());
    out.push(
      hit
        ? ev(3, 0.92, `window shows "${st.expect.windowContains}"`)
        : ev(3, 0.12, `window lacks "${st.expect.windowContains}"`),
    );
  }
  if (st.expect?.textVisible) {
    const found = obs.textFound === true;
    out.push(
      found
        ? ev(2.5, 0.88, `"${st.expect.textVisible}" found on screen`)
        : ev(2.5, 0.2, `"${st.expect.textVisible}" not found`),
    );
  }
  if (!st.expect) {
    const hay = `${window} ${JSON.stringify(obs)}`.toLowerCase();
    const needles = [st.args.app, st.args.url, st.args.text, st.args.keys]
      .filter((v): v is string => typeof v === 'string')
      .flatMap((s) =>
        s
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((t) => t.length >= 4),
      );
    const hit = needles.find((t) => hay.includes(t));
    if (hit) out.push(ev(1.5, 0.75, `screen mentions "${hit}"`));
    else if (window) out.push(ev(1, 0.55, 'foreground window readable, nothing contradicting'));
    else out.push(ev(1, 0.45, 'no observation to confirm against'));
  }
  return out;
}

function recoveryScores(st: ParsedJudgeState): Array<{ option: string; p: number }> {
  const f = st.failure.toLowerCase();
  const transient = /(timeout|timed out|busy|econn|ebusy|rate limit|try again|temporar)/.test(f);
  const gated = /(confirm|gated|approv|denied|forbidden|blocked)/.test(f);
  const unverified = /(unverified|lacks|not found|mismatch)/.test(f);
  const destructive = RISK_WORDS.some((w) => f.includes(w));
  const fresh = st.replansLeft >= 2;

  const retryEvidences: Evidence[] = [
    transient ? ev(2, 0.75, 'transient-looking failure') : ev(1, 0.35, 'not obviously transient'),
    fresh ? ev(1, 0.6, 'recovery budget remains') : ev(2, 0.3, 'recovery budget low'),
  ];
  if (gated) retryEvidences.push(ev(2, 0.1, 'retry cannot clear an approval gate'));
  const replanEvidences: Evidence[] = [ev(1, 0.6, 'replan is the safe default')];
  if (unverified) replanEvidences.push(ev(1.5, 0.7, 'observation disagreed — new approach warranted'));
  if (gated) replanEvidences.push(ev(1, 0.45, 'replan still needs approval'));
  const askEvidences: Evidence[] = [ev(1, 0.25, 'asking interrupts the user')];
  if (gated) askEvidences.push(ev(2.5, 0.8, 'failure mentions an approval gate'));
  if (!fresh) askEvidences.push(ev(3, 0.75, 'recovery budget nearly spent'));
  if (destructive) askEvidences.push(ev(1.5, 0.65, 'failure touches destructive words'));

  return [
    { option: 'retry_same', p: fuseEvidence(0.4, retryEvidences).p },
    { option: 'replan', p: fuseEvidence(0.6, replanEvidences).p },
    { option: 'ask_user', p: fuseEvidence(0.25, askEvidences).p },
  ];
}

// ─── The judge ──────────────────────────────────────────────────────────

export class SofiaJudge implements SystemOneJudge {
  private calib = new BucketCalibrator();

  constructor(snapshot?: Record<string, { n: number[]; k: number[] }>) {
    if (snapshot) this.calib.restore(snapshot);
  }

  /** Persisted later (companion store); memory-only in 11b. */
  calibrationSnapshot(): Record<string, { n: number[]; k: number[] }> {
    return this.calib.snapshot();
  }

  async choice(
    state: string,
    _id: string,
    options: string[],
  ): Promise<{ choice: string; confidence: number }> {
    void _id;
    if (
      options.length !== 3 ||
      !options.includes('retry_same') ||
      !options.includes('replan') ||
      !options.includes('ask_user')
    ) {
      throw new Error('judge_unsupported_choice: this engine scores the recovery triple.');
    }
    const scores = recoveryScores(parseJudgeState(state));
    const total = scores.reduce((s, o) => s + o.p, 0) || 1;
    const ranked = scores
      .map((o) => ({ ...o, p: o.p / total }))
      .sort((a, b) => b.p - a.p);
    const top = ranked[0];
    const second = ranked[1]?.p ?? 0;
    return { choice: top.option, confidence: Math.min(0.99, Math.max(0.01, (top.p - second) * 2 + 0.1)) };
  }

  async score(
    state: string,
    _id: string,
    levels: string[],
  ): Promise<{ score: number; confidence: number; ticket?: CalibrationTicket }> {
    void _id;
    if (levels.length !== 5) {
      throw new Error('judge_unsupported_score: this engine rates 1..5 safety.');
    }
    const fused = fuseEvidence(0.6, planEvidence(parseJudgeState(state)));
    const p = this.calib.adjusted('plan_gate', fused.p);
    const score = Math.min(5, Math.max(1, Math.round(p * 5 + 0.5)));
    return {
      score,
      confidence: confidenceOf(p, fused.agreement, this.calib.samples('plan_gate', fused.p)),
      ticket: this.calib.pending('plan_gate', fused.p),
    };
  }

  async noul(state: string, _id: string, _statement: string): Promise<{ noul: number }> {
    void _id;
    void _statement;
    const st = parseJudgeState(state);
    return { noul: fuseEvidence(0.5, verifyEvidence(st)).p };
  }

  report(ticket: CalibrationTicket, outcome: 0 | 1): void {
    this.calib.resolve(ticket, outcome);
  }
}
