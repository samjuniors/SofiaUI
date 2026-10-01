/**
 * memory/derive.mjs — Phase 24: the Deriver (Honcho's write-time reasoner,
 * adapted). No LLM, no vendor: deterministic extractors pull explicit
 * conclusions out of episode text at write time. Every candidate cites its
 * premise episode, carries a source tag + trust + confidence, and flows
 * through the same validation as hand-written facts — consolidation merges,
 * resolves, and weights them later.
 *
 * Pure: derive(text, {source, sourceTrust, episodeId}) → candidates[].
 */

import { CONF, normalizeText, trustOf } from './schema.mjs';

const MAX_CANDIDATES = 5;
const MAX_LEN = 300;

function cap(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
}

function finalize(cands, source, trust, episodeId) {
  const seen = new Map();
  const out = [];
  for (const c of cands) {
    const text = cap(c.text);
    if (!text || text.length < 8) continue;
    const norm = normalizeText(text);
    if (!norm) continue;
    const prior = seen.get(norm);
    if (prior) {
      // Same conclusion via two rules: keep the first phrasing but adopt a
      // subject slot when the twin has one ("remember my dog is X" + slot).
      if (!prior.subject && c.subject) prior.subject = c.subject;
      continue;
    }
    let confidence = c.confidence;
    if (trust === 'untrusted') confidence = Math.min(confidence, CONF.UNTRUSTED_CONF_CAP);
    const row = {
      text,
      subject: c.subject ?? null,
      source,
      sourceTrust: trust,
      confidence: Math.round(confidence * 100) / 100,
      premises: episodeId != null ? [episodeId] : [],
    };
    seen.set(norm, row);
    out.push(row);
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

/**
 * Extract conclusion candidates from one text. The rules are deliberately
 * conservative: explicit statements ("remember that…", "my X is Y",
 * "I prefer…", "actually…") — never speculative leaps. Induction across
 * episodes belongs to consolidation, where ≥2 observations are required.
 */
export function derive(text, opts = {}) {
  const source = String(opts.source ?? '').trim() || 'unknown';
  const trust = trustOf(source, opts.sourceTrust);
  const episodeId = Number.isInteger(opts.episodeId) ? opts.episodeId : null;
  const cands = [];
  const input = String(text ?? '');
  // Assistant phrasing is inferred, not stated: discount it.
  const discount = source.toLowerCase() === 'assistant' ? 0.8 : 1;

  const push = (t, conf, subject = null) => {
    if (t && t.trim()) cands.push({ text: t.trim(), confidence: conf * discount, subject });
  };

  // "remember (that) X" / "note (that) X" / "don't forget X"
  for (const m of input.matchAll(/\b(?:remember|note|don't forget)(?: that)?\s+([^.!\n]{8,300})/gi)) {
    push(m[1], 0.85);
  }
  // "my <slot> is <value>"
  for (const m of input.matchAll(/\bmy ([\w][\w -]{0,40}?) (is|are) ([^.!\n]{1,200})/gi)) {
    const slot = m[1].trim().toLowerCase().replace(/\s+/g, ' ');
    push(`My ${m[1].trim()} ${m[2]} ${m[3].trim()}`, 0.8, slot || null);
  }
  // "I like/love/prefer/hate …"
  for (const m of input.matchAll(/\bi (like|love|prefer|hate|dislike)\b([^.!\n]{2,200})/gi)) {
    push(`I ${m[1].toLowerCase()}${m[2].trim() ? ` ${m[2].trim()}` : ''}`, 0.75);
  }
  // "I am …" / "I'm …"
  for (const m of input.matchAll(/\bi(?:'m| am) ([^.!\n]{2,200})/gi)) {
    push(`I am ${m[1].trim()}`, 0.8);
  }
  // Corrections carry extra weight — the user is fixing the record.
  for (const m of input.matchAll(/\b(actually|correction|no[,.]?\s+(?:it's|its|it is))[:,]?\s+([^.!\n]{8,300})/gi)) {
    push(m[2], 0.85);
  }
  // Commitments / standing instructions.
  for (const m of input.matchAll(/\b(always|never) ([^.!\n]{8,200})/gi)) {
    if (/\b(i|you|we)\b/i.test(m[0].slice(0, 40))) push(`${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2].trim()}`, 0.7);
  }

  return finalize(cands, source, trust, episodeId);
}
