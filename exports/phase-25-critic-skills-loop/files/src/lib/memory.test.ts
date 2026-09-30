import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CompanionReply } from './companion-client.ts';
import {
  addMemoryFact,
  addMemoryEpisode,
  putWorking,
  getWorking,
  recallForTurn,
  listMemories,
  updateMemory,
  deleteMemory,
  exportMemory,
  memoryWrites,
  memoryCounts,
  runConsolidationNow,
  MemoryError,
  type MemoryCaller,
} from './memory.ts';

const ok = (result: unknown): CompanionReply<unknown> => ({ ok: true, result });
const dead = (): CompanionReply<unknown> => ({ ok: false, error: 'not_connected' });
const calls: Array<{ action: string; args: Record<string, unknown> }> = [];
const scripted = (replies: Record<string, unknown>): MemoryCaller => async (action, args = {}) => {
  calls.push({ action, args });
  if (!(action in replies)) return dead();
  return ok(replies[action]);
};
const noEmbed = async (_texts: string[]) => null;

test('addMemoryFact validates locally and shapes the reply', async () => {
  calls.length = 0;
  await assert.rejects(addMemoryFact(scripted({}), { text: '', source: 'user' }, noEmbed), MemoryError);
  const r = await addMemoryFact(
    scripted({ memory_fact_add: { id: 3, sourceTrust: 'trusted', confidence: 0.8, engine: 'fts5' } }),
    { text: 'My dog is Rex', source: 'user' },
    noEmbed,
  );
  assert.equal(r.id, 3);
  assert.equal(calls[0].action, 'memory_fact_add');
  assert.ok(!('embedding' in calls[0].args), 'no vector when the embed backend is down');
});

test('addMemoryFact attaches embeddings when available', async () => {
  calls.length = 0;
  await addMemoryFact(
    scripted({ memory_fact_add: { id: 1 } }),
    { text: 'My dog is Rex', source: 'user' },
    async () => [[0.1, 0.2]],
  );
  assert.deepEqual(calls[0].args.embedding, [0.1, 0.2]);
});

test('addMemoryEpisode returns derived ids; working roundtrips', async () => {
  const ep = await addMemoryEpisode(
    scripted({ memory_episode_add: { id: 9, derivedIds: [11, 12], engine: 'fts5' } }),
    { text: 'did the thing', kind: 'task', outcome: 'done' },
    noEmbed,
  );
  assert.deepEqual(ep.derivedIds, [11, 12]);
  const put = await putWorking(scripted({ memory_working_put: { sessionId: 's1' } }), { sessionId: 's1', goal: 'g' });
  assert.equal(put.sessionId, 's1');
  const got = await getWorking(scripted({ memory_working_get: { working: { sessionId: 's1', goal: 'g' } } }), 's1');
  assert.equal(got?.goal, 'g');
  const missing = await getWorking(scripted({ memory_working_get: { working: null } }), 's1');
  assert.equal(missing, null);
});

test('recallForTurn never throws and shapes hits', async () => {
  const empty = await recallForTurn('hello', { caller: async () => { throw new Error('boom'); }, embed: noEmbed });
  assert.deepEqual(empty, { block: '', facts: [], episodes: [], working: null, skills: [] });
  const blank = await recallForTurn('   ', { embed: noEmbed });
  assert.equal(blank.block, '');
  const full = await recallForTurn('Rex', {
    caller: scripted({
      memory_context: {
        block: 'Remembered:\n• My dog is Rex',
        facts: [{ id: 1, text: 'My dog is Rex', source: 'user', sourceTrust: 'trusted', confidence: 0.8 }],
        episodes: [{ id: 2, text: 'walked', kind: 'task', outcome: 'done' }],
        working: null,
        skills: [{ id: 3, name: 'walk', trigger: 'when dog', status: 'active', successCount: 4, useCount: 5, successRate: 0.8 }],
      },
    }),
    embed: noEmbed,
  });
  assert.match(full.block, /Rex/);
  assert.equal(full.facts[0].sourceTrust, 'trusted');
  assert.equal(full.episodes[0].outcome, 'done');
  assert.equal(full.skills[0].successRate, 0.8);
  const down: MemoryCaller = async () => dead();
  assert.equal((await recallForTurn('Rex', { caller: down, embed: noEmbed })).block, '');
});

test('CRUD + export + writes + counts + consolidate pass through', async () => {
  calls.length = 0;
  const caller = scripted({
    memory_list: { rows: [{ id: 1 }] },
    memory_update: { updated: true },
    memory_delete: { deleted: true },
    memory_export: { facts: [], episodes: [] },
    memory_writes: { writes: [{ id: 1, ts: 2, store: 'semantic', op: 'add', refId: '1', actor: 'user', summary: 'x' }] },
    memory_counts: { counts: { facts: 4 } },
    memory_consolidate: { skipped: null, stats: { merged: 2 } },
  });
  assert.equal((await listMemories(caller, 'semantic')).length, 1);
  assert.equal(await updateMemory(caller, 'semantic', 1, { text: 'new' }), true);
  assert.deepEqual(calls[1].args, { store: 'semantic', id: 1, patch: { text: 'new' }, actor: 'user' });
  assert.equal(await deleteMemory(caller, 'episodic', 9), true);
  assert.ok('facts' in (await exportMemory(caller)));
  assert.equal((await memoryWrites(caller))[0].op, 'add');
  assert.equal((await memoryCounts(caller)).facts, 4);
  assert.equal((await runConsolidationNow(caller, true)).stats?.merged, 2);
  assert.deepEqual(calls[calls.length - 1].args, { force: true });
});
