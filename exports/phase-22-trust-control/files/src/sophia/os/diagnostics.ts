/**
 * sophia/os/diagnostics.ts — read-only health snapshots for the UI.
 * Extracted verbatim from SophiaOS (Phase 22 split). Everything here is a
 * pure read over an explicit context — no timers, no providers started.
 */

import type { AudioEngine } from '../audio/AudioEngine';
import { controlLayer } from '../control';
import type { VisualDirector } from '../VisualDirector';
import type { GeminiLiveProvider, LiveConnectionMetrics } from '../voice/GeminiLiveProvider';
import type { VoiceProvider } from '../voice/VoiceProvider';
import type { VoiceProviderId } from '../types';
import type { OSStatus } from '../SophiaOS';
import type { Prefs } from './prefs';

export interface DiagnosticsSnapshot {
  mic: {
    status: AudioEngine['micStatus'];
    level: number;
    error: string | null;
  };
  live: {
    status: 'connected' | 'connecting' | 'idle' | 'error';
    provider: string;
    model: string;
    voice: string;
    packetsSent: number;
    packetsReceived: number;
  };
  brain: {
    mode: string;
    pureGemini: boolean;
  };
  mouth: {
    engine: string;
    level: number;
  };
  visuals: {
    fps: number;
    density: string;
    shape: string;
  };
}

const OFFLINE_METRICS: LiveConnectionMetrics = {
  isConnected: false,
  latencyMs: 0,
  stabilityPercent: 0,
  quality: 'offline',
  packetsSent: 0,
  packetsReceived: 0,
  modelName: 'gemini-3.8-live',
  voiceName: 'Aoede',
  history: [],
};

export function geminiLiveMetrics(providers: Record<VoiceProviderId, VoiceProvider>): LiveConnectionMetrics {
  const gemini = providers['gemini-live'] as GeminiLiveProvider | undefined;
  return gemini ? gemini.getMetrics() : { ...OFFLINE_METRICS, history: [] };
}

export function liveMetrics(providers: Record<VoiceProviderId, VoiceProvider>): LiveConnectionMetrics {
  const liveProvider = providers['gemini-live'] as GeminiLiveProvider;
  return liveProvider.getMetrics();
}

export function pingLiveProvider(providers: Record<VoiceProviderId, VoiceProvider>): Promise<number> {
  const liveProvider = providers['gemini-live'] as GeminiLiveProvider;
  return liveProvider.ping();
}

export function buildDiagnostics(ctx: {
  audio: AudioEngine;
  prefs: Prefs;
  status: OSStatus;
  providers: Record<VoiceProviderId, VoiceProvider>;
  director: VisualDirector;
  fps: number;
}): DiagnosticsSnapshot {
  const liveProvider = ctx.providers['gemini-live'] as GeminiLiveProvider;
  return {
    mic: {
      status: ctx.audio.micStatus,
      level: ctx.audio.micLevel,
      error: ctx.audio.micErrorDetails,
    },
    live: {
      status: liveProvider.isConnected ? 'connected' : ctx.status === 'connecting' ? 'connecting' : ctx.status === 'error' ? 'error' : 'idle',
      provider: 'Gemini Live (Native Audio)',
      model: liveProvider.stats.modelName,
      voice: controlLayer.voiceName,
      packetsSent: liveProvider.stats.packetsSent,
      packetsReceived: liveProvider.stats.packetsReceived,
    },
    brain: {
      mode: controlLayer.brainMode,
      pureGemini: controlLayer.pureGeminiLive,
    },
    mouth: {
      engine: controlLayer.pureGeminiLive ? 'gemini' : controlLayer.mouthProvider,
      level: ctx.audio.playbackLevel,
    },
    visuals: {
      fps: ctx.fps,
      density: ctx.prefs.density,
      shape: ctx.director.currentForm,
    },
  };
}
