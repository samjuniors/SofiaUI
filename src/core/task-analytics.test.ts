import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALARM_DROP,
  ALARM_MIN_SAMPLES,
  MAX_RECORDS,
  TaskAnalyticsStore,
  computeAlarm,
  computeSnapshot,
  weekKey,
  type SkillInfo,
  type TaskRecord,
} from './task-analytics.ts';

function mem() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}

function rec(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: `r-${Math.random()}`,
    kind: 'desktop',
    goal: 'g',
    ok: true,
    steps: 4,
    costUsd: 0,
    durationMs: 1000,
    ts: Date.now(),
    memoryHit: false,
    curationApplied: 0,
    ...over,
  };
}

const DAY = 24 * 60 * 60 * 1000;

test('weekKey buckets ISO weeks', () => {
  assert.equal(weekKey(Date.UTC(2026, 8, 30)), '2026-W40'); // Wed Sep 30
  assert.equal(weekKey(Date.UTC(2026, 8, 28)), '2026-W40'); // Mon
  assert.equal(weekKey(Date.UTC(2026, 8, 27)), '2026-W39'); // Sun
  assert.equal(weekKey(Date.UTC(2026, 0, 1)), '2026-W01'); // Thu Jan 1
});

test('snapshot aggregates rate, steps, cost and memory assists', () => {
  const skills: SkillInfo = { ids: ['a', 'b', 'c'], disabled: ['c', 'ghost'] };
  const s = computeSnapshot(
    [
      rec({ ok: true, steps: 2, costUsd: 0.1, memoryHit: true }),
      rec({ ok: false, steps: 6, costUsd: 0.3, curationApplied: 2 }),
    ],
    skills,
    ['a', 'b', 'c', 'old'],
    Date.now(),
  );
  assert.equal(s.total, 2);
  assert.equal(s.done, 1);
  assert.equal(s.rate, 0.5);
  assert.equal(s.avgSteps, 4);
  assert.ok(Math.abs(s.costPerTask - 0.2) < 1e-9);
  assert.equal(s.memoryAssists, 3);
  assert.equal(s.skillsLearned, 4);
  assert.equal(s.skillsRetired, 1);
});

test('snapshot on empty history is honest nulls, never 0%', () => {
  const s = computeSnapshot([], { ids: [], disabled: [] }, [], Date.now());
  assert.equal(s.total, 0);
  assert.equal(s.rate, null);
  assert.equal(s.avgSteps, null);
  assert.equal(s.costPerTask, 0);
  assert.equal(s.alarm.raised, false);
});

test('weeks bucket the last 8 in chronological order', () => {
  const now = Date.UTC(2026, 8, 30);
  const records = Array.from({ length: 10 }, (_, i) => rec({ ts: now - i * 7 * DAY, ok: i % 3 !== 0 }));
  const s = computeSnapshot(records, { ids: [], disabled: [] }, [], now);
  assert.equal(s.weeks.length, 8);
  assert.ok(s.weeks[0].week < s.weeks[7].week);
  assert.equal(s.weeks[7].total, 1);
});

test('alarm raises on a week-over-week drop with enough samples', () => {
  const now = Date.now();
  const prev = Array.from({ length: 6 }, () => rec({ ts: now - 10 * DAY, ok: true }));
  const curBad = Array.from({ length: 6 }, () => rec({ ts: now - 1 * DAY, ok: false }));
  const raised = computeAlarm([...prev, ...curBad], now);
  assert.equal(raised.raised, true);
  assert.match(raised.reason, /fell 100pts/);
  const curOk = Array.from({ length: 6 }, () => rec({ ts: now - 1 * DAY, ok: true }));
  assert.equal(computeAlarm([...prev, ...curOk], now).raised, false);
  assert.ok(ALARM_MIN_SAMPLES === 5 && ALARM_DROP === 0.15);
});

test('alarm stays quiet without enough samples', () => {
  const now = Date.now();
  const a = computeAlarm([rec({ ts: now - DAY, ok: false })], now);
  assert.equal(a.raised, false);
  assert.match(a.reason, /needs ≥5/);
});

test('store caps records, persists and reloads', () => {
  const storage = mem();
  const s = new TaskAnalyticsStore(storage, () => 1000);
  for (let i = 0; i < MAX_RECORDS + 10; i++) s.record(rec({ id: `r-${i}` }));
  assert.equal(s.list().length, MAX_RECORDS);
  assert.equal(s.list()[0].id, 'r-10');
  s.noteSkills({ ids: ['a'], disabled: [] });
  const s2 = new TaskAnalyticsStore(storage, () => 1000);
  assert.equal(s2.list().length, MAX_RECORDS);
  assert.equal(s2.snapshot().skillsLearned, 1);
  let events = 0;
  s2.addEventListener('change', () => (events += 1));
  s2.clear();
  assert.equal(s2.list().length, 0);
  assert.equal(events, 1);
});

test('store drops corrupt cache and records', () => {
  const storage = mem();
  storage.setItem('sophia:task-analytics:v1', '{oops');
  const s = new TaskAnalyticsStore(storage);
  assert.equal(s.list().length, 0);
  storage.setItem('sophia:task-analytics:v1', JSON.stringify({ records: [{ id: 'x' }, 42], everSeen: 'nope' }));
  const s2 = new TaskAnalyticsStore(storage);
  assert.equal(s2.list().length, 0);
});
