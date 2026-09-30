import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOUD_FAILURE_TRIP,
  CLOUD_RECOVERY_SUCCESSES,
  RUN_MODE_KEY,
  RunModeStore,
  memoryStorage,
} from './run-mode.ts';

test('defaults to auto with cloud allowed', () => {
  const s = new RunModeStore(memoryStorage());
  assert.equal(s.getMode(), 'auto');
  assert.equal(s.offline, false);
  assert.equal(s.cloudAllowed, true);
  assert.equal(s.autoTripped, false);
});

test('persists the mode and reloads it', () => {
  const storage = memoryStorage();
  const a = new RunModeStore(storage);
  a.setMode('offline');
  assert.equal(storage.getItem(RUN_MODE_KEY), 'offline');
  const b = new RunModeStore(storage);
  assert.equal(b.getMode(), 'offline');
  assert.equal(b.offline, true);
  assert.equal(b.cloudAllowed, false);
});

test('ignores corrupt persisted values', () => {
  const storage = memoryStorage();
  storage.setItem(RUN_MODE_KEY, 'turbo');
  assert.equal(new RunModeStore(storage).getMode(), 'auto');
});

test('offline mode is sticky: failures and successes change nothing', () => {
  const s = new RunModeStore(memoryStorage());
  s.setMode('offline');
  s.reportCloudFailure();
  s.reportCloudFailure();
  s.reportCloudSuccess();
  assert.equal(s.offline, true);
  assert.equal(s.autoTripped, false);
});

test('cloud mode never trips offline', () => {
  const s = new RunModeStore(memoryStorage());
  s.setMode('cloud');
  for (let i = 0; i < CLOUD_FAILURE_TRIP + 2; i++) s.reportCloudFailure();
  assert.equal(s.offline, false);
});

test('auto trips offline after consecutive failures, not before', () => {
  const s = new RunModeStore(memoryStorage());
  s.reportCloudFailure();
  assert.equal(s.offline, false);
  assert.equal(s.autoTripped, false);
  s.reportCloudFailure();
  assert.equal(s.offline, true);
  assert.equal(s.autoTripped, true);
  assert.equal(s.cloudAllowed, false);
});

test('a success resets the failure count', () => {
  const s = new RunModeStore(memoryStorage());
  s.reportCloudFailure();
  s.reportCloudSuccess();
  s.reportCloudFailure();
  assert.equal(s.offline, false);
});

test('a tripped session recovers after a success streak', () => {
  const s = new RunModeStore(memoryStorage());
  s.reportCloudFailure();
  s.reportCloudFailure();
  assert.equal(s.autoTripped, true);
  for (let i = 0; i < CLOUD_RECOVERY_SUCCESSES - 1; i++) s.reportCloudSuccess();
  assert.equal(s.autoTripped, true);
  s.reportCloudSuccess();
  assert.equal(s.autoTripped, false);
  assert.equal(s.offline, false);
});

test('setMode clears the trip and notifies subscribers', () => {
  const s = new RunModeStore(memoryStorage());
  s.reportCloudFailure();
  s.reportCloudFailure();
  let calls = 0;
  const unsub = s.subscribe(() => {
    calls += 1;
  });
  s.setMode('auto');
  assert.equal(s.autoTripped, false);
  assert.equal(calls, 1);
  unsub();
  s.setMode('cloud');
  assert.equal(calls, 1);
});

test('trip and recovery notify subscribers', () => {
  const s = new RunModeStore(memoryStorage());
  let calls = 0;
  s.subscribe(() => {
    calls += 1;
  });
  s.reportCloudFailure();
  assert.equal(calls, 0);
  s.reportCloudFailure();
  assert.equal(calls, 1);
  for (let i = 0; i < CLOUD_RECOVERY_SUCCESSES; i++) s.reportCloudSuccess();
  assert.equal(calls, 2);
});
