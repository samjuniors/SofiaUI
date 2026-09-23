/**
 * Sophia — shared types
 * The visual engine, state machine and every VoiceProvider speak these types.
 */

/** Lifecycle: AMBIENT / IDLE → WAKEUP → FOCUSING → LISTENING → THINKING → SPEAKING → (RENDERING / TRANSFORMING) → AMBIENT
 *  PAUSED is an overlay state that can wrap any of the above. */
export type SophiaStateName =
  | 'ambient'
  | 'idle'
  | 'wakeup'
  | 'focusing'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'rendering'
  | 'transforming'
  | 'paused'
  | 'completed';

/** Normalized events every VoiceProvider must emit. */
export type SophiaEventType =
  | 'listening'
  | 'speech_started'
  | 'transcript'
  | 'thinking'
  | 'response_started'
  | 'audio_started'
  | 'audio_chunk'
  | 'interrupted'
  | 'response_finished'
  | 'error';

export interface SophiaEventDetail {
  /** transcript payloads */
  text?: string;
  role?: 'user' | 'sophia';
  final?: boolean;
  /** realtime 0..1 level carried by audio_chunk / speech_started */
  level?: number;
  /** error payloads */
  code?: string;
  message?: string;
  source?: string;
}

export type VoiceProviderId = 'gemini-live' | 'deepgram';

/** Geometry the substance can become. Generated, never hand-animated. */
export type SophiaShape =
  | 'organic'
  | 'circle'
  | 'waveform'
  | 'bow'
  | 'torus'
  | 'infinity'
  | 'helix'
  | 'hypercube'
  | 'pyramid'
  | 'star'
  | 'galaxy'
  | 'heart'
  | 'shield'
  | 'matrix'
  | 'split'
  | 'merge'
  | 'dissolve'
  | 'face'
  | 'letter-z'
  | 'letter-s'
  | 'letter-a'
  | 'letter-o';

/** What actually wakes Sophia. */
export type ActivationSource = 'wake-word' | 'mic-button' | 'chat';

export interface Turn {
  role: 'user' | 'sophia' | 'system';
  text: string;
  final: boolean;
  ts: number;
}
