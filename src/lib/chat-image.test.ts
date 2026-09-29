import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validChatImage,
  openAiImagePart,
  claudeImageBlock,
  geminiImagePart,
  MAX_IMAGE_CHARS,
} from './chat-image.ts';

const B64 = 'iVBORw0KGgo'.padEnd(200, 'A');

test('validChatImage accepts well-formed attachments', () => {
  assert.deepEqual(validChatImage({ data: B64, mimeType: 'image/png' }), {
    data: B64,
    mimeType: 'image/png',
  });
  assert.equal(validChatImage({ data: B64, mimeType: 'image/jpeg' })?.mimeType, 'image/jpeg');
});

test('validChatImage rejects absent/malformed/absurd input, defaults mime', () => {
  assert.equal(validChatImage(undefined), null);
  assert.equal(validChatImage(null), null);
  assert.equal(validChatImage('nope'), null);
  assert.equal(validChatImage({}), null);
  assert.equal(validChatImage({ data: 'short', mimeType: 'image/png' }), null);
  assert.equal(validChatImage({ data: 'x'.repeat(200), mimeType: 'image/png' })?.mimeType, 'image/png');
  assert.equal(validChatImage({ data: '!!!'.padEnd(200, '!'), mimeType: 'image/png' }), null);
  assert.equal(validChatImage({ data: B64, mimeType: 'image/bmp' })?.mimeType, 'image/png');
  assert.equal(validChatImage({ data: B64 })?.mimeType, 'image/png');
  assert.equal(validChatImage({ data: 'A'.repeat(MAX_IMAGE_CHARS + 1), mimeType: 'image/png' }), null);
});

test('vendor part builders shape the same pixels per API', () => {
  const img = { data: B64, mimeType: 'image/png' };
  const oai = openAiImagePart(img);
  assert.equal(oai.type, 'image_url');
  assert.ok(oai.image_url.url.startsWith('data:image/png;base64,iVBORw0KGgo'));
  const cl = claudeImageBlock(img);
  assert.deepEqual(cl, {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: B64 },
  });
  assert.deepEqual(geminiImagePart(img), {
    inlineData: { mimeType: 'image/png', data: B64 },
  });
});
