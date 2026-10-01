/**
 * lib/grounding.ts — typed client for OCR grounding (Phase 6).
 *
 * Find on-screen text by its words (`ground_text`) or dump every word
 * box the daemon's tesseract sees (`ground_ocr`). Tesseract lives on the
 * companion machine, so absence surfaces as a setup hint, not a crash.
 */

import { companion, type CompanionReply } from './companion-client.ts';

export type GroundingCaller = (
  action: string,
  args?: Record<string, unknown>,
) => Promise<CompanionReply<unknown>>;

export const defaultGroundingCaller: GroundingCaller = (action, args) =>
  companion.send(action, args ?? {});

export class GroundingError extends Error {
  code: string;
  detail?: string;

  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = 'GroundingError';
    this.code = code;
    this.detail = detail;
  }
}

export const TESSERACT_SETUP_HINT =
  'OCR grounding needs tesseract on the companion machine (apt install tesseract-ocr / brew install tesseract).';

/** True when the daemon reports the missing tesseract backend. */
export function isTesseractError(err: unknown): boolean {
  const text = err instanceof GroundingError ? `${err.message} ${err.detail ?? ''}` : String(err ?? '');
  return /tesseract/i.test(text);
}

async function call(
  caller: GroundingCaller,
  action: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  let reply: CompanionReply<unknown>;
  try {
    reply = await caller(action, args);
  } catch (err) {
    throw new GroundingError('transport', 'Could not reach the companion.', err instanceof Error ? err.message : String(err));
  }
  if (!reply.ok) {
    throw new GroundingError(
      reply.error || 'action_failed',
      reply.detail || reply.error || 'The companion could not do that.',
      reply.detail,
    );
  }
  return (reply.result ?? {}) as Record<string, unknown>;
}

export interface WordBox {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextHit {
  found: true;
  text: string;
  x: number;
  y: number;
  box: { x: number; y: number; w: number; h: number };
}

export interface TextMiss {
  found: false;
  text: string;
  hint: string;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function toWordBox(raw: unknown): WordBox | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const w = raw as Record<string, unknown>;
  if (typeof w.text !== 'string' || !w.text.trim()) return null;
  return { text: w.text, x: num(w.x), y: num(w.y), w: num(w.w), h: num(w.h) };
}

/** Locate visible text; resolves to a hit or a miss (never throws for those). */
export async function groundText(
  caller: GroundingCaller = defaultGroundingCaller,
  text: string,
): Promise<TextHit | TextMiss> {
  const target = typeof text === 'string' ? text.trim() : '';
  if (!target) throw new GroundingError('validation', 'Enter the text to find.');
  const res = await call(caller, 'ground_text', { text: target });
  if (res.found !== true) {
    return {
      found: false,
      text: typeof res.text === 'string' ? res.text : target,
      hint: typeof res.hint === 'string' && res.hint ? res.hint : 'Text not visible on screen.',
    };
  }
  const box = (res.box ?? {}) as Record<string, unknown>;
  return {
    found: true,
    text: typeof res.text === 'string' ? res.text : target,
    x: num(res.x),
    y: num(res.y),
    box: { x: num(box.x), y: num(box.y), w: num(box.w), h: num(box.h) },
  };
}

/** Dump every word box the daemon sees on screen right now. */
export async function groundScan(
  caller: GroundingCaller = defaultGroundingCaller,
): Promise<{ count: number; words: WordBox[] }> {
  const res = await call(caller, 'ground_ocr', {});
  const words = Array.isArray(res.words) ? res.words : [];
  const clean = words.map(toWordBox).filter((w): w is WordBox => w !== null);
  return {
    count: typeof res.count === 'number' ? res.count : clean.length,
    words: clean,
  };
}
