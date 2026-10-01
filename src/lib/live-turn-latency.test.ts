import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveTurnLatency, LIVE_LATENCY_ALERT_MS } from './live-turn-latency.ts';

test('first model audio after input completes one sample per turn', () => {
  let t = 1000;
  const m = new LiveTurnLatency(() => t);
  m.noteAudioIn();
  t = 1400;
  assert.deepEqual(m.noteModelAudio(), { turn: 1, ms: 400 });
  t = 1500;
  assert.equal(m.noteModelAudio(), null, 'mid-turn chunks are not samples');
  m.noteTurnBoundary();
  t = 2000;
  m.noteAudioIn();
  t = 2100;
  assert.deepEqual(m.noteModelAudio(), { turn: 2, ms: 100 });
});

test('unprompted or stale speech yields no sample', () => {
  let t = 5000;
  const m = new LiveTurnLatency(() => t);
  assert.equal(m.noteModelAudio(), null, 'greeting with no input is not a turn');
  m.noteAudioIn();
  t += 31_000;
  m.noteTurnBoundary();
  assert.equal(m.noteModelAudio(), null, '30s-stale input cannot explain this audio');
});

test('alert budget is 1s', () => {
  assert.equal(LIVE_LATENCY_ALERT_MS, 1000);
});
