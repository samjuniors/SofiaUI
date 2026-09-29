/**
 * lib/wav.test.ts — browser-side WAV codec (pure, DOM-free).
 * Run via: node --experimental-strip-types --test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWav, wavToPcm16Mono, pcm16ToWav, bytesToBase64, base64ToBytes } from './wav.ts';

test('pcm16ToWav → parseWav round-trip', () => {
  const pcm = new Uint8Array(200);
  for (let i = 0; i < 100; i++) {
    const v = (i * 600) % 32000 - 16000;
    pcm[i * 2] = v & 0xff;
    pcm[i * 2 + 1] = (v >> 8) & 0xff;
  }
  const wav = pcm16ToWav(pcm, 16000);
  const w = parseWav(wav);
  assert.equal(w.sampleRate, 16000);
  assert.equal(w.channels, 1);
  assert.equal(w.bitsPerSample, 16);
  assert.equal(w.dataLength, 200);
  assert.deepEqual(Array.from(wavToPcm16Mono(wav).pcm), Array.from(pcm));
});

test('wavToPcm16Mono downmixes stereo to mono', () => {
  const stereo = new Uint8Array(8);
  const put = (o: number, v: number) => { stereo[o] = v & 0xff; stereo[o + 1] = (v >> 8) & 0xff; };
  put(0, 100); put(2, 300); put(4, -100 & 0xffff); put(6, -300 & 0xffff);
  const { pcm } = wavToPcm16Mono(stereoWav(stereo, 16000));
  assert.equal(pcm.length, 4);
  const i16 = (o: number) => { const v = pcm[o] | (pcm[o + 1] << 8); return v >= 0x8000 ? v - 0x10000 : v; };
  assert.equal(i16(0), 200);
  assert.equal(i16(2), -200);
});

function stereoWav(data: Uint8Array, rate: number): Uint8Array {
  const h = new Uint8Array(44);
  const wr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) h[o + i] = s.charCodeAt(i); };
  const u32 = (o: number, v: number) => { h[o] = v & 0xff; h[o + 1] = (v >> 8) & 0xff; h[o + 2] = (v >> 16) & 0xff; h[o + 3] = (v >>> 24) & 0xff; };
  const u16 = (o: number, v: number) => { h[o] = v & 0xff; h[o + 1] = (v >> 8) & 0xff; };
  wr(0, 'RIFF'); u32(4, 36 + data.length); wr(8, 'WAVE');
  wr(12, 'fmt '); u32(16, 16); u16(20, 1); u16(22, 2);
  u32(24, rate); u32(28, rate * 4); u16(32, 4); u16(34, 16);
  wr(36, 'data'); u32(40, data.length);
  const out = new Uint8Array(44 + data.length);
  out.set(h); out.set(data, 44);
  return out;
}

test('parseWav rejects non-WAV input', () => {
  assert.throws(() => parseWav(new TextEncoder().encode('this is not a wav file at all')), /Not a WAV/);
  assert.throws(() => parseWav(new Uint8Array([1, 2, 3, 4])), /Not a WAV/);
});

test('base64 round-trip survives the chunked encoder', () => {
  const bytes = new Uint8Array(70000); // > 0x8000 chunk boundary
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) & 0xff;
  assert.deepEqual(Array.from(base64ToBytes(bytesToBase64(bytes))), Array.from(bytes));
});
