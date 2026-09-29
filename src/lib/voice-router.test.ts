/**
 * lib/voice-router.test.ts — cloud ↔ local fallback policy (pure core).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRoutes, pickPrimary, nextFallback, describeChain, routeInputFrom, type RouteInput } from './voice-router.ts';

const base: RouteInput = {
  mode: 'auto',
  airplane: false,
  hasGeminiKey: true,
  hasDeepgramKey: true,
  hasElevenlabsKey: false,
  companionConnected: true,
  localTts: true,
  localStt: true,
  localBrain: true,
};

const ids = (r: ReturnType<typeof planRoutes>) => r.map((l) => l.id);

test('auto with keys: cloud chain first, local follows (both directions)', () => {
  const r = planRoutes(base);
  assert.deepEqual(ids(r), ['gemini-live', 'deepgram', 'local', 'browser-tts']);
  assert.equal(pickPrimary(r).id, 'gemini-live');
});

test('auto without any keys: local leads the chain', () => {
  const r = planRoutes({ ...base, hasGeminiKey: false, hasDeepgramKey: false });
  assert.deepEqual(ids(r), ['local', 'browser-tts']);
  assert.equal(pickPrimary(r).id, 'local');
});

test('airplane mode never reaches the cloud', () => {
  const r = planRoutes({ ...base, airplane: true });
  assert.deepEqual(ids(r), ['local', 'browser-tts']);
  assert.equal(pickPrimary(r).id, 'local');
});

test('explicit local mode ignores keys', () => {
  const r = planRoutes({ ...base, mode: 'local' });
  assert.deepEqual(ids(r), ['local', 'browser-tts']);
});

test('explicit cloud mode keeps browser TTS as last resort only', () => {
  const r = planRoutes({ ...base, mode: 'cloud' });
  assert.deepEqual(ids(r), ['gemini-live', 'deepgram', 'browser-tts']);
});

test('fallback walks the chain after a failure', () => {
  const r = planRoutes(base);
  assert.equal(nextFallback(r, 'gemini-live')?.id, 'deepgram');
  assert.equal(nextFallback(r, 'deepgram')?.id, 'local');
  assert.equal(nextFallback(r, 'local')?.id, 'browser-tts');
  assert.equal(nextFallback(r, 'browser-tts'), null);
  assert.equal(nextFallback(r, 'elevenlabs'), null); // not in chain
});

test('local leg reports partial capabilities honestly', () => {
  const r = planRoutes({ ...base, localStt: false, localBrain: true, localTts: true });
  const local = r.find((l) => l.id === 'local');
  assert.ok(local);
  assert.equal(local.full, false);
  assert.deepEqual(local.caps, { stt: false, brain: true, tts: true });
  // primary falls back to first fully-capable leg
  assert.equal(pickPrimary(r).id, 'gemini-live');
});

test('companion disconnected: local leg absent, chain still non-empty', () => {
  const r = planRoutes({ ...base, companionConnected: false, hasGeminiKey: false, hasDeepgramKey: false });
  assert.deepEqual(ids(r), ['browser-tts']);
  assert.equal(pickPrimary(r).id, 'browser-tts');
});

test('describeChain renders a readable order', () => {
  assert.equal(describeChain(planRoutes(base)), 'Gemini Live → Deepgram voice → Local (on-device) → Browser voice');
  assert.equal(describeChain([]), 'No voice path available');
});

test('routeInputFrom maps live status + readiness', () => {
  const input = routeInputFrom(
    { gemini: true, deepgram: false, elevenlabs: false },
    { companion: true, tts: true, stt: false, brain: true },
    'auto',
    false,
  );
  assert.deepEqual(input, {
    mode: 'auto',
    airplane: false,
    hasGeminiKey: true,
    hasDeepgramKey: false,
    hasElevenlabsKey: false,
    companionConnected: true,
    localTts: true,
    localStt: false,
    localBrain: true,
  });
  // null inputs stay safely false
  const empty = routeInputFrom(null, null, 'local', true);
  assert.equal(empty.hasGeminiKey, false);
  assert.equal(empty.companionConnected, false);
  assert.equal(empty.airplane, true);
});
