/**
 * lib/episodes.test.ts — episodic memory client with a fake transport.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EpisodeError,
  addEpisode,
  episodeAge,
  recentEpisodes,
  searchEpisodes,
} from './episodes.ts';
import type { EpisodeCaller } from './episodes.ts';

function fake(result: unknown = {}) {
  const calls: Array<{ action: string; args: Record<string, unknown> }> = [];
  const caller: EpisodeCaller = async (action, args = {}) => {
    calls.push({ action, args });
    return { ok: true, result };
  };
  return { calls, caller };
}

function failing(error: string, detail = ''): EpisodeCaller {
  return async () => ({ ok: false, error, detail });
}

test('addEpisode validates and shapes the reply', async () => {
  const { calls, caller } = fake({ id: 7, ts: 123, engine: 'fts5' });
  const r = await addEpisode(caller, '  First flight  ', 'milestone');
  assert.deepEqual([calls[0].action, calls[0].args.text, calls[0].args.role], ['episodes_add', 'First flight', 'milestone']);
  assert.deepEqual(r, { id: 7, ts: 123, engine: 'fts5' });
  const jsonl = await addEpisode(fake({ ts: 5, engine: 'jsonl' }).caller, 'x');
  assert.equal(jsonl.id, undefined);
  await assert.rejects(() => addEpisode(caller, '   '), EpisodeError);
});

test('searchEpisodes clamps the limit and filters junk', async () => {
  const { calls, caller } = fake({
    engine: 'fts5',
    hits: [
      { id: 1, ts: 10, role: 'note', text: 'kept' },
      { nope: true },
      { text: '  ' },
      null,
    ],
  });
  const r = await searchEpisodes(caller, 'flight', 999);
  assert.equal(calls[0].args.limit, 50);
  assert.deepEqual(r.hits.map((h) => h.text), ['kept']);
  assert.equal(r.engine, 'fts5');
  await assert.rejects(() => searchEpisodes(caller, ''), /Search text/);
});

test('recentEpisodes tolerates missing lists and roles', async () => {
  const r = await recentEpisodes(fake({ engine: 'jsonl', episodes: [{ ts: 3, text: 'a' }] }).caller);
  assert.deepEqual(r.episodes, [{ id: undefined, ts: 3, role: 'note', text: 'a' }]);
  assert.deepEqual((await recentEpisodes(fake({}).caller)).episodes, []);
});

test('daemon and transport failures surface as EpisodeError', async () => {
  await assert.rejects(() => searchEpisodes(failing('not_connected', 'down'), 'x'), /down/);
  const boom: EpisodeCaller = async () => {
    throw new Error('socket died');
  };
  try {
    await recentEpisodes(boom);
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof EpisodeError);
    assert.equal(err.code, 'transport');
  }
});

test('episodeAge bands', () => {
  assert.equal(episodeAge(0), 'unknown');
  assert.equal(episodeAge(1000, 30_000), 'just now');
  assert.equal(episodeAge(1000, 1000 + 5 * 60_000), '5m ago');
  assert.equal(episodeAge(1000, 1000 + 3 * 3600_000), '3h ago');
  assert.equal(episodeAge(1000, 1000 + 2 * 86400_000), '2d ago');
  assert.equal(episodeAge(1000, 1000 + 30 * 86400_000), new Date(1000).toLocaleDateString());
});

test('vectors ride add/search args; hybrid flag surfaces', async () => {
  const { calls, caller } = fake({ engine: 'fts5', hybrid: true, hits: [] });
  const { searchEpisodes: se, addEpisode: ae } = await import('./episodes.ts');
  const r = await se(caller, 'q', 5, { vector: [0.1, 0.2] });
  assert.deepEqual(calls[0].args.vector, [0.1, 0.2]);
  assert.equal(r.hybrid, true);
  const plain = fake({ engine: 'fts5', hits: [] });
  const r2 = await se(plain.caller, 'q');
  assert.ok(!('vector' in (plain.calls[0].args as object)));
  assert.equal(r2.hybrid, false, 'old daemons omit the flag');
  await ae(caller, 'moment', 'note', { embedding: [1, 2] });
  assert.deepEqual(calls[1].args.embedding, [1, 2]);
  await ae(caller, 'plain', 'note', { embedding: [1, NaN] });
  assert.ok(!('embedding' in (calls[2].args as object)), 'junk vectors are dropped, not shipped');
});

test('hybrid/enriched helpers degrade gracefully without an embed backend', async () => {
  const { searchEpisodesHybrid, addEpisodeEnriched } = await import('./episodes.ts');
  const down = async () => null;
  const { calls, caller } = fake({ engine: 'fts5', hits: [{ text: 'kw hit' }] });
  const r = await searchEpisodesHybrid(caller, 'q', 5, down);
  assert.ok(!('vector' in (calls[0].args as object)));
  assert.equal(r.hits[0].text, 'kw hit');
  const up = async () => [[0.3, 0.4]];
  const r2 = await searchEpisodesHybrid(caller, 'q', 5, up);
  assert.deepEqual(calls[1].args.vector, [0.3, 0.4]);
  assert.equal(r2.hits[0].text, 'kw hit');
  const throwing = async (): Promise<null> => {
    throw new Error('ollama down');
  };
  await addEpisodeEnriched(caller, 'm', 'note', throwing);
  assert.ok(!('embedding' in (calls[2].args as object)));
  await addEpisodeEnriched(caller, 'm', 'note', up);
  assert.deepEqual(calls[3].args.embedding, [0.3, 0.4]);
});
