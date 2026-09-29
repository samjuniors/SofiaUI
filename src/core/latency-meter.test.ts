/**
 * core/latency-meter.test.ts — the 800 ms budget under a fake clock.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LATENCY_HISTORY_CAP,
  LatencyMeter,
  VOICE_LATENCY_BUDGET_MS,
  latencyStatsFor,
} from './LatencyMeter.ts';

function meter() {
  let t = 10000;
  const m = new LatencyMeter({ now: () => t });
  return { m, advance: (ms: number) => void (t += ms) };
}

test('budget constant is the 800 ms voice-to-voice target', () => {
  assert.equal(VOICE_LATENCY_BUDGET_MS, 800);
});

test('a full turn records brain, tts and voice spans', () => {
  const { m, advance } = meter();
  assert.equal(m.inFlight, false);
  m.startTurn('cloud');
  assert.equal(m.inFlight, true);
  advance(300);
  m.markBrain();
  advance(200);
  m.markVoice();
  assert.equal(m.inFlight, false);
  const [s] = m.snapshot();
  assert.deepEqual(
    { route: s.route, brainMs: s.brainMs, ttsMs: s.ttsMs, voiceMs: s.voiceMs },
    { route: 'cloud', brainMs: 300, ttsMs: 200, voiceMs: 500 },
  );
  assert.equal(s.withinBudget, true);
});

test('over-budget turns are flagged', () => {
  const { m, advance } = meter();
  m.startTurn('local');
  advance(900);
  m.markVoice();
  const [s] = m.snapshot();
  assert.equal(s.voiceMs, 900);
  assert.equal(s.withinBudget, false);
});

test('missing brain mark folds the whole turn into tts time', () => {
  const { m, advance } = meter();
  m.startTurn('cloud');
  advance(120);
  m.markVoice();
  const [s] = m.snapshot();
  assert.deepEqual([s.brainMs, s.ttsMs, s.voiceMs], [120, 0, 120]);
});

test('stray marks and cancels are safe', () => {
  const { m, advance } = meter();
  m.markBrain();
  m.markVoice();
  m.cancel();
  m.setRoute('x');
  assert.equal(m.snapshot().length, 0);
  m.startTurn('cloud');
  m.setRoute('local');
  advance(50);
  m.markVoice();
  assert.equal(m.snapshot()[0].route, 'local');
  // Restarting mid-turn drops the abandoned one.
  m.startTurn('a');
  advance(10);
  m.startTurn('b');
  advance(20);
  m.markVoice();
  assert.equal(m.snapshot().length, 2);
  m.cancel();
  assert.equal(m.inFlight, false);
});

test('stats summarise last, avg, p50, best, worst and budget hits', () => {
  const empty = new LatencyMeter().stats();
  assert.equal(empty.count, 0);
  assert.equal(empty.lastMs, null);
  const { m, advance } = meter();
  for (const [route, ms] of [['a', 200], ['b', 400], ['c', 900]] as const) {
    m.startTurn(route);
    advance(ms);
    m.markVoice();
  }
  const s = m.stats();
  assert.deepEqual(
    { count: s.count, lastMs: s.lastMs, avgMs: s.avgMs, p50Ms: s.p50Ms, bestMs: s.bestMs, worstMs: s.worstMs },
    { count: 3, lastMs: 900, avgMs: 500, p50Ms: 400, bestMs: 200, worstMs: 900 },
  );
  assert.equal(s.withinBudget, 2);
  assert.equal(s.budgetMs, 800);
});

test('history is capped and reset clears everything', () => {
  const { m, advance } = meter();
  for (let i = 0; i < LATENCY_HISTORY_CAP + 5; i++) {
    m.startTurn('x');
    advance(10);
    m.markVoice();
  }
  assert.equal(m.snapshot().length, LATENCY_HISTORY_CAP);
  m.reset();
  assert.equal(m.snapshot().length, 0);
  assert.equal(m.stats().count, 0);
});

test('subscribers hear completions and resets only', () => {
  const { m, advance } = meter();
  let calls = 0;
  const off = m.subscribe(() => calls++);
  m.startTurn('x');
  m.markBrain();
  assert.equal(calls, 0);
  advance(5);
  m.markVoice();
  assert.equal(calls, 1);
  m.reset();
  assert.equal(calls, 2);
  off();
  m.startTurn('x');
  m.markVoice();
  assert.equal(calls, 2);
});

test('latencyStatsFor handles even counts and clones safely', () => {
  const s = latencyStatsFor([
    { at: 1, route: 'a', brainMs: 50, ttsMs: 50, voiceMs: 100, withinBudget: true },
    { at: 2, route: 'a', brainMs: 100, ttsMs: 100, voiceMs: 200, withinBudget: true },
  ]);
  assert.equal(s.p50Ms, 150);
  assert.equal(s.avgMs, 150);
});
