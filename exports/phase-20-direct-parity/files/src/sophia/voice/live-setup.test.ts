import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveSetup, bankableResumeHandle } from './live-setup.ts';

function setup(handle?: string | null) {
  return buildLiveSetup({
    model: 'm',
    voice: 'Aoede',
    systemInstruction: { parts: [{ text: 'hi' }] },
    functionDeclarations: [{ name: 'task' }],
    handle,
  }).setup as Record<string, unknown>;
}

test('setup carries the voice session config verbatim', () => {
  const s = setup();
  assert.equal(s.model, 'm');
  assert.deepEqual((s.generationConfig as { responseModalities: string[] }).responseModalities, ['AUDIO']);
  assert.deepEqual(s.tools, [{ functionDeclarations: [{ name: 'task' }] }]);
  assert.deepEqual(s.inputAudioTranscription, {});
  assert.deepEqual(s.outputAudioTranscription, {});
  const vad = (
    s.realtimeInputConfig as { automaticActivityDetection: Record<string, unknown> }
  ).automaticActivityDetection;
  assert.equal(vad.silenceDurationMs, 650);
});

test('setup always compresses; resumption reuses the banked handle', () => {
  assert.deepEqual(setup().contextWindowCompression, { slidingWindow: {} });
  assert.deepEqual(setup().sessionResumption, {});
  assert.deepEqual(setup(null).sessionResumption, {});
  assert.deepEqual(setup('h-1').sessionResumption, { handle: 'h-1' });
});

test('only resumable updates with a real handle are bankable', () => {
  assert.equal(bankableResumeHandle({ sessionResumptionUpdate: { newHandle: 'h', resumable: true } }), 'h');
  assert.equal(bankableResumeHandle({ sessionResumptionUpdate: { newHandle: 'h' } }), 'h');
  assert.equal(bankableResumeHandle({}), null);
  assert.equal(bankableResumeHandle({ sessionResumptionUpdate: { newHandle: 'h', resumable: false } }), null);
  assert.equal(bankableResumeHandle({ sessionResumptionUpdate: { newHandle: '', resumable: true } }), null);
  assert.equal(bankableResumeHandle({ sessionResumptionUpdate: { resumable: true } }), null);
});
