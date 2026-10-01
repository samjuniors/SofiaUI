/**
 * tools/local-voice-tool.ts — voice + chat control over airplane mode.
 *
 * Actions: readiness (all legs + routing chain), speak (local TTS),
 * ask (local brain + spoken reply), on/off (airplane toggle). The real
 * backend loads lazily via dynamic import so this module stays
 * node-testable with an injected fake.
 */

import type {
  GeminiFunctionDeclaration,
  ITool,
  ToolResult,
} from './types.ts';
import type { Readiness } from '../lib/airplane-mode.ts';
import type { StatusLike, VoiceMode } from '../lib/voice-router.ts';

export type LocalVoiceAction = 'readiness' | 'speak' | 'ask' | 'on' | 'off';

const VALID_ACTIONS = new Set<string>(['readiness', 'speak', 'ask', 'on', 'off']);

/** The slice of airplane-mode + voice-router the tool drives. */
export interface LocalVoiceBackend {
  isEnabled: () => boolean;
  setEnabled: (on: boolean) => void;
  readiness: () => Promise<Readiness>;
  speakLocal: (text: string) => Promise<{ engine: string; ms: number }>;
  askLocal: (text: string) => Promise<string>;
  loadMode: () => VoiceMode;
  serverStatus: () => Promise<StatusLike | null>;
  describeRoute: (status: StatusLike | null, local: Readiness, mode: VoiceMode, airplane: boolean) => string;
}

async function loadRealBackend(): Promise<LocalVoiceBackend> {
  const [{ airplaneMode }, router] = await Promise.all([
    import('../lib/airplane-mode'),
    import('../lib/voice-router'),
  ]);
  return {
    isEnabled: () => airplaneMode.enabled,
    setEnabled: (on: boolean) => airplaneMode.setEnabled(on),
    readiness: () => airplaneMode.readiness(),
    speakLocal: (text: string) => airplaneMode.speakLocal(text),
    askLocal: (text: string) => airplaneMode.askLocal(text),
    loadMode: () => router.loadVoiceMode(),
    serverStatus: async () => {
      try {
        const res = await fetch('/api/sophia/status');
        return (await res.json()) as StatusLike;
      } catch {
        return null;
      }
    },
    describeRoute: (status, local, mode, airplane) =>
      router.describeChain(router.planRoutes(router.routeInputFrom(status, local, mode, airplane))),
  };
}

export class LocalVoiceTool implements ITool {
  readonly name = 'local_voice';
  readonly description =
    'Control airplane-mode local voice: check readiness of the companion/TTS/STT/brain legs, ' +
    'speak text with the on-device voice, ask the local brain a question out loud, ' +
    'or switch airplane mode on/off.';

  private injected: LocalVoiceBackend | null;
  private real: LocalVoiceBackend | null = null;

  constructor(backend: LocalVoiceBackend | null = null) {
    this.injected = backend;
  }

  private async backend(): Promise<LocalVoiceBackend> {
    if (this.injected) return this.injected;
    if (!this.real) this.real = await loadRealBackend();
    return this.real;
  }

  async invoke(args: Record<string, unknown>): Promise<ToolResult> {
    const action = String(args.action ?? '') as LocalVoiceAction;
    if (!VALID_ACTIONS.has(action)) {
      return { success: false, error: 'invalid_action', errorDetail: `Action "${action}" is not a local-voice action.` };
    }

    try {
      const be = await this.backend();

      if (action === 'on' || action === 'off') {
        be.setEnabled(action === 'on');
        return { success: true, data: { action, airplane: be.isEnabled() } };
      }

      if (action === 'readiness') {
        const [ready, status] = await Promise.all([be.readiness(), be.serverStatus()]);
        const mode = be.loadMode();
        const airplane = be.isEnabled();
        return {
          success: true,
          data: {
            airplane,
            mode,
            companion: ready.companion,
            tts: ready.tts,
            stt: ready.stt,
            brain: ready.brain,
            hints: [ready.ttsHint, ready.sttHint, ready.brainHint].filter(Boolean),
            chain: be.describeRoute(status, ready, mode, airplane),
          },
        };
      }

      const text = typeof args.text === 'string' ? args.text.trim() : '';
      if (!text) {
        return { success: false, error: 'missing_text', errorDetail: `The "${action}" action needs text.` };
      }
      if (action === 'speak') {
        const r = await be.speakLocal(text.slice(0, 500));
        return { success: true, data: { action, engine: r.engine, ms: r.ms } };
      }
      const reply = await be.askLocal(text.slice(0, 500));
      return { success: true, data: { action, reply } };
    } catch (err) {
      return {
        success: false,
        error: 'local_voice_failed',
        errorDetail: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

export const localVoiceTool = new LocalVoiceTool();

export const LOCAL_VOICE_SCHEMA: GeminiFunctionDeclaration = {
  name: 'local_voice',
  description:
    'Airplane-mode local voice: check leg readiness, speak text on-device, ' +
    'ask the local brain out loud, or toggle airplane mode.',
  parameters: {
    type: 'OBJECT',
    properties: {
      action: {
        type: 'STRING',
        enum: ['readiness', 'speak', 'ask', 'on', 'off'] as unknown as string[],
        description: 'The local-voice action to perform.',
      },
      text: {
        type: 'STRING',
        description: 'Text for speak/ask (spoken aloud through the local voice).',
      },
    },
    required: ['action'],
  },
};
