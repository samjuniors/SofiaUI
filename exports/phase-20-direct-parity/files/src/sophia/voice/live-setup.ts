/**
 * sophia/voice/live-setup.ts — Phase 20: raw BidiGenerateContent setup builder.
 *
 * The direct-Google fallback path speaks the Live WebSocket protocol
 * without the SDK, so the setup message is built by hand here (pure and
 * unit-tested) instead of inline in the provider. Parity with the relay
 * path: sliding-window compression always on, resumption handle reused
 * when banked, empty resumption object on a fresh session.
 */

export interface LiveSetupInput {
  model: string;
  voice: string;
  systemInstruction: unknown;
  functionDeclarations: unknown[];
  handle?: string | null;
}

export function buildLiveSetup(input: LiveSetupInput): Record<string, unknown> {
  return {
    setup: {
      model: input.model,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: input.voice },
          },
        },
      },
      systemInstruction: input.systemInstruction,
      tools: [{ functionDeclarations: input.functionDeclarations }],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      realtimeInputConfig: {
        automaticActivityDetection: {
          startOfSpeechSensitivity: 'START_SENSITIVITY_BALANCED',
          endOfSpeechSensitivity: 'END_SENSITIVITY_BALANCED',
          prefixPaddingMs: 60,
          silenceDurationMs: 650,
        },
      },
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: input.handle ? { handle: input.handle } : {},
    },
  };
}

interface ResumeUpdateMessage {
  sessionResumptionUpdate?: {
    newHandle?: unknown;
    resumable?: unknown;
  };
}

/**
 * The bankable handle from a raw server message, or null. Only resumable
 * updates with a non-empty string handle count — resumable:false (mid
 * tool-call / mid-generation) must never overwrite a good handle.
 */
export function bankableResumeHandle(msg: ResumeUpdateMessage): string | null {
  const u = msg.sessionResumptionUpdate;
  if (!u || u.resumable === false) return null;
  return typeof u.newHandle === 'string' && u.newHandle ? u.newHandle : null;
}
