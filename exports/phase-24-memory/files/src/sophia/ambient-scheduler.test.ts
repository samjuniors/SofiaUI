/**
 * sophia/ambient-scheduler.test.ts — routines under a stub clock + storage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HEALTH_WATCH_ID,
  MEMORY_CONSOLIDATION_ID,
  MORNING_BRIEFING_ID,
  PROACTIVE_STORAGE_KEY,
  TICK_MS,
  AmbientScheduler,
  isQuietHours,
  type HealthCheckResult,
} from './AmbientScheduler.ts';

function setup(hour = 10, minute = 0) {
  let t = new Date(2026, 8, 29, hour, minute).getTime();
  const alerts: Array<{ title: string; body: string; level: string }> = [];
  let health: HealthCheckResult = { score: 95, warnings: [] };
  const calls = { health: 0, briefing: 0, consolidate: 0 };
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  const sched = new AmbientScheduler({
    now: () => t,
    storage,
    handlers: {
      healthCheck: async () => {
        calls.health++;
        return { score: health.score, warnings: [...health.warnings] };
      },
      briefing: async () => {
        calls.briefing++;
        return 'Good morning from the test town.';
      },
      consolidate: async () => {
        calls.consolidate++;
        return { merged: 1, resolved: 0, flagged: 0, skillsProposed: 0, skipped: null };
      },
      alert: (title, body, level) => void alerts.push({ title, body, level }),
    },
  });
  return {
    sched,
    alerts,
    calls,
    map,
    setHealth: (h: HealthCheckResult) => void (health = h),
    advance: (ms: number) => void (t += ms),
    setTime: (h: number, m = 0) => void (t = new Date(2026, 8, 29, h, m).getTime()),
    now: () => t,
  };
}

test('quiet hours span 22:30–07:45', () => {
  const at = (h: number, m: number) => new Date(2026, 8, 29, h, m);
  assert.equal(isQuietHours(at(22, 29)), false);
  assert.equal(isQuietHours(at(22, 30)), true);
  assert.equal(isQuietHours(at(23, 59)), true);
  assert.equal(isQuietHours(at(0, 0)), true);
  assert.equal(isQuietHours(at(7, 44)), true);
  assert.equal(isQuietHours(at(7, 45)), false);
  assert.equal(isQuietHours(at(12, 0)), false);
  assert.equal(TICK_MS, 30000);
});

test('built-ins: health-watch on, briefing off, consolidation dreams at 03:00', () => {
  const { sched } = setup();
  const list = sched.list();
  assert.equal(list.length, 3);
  const watch = sched.status(HEALTH_WATCH_ID)!;
  const briefing = sched.status(MORNING_BRIEFING_ID)!;
  const dream = sched.status(MEMORY_CONSOLIDATION_ID)!;
  assert.equal(watch.enabled, true);
  assert.deepEqual(watch.routine.rule, { kind: 'interval', everyMs: 4 * 3600_000 });
  assert.equal(briefing.enabled, false);
  assert.deepEqual(briefing.routine.rule, { kind: 'daily', timeOfDay: '08:00' });
  assert.equal(dream.enabled, true);
  assert.deepEqual(dream.routine.rule, { kind: 'daily', timeOfDay: '03:00' });
  assert.equal(dream.routine.runInQuietHours, true);
  assert.equal(sched.status('nope'), null);
});

test('interval rules fire once, then re-arm via lastRunAt', async () => {
  const { sched, calls, advance, now } = setup();
  await sched.tick();
  assert.equal(calls.health, 1);
  await sched.tick();
  assert.equal(calls.health, 1);
  // Re-arm to an hour ago: still not due.
  sched.markRun(HEALTH_WATCH_ID, now() - 3600_000);
  await sched.tick();
  assert.equal(calls.health, 1);
  // Past the 4h window: due again.
  advance(3 * 3600_000 + 1000);
  await sched.tick();
  assert.equal(calls.health, 2);
});

test('daily briefing fires after 08:00, once per day', async () => {
  const s = setup(7, 0);
  s.sched.enable(MORNING_BRIEFING_ID);
  await s.sched.tick();
  assert.equal(s.calls.briefing, 0);
  s.setTime(9, 0);
  await s.sched.tick();
  assert.equal(s.calls.briefing, 1);
  assert.equal(s.alerts.length, 1);
  assert.deepEqual([s.alerts[0].title, s.alerts[0].level], ['Morning briefing', 'info']);
  assert.match(s.alerts[0].body, /test town/);
  await s.sched.tick();
  assert.equal(s.calls.briefing, 1);
});

test('quiet hours freeze everything except the opted-in dream', async () => {
  const s = setup(23, 0);
  await s.sched.tick();
  assert.equal(s.calls.health, 0);
  assert.equal(s.sched.status(HEALTH_WATCH_ID)!.lastRunAt, null);
  assert.equal(s.calls.consolidate, 1); // past 03:00 + exempt → dreams on schedule
  assert.equal(s.alerts.length, 0); // …silently
  s.setTime(7, 50);
  await s.sched.tick();
  assert.equal(s.calls.health, 1);
});

test('consolidation fires once per night and sleeps when disabled', async () => {
  const s = setup(2, 0);
  await s.sched.tick();
  assert.equal(s.calls.consolidate, 0); // not yet 03:00
  s.setTime(4, 0);
  await s.sched.tick();
  assert.equal(s.calls.consolidate, 1);
  assert.equal(s.alerts.length, 0);
  assert.match(s.sched.status(MEMORY_CONSOLIDATION_ID)!.lastSignature ?? '', /merged/);
  await s.sched.tick();
  assert.equal(s.calls.consolidate, 1); // once per night
  s.sched.disable(MEMORY_CONSOLIDATION_ID);
  s.sched.markRun(MEMORY_CONSOLIDATION_ID, s.now() - 25 * 3600_000);
  await s.sched.tick();
  assert.equal(s.calls.consolidate, 1);
});

test('health alerts are delta-only', async () => {
  const s = setup();
  s.setHealth({ score: 60, warnings: ['CPU hot'] });
  await s.sched.tick();
  assert.equal(s.alerts.length, 1);
  assert.equal(s.alerts[0].level, 'warning');
  assert.match(s.alerts[0].body, /60\/100/);
  // Same signature, forced due: silent.
  s.sched.markRun(HEALTH_WATCH_ID, s.now() - 5 * 3600_000);
  await s.sched.tick();
  assert.equal(s.alerts.length, 1);
  // Warnings change: speaks again.
  s.setHealth({ score: 62, warnings: ['CPU hot', 'Disk full'] });
  s.sched.markRun(HEALTH_WATCH_ID, s.now() - 5 * 3600_000);
  await s.sched.tick();
  assert.equal(s.alerts.length, 2);
  // Score drift alone (still low, same warnings): silent.
  s.setHealth({ score: 68, warnings: ['CPU hot', 'Disk full'] });
  s.sched.markRun(HEALTH_WATCH_ID, s.now() - 5 * 3600_000);
  await s.sched.tick();
  assert.equal(s.alerts.length, 2);
  // Recovery: silent but re-arms; relapse: speaks.
  s.setHealth({ score: 95, warnings: [] });
  s.sched.markRun(HEALTH_WATCH_ID, s.now() - 5 * 3600_000);
  await s.sched.tick();
  assert.equal(s.alerts.length, 2);
  s.setHealth({ score: 60, warnings: ['CPU hot'] });
  s.sched.markRun(HEALTH_WATCH_ID, s.now() - 5 * 3600_000);
  await s.sched.tick();
  assert.equal(s.alerts.length, 3);
});

test('healthNow checks immediately and reports whether it alerted', async () => {
  const s = setup(23, 30); // quiet hours — explicit asks still work
  s.setHealth({ score: 55, warnings: ['Fan loud'] });
  const r = await s.sched.healthNow();
  assert.deepEqual([r.score, r.alerted], [55, true]);
  assert.equal(s.alerts.length, 1);
  const calm = await s.sched.healthNow();
  assert.equal(calm.alerted, false);
});

test('runNow bypasses quiet hours and disabled flags', async () => {
  const s = setup(23, 30);
  assert.equal(await s.sched.runNow(MORNING_BRIEFING_ID), true);
  assert.equal(s.calls.briefing, 1);
  assert.equal(await s.sched.runNow('nope'), false);
});

test('enable/disable round-trips; unknown ids refuse', () => {
  const { sched } = setup();
  assert.equal(sched.disable(HEALTH_WATCH_ID), true);
  assert.equal(sched.status(HEALTH_WATCH_ID)!.enabled, false);
  assert.equal(sched.enable(HEALTH_WATCH_ID), true);
  assert.equal(sched.disable('nope'), false);
  assert.equal(sched.enable('nope'), false);
});

test('state persists across restarts', async () => {
  const a = setup();
  a.sched.enable(MORNING_BRIEFING_ID);
  a.setHealth({ score: 60, warnings: ['CPU hot'] });
  await a.sched.tick();
  assert.ok(a.map.has(PROACTIVE_STORAGE_KEY));
  const b = new AmbientScheduler({
    now: a.now,
    storage: {
      getItem: (k: string) => (a.map.has(k) ? a.map.get(k)! : null),
      setItem: (k: string, v: string) => void a.map.set(k, v),
      removeItem: (k: string) => void a.map.delete(k),
    },
  });
  assert.equal(b.status(MORNING_BRIEFING_ID)!.enabled, true);
  assert.equal(b.status(HEALTH_WATCH_ID)!.lastRunAt, a.sched.status(HEALTH_WATCH_ID)!.lastRunAt);
});

test('failures record an error and back off to the next slot', async () => {
  const s = setup();
  s.sched.setHandlers({
    healthCheck: async () => {
      throw new Error('companion down');
    },
    briefing: async () => '',
    consolidate: async () => ({ merged: 0, resolved: 0, flagged: 0, skillsProposed: 0, skipped: 'test' }),
    alert: () => undefined,
  });
  await s.sched.tick();
  const st = s.sched.status(HEALTH_WATCH_ID)!;
  assert.equal(st.lastError, 'companion down');
  assert.notEqual(st.lastRunAt, null); // backed off, not retry-spamming
  assert.equal(s.alerts.length, 0);
});

test('change events fire on runs and toggles', async () => {
  const { sched } = setup();
  let calls = 0;
  sched.addEventListener('change', () => calls++);
  await sched.tick();
  assert.ok(calls >= 1);
  sched.disable(HEALTH_WATCH_ID);
  assert.ok(calls >= 2);
});

test('start/stop controls the timer without hanging', () => {
  const { sched } = setup();
  assert.equal(sched.running, false);
  sched.start();
  sched.start();
  assert.equal(sched.running, true);
  sched.stop();
  assert.equal(sched.running, false);
});

test('nextRunAt previews the coming run', () => {
  const s = setup(10, 0);
  const watch = s.sched.status(HEALTH_WATCH_ID)!;
  assert.equal(watch.nextRunAt, s.now()); // never ran: due now
  s.sched.enable(MORNING_BRIEFING_ID);
  const briefing = s.sched.status(MORNING_BRIEFING_ID)!;
  // Already past 08:00 and never ran: due now.
  assert.equal(briefing.nextRunAt, s.now());
  s.setTime(7, 0);
  const early = s.sched.status(MORNING_BRIEFING_ID)!;
  assert.equal(early.nextRunAt, new Date(2026, 8, 29, 8, 0).getTime());
});
