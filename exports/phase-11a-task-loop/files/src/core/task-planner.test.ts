import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPrompt, parsePlan, planWithBrain, MAX_PLAN_STEPS } from './task-planner.ts';

const GOOD = JSON.stringify({
  steps: [
    { tool: 'computer', args: { action: 'open_app', app: 'vlc' }, expect: { windowContains: 'vlc' }, note: 'Open VLC' },
    { tool: 'computer', args: { action: 'hotkey', keys: 'ctrl+o' } },
  ],
});

test('parsePlan accepts a valid computer plan', () => {
  const r = parsePlan(GOOD, 'open vlc');
  assert.ok('plan' in r);
  assert.equal(r.plan.goal, 'open vlc');
  assert.equal(r.plan.steps.length, 2);
  assert.equal(r.plan.steps[0].expect?.windowContains, 'vlc');
  assert.equal(r.plan.steps[1].expect, undefined);
});

test('parsePlan strips code fences', () => {
  const r = parsePlan('```json\n' + GOOD + '\n```', 'g');
  assert.ok('plan' in r);
  assert.equal(r.plan.steps.length, 2);
});

test('parsePlan rejects non-JSON, bad shapes, empty and oversized plans', () => {
  assert.match((parsePlan('just prose', 'g') as { error: string }).error, /not_json/);
  assert.match((parsePlan('{"nope":[]}', 'g') as { error: string }).error, /bad_shape/);
  assert.match((parsePlan('{"steps":[]}', 'g') as { error: string }).error, /empty/);
  const many = JSON.stringify({ steps: Array.from({ length: MAX_PLAN_STEPS + 1 }, () => ({ tool: 'computer', args: { action: 'see' } })) });
  assert.match((parsePlan(many, 'g') as { error: string }).error, /too_long/);
});

test('parsePlan enforces computer-only steps with known actions', () => {
  const nested = JSON.stringify({ steps: [{ tool: 'task', args: { goal: 'x' } }] });
  assert.match((parsePlan(nested, 'g') as { error: string }).error, /must be "computer"/);
  const bogus = JSON.stringify({ steps: [{ tool: 'computer', args: { action: 'dance' } }] });
  assert.match((parsePlan(bogus, 'g') as { error: string }).error, /unknown computer action/);
  const noAction = JSON.stringify({ steps: [{ tool: 'computer', args: {} }] });
  assert.match((parsePlan(noAction, 'g') as { error: string }).error, /unknown computer action/);
});

test('parsePlan validates expect blocks and keeps confirm flags', () => {
  const bad = JSON.stringify({ steps: [{ tool: 'computer', args: { action: 'see' }, expect: { windowContains: 42 } }] });
  assert.match((parsePlan(bad, 'g') as { error: string }).error, /windowContains must be a string/);
  const ok = JSON.stringify({
    steps: [{ tool: 'computer', args: { action: 'click' }, needsConfirm: true, note: 'n'.repeat(500) }],
  });
  const r = parsePlan(ok, 'g');
  assert.ok('plan' in r);
  assert.equal(r.plan.steps[0].needsConfirm, true);
  assert.equal(r.plan.steps[0].note?.length, 200);
});

test('planPrompt grounds the goal with snapshot + rules', () => {
  const p = planPrompt('open vlc', { window: 'Program Manager', cursor: { x: 5, y: 6 }, vision: true });
  assert.match(p, /open vlc/);
  assert.match(p, /Program Manager/);
  assert.match(p, /JSON ONLY/);
  assert.match(p, /find_text/);
  const f = planPrompt('g', { failure: 'click missed' });
  assert.match(f, /FAILED/);
  assert.match(f, /click missed/);
});

test('planWithBrain posts a clean-slate brain call and parses', async () => {
  const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string, init: { body: string }) => {
    seen.push({ url, body: JSON.parse(init.body) });
    return { json: async () => ({ text: GOOD }) };
  }) as unknown as typeof fetch;
  const plan = await planWithBrain('open vlc', { window: null }, fetchImpl);
  assert.equal(plan.steps.length, 2);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, '/api/sophia/chat');
  assert.deepEqual((seen[0].body as { history: unknown[] }).history, []);
  assert.match(String((seen[0].body as { lastUser: string }).lastUser), /open vlc/);
});

test('planWithBrain throws reachable errors as values', async () => {
  const down = (() => Promise.reject(new Error('nope'))) as unknown as typeof fetch;
  await assert.rejects(() => planWithBrain('g', {}, down), /planner_unreachable/);
  const badBrain = (() => Promise.resolve({ json: async () => ({ text: 'not json' }) })) as unknown as typeof fetch;
  await assert.rejects(() => planWithBrain('g', {}, badBrain), /planner_not_json/);
});
