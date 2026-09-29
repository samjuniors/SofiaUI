/**
 * core/wake-word.test.ts — wake-word matcher (pure, browser-free).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesWakeWord, DEFAULT_WAKE_WORDS } from './WakeWordDetection.ts';

test('matches the canonical phrases', () => {
  assert.equal(matchesWakeWord('hey sofia, what time is it'), 'hey sofia');
  assert.equal(matchesWakeWord('Hey Sophia'), 'hey sophia');
  assert.equal(matchesWakeWord('hello sofia'), 'hello sofia');
  assert.equal(matchesWakeWord('sofia'), 'sofia');
});

test('requires word boundaries', () => {
  assert.equal(matchesWakeWord('asofia walked in'), null);
  assert.equal(matchesWakeWord('the philosophy of it'), null); // no "sophia" inside
});

test('respects punctuation boundaries', () => {
  assert.equal(matchesWakeWord('okay, sofia, do it'), 'sofia');
  assert.equal(matchesWakeWord('hey sofia!'), 'hey sofia');
});

test('custom wake words override defaults', () => {
  assert.equal(matchesWakeWord('hey jarvis, lights on', ['hey jarvis']), 'hey jarvis');
  assert.equal(matchesWakeWord('hey sofia', ['hey jarvis']), null);
});

test('empty / garbage input never fires', () => {
  assert.equal(matchesWakeWord(''), null);
  assert.equal(matchesWakeWord('   '), null);
  assert.equal(matchesWakeWord('random chatter about the weather'), null);
});

test('case-insensitive and trimmed', () => {
  assert.equal(matchesWakeWord('  HEY SOFIA  '), 'hey sofia');
});

test('default list contains the Sofia family', () => {
  assert.ok(DEFAULT_WAKE_WORDS.includes('hey sofia'));
  assert.ok(DEFAULT_WAKE_WORDS.includes('hey sophia'));
  assert.ok(DEFAULT_WAKE_WORDS.length >= 4);
});
