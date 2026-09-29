/**
 * lib/chat-image.ts — Phase 18: screenshot attachments for vision turns.
 *
 * The task decider sends the observe screenshot with every step decision;
 * these pure builders validate it once and shape it per brain vendor.
 * Kept out of sophia-server.ts so node tests can import it without
 * touching the extensionless server import chain.
 */

export interface ChatImage {
  data: string;
  mimeType: string;
}

/** ~9MB of pixels max — a 1568px PNG is ~0.5–3MB base64. */
export const MAX_IMAGE_CHARS = 12_000_000;
const MIN_IMAGE_CHARS = 100;
const KNOWN_MIME = /^image\/(png|jpeg|webp|gif)$/;

/**
 * Validate an untrusted image attachment. Returns null when absent,
 * malformed, or absurdly sized (the brain then runs text-only).
 * Unknown mime types fall back to image/png.
 */
export function validChatImage(image: unknown): ChatImage | null {
  if (!image || typeof image !== 'object') return null;
  const { data, mimeType } = image as { data?: unknown; mimeType?: unknown };
  if (typeof data !== 'string') return null;
  if (data.length < MIN_IMAGE_CHARS || data.length > MAX_IMAGE_CHARS) return null;
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(data)) return null;
  const mime = typeof mimeType === 'string' && KNOWN_MIME.test(mimeType) ? mimeType : 'image/png';
  return { data, mimeType: mime };
}

export interface OpenAiTextPart {
  type: 'text';
  text: string;
}

export interface OpenAiImageUrlPart {
  type: 'image_url';
  image_url: { url: string };
}

export type OpenAiContentPart = OpenAiTextPart | OpenAiImageUrlPart;

/** OpenAI-compat / Grok / Ollama / LM Studio vision part. */
export function openAiImagePart(img: ChatImage): OpenAiImageUrlPart {
  return { type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } };
}

export interface ClaudeTextBlock {
  type: 'text';
  text: string;
}

export interface ClaudeImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
}

export type ClaudeContentBlock = ClaudeTextBlock | ClaudeImageBlock;

/** Anthropic messages vision block. */
export function claudeImageBlock(img: ChatImage): ClaudeImageBlock {
  return { type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } };
}

export interface GeminiInlinePart {
  inlineData: { mimeType: string; data: string };
}

/** Gemini generateContent vision part. */
export function geminiImagePart(img: ChatImage): GeminiInlinePart {
  return { inlineData: { mimeType: img.mimeType, data: img.data } };
}
