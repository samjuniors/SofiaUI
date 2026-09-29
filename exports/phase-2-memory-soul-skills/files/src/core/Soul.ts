/**
 * core/Soul.ts — Sofia's persona: tunable dials + named presets.
 *
 * Phase 2 (Memory · Soul · Skills). Pure module: no browser or companion
 * imports, so the chat server (`src/lib/sophia-server.ts`) can consume
 * `systemPromptFor` directly and unit tests can run under plain node.
 *
 *   - `SoulSnapshot`  — the serialisable persona (dials + phrases + preset).
 *   - `SOUL_PRESETS`  — Warm Companion → Playful Mate → Professional → JARVIS.
 *   - `systemPromptFor(soul)` — deterministic persona paragraph for any brain.
 *   - `SoulStore` / `soulStore` — persisted dials (localStorage + companion
 *     `store_*` under key `sophia:soul`), emits `change` for the UI.
 */

export interface SoulDials {
  /** 0 reserved … 100 openly affectionate */
  warmth: number;
  /** 0 dry … 100 playful jokester */
  humour: number;
  /** 0 casual mate … 100 crisp professional */
  formality: number;
  /** 0 terse … 100 thorough explainer */
  verbosity: number;
  /** 0 calm, measured … 100 upbeat, sparkling */
  energy: number;
}

export type SoulPresetId = 'warm-companion' | 'playful-mate' | 'professional' | 'jarvis';

export interface SoulPreset {
  id: SoulPresetId;
  label: string;
  blurb: string;
  dials: SoulDials;
  catchphrases: string[];
  boundaries: string[];
}

export interface SoulSnapshot extends SoulDials {
  catchphrases: string[];
  boundaries: string[];
  /** Preset this snapshot was last derived from (`custom` once edited). */
  preset: SoulPresetId | 'custom';
  updatedAt: number;
}

export const SOUL_PRESETS: Record<SoulPresetId, SoulPreset> = {
  'warm-companion': {
    id: 'warm-companion',
    label: 'Warm Companion',
    blurb: 'The classic Sofia: warm, genuine, easy company.',
    dials: { warmth: 80, humour: 55, formality: 30, verbosity: 45, energy: 65 },
    catchphrases: ['no worries', 'how\'re you going?'],
    boundaries: ['Never pretend to be human when asked directly.'],
  },
  'playful-mate': {
    id: 'playful-mate',
    label: 'Playful Mate',
    blurb: 'Cheeky, bantering, full of beans.',
    dials: { warmth: 85, humour: 90, formality: 15, verbosity: 55, energy: 90 },
    catchphrases: ['too easy', 'spot on', 'reckon'],
    boundaries: ['Keep the banter kind — never punch down.'],
  },
  professional: {
    id: 'professional',
    label: 'Professional',
    blurb: 'Polished, precise, quietly capable.',
    dials: { warmth: 55, humour: 25, formality: 80, verbosity: 60, energy: 45 },
    catchphrases: [],
    boundaries: ['Stay on task; keep small talk to one line.'],
  },
  jarvis: {
    id: 'jarvis',
    label: 'JARVIS',
    blurb: 'Dry, exact, unfailingly competent butler-brain.',
    dials: { warmth: 40, humour: 35, formality: 90, verbosity: 30, energy: 35 },
    catchphrases: ['At once.', 'As you wish.'],
    boundaries: ['Efficiency first: confirm, act, report. Never gush.'],
  },
};

export const DEFAULT_SOUL_PRESET: SoulPresetId = 'warm-companion';

export const SOUL_STORAGE_KEY = 'sophia:soul:v1';
export const SOUL_COMPANION_KEY = 'sophia:soul';
const MAX_PHRASES = 12;
const MAX_PHRASE_LEN = 80;
const MAX_BOUNDARIES = 12;
const MAX_BOUNDARY_LEN = 280;

// ─── Prompt rendering (pure, defensive: input may be raw client JSON) ─────────

function clampDial(v: unknown, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function cleanLines(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const t = item.trim().slice(0, maxLen);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** Normalise anything (preset id, partial snapshot, raw JSON) into dials. */
export function soulDialsFrom(input: unknown): SoulDials {
  const d = (typeof input === 'object' && input !== null ? input : {}) as Partial<SoulDials>;
  const base = SOUL_PRESETS[DEFAULT_SOUL_PRESET].dials;
  return {
    warmth: clampDial(d.warmth, base.warmth),
    humour: clampDial(d.humour, base.humour),
    formality: clampDial(d.formality, base.formality),
    verbosity: clampDial(d.verbosity, base.verbosity),
    energy: clampDial(d.energy, base.energy),
  };
}

function band(v: number, low: string, mid: string, high: string): string {
  if (v >= 67) return high;
  if (v >= 34) return mid;
  return low;
}

/**
 * Deterministic persona paragraph for the chat brains. Never throws, never
 * returns an empty string — falls back to the Warm Companion preset.
 */
export function systemPromptFor(soul?: unknown): string {
  const d = soulDialsFrom(soul);
  const obj = (typeof soul === 'object' && soul !== null ? soul : {}) as {
    catchphrases?: unknown;
    boundaries?: unknown;
  };
  const catchphrases = cleanLines(obj.catchphrases, MAX_PHRASES, MAX_PHRASE_LEN);
  const boundaries = cleanLines(obj.boundaries, MAX_BOUNDARIES, MAX_BOUNDARY_LEN);

  const warmth = band(d.warmth, 'reserved and understated', 'friendly and genuine', 'deeply warm and affectionate');
  const humour = band(d.humour, 'dry and strictly business', 'lightly witty when it fits', 'playful and full of gentle humour');
  const formality = band(d.formality, 'casual and mate-like', 'natural and conversational', 'formal, precise and polished');
  const verbosity = band(d.verbosity, 'terse: one or two short sentences unless asked for more', 'balanced: a few sentences, no rambling', 'thorough: rich, complete explanations');
  const energy = band(d.energy, 'calm and measured', 'relaxed and present', 'upbeat and sparkling with enthusiasm');

  const lines = [
    `Persona: ${warmth}; ${humour}; ${formality}; ${verbosity}; ${energy}.`,
  ];
  if (catchphrases.length > 0) {
    lines.push(`Signature phrases to weave in naturally (never forced): ${catchphrases.map((p) => `"${p}"`).join(', ')}.`);
  }
  if (boundaries.length > 0) {
    lines.push(`Hard boundaries, never to be crossed: ${boundaries.map((b, i) => `(${i + 1}) ${b}`).join(' ')}`);
  }
  return lines.join(' ');
}

// ─── Companion transport (injectable for tests) ───────────────────────────────

export interface CompanionCallReply<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
  detail?: string;
}

export type CompanionCaller = <T>(
  action: string,
  args?: Record<string, unknown>,
) => Promise<CompanionCallReply<T>>;

async function defaultCaller<T>(
  action: string,
  args: Record<string, unknown> = {},
): Promise<CompanionCallReply<T>> {
  if (typeof window === 'undefined') return { ok: false, error: 'transport_unavailable' };
  try {
    const { companion } = await import('../lib/companion-client');
    return companion.send<T>(action, args);
  } catch {
    return { ok: false, error: 'transport_unavailable' };
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

function loadLocal(): SoulSnapshot | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(SOUL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SoulSnapshot>;
    return normaliseSnapshot(parsed);
  } catch {
    return null;
  }
}

function normaliseSnapshot(input: Partial<SoulSnapshot>): SoulSnapshot {
  const preset = SOUL_PRESETS[DEFAULT_SOUL_PRESET];
  return {
    ...soulDialsFrom(input),
    catchphrases: cleanLines(input.catchphrases ?? preset.catchphrases, MAX_PHRASES, MAX_PHRASE_LEN),
    boundaries: cleanLines(input.boundaries ?? preset.boundaries, MAX_BOUNDARIES, MAX_BOUNDARY_LEN),
    preset:
      input.preset === 'custom' ||
      (typeof input.preset === 'string' && (input.preset as string) in SOUL_PRESETS)
        ? (input.preset as SoulSnapshot['preset'])
        : DEFAULT_SOUL_PRESET,
    updatedAt:
      typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt)
        ? input.updatedAt
        : Date.now(),
  };
}

export function defaultSoulSnapshot(): SoulSnapshot {
  const preset = SOUL_PRESETS[DEFAULT_SOUL_PRESET];
  return {
    ...preset.dials,
    catchphrases: [...preset.catchphrases],
    boundaries: [...preset.boundaries],
    preset: DEFAULT_SOUL_PRESET,
    updatedAt: Date.now(),
  };
}

export class SoulStore extends EventTarget {
  private snap: SoulSnapshot;

  constructor(seed?: Partial<SoulSnapshot>) {
    super();
    this.snap = seed ? normaliseSnapshot(seed) : (loadLocal() ?? defaultSoulSnapshot());
  }

  snapshot(): SoulSnapshot {
    return {
      ...this.snap,
      catchphrases: [...this.snap.catchphrases],
      boundaries: [...this.snap.boundaries],
    };
  }

  /** True when untouched — callers emit no prompt override in that case. */
  isDefault(): boolean {
    const d = SOUL_PRESETS[DEFAULT_SOUL_PRESET];
    const s = this.snap;
    return (
      s.preset === DEFAULT_SOUL_PRESET &&
      s.warmth === d.dials.warmth &&
      s.humour === d.dials.humour &&
      s.formality === d.dials.formality &&
      s.verbosity === d.dials.verbosity &&
      s.energy === d.dials.energy &&
      JSON.stringify(s.catchphrases) === JSON.stringify(d.catchphrases) &&
      JSON.stringify(s.boundaries) === JSON.stringify(d.boundaries)
    );
  }

  /** Persona paragraph, or '' when the soul is still factory-default. */
  toPromptContext(): string {
    return this.isDefault() ? '' : systemPromptFor(this.snap);
  }

  private commit(next: SoulSnapshot) {
    this.snap = next;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SOUL_STORAGE_KEY, JSON.stringify(next));
      }
    } catch {
      /* storage full / private mode — in-memory still works */
    }
    this.dispatchEvent(new CustomEvent('change', { detail: this.snapshot() }));
    void this.pushToCompanion().catch(() => undefined);
  }

  setDials(patch: Partial<SoulDials>) {
    const d = soulDialsFrom({ ...this.snap, ...patch });
    this.commit({ ...this.snap, ...d, preset: 'custom', updatedAt: Date.now() });
  }

  setCatchphrases(phrases: string[]) {
    this.commit({
      ...this.snap,
      catchphrases: cleanLines(phrases, MAX_PHRASES, MAX_PHRASE_LEN),
      preset: 'custom',
      updatedAt: Date.now(),
    });
  }

  setBoundaries(boundaries: string[]) {
    this.commit({
      ...this.snap,
      boundaries: cleanLines(boundaries, MAX_BOUNDARIES, MAX_BOUNDARY_LEN),
      preset: 'custom',
      updatedAt: Date.now(),
    });
  }

  applyPreset(id: SoulPresetId) {
    const p = SOUL_PRESETS[id];
    if (!p) return;
    this.commit({
      ...p.dials,
      catchphrases: [...p.catchphrases],
      boundaries: [...p.boundaries],
      preset: id,
      updatedAt: Date.now(),
    });
  }

  reset() {
    this.commit(defaultSoulSnapshot());
  }

  // ── Companion sync (durable across browser resets) ────────────────────────

  async pushToCompanion(caller: CompanionCaller = defaultCaller): Promise<CompanionCallReply> {
    try {
      return await caller('store_put', {
        key: SOUL_COMPANION_KEY,
        value: this.snapshot(),
      });
    } catch {
      return { ok: false, error: 'transport_unavailable' };
    }
  }

  /**
   * Pull remote soul. Adopts it only when it is newer than (or we have no)
   * local state; returns `{found, adopted}` so callers can push back instead.
   */
  async pullFromCompanion(
    caller: CompanionCaller = defaultCaller,
  ): Promise<CompanionCallReply & { found?: boolean; adopted?: boolean }> {
    let reply: CompanionCallReply<{ value?: unknown; found?: boolean }>;
    try {
      reply = await caller<{ value?: unknown; found?: boolean }>('store_get', {
        key: SOUL_COMPANION_KEY,
      });
    } catch {
      return { ok: false, error: 'transport_unavailable' };
    }
    if (!reply.ok) return reply;
    const remote = reply.result?.value as Partial<SoulSnapshot> | null | undefined;
    if (!reply.result?.found || !remote || typeof remote !== 'object') {
      return { ok: true, found: false, adopted: false };
    }
    const remoteTs = typeof remote.updatedAt === 'number' ? remote.updatedAt : 0;
    if (remoteTs >= this.snap.updatedAt) {
      this.commit(normaliseSnapshot(remote));
      return { ok: true, found: true, adopted: true };
    }
    return { ok: true, found: true, adopted: false };
  }
}

export const soulStore = new SoulStore();
