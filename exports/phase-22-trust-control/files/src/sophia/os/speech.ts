/**
 * sophia/os/speech.ts — neural TTS playback + mic/voice self-tests.
 * Extracted verbatim from SophiaOS (Phase 22 split). Runs against an
 * explicit context (audio engine, state machine, log sink) instead of
 * class privates, so the same code serves the OS and any future caller.
 */

import type { AudioEngine } from '../audio/AudioEngine';
import { controlLayer } from '../control';
import { sophiaFetch } from '../../lib/sophia-fetch.ts';
import type { SophiaState } from '../SophiaState';

export interface SpeechContext {
  audio: AudioEngine;
  state: SophiaState;
  pushLog: (level: 'info' | 'event' | 'cmd' | 'error', text: string) => void;
  /** Fallback voice when the neural mouth is unreachable. */
  speakFallback: (text: string) => Promise<void>;
}

/** Speak one string through the neural mouth (server TTS → playback). */
export async function speakText(ctx: SpeechContext, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  await ctx.audio.unlockAudio();

  try {
    const res = await sophiaFetch('/api/sophia/mouth/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: trimmed,
        provider: controlLayer.pureGeminiLive ? 'gemini' : controlLayer.mouthProvider,
        voice: controlLayer.voiceName,
        voiceId: controlLayer.elevenLabsVoiceId,
      }),
    });

    if (!res.ok) {
      throw new Error(`mouth-speak:${res.status}`);
    }

    const buf = await res.arrayBuffer();
    await ctx.audio.playEncoded(buf);
  } catch (err) {
    console.warn('[SophiaOS] Neural TTS speak fallback note:', err);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(trimmed);
        u.onend = () => resolve();
        u.onerror = () => resolve();
        window.speechSynthesis.speak(u);
      });
    }
  }
}

/** Sample the mic for ~1.2s and report the peak level (0 when denied). */
export async function testMic(ctx: SpeechContext): Promise<number> {
  ctx.pushLog('info', 'Testing microphone input…');
  try {
    await ctx.audio.startCapture();
    return new Promise((resolve) => {
      let maxLvl = 0;
      const unsub = ctx.audio.onMicLevel((l) => {
        if (l > maxLvl) maxLvl = l;
      });
      setTimeout(() => {
        unsub();
        ctx.pushLog('event', `Microphone test complete: peak level ${(maxLvl * 100).toFixed(1)}%`);
        resolve(maxLvl);
      }, 1200);
    });
  } catch (err: unknown) {
    ctx.pushLog('error', `Microphone test failed: ${(err as Error).message}`);
    return 0;
  }
}

/** Play one sample line in the currently selected voice. */
export async function testVoice(ctx: SpeechContext): Promise<void> {
  const voice = controlLayer.voiceName || 'Aoede';
  const provider = controlLayer.pureGeminiLive ? 'gemini' : controlLayer.mouthProvider;
  const voiceId = controlLayer.elevenLabsVoiceId;
  ctx.pushLog('info', `Testing voice: ${voice} via ${provider}…`);
  await ctx.audio.unlockAudio();
  try {
    const res = await sophiaFetch('/api/sophia/test-voice', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voice, provider, voiceId }),
    });
    if (!res.ok) throw new Error(`test-voice:${res.status}`);
    const buf = await res.arrayBuffer();
    ctx.state.transition('speaking', { source: 'test' }, true);
    await ctx.audio.playEncoded(buf);
    ctx.state.transition('ambient', { source: 'test' }, true);
    ctx.pushLog('event', 'Voice test playback complete.');
  } catch (err: unknown) {
    ctx.pushLog('error', `Voice test error: ${(err as Error).message}`);
    await ctx.speakFallback("G'day! Sofia voice test complete.");
  }
}
