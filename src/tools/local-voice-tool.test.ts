/**
 * tools/local-voice-tool.test.ts — the airplane tool against a fake backend.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_VOICE_SCHEMA, LocalVoiceTool, type LocalVoiceBackend } from './local-voice-tool.ts';

function backend(over: Partial<LocalVoiceBackend> = {}): LocalVoiceBackend {
  let on = false;
  return {
    isEnabled: () => on,
    setEnabled: (v: boolean) => void (on = v),
    readiness: async () => ({ companion: true, tts: true, stt: false, brain: true, sttHint: 'no mic model' }),
    speakLocal: async (text: string) => ({ engine: 'test-tts', ms: text.length }),
    askLocal: async (text: string) => `echo:${text}`,
    loadMode: () => 'auto',
    serverStatus: async () => ({ gemini: true }),
    describeRoute: () => 'Gemini Live → Local voice',
    ...over,
  };
}

test('on/off toggles airplane mode', async () => {
  const tool = new LocalVoiceTool(backend());
  assert.deepEqual((await tool.invoke({ action: 'on' })).data, { action: 'on', airplane: true });
  assert.deepEqual((await tool.invoke({ action: 'off' })).data, { action: 'off', airplane: false });
});

test('readiness reports legs, mode and the resolved chain', async () => {
  const tool = new LocalVoiceTool(backend());
  const r = await tool.invoke({ action: 'readiness' });
  assert.equal(r.success, true);
  assert.deepEqual(r.data, {
    airplane: false,
    mode: 'auto',
    companion: true,
    tts: true,
    stt: false,
    brain: true,
    hints: ['no mic model'],
    chain: 'Gemini Live → Local voice',
  });
});

test('speak and ask validate text and cap length', async () => {
  const calls: string[] = [];
  const tool = new LocalVoiceTool(
    backend({
      speakLocal: async (text: string) => {
        calls.push(text);
        return { engine: 'e', ms: 1 };
      },
    }),
  );
  assert.deepEqual((await tool.invoke({ action: 'speak', text: '  hi  ' })).data, {
    action: 'speak',
    engine: 'e',
    ms: 1,
  });
  assert.deepEqual((await tool.invoke({ action: 'ask', text: 'q?' })).data, { action: 'ask', reply: 'echo:q?' });
  await tool.invoke({ action: 'speak', text: `x${'y'.repeat(600)}` });
  assert.equal(calls[1].length, 500);
  const missing = await tool.invoke({ action: 'speak', text: '   ' });
  assert.deepEqual([missing.success, missing.error], [false, 'missing_text']);
});

test('backend failures surface cleanly', async () => {
  const tool = new LocalVoiceTool(
    backend({
      readiness: async () => {
        throw new Error('daemon away');
      },
    }),
  );
  const r = await tool.invoke({ action: 'readiness' });
  assert.deepEqual([r.success, r.error, r.errorDetail], [false, 'local_voice_failed', 'daemon away']);
});

test('unknown actions are rejected', async () => {
  const r = await new LocalVoiceTool(backend()).invoke({ action: 'fly' });
  assert.deepEqual([r.success, r.error], [false, 'invalid_action']);
});

test('schema declares the tool for the LLM', () => {
  assert.equal(LOCAL_VOICE_SCHEMA.name, 'local_voice');
  assert.deepEqual(LOCAL_VOICE_SCHEMA.parameters.required, ['action']);
  const props = LOCAL_VOICE_SCHEMA.parameters.properties as Record<string, { enum?: string[] }>;
  assert.deepEqual(props.action.enum, ['readiness', 'speak', 'ask', 'on', 'off']);
  assert.ok(props.text);
});
