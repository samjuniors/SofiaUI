import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ollamaEmbed } from './ollama-embed.ts';

function fakeFetch(handler: (url: string, init: RequestInit) => unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const out = handler(url, init);
    if (out instanceof Error) throw out;
    return out;
  }) as unknown as typeof fetch;
  return { calls, fn };
}

const okRes = (embeddings: unknown) =>
  ({ ok: true, json: async () => ({ embeddings }) }) as unknown as Response;

test('posts inputs and validates the embedding matrix', async () => {
  const { calls, fn } = fakeFetch(() => okRes([[0.1, 0.2]]));
  const r = await ollamaEmbed([' hello '], { baseUrl: 'http://localhost:11434/', fetchFn: fn });
  assert.deepEqual(r, [[0.1, 0.2]]);
  assert.equal(calls[0].url, 'http://localhost:11434/api/embeddings');
  const body = JSON.parse(String(calls[0].init.body));
  assert.deepEqual(body, { model: 'nomic-embed-text', input: ['hello'] });
});

test('clips texts and characters without calling on empties', async () => {
  const { calls, fn } = fakeFetch(() => okRes([[1]]));
  assert.equal(await ollamaEmbed(['   ', ''], { baseUrl: 'http://x', fetchFn: fn }), null);
  assert.equal(calls.length, 0);
  const big = 'a'.repeat(5000);
  await ollamaEmbed([big], { baseUrl: 'http://x', fetchFn: fn });
  assert.equal(JSON.parse(String(calls[0].init.body)).input[0].length, 2000);
});

test('any failure degrades to null', async () => {
  const { fn: err } = fakeFetch(() => new Error('down'));
  assert.equal(await ollamaEmbed(['a'], { baseUrl: 'http://x', fetchFn: err }), null);
  const { fn: bad } = fakeFetch(() => ({ ok: false }) as unknown as Response);
  assert.equal(await ollamaEmbed(['a'], { baseUrl: 'http://x', fetchFn: bad }), null);
  const { fn: malformed } = fakeFetch(() => okRes([[1, NaN]]));
  assert.equal(await ollamaEmbed(['a'], { baseUrl: 'http://x', fetchFn: malformed }), null);
  const { fn: short } = fakeFetch(() => okRes([[1]]));
  assert.equal(await ollamaEmbed(['a', 'b'], { baseUrl: 'http://x', fetchFn: short }), null);
});
