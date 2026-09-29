import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embedTexts, isEmbedding } from './embeddings.ts';

function fakeFetch(handler: () => unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const out = handler();
    if (out instanceof Error) throw out;
    return out;
  }) as unknown as typeof fetch;
  return { calls, fn };
}

const okRes = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

test('posts texts and returns validated vectors', async () => {
  const { calls, fn } = fakeFetch(() => okRes({ embeddings: [[0.5, -0.5]] }));
  const r = await embedTexts([' hello '], fn);
  assert.deepEqual(r, [[0.5, -0.5]]);
  assert.equal(calls[0].url, '/api/sophia/embed');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { texts: ['hello'] });
});

test('unavailable or malformed backends degrade to null', async () => {
  const { fn: err } = fakeFetch(() => new Error('down'));
  assert.equal(await embedTexts(['a'], err), null);
  const { fn: bad } = fakeFetch(() => ({ ok: false }) as unknown as Response);
  assert.equal(await embedTexts(['a'], bad), null);
  const { fn: malformed } = fakeFetch(() => okRes({ embeddings: [['x']] }));
  assert.equal(await embedTexts(['a'], malformed), null);
  const { fn: unused } = fakeFetch(() => okRes({}));
  assert.equal(await embedTexts(['  '], unused), null);
});

test('isEmbedding bounds dimensions and values', () => {
  assert.equal(isEmbedding([0.1, 0.2]), true);
  assert.equal(isEmbedding([]), false);
  assert.equal(isEmbedding([1, NaN]), false);
  assert.equal(isEmbedding('nope'), false);
  assert.equal(isEmbedding(new Array(5000).fill(0)), false);
});
