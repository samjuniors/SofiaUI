/**
 * lib/headlines.test.ts — the news wire's parse + cache helpers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FALLBACK_HEADLINES,
  HEADLINES_CACHE_KEY,
  ageLabel,
  fetchHeadlines,
  parseHeadlines,
  readHeadlineCache,
  writeHeadlineCache,
} from './headlines.ts';

function stubStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  return map;
}

function unstubStorage() {
  delete (globalThis as Record<string, unknown>).localStorage;
}

test('parseHeadlines cleans mixed junk', () => {
  const items = parseHeadlines(
    {
      hits: [
        { title: '  Clean title  ', url: 'https://www.example.com/a', points: 12.7, author: 'sam', num_comments: 3 },
        { title: '', url: 'https://example.com/empty' },
        { title: 'No URL', objectID: 123, points: -5 },
        { title: 'Bad numbers', points: NaN, num_comments: Infinity },
        null,
        'junk',
      ],
    },
    10,
  );
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], {
    title: 'Clean title',
    url: 'https://www.example.com/a',
    points: 13,
    source: 'example.com',
    comments: 3,
  });
  assert.equal(items[1].url, 'https://news.ycombinator.com/item?id=123');
  assert.equal(items[1].points, 0);
  assert.deepEqual([items[2].points, items[2].comments], [0, 0]);
});

test('parseHeadlines rejects junk payloads and honours the limit', () => {
  assert.deepEqual(parseHeadlines(null), []);
  assert.deepEqual(parseHeadlines({}), []);
  assert.deepEqual(parseHeadlines({ hits: 'nope' }), []);
  const many = { hits: Array.from({ length: 20 }, (_, i) => ({ title: `t${i}` })) };
  assert.equal(parseHeadlines(many, 8).length, 8);
});

test('headline cache round-trips and rejects corruption', () => {
  const map = stubStorage();
  try {
    assert.equal(readHeadlineCache(), null);
    writeHeadlineCache([{ title: 'Hi', url: 'https://example.com', points: 1, source: 'example.com', comments: 0 }], 1000);
    assert.ok(map.has(HEADLINES_CACHE_KEY));
    const cached = readHeadlineCache();
    assert.equal(cached?.at, 1000);
    assert.equal(cached?.items[0].title, 'Hi');
    map.set(HEADLINES_CACHE_KEY, '{broken');
    assert.equal(readHeadlineCache(), null);
    map.set(HEADLINES_CACHE_KEY, '{"at":"x","items":[]}');
    assert.equal(readHeadlineCache(), null);
  } finally {
    unstubStorage();
  }
});

test('fetchHeadlines resolves clean items and rejects on trouble', async () => {
  const okFetch = (async () => ({
    ok: true,
    json: async () => ({ hits: [{ title: 'Wire up', url: 'https://example.com', points: 9 }] }),
  })) as unknown as typeof fetch;
  const items = await fetchHeadlines(okFetch, 1000);
  assert.equal(items[0].title, 'Wire up');

  const badFetch = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
  await assert.rejects(() => fetchHeadlines(badFetch, 1000), /wire answered 500/);

  const deadFetch = (async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch;
  await assert.rejects(() => fetchHeadlines(deadFetch, 1000), /offline/);
});

test('ageLabel bands', () => {
  assert.equal(ageLabel(1000, 30_000), 'just now');
  assert.equal(ageLabel(0, 5 * 60_000), '5m ago');
  assert.equal(ageLabel(0, 3 * 3600_000), '3h ago');
  assert.equal(ageLabel(0, 2 * 86400_000), '2d ago');
});

test('fallback wire is never empty', () => {
  assert.ok(FALLBACK_HEADLINES.length >= 3);
  for (const h of FALLBACK_HEADLINES) {
    assert.ok(h.title.length > 0);
    assert.ok(h.url.startsWith('http'));
  }
});
