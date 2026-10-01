/**
 * lib/local-audio.ts — local speech-to-text routing (Phase 32).
 *
 * Two providers:
 * - companion: the Windows daemon's local Whisper (`stt_local` op).
 * - custom: any OpenAI-compatible `/audio/transcriptions` endpoint — this is
 *   how self-hosted models plug into Sofia's audio agents (faster-whisper
 *   server, whisper.cpp server, a Qwen3-Omni transformers serve, ...).
 *
 * See AUDIO_MODELS.md for setup recipes.
 */
import { memoryStorage, type RunModeStorage } from './run-mode.ts';

export type SttProvider = 'companion' | 'custom';

export interface CustomSttConfig {
  /** Base URL, e.g. http://127.0.0.1:8000/v1 (trailing /audio/transcriptions tolerated). */
  baseUrl: string;
  /** Model id sent in the `model` field (many local servers accept anything here). */
  model: string;
  /** Optional bearer token for endpoints that require auth. */
  apiKey?: string;
}

export interface SttSettings {
  provider: SttProvider;
  custom: CustomSttConfig;
}

export const STT_SETTINGS_KEY = 'sophia:audio-stt:v1';
export const DEFAULT_CUSTOM_STT: CustomSttConfig = {
  baseUrl: 'http://127.0.0.1:8000/v1',
  model: 'whisper-1',
};

function defaultStorage(): RunModeStorage {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* ignore */
  }
  return memoryStorage();
}

export function loadSttSettings(storage: RunModeStorage = defaultStorage()): SttSettings {
  const fallback: SttSettings = { provider: 'companion', custom: { ...DEFAULT_CUSTOM_STT } };
  try {
    const raw = storage.getItem(STT_SETTINGS_KEY);
    if (!raw) return fallback;
    const j = JSON.parse(raw) as Partial<SttSettings>;
    const provider: SttProvider = j.provider === 'custom' ? 'custom' : 'companion';
    const custom = (j.custom ?? {}) as Partial<CustomSttConfig>;
    return {
      provider,
      custom: {
        baseUrl:
          typeof custom.baseUrl === 'string' && custom.baseUrl.trim()
            ? custom.baseUrl.trim()
            : DEFAULT_CUSTOM_STT.baseUrl,
        model:
          typeof custom.model === 'string' && custom.model.trim()
            ? custom.model.trim()
            : DEFAULT_CUSTOM_STT.model,
        ...(typeof custom.apiKey === 'string' && custom.apiKey ? { apiKey: custom.apiKey } : {}),
      },
    };
  } catch {
    return fallback;
  }
}

export function saveSttSettings(s: SttSettings, storage: RunModeStorage = defaultStorage()): void {
  try {
    storage.setItem(STT_SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* Storage unavailable: the caller keeps working with the in-memory copy. */
  }
}

/** Trim + validate a user-typed endpoint base URL. Throws stt_bad_url with a hint. */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/.+/i.test(trimmed)) {
    throw new Error(
      `stt_bad_url: "${raw.trim().slice(0, 80) || '(empty)'}" — use an http(s) base URL like http://127.0.0.1:8000/v1`,
    );
  }
  return trimmed.replace(/\/audio\/transcriptions$/i, '');
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Transcribe 16 kHz mono WAV (base64) against a custom OpenAI-compatible
 * endpoint. Throws stt_unreachable / stt_http_* / stt_empty with fix hints.
 */
export async function transcribeCustom(
  wavB64: string,
  cfg: CustomSttConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const base = normalizeBaseUrl(cfg.baseUrl);
  const form = new FormData();
  form.append('file', new Blob([b64ToBytes(wavB64)], { type: 'audio/wav' }), 'audio.wav');
  form.append('model', cfg.model?.trim() || 'whisper-1');
  const headers: Record<string, string> = {};
  if (cfg.apiKey?.trim()) headers.authorization = `Bearer ${cfg.apiKey.trim()}`;
  let res: Response;
  try {
    res = await fetchImpl(`${base}/audio/transcriptions`, { method: 'POST', headers, body: form });
  } catch (err) {
    throw new Error(
      `stt_unreachable: ${base} did not answer (${err instanceof Error ? err.message : String(err)}). Is the local STT server running? See AUDIO_MODELS.md.`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `stt_http_${res.status}: ${base} rejected the transcription (${body.slice(0, 160) || res.statusText || 'no details'}).`,
    );
  }
  const j = (await res.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof j?.text === 'string' ? j.text.trim() : '';
  if (!text) throw new Error('stt_empty: the endpoint answered but returned no transcript text.');
  return text;
}
