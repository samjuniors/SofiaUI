/**
 * tools/proactive-tool.test.ts — the routine tool against a fake scheduler.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AmbientScheduler } from '../sophia/AmbientScheduler.ts';
import { PROACTIVE_SCHEMA, ProactiveTool } from './proactive-tool.ts';

function setup() {
  const alerts: string[] = [];
  const sched = new AmbientScheduler({
    now: () => new Date(2026, 8, 29, 10, 0).getTime(),
    storage: null,
    handlers: {
      healthCheck: async () => ({ score: 88, warnings: [] }),
      briefing: async () => 'morning!',
      consolidate: async () => ({ merged: 0, resolved: 0, flagged: 0, skillsProposed: 0, skipped: null }),
      alert: (title) => void alerts.push(title),
    },
  });
  return { tool: new ProactiveTool(sched), sched, alerts };
}

test('list returns all routines with schedule state', async () => {
  const { tool } = setup();
  const r = await tool.invoke({ action: 'list' });
  assert.equal(r.success, true);
  const routines = (r.data as { routines: Array<{ id: string; enabled: boolean }> }).routines;
  assert.deepEqual(
    routines.map((x) => [x.id, x.enabled]),
    [
      ['memory-consolidation', true],
      ['morning-briefing', false],
      ['health-watch', true],
    ],
  );
});

test('enable/disable flip routines and refuse unknown ids', async () => {
  const { tool } = setup();
  assert.deepEqual((await tool.invoke({ action: 'enable', id: 'morning-briefing' })).data, {
    action: 'enable',
    id: 'morning-briefing',
    enabled: true,
  });
  assert.deepEqual((await tool.invoke({ action: 'disable', id: 'health-watch' })).data, {
    action: 'disable',
    id: 'health-watch',
    enabled: false,
  });
  const missing = await tool.invoke({ action: 'enable' });
  assert.deepEqual([missing.success, missing.error], [false, 'missing_id']);
  const unknown = await tool.invoke({ action: 'disable', id: 'nope' });
  assert.deepEqual([unknown.success, unknown.error], [false, 'unknown_routine']);
});

test('health_now returns a spoken-ready summary', async () => {
  const { tool } = setup();
  const r = await tool.invoke({ action: 'health_now' });
  assert.equal(r.success, true);
  const d = r.data as { score: number; alerted: boolean; summary: string };
  assert.deepEqual([d.score, d.alerted], [88, false]);
  assert.match(d.summary, /88\/100/);
});

test('health_now failures surface cleanly', async () => {
  const sched = new AmbientScheduler({
    now: () => 0,
    storage: null,
    handlers: {
      healthCheck: async () => {
        throw new Error('companion down');
      },
      briefing: async () => '',
      consolidate: async () => ({ merged: 0, resolved: 0, flagged: 0, skillsProposed: 0, skipped: 'test' }),
      alert: () => undefined,
    },
  });
  const r = await new ProactiveTool(sched).invoke({ action: 'health_now' });
  assert.deepEqual([r.success, r.error, r.errorDetail], [false, 'health_check_failed', 'companion down']);
});

test('unknown actions are rejected', async () => {
  const { tool } = setup();
  const r = await tool.invoke({ action: 'launch' });
  assert.deepEqual([r.success, r.error], [false, 'invalid_action']);
});

test('schema declares the tool for the LLM', () => {
  assert.equal(PROACTIVE_SCHEMA.name, 'proactive');
  assert.deepEqual(PROACTIVE_SCHEMA.parameters.required, ['action']);
  const props = PROACTIVE_SCHEMA.parameters.properties as Record<string, { enum?: string[] }>;
  assert.deepEqual(props.action.enum, ['list', 'enable', 'disable', 'health_now']);
  assert.ok(props.id);
});
