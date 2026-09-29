import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWav, wavToPcm16, pcm16ToWav, pickTtsEngine, ttsHint, sttHint, STT_BINARIES } from "./voice.mjs";

test("pcm16ToWav → parseWav round-trip", () => {
  const pcm = Buffer.alloc(200);
  for (let i = 0; i < 100; i++) pcm.writeInt16LE((i * 600) % 32000 - 16000, i * 2);
  const wav = pcm16ToWav(pcm, 16000);
  const w = parseWav(wav);
  assert.equal(w.sampleRate, 16000);
  assert.equal(w.channels, 1);
  assert.equal(w.bitsPerSample, 16);
  assert.equal(w.dataLength, 200);
});

test("wavToPcm16 extracts mono PCM untouched", () => {
  const pcm = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const { pcm: out, sampleRate } = wavToPcm16(pcm16ToWav(pcm, 22050));
  assert.equal(sampleRate, 22050);
  assert.deepEqual([...out], [...pcm]);
});

test("wavToPcm16 downmixes stereo to mono", () => {
  const stereo = Buffer.alloc(8);
  stereo.writeInt16LE(100, 0); stereo.writeInt16LE(300, 2);
  stereo.writeInt16LE(-100, 4); stereo.writeInt16LE(-300, 6);
  const { pcm } = wavToPcm16(stereoWav(stereo, 16000));
  assert.equal(pcm.length, 4);
  const v = Buffer.from(pcm);
  assert.equal(v.readInt16LE(0), 200);
  assert.equal(v.readInt16LE(2), -200);
});

function stereoWav(data, rate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

test("parseWav rejects non-WAV and malformed input", () => {
  assert.throws(() => parseWav(Buffer.from("hello world, this is not audio at all!")), /Not a WAV/);
  assert.throws(() => parseWav(Buffer.from("RIFF")), /Not a WAV/);
});

test("engine preference per platform with overrides", () => {
  assert.equal(pickTtsEngine("darwin"), "say");
  assert.equal(pickTtsEngine("win32"), "sapi");
  assert.equal(pickTtsEngine("linux"), "piper-or-espeak");
  assert.equal(pickTtsEngine("linux", { SOPHIA_TTS_ENGINE: "piper" }), "piper");
});

test("hints are actionable", () => {
  assert.match(ttsHint("linux"), /espeak-ng|Piper/);
  assert.match(ttsHint("darwin"), /say|Piper/);
  assert.match(sttHint(), /whisper|SOPHIA_STT_URL/i);
  assert.ok(STT_BINARIES.length >= 3);
});
