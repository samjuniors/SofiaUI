import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CUSTOM_STT,
  loadSttSettings,
  normalizeBaseUrl,
  saveSttSettings,
  transcribeCustom,
} from './local-audio.ts';
import { memoryStorage } from './run-mode.ts';

test('normalizeBaseUrl trims slashes and validates scheme', () => {
  assert.equal(normalizeBaseUrl('http://127.0.0.1:8000/v1/'), 'http://127.0.0.1:8000/v1');
  assert.equal(
    normalizeBaseUrl('http://127.0.0.1:8000/v1/audio/transcriptions'),
    'http://127.0.0.1:8000/v1',
  );
  assert.throws(() => normalizeBaseUrl('notaurl'), /stt_bad_url/);
  assert.throws(() => normalizeBaseUrl(''), /stt_bad_url/);
  assert.throws(() => normalizeBaseUrl('ftp://x/y'), /stt_bad_url/);
});

test('settings default to the companion provider', () => {
  const s = loadSttSettings(memoryStorage());
  assert.equal(s.provider, 'companion');
  assert.deepEqual(s.custom, DEFAULT_CUSTOM_STT);
});

test('settings round-trip and survive corrupt data', () => {
  const storage = memoryStorage();
  saveSttSettings(
    { provider: 'custom', custom: { baseUrl: 'http://gpu:8000/v1', model: 'qwen3-omni' } },
    storage,
  );
  const s = loadSttSettings(storage);
  assert.equal(s.provider, 'custom');
  assert.equal(s.custom.model, 'qwen3-omni');
  storage.setItem('sophia:audio-stt:v1', '{oops');
  assert.equal(loadSttSettings(storage).provider, 'companion');
  storage.setItem('sophia:audio-stt:v1', JSON.stringify({ provider: 'qwen' }));
  assert.equal(loadSttSettings(storage).provider, 'companion');
});

function okFetch(seen: { url?: string; init?: RequestInit }) {
  return (async (url: string, init: RequestInit) => {
    seen.url = url;
    seen.init = init;
    return new Response(JSON.stringify({ text: '  hello world  ' }), { status: 200 });
  }) as typeof fetch;
}

test('transcribeCustom posts multipart audio and trims the transcript', async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  const text = await transcribeCustom('UklGRg==', { baseUrl: 'http://127.0.0.1:8000/v1/', model: 'm' }, okFetch(seen));
  assert.equal(text, 'hello world');
  assert.equal(seen.url, 'http://127.0.0.1:8000/v1/audio/transcriptions');
  assert.equal(seen.init?.method, 'POST');
  assert.ok(seen.init?.body instanceof FormData);
});

test('transcribeCustom sends the bearer token and default model', async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  await transcribeCustom(
    'UklGRg==',
    { baseUrl: 'https://x/v1', model: '', apiKey: 'sekret' },
    okFetch(seen),
  );
  const headers = seen.init?.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer sekret');
  const form = seen.init?.body as FormData;
  assert.equal(form.get('model'), 'whisper-1');
});

test('transcribeCustom maps network, http and empty failures', async () => {
  const down = (async () => {
    throw new Error('ECONNREFUSED');
  }) as typeof fetch;
  await assert.rejects(
    () => transcribeCustom('AA==', { baseUrl: 'http://127.0.0.1:9/v1', model: 'm' }, down),
    /stt_unreachable: .*AUDIO_MODELS\.md/,
  );
  const bad = (async () => new Response('nope', { status: 500 })) as typeof fetch;
  await assert.rejects(
    () => transcribeCustom('AA==', { baseUrl: 'http://h/v1', model: 'm' }, bad),
    /stt_http_500: .*nope/,
  );
  const empty = (async () => new Response(JSON.stringify({ text: '  ' }), { status: 200 })) as typeof fetch;
  await assert.rejects(
    () => transcribeCustom('AA==', { baseUrl: 'http://h/v1', model: 'm' }, empty),
    /stt_empty/,
  );
});
