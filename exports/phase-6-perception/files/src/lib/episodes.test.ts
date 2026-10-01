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
