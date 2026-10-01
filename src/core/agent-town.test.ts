/**
 * core/agent-town.test.ts — the town sim under a controlled clock + RNG.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentTown, TOWN_AGENTS, TOWN_STORAGE_KEY, agentById } from './AgentTown.ts';

function memStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    storage: {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
  };
}

function town(opts: { at?: number; rand?: number } = {}) {
  let t = opts.at ?? 1000;
  return new AgentTown({
    now: () => t++,
    random: () => opts.rand ?? 0,
    storage: null,
    autoSeed: true,
  });
}

test('four agents with distinct specialties and colours', () => {
  assert.deepEqual(TOWN_AGENTS.map((a) => a.id), ['iris', 'vera', 'atlas', 'forge']);
  const specs = TOWN_AGENTS.flatMap((a) => a.specialties);
  assert.equal(new Set(specs).size, specs.length);
  assert.equal(new Set(TOWN_AGENTS.map((a) => a.color)).size, 4);
  assert.equal(agentById('vera').name, 'Vera');
  assert.equal(agentById(null).id, 'iris');
});

test('seed opens with five backlog tasks and a log line', () => {
  const s = town().snapshot();
  assert.equal(s.tasks.length, 5);
  assert.ok(s.tasks.every((t) => t.state === 'backlog'));
  assert.equal(s.log.length, 1);
  assert.match(s.log[0].text, /standup begins/);
});

test('first tick claims specialty work for every agent', () => {
  const tw = town();
  tw.tick();
  const doing = tw.snapshot().tasks.filter((t) => t.state === 'doing');
  assert.equal(doing.length, 4);
  // Deterministic claims: iris→research, vera→craft, atlas→organize, forge→chore.
  const byAgent = Object.fromEntries(doing.map((t) => [t.agent, t.tag]));
  assert.deepEqual(byAgent, { iris: 'research', vera: 'craft', atlas: 'organize', forge: 'chore' });
});

test('work progresses to done and the feed narrates it', () => {
  const tw = town();
  tw.tick();
  for (let i = 0; i < 6; i++) tw.tick();
  const s = tw.snapshot();
  assert.ok(s.tasks.some((t) => t.state === 'done'), 'nothing completed');
  assert.ok(s.log.some((l) => /finished/.test(l.text)));
  assert.ok(s.log.some((l) => /picked up/.test(l.text)));
  const done = s.tasks.filter((t) => t.state === 'done');
  assert.ok(done.every((t) => typeof t.doneAt === 'number'));
});

test('pause freezes the town; resume thaws it', () => {
  const tw = town();
  tw.tick();
  const before = tw.snapshot();
  tw.pause();
  assert.equal(tw.tick(), false);
  assert.deepEqual(tw.snapshot().tasks, before.tasks);
  tw.resume();
  assert.equal(tw.tick(), true);
});

test('addTask validates and reset restores the seed', () => {
  const tw = town();
  assert.throws(() => tw.addTask('   '), /title/);
  const added = tw.addTask('  Water the bonsai  ', 'CHORE');
  assert.equal(added.title, 'Water the bonsai');
  assert.equal(added.tag, 'chore');
  assert.equal(tw.snapshot().tasks.length, 6);
  tw.reset();
  const s = tw.snapshot();
  assert.equal(s.tasks.length, 5);
  assert.equal(s.tick, 0); // reset re-seeds cleanly at tick zero
});

test('new chores drift in over time without duplicating live work', () => {
  const tw = town();
  for (let i = 0; i < 12; i++) tw.tick();
  const live = tw.snapshot().tasks.filter((t) => t.state !== 'done').map((t) => t.title);
  assert.equal(new Set(live).size, live.length);
  assert.ok(tw.snapshot().tick >= 12);
});

test('done list and log are capped', () => {
  const tw = town();
  for (let i = 0; i < 60; i++) tw.tick();
  const s = tw.snapshot();
  assert.ok(s.tasks.filter((t) => t.state === 'done').length <= 12);
  assert.ok(s.log.length <= 30);
});

test('persistence round-trips; doing tasks re-queue on reload', () => {
  const { map, storage } = memStorage();
  const a = new AgentTown({ now: () => 5000, random: () => 0, storage, autoSeed: true });
  a.tick();
  assert.ok(map.has(TOWN_STORAGE_KEY));
  const b = new AgentTown({ now: () => 6000, random: () => 0, storage, autoSeed: true });
  const s = b.snapshot();
  assert.ok(s.tasks.length >= 5);
  assert.ok(s.tasks.every((t) => t.state !== 'doing'), 'reloaded town still mid-task');
  assert.ok(s.log.length >= 1);
});

test('corrupt saves fall back to a fresh seed', () => {
  const { storage } = memStorage({ [TOWN_STORAGE_KEY]: '{broken' });
  const s = new AgentTown({ storage, autoSeed: true }).snapshot();
  assert.equal(s.tasks.length, 5);
});

test('subscribers hear every change', () => {
  const tw = town();
  let calls = 0;
  const off = tw.subscribe(() => calls++);
  tw.tick();
  assert.ok(calls >= 1);
  off();
  const frozen = calls;
  tw.tick();
  assert.equal(calls, frozen);
});
