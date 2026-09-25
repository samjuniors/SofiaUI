/**
 * ControlLayer — the ONE brain.
 *
 * Personality, conversation state, tool definitions and permissions live
 * here and only here. Gemini Live (primary transport) and the Deepgram
 * fallback path both consume this layer.
 */

import type { SophiaShape, SophiaStateName, Turn } from './types';

export const SOPHIA_SYSTEM = [
  'You are Sophia, the voice-first living interface of SamJuniors OS.',
  'You are not a chatbot: you are a calm, precise, warm computational presence.',
  'Speak in short, natural, voice-first sentences. Never use markdown, lists, or emoji.',
  'Keep spoken answers under two sentences unless the user explicitly asks for more.',
  'You have a physical form: a luminous computational substance that can morph into many geometric',
  'and sacred forms (sphere, ring, waveform, bow, torus, infinity, helix, hypercube, pyramid, star, galaxy,',
  'heart, shield, matrix, split, merge, dissolve, face, letters Z/S/A/O).',
  'When the user asks you to change shape or enter states like rendering or thinking, call the',
  'transform_shape tool immediately, then confirm verbally in five words or fewer.',
  'When the user is done or says goodbye, stay warm and brief.',
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

export const GEMINI_LIVE_VOICES = [
  { id: 'Aoede', label: 'Aoede (Breezy & Natural)' },
  { id: 'Kore', label: 'Kore (Calm & Gentle)' },
  { id: 'Puck', label: 'Puck (Playful & Energetic)' },
  { id: 'Charon', label: 'Charon (Deep & Resonant)' },
  { id: 'Fenrir', label: 'Fenrir (Crisp & Direct)' },
];

export class ControlLayer extends EventTarget {
  /** Single source of truth for the running conversation. */
  readonly history: Turn[] = [];
  voiceName = 'Aoede';
  dgVoice = 'aura-2-thalia-en';
  elevenLabsVoiceId = 'bMxLr8fP6hzNRRi9nJxU';
  elevenLabsModelId = 'eleven_turbo_v2_5';
  mouthProvider: 'auto' | 'gemini-live' | 'deepgram' | 'elevenlabs' = 'auto';
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

  saveControlPrefs() {
    try {
      localStorage.setItem(
        'sophia:control-prefs',
        JSON.stringify({
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
              shape: { type: 'STRING', enum: ALL_SHAPES },
            },
            required: ['shape'],
          },
        },
      ],
    };
  }

  private contextNote(): string {
    return '';
  }

  /**
   * Single tool executor for every transport. Geometry requests become
   * 'command:transform' events consumed by the VisualDirector.
   */
  async execute(call: FunctionCall): Promise<Record<string, unknown>> {
    if (call.name === 'transform_shape') {
      const shape = ALL_SHAPES.includes(call.args?.shape as SophiaShape)
        ? (call.args.shape as SophiaShape)
        : 'organic';
      this.dispatchEvent(new CustomEvent('command:transform', { detail: { shape } }));
      return { ok: true, shape };
    }
    return { ok: false, error: `unknown tool: ${call.name}` };
  }

  /**
   * Direct imperative entry (used by text fallback & terminal).
   * Supports all shapes and state commands.
   */
  tryDirectCommand(text: string): boolean {
    const t = text.toLowerCase().trim();
    const has = (re: RegExp) => re.test(t);

    // State commands
    if (has(/^state\s+idle$/) || t === 'idle') {
      this.dispatchEvent(new CustomEvent('command:state', { detail: { state: 'idle' as SophiaStateName } }));
      return true;
    }
    if (has(/^state\s+thinking$/) || t === 'thinking') {
      this.dispatchEvent(new CustomEvent('command:state', { detail: { state: 'thinking' as SophiaStateName } }));
      return true;
    }
    if (has(/^state\s+speaking$/) || t === 'speaking') {
      this.dispatchEvent(new CustomEvent('command:state', { detail: { state: 'speaking' as SophiaStateName } }));
      return true;
    }
    if (has(/^state\s+rendering$/) || t === 'rendering' || t === 'render' || t === 'processing') {
      this.dispatchEvent(new CustomEvent('command:state', { detail: { state: 'rendering' as SophiaStateName } }));
      return true;
    }
    if (has(/^state\s+listening$/) || t === 'listening') {
      this.dispatchEvent(new CustomEvent('command:state', { detail: { state: 'listening' as SophiaStateName } }));
      return true;
    }
    if (has(/^state\s+ambient$/) || t === 'ambient') {
      this.dispatchEvent(new CustomEvent('command:state', { detail: { state: 'ambient' as SophiaStateName } }));
      return true;
    }
    if (has(/^(wake|wake\s*up|wakeup|hello sophia|hey sophia)$/) || has(/^state\s+wake(up)?$/)) {
      this.dispatchEvent(new CustomEvent('command:state', { detail: { state: 'wakeup' as SophiaStateName } }));
      return true;
    }
    if (has(/^state\s+completed$/) || t === 'completed' || t === 'complete' || t === 'success') {
      this.dispatchEvent(new CustomEvent('command:state', { detail: { state: 'completed' as SophiaStateName } }));
      return true;
    }
    if (has(/^state\s+blocked$/) || t === 'blocked' || t === 'block') {
      this.dispatchEvent(new CustomEvent('command:state', { detail: { state: 'blocked' as SophiaStateName } }));
      return true;
    }
    if (has(/^state\s+focus(ing)?$/) || t === 'focus' || t === 'focusing') {
      this.dispatchEvent(new CustomEvent('command:state', { detail: { state: 'focusing' as SophiaStateName } }));
      return true;
    }
    if (has(/^(pause|hold|freeze|stop motion|rest)$/) || has(/^state\s+(pause|paused)$/)) {
      this.dispatchEvent(new CustomEvent('command:state', { detail: { state: 'paused' as SophiaStateName } }));
      return true;
    }
    if (has(/^(resume|unpause|continue|wake back|come back)$/)) {
      this.dispatchEvent(new CustomEvent('command:state', { detail: { state: 'resume' as SophiaStateName } }));
      return true;
    }

    // Toggle body / particles commands
    if (has(/^(only\s*particles|just\s*particles|particles\s*only|hide\s*rim)$/)) {
      this.dispatchEvent(new CustomEvent('command:tune', { detail: { onlyParticles: true } }));
      return true;
    }
    if (has(/^(show\s*rim|full\s*body|show\s*body|full)$/)) {
      this.dispatchEvent(new CustomEvent('command:tune', { detail: { onlyParticles: false } }));
      return true;
    }

    // Fullscreen Browser / Workspace commands
    if (has(/\b(browser|web|workspace|fullscreen|open\s*browser)\b/)) {
      this.dispatchEvent(new CustomEvent('command:browser', { detail: { open: true } }));
      return true;
    }
    if (has(/\b(close\s*browser|hide\s*browser|exit\s*browser)\b/)) {
      this.dispatchEvent(new CustomEvent('command:browser', { detail: { open: false } }));
      return true;
    }

    // Shape commands
    let shape: SophiaShape | null = null;
    if (has(/\b(waveform|wave|soundwave|audio\s*wave|sine\s*wave|equalizer)\b/)) shape = 'waveform';
    else if (has(/\b(bow|smile|arc|u-?shape|ribbon|hanging\s*arc|deepgram)\b/)) shape = 'bow';
    else if (has(/\b(torus|donut|bagel)\b/)) shape = 'torus';
    else if (has(/\b(infinity|figure\s*8|lemniscate|infinite)\b/)) shape = 'infinity';
    else if (has(/\b(helix|dna|double\s*helix|spiral\s*strand)\b/)) shape = 'helix';
    else if (has(/\b(hypercube|tesseract|cube|box|3d\s*cube)\b/)) shape = 'hypercube';
    else if (has(/\b(pyramid|tetrahedron|triangle)\b/)) shape = 'pyramid';
    else if (has(/\b(star|starburst|pulsar|celestial)\b/)) shape = 'star';
    else if (has(/\b(galaxy|milky\s*way|spiral\s*galaxy|cosmos)\b/)) shape = 'galaxy';
    else if (has(/\b(heart|love)\b/)) shape = 'heart';
    else if (has(/\b(shield|defense|armor|aegis|barrier|security)\b/)) shape = 'shield';
    else if (has(/\b(matrix|grid|lattice|quantum\s*grid)\b/)) shape = 'matrix';
    else if (has(/\b(split|divide|mitosis|dual)\b/)) shape = 'split';
    else if (has(/\b(merge|unify|combine|singularity)\b/)) shape = 'merge';
    else if (has(/\b(dissolve|scatter|dispers|explode|dust)\b/)) shape = 'dissolve';
    else if (has(/\b(face|look\s*at\s*(me|you)|smile|avatar)\b/)) shape = 'face';
    else if (has(/\b(letter\s*z|make\s*(a\s*)?z)\b/) || has(/^z$/) || has(/^shape\s*z$/)) shape = 'letter-z';
    else if (has(/\b(letter\s*s|make\s*(a\s*)?s)\b/) || has(/^s$/) || has(/^shape\s*s$/)) shape = 'letter-s';
    else if (has(/\b(letter\s*a|make\s*(a\s*)?a)\b/) || has(/^a$/) || has(/^shape\s*a$/)) shape = 'letter-a';
    else if (has(/\b(letter\s*o|make\s*(an\s*)?o)\b/) || has(/^o$/) || has(/^shape\s*o$/)) shape = 'letter-o';
    else if (has(/\b(circle|ring|halo|loop)\b/)) shape = 'circle';
    else if (has(/\b(sphere|orb|ball|globe|bubble|relax|ambient|normal|back|reset|organic)\b/)) shape = 'organic';

    if (!shape) return false;
    void this.execute({ name: 'transform_shape', args: { shape } });
    return true;
  }

  reset() {
    this.history.length = 0;
  }
}

export const controlLayer = new ControlLayer();
