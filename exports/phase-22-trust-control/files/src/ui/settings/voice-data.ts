/**
 * settings/voice-data.ts — voice/brain option tables for the settings sheet.
 * Extracted verbatim from SettingsSheet (Phase 22 split).
 */

export interface TTSVoiceProfile {
  id: string;
  name: string;
  accent: string;
  gender: 'Female' | 'Male';
  geminiVoice: string;
  elevenLabsVoiceId: string;
  dgVoice: string;
  description: string;
}

export const TTS_VOICE_PROFILES: TTSVoiceProfile[] = [
  {
    id: 'au-female',
    name: 'Australian Female (Aoede / Warm Friend)',
    accent: 'Australian',
    gender: 'Female',
    geminiVoice: 'Aoede',
    elevenLabsVoiceId: 'bMxLr8fP6hzNRRi9nJxU',
    dgVoice: 'aura-2-thalia-en',
    description: 'Upbeat, friendly Australian female tone — conversational and lively mate style.',
  },
  {
    id: 'us-male',
    name: 'US Male (Puck / Adam · Deep & Friendly)',
    accent: 'US',
    gender: 'Male',
    geminiVoice: 'Puck',
    elevenLabsVoiceId: 'pNInz6obpgSf9S9P369C',
    dgVoice: 'aura-2-orion-en',
    description: 'Confident, friendly US male voice with natural resonance and clarity.',
  },
  {
    id: 'us-female',
    name: 'US Female (Kore / Rachel · Calm & Natural)',
    accent: 'US',
    gender: 'Female',
    geminiVoice: 'Kore',
    elevenLabsVoiceId: '21m00Tcm4TlvDq8ikWAM',
    dgVoice: 'aura-2-asteria-en',
    description: 'Smooth, natural US female voice suitable for focused and relaxed presence.',
  },
  {
    id: 'uk-male',
    name: 'British Male (Charon / George · Refined)',
    accent: 'British',
    gender: 'Male',
    geminiVoice: 'Charon',
    elevenLabsVoiceId: 'JBFqnCBsd6RMkjVDRZzb',
    dgVoice: 'aura-2-helios-en',
    description: 'Cultured, deep British male tone with polite and resonant articulation.',
  },
  {
    id: 'uk-female',
    name: 'British Female (Zephyr / Charlotte · Elegant)',
    accent: 'British',
    gender: 'Female',
    geminiVoice: 'Zephyr',
    elevenLabsVoiceId: 'XB0fDUnXU5powFXDhCwa',
    dgVoice: 'aura-2-stella-en',
    description: 'Expressive British female accent with vibrant presence and warmth.',
  },
  {
    id: 'us-male-calm',
    name: 'Nordic / Calm Male (Fenrir · Authoritative)',
    accent: 'International',
    gender: 'Male',
    geminiVoice: 'Fenrir',
    elevenLabsVoiceId: 'pNInz6obpgSf9S9P369C',
    dgVoice: 'aura-2-perseus-en',
    description: 'Calm, grounded baritone tone with authoritative steady pace.',
  },
  {
    id: 'us-female-soft',
    name: 'Soft Whisper Female (Zephyr / Nicole · Gentle)',
    accent: 'US',
    gender: 'Female',
    geminiVoice: 'Zephyr',
    elevenLabsVoiceId: 'piTKgcLEGmPE4e6mEKli',
    dgVoice: 'aura-2-luna-en',
    description: 'Intimate, gentle feminine whisper voice with soft dynamics.',
  },
];

export const GEMINI_VOICES = [
  { id: 'Aoede', label: 'Aoede (Female · Australian Friend / Warm & Engaging)' },
  { id: 'Kore', label: 'Kore (Female · Relaxed & Natural)' },
  { id: 'Zephyr', label: 'Zephyr (Female · Bright & Lively)' },
  { id: 'Puck', label: 'Puck (Male · Friendly & Playful)' },
  { id: 'Charon', label: 'Charon (Male · Deep & Resonant)' },
  { id: 'Fenrir', label: 'Fenrir (Male · Calm & Authoritative)' },
];

export const DEFAULT_ELEVENLABS_VOICES = [
  { id: 'bMxLr8fP6hzNRRi9nJxU', label: 'Sophia Custom (.env)' },
  { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel (Calm & Clear)' },
  { id: 'pNInz6obpgSf9S9P369C', label: 'Adam (Warm & Deep)' },
  { id: 'piTKgcLEGmPE4e6mEKli', label: 'Nicole (Soft Whisper)' },
  { id: 'XB0fDUnXU5powFXDhCwa', label: 'Charlotte (Expressive)' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', label: 'George (British)' },
  { id: 'custom', label: 'Custom Voice ID…' },
];

export const DEEPGRAM_VOICES = [
  { id: 'aura-2-thalia-en', label: 'Aura-2 Thalia (Natural)' },
  { id: 'aura-2-asteria-en', label: 'Aura-2 Asteria (Warm)' },
  { id: 'aura-2-luna-en', label: 'Aura-2 Luna (Calm)' },
  { id: 'aura-2-stella-en', label: 'Aura-2 Stella (Friendly)' },
  { id: 'aura-2-athena-en', label: 'Aura-2 Athena (Clear)' },
  { id: 'aura-2-orion-en', label: 'Aura-2 Orion (Confident)' },
  { id: 'aura-2-perseus-en', label: 'Aura-2 Perseus (Expressive)' },
  { id: 'aura-2-helios-en', label: 'Aura-2 Helios (Deep)' },
];

export const BRAIN_OPTIONS = [
  { id: 'auto', label: 'Auto (Smart Fallback)' },
  { id: 'ollama', label: 'Ollama (Local LLM)' },
  { id: 'lmstudio', label: 'LM Studio (Local)' },
  { id: 'gemini', label: 'Gemini 3.8 Flash' },
  { id: 'grok', label: 'Grok 4.5 (xAI)' },
  { id: 'claude', label: 'Claude Sonnet 4.6' },
  { id: 'openai', label: 'OpenAI GPT-6 Sol' },
];
