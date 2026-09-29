/**
 * lib/grounding.test.ts — OCR grounding client with a fake transport.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GroundingError,
  TESSERACT_SETUP_HINT,
  groundScan,
  groundText,
  isTesseractError,
} from './grounding.ts';
import type { GroundingCaller } from './grounding.ts';

function fake(result: unknown = {}) {
  const calls: Array<{ action: string; args: Record<string, unknown> }> = [];
  const caller: GroundingCaller = async (action, args = {}) => {
    calls.push({ action, args });
    return { ok: true, result };
  };
  return { calls, caller };
}

function failing(error: string, detail = ''): GroundingCaller {
  return async () => ({ ok: false, error, detail });
}

test('groundText shapes hits and misses', async () => {
  const { calls, caller } = fake({
    found: true,
    text: 'save',
    x: 100,
    y: 200,
    box: { x: 90, y: 195, w: 40, h: 14 },
  });
  const hit = await groundText(caller, '  Save ');
  assert.equal(calls[0].args.text, 'Save');
  assert.deepEqual(hit, {
    found: true,
    text: 'save',
    x: 100,
    y: 200,
    box: { x: 90, y: 195, w: 40, h: 14 },
  });
  const miss = await groundText(fake({ found: false, text: 'x', hint: 'nope' }).caller, 'x');
  assert.deepEqual(miss, { found: false, text: 'x', hint: 'nope' });
  const bare = await groundText(fake({}).caller, 'x');
  assert.equal(bare.found, false);
  await assert.rejects(() => groundText(caller, '   '), /text to find/);
});

test('groundScan filters junk words', async () => {
  const r = await groundScan(
    fake({ count: 3, words: [{ text: 'File', x: 1, y: 2, w: 3, h: 4 }, { nope: 1 }, null, { text: ' ' }] }).caller,
  );
  assert.equal(r.count, 3);
  assert.deepEqual(r.words, [{ text: 'File', x: 1, y: 2, w: 3, h: 4 }]);
  assert.deepEqual((await groundScan(fake({}).caller)).words, []);
});

test('tesseract absence is recognised as a setup state', async () => {
  const err = await groundText(
    failing('action_failed', 'OCR grounding needs tesseract. Install it.'),
    'save',
  ).then(
    () => assert.fail('should have thrown'),
    (e: unknown) => e,
  );
  assert.ok(err instanceof GroundingError);
  assert.equal(isTesseractError(err), true);
  assert.equal(isTesseractError(new GroundingError('action_failed', 'screenshot failed')), false);
  assert.ok(TESSERACT_SETUP_HINT.includes('tesseract'));
});

test('transport failures surface as GroundingError', async () => {
  const boom: GroundingCaller = async () => {
    throw new Error('socket died');
  };
  await assert.rejects(() => groundScan(boom), /Could not reach/);
});
