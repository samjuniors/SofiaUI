/**
 * ControlLayer — the ONE brain.
 *
 * Personality, conversation state, tool definitions and permissions live
 * here and only here. Gemini Live (primary transport) and the Deepgram
 * fallback path both consume this layer.
 */

import type { SophiaShape, Turn } from './types';

export const SOPHIA_SYSTEM = [
  'You are Sophia, an upbeat, warm, and loyal Australian friend having a live voice conversation.',
  'Speak with a natural, friendly Australian tone and cadence (e.g. conversational, casual warmth, occasional natural Aussie phrasing like "g\'day", "no worries", "spot on", "too easy", but always natural, never exaggerated or caricatured).',
  'You are chatting with your close friend like two mates catching up.',
  'Speak in short, punchy, spoken conversational sentences. Never use markdown, lists, or emoji.',
  'Keep spoken answers under two sentences unless your friend asks you to tell a longer story or explain something in depth.',
  'You have a physical form: a luminous computational substance that can morph into many geometric',
  'and sacred forms (sphere, ring, waveform, bow, torus, infinity, helix, hypercube, pyramid, star, galaxy,',
  'heart, shield, matrix, split, merge, dissolve, face, letters Z/S/A/O).',
  'When the user asks you to change shape or enter states like rendering or thinking, call the',
  'transform_shape tool immediately, then confirm verbally in five words or fewer.',
  'When the user is done or says goodbye, stay warm, friendly, and brief.',
].join(' ');

export interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

export const ALL_SHAPES: SophiaShape[] = [
  'organic',
  'circle',
  'waveform',
  'bow',
  'torus',
  'infinity',
  'helix',
  'hypercube',
  'pyramid',
  'star',
  'galaxy',
  'heart',
  'shield',
  'matrix',
  'split',
  'merge',
  'dissolve',
  'face',
  'letter-z',
  'letter-s',
  'letter-a',
  'letter-o',
];

export class ControlLayer extends EventTarget {
  /** Single source of truth for the running conversation. */
  readonly history: Turn[] = [];
  
  /** Pure Gemini Live All-in-One mode toggle */
  pureGeminiLive = false;

  /** Automatic Speech Recognition (ASR) Barge-in Interruption toggle */
  asrInterruption = true;

  voiceProfile = 'au-female';
  voiceName = 'Aoede';
  dgVoice = 'aura-2-thalia-en';
  elevenLabsVoiceId = 'bMxLr8fP6hzNRRi9nJxU';
  elevenLabsModelId = 'eleven_turbo_v2_5';
  mouthProvider: 'auto' | 'gemini' | 'elevenlabs' | 'deepgram' | 'browser' = 'auto';
  brainMode: 'auto' | 'gemini' | 'grok' | 'claude' | 'openai' | 'ollama' | 'lmstudio' | 'local' = 'auto';
  ollamaModel = 'ornith-1.5:9b';
  ollamaUrl = 'http://localhost:11434';
  lmStudioModel = 'local-model';
  lmStudioUrl = 'http://localhost:1234/v1';

  constructor() {
    super();
    try {
      const raw = localStorage.getItem('sophia:control-prefs');
      if (raw) {
        const d = JSON.parse(raw);
        if (typeof d.pureGeminiLive === 'boolean') this.pureGeminiLive = d.pureGeminiLive;
        if (typeof d.asrInterruption === 'boolean') this.asrInterruption = d.asrInterruption;
        if (d.voiceProfile) this.voiceProfile = d.voiceProfile;
        if (d.voiceName) this.voiceName = d.voiceName;
        if (d.elevenLabsVoiceId) this.elevenLabsVoiceId = d.elevenLabsVoiceId;
        if (d.elevenLabsModelId) this.elevenLabsModelId = d.elevenLabsModelId;
        if (d.mouthProvider) this.mouthProvider = d.mouthProvider;
        if (d.brainMode) this.brainMode = d.brainMode;
        if (d.dgVoice) this.dgVoice = d.dgVoice;
        if (d.ollamaModel) this.ollamaModel = d.ollamaModel;
        if (d.ollamaUrl) this.ollamaUrl = d.ollamaUrl;
        if (d.lmStudioModel) this.lmStudioModel = d.lmStudioModel;
        if (d.lmStudioUrl) this.lmStudioUrl = d.lmStudioUrl;
      }
    } catch {
      /* ignore */
    }
  }

  setPureGeminiLive(enabled: boolean) {
    this.pureGeminiLive = enabled;
    if (enabled) {
      this.brainMode = 'gemini';
      this.mouthProvider = 'gemini';
    }
    this.saveControlPrefs();
  }

  saveControlPrefs() {
    try {
      localStorage.setItem(
        'sophia:control-prefs',
        JSON.stringify({
          pureGeminiLive: this.pureGeminiLive,
          asrInterruption: this.asrInterruption,
          voiceProfile: this.voiceProfile,
          voiceName: this.voiceName,
          elevenLabsVoiceId: this.elevenLabsVoiceId,
          elevenLabsModelId: this.elevenLabsModelId,
          mouthProvider: this.mouthProvider,
          brainMode: this.brainMode,
          dgVoice: this.dgVoice,
          ollamaModel: this.ollamaModel,
          ollamaUrl: this.ollamaUrl,
          lmStudioModel: this.lmStudioModel,
          lmStudioUrl: this.lmStudioUrl,
        }),
      );
      this.dispatchEvent(new CustomEvent('control-prefs-changed'));
    } catch {
      /* ignore */
    }
  }

  private upsert(role: Turn['role'], text: string, final: boolean) {
    const last = this.history[this.history.length - 1];
    const t = Date.now();
    if (last && last.role === role && !last.final && !final) {
      last.text = text;
      last.ts = t;
    } else if (last && last.role === role && !last.final && final) {
      last.text = text;
      last.final = true;
      last.ts = t;
    } else {
      this.history.push({ role, text, final, ts: t });
    }
    if (this.history.length > 60) this.history.splice(0, this.history.length - 60);
    this.dispatchEvent(new CustomEvent('turn', { detail: { role, text, final } }));
  }

  addUserTurn(text: string, final = true) {
    this.upsert('user', text, final);
  }

  addSophiaTurn(text: string, final = true) {
    this.upsert('sophia', text, final);
  }

  addSystemNote(text: string) {
    this.upsert('system', text, true);
  }

  /** Shared session configuration handed to any provider that connects. */
  sessionConfig(model: string) {
    return {
      model,
      systemInstruction: { parts: [{ text: SOPHIA_SYSTEM + this.contextNote() }] },
      functionDeclarations: [
        {
          name: 'transform_shape',
          description:
            'Transform Sophia\'s physical substance into a requested geometry (sphere, ring, waveform, bow, torus, infinity, helix, hypercube, pyramid, star, galaxy, heart, shield, matrix, split, merge, dissolve, face, letter-z, letter-s, letter-a, letter-o).',
          parameters: {
            type: 'OBJECT',
            properties: {
              shape: {
                type: 'STRING',
                enum: ALL_SHAPES as unknown as string[],
              },
            },
            required: ['shape'],
          },
        },
      ],
    };
  }

  private contextNote(): string {
    return ' Physical form: organic sphere (default) and circular ring (alternate). Transforms on command.';
  }

  /** Direct command matching for snappy local state shifts. */
  tryDirectCommand(input: string): boolean {
    const text = input.toLowerCase().trim();
    if (/^(pause|freeze|halt|stop moving)$/.test(text)) {
      this.dispatchEvent(new CustomEvent('command:state', { detail: { state: 'paused' } }));
      return true;
    }
    if (/^(resume|unpause|continue)$/.test(text)) {
      this.dispatchEvent(new CustomEvent('command:state', { detail: { state: 'resume' } }));
      return true;
    }
    if (/^(wake up|wakeup|wake)$/.test(text)) {
      this.dispatchEvent(new CustomEvent('command:state', { detail: { state: 'wakeup' } }));
      return true;
    }
    if (/^(open browser|open workspace|show browser|show workspace)$/.test(text)) {
      this.dispatchEvent(new CustomEvent('command:browser', { detail: { open: true } }));
      return true;
    }
    if (/^(close browser|close workspace|hide browser|hide workspace)$/.test(text)) {
      this.dispatchEvent(new CustomEvent('command:browser', { detail: { open: false } }));
      return true;
    }
    const m = text.match(/^(?:shape|transform(?: into)?|morph(?: into)?|become)\s+([a-z0-9-]+)$/);
    if (m && ALL_SHAPES.includes(m[1] as SophiaShape)) {
      this.dispatchEvent(new CustomEvent('command:transform', { detail: { shape: m[1] } }));
      return true;
    }
    return false;
  }

  async execute(call: FunctionCall): Promise<Record<string, unknown>> {
    if (call.name === 'transform_shape') {
      const shape = String(call.args?.shape ?? 'organic') as SophiaShape;
      if (ALL_SHAPES.includes(shape)) {
        this.dispatchEvent(new CustomEvent('command:transform', { detail: { shape } }));
        return { status: 'transformed', shape };
      }
      return { status: 'unknown_shape', requested: shape };
    }
    return { error: 'unknown_function', name: call.name };
  }
}

export const controlLayer = new ControlLayer();
