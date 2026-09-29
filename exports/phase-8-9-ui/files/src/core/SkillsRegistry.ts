/**
 * core/SkillsRegistry.ts — every Sofia capability in one place.
 *
 * Phase 2 (Memory · Soul · Skills). Each skill carries an on/off switch plus
 * usage stats, persisted locally and merged with the companion daemon's live
 * `skills_list`. The tool registry consults `isEnabled()` through a guard hook
 * installed by `src/core/mind-wiring.ts`, so a disabled skill refuses voice
 * and chat invocations alike.
 *
 * Pure module: no browser or companion imports at load time, so unit tests
 * run under plain node. Emits `change` for the Settings → Skills UI.
 */

import type { CompanionCaller, CompanionCallReply } from './Soul';

export type SkillCategory =
  | 'voice'
  | 'chat'
  | 'device'
  | 'browser'
  | 'files'
  | 'memory'
  | 'media'
  | 'system'
  | 'companion';

export interface SkillDef {
  id: string;
  label: string;
  description: string;
  category: SkillCategory;
  /** Local tools vs daemon actions discovered over `skills_list`. */
  source: 'local' | 'companion';
  /** Locked skills (protocol actions) are always on and cannot be toggled. */
  locked?: boolean;
}

export interface SkillState extends SkillDef {
  enabled: boolean;
  uses: number;
  lastUsedAt: number | null;
}

export const SKILLS_STORAGE_KEY = 'sophia:skills:v1';

/** Protocol actions: always on, never shown as toggles. */
const LOCKED_ACTIONS = new Set(['ping', 'abort', 'resume']);

/** Daemon meta-actions that are not user-facing capabilities. */
const HIDDEN_ACTIONS = new Set(['skills_list']);

/**
 * Built-in client capabilities (the tool registry's tools, by name).
 * Companion daemon actions merge in on top via `refreshFromCompanion()`.
 */
export const LOCAL_SKILLS: SkillDef[] = [
  {
    id: 'web_search',
    label: 'Web search',
    description: 'Live answers from the web: news, weather, prices, facts.',
    category: 'chat',
    source: 'local',
  },
  {
    id: 'ui_control',
    label: 'Interface control',
    description: 'Open panels, show info cards, scroll, notify, set volume.',
    category: 'chat',
    source: 'local',
  },
  {
    id: 'system_control',
    label: 'Device control',
    description: 'Desktop browser, apps, music, clock and system info.',
    category: 'device',
    source: 'local',
  },
  {
    id: 'generate_image',
    label: 'Image generation',
    description: 'Create illustrations, concept art and diagrams.',
    category: 'chat',
    source: 'local',
  },
  {
    id: 'transform_shape',
    label: 'Shape shifting',
    description: "Morph Sofia's holographic form between geometries.",
    category: 'chat',
    source: 'local',
  },
  {
    id: 'play_music',
    label: 'Music',
    description: 'Play songs and ambient soundscapes.',
    category: 'media',
    source: 'local',
  },
  {
    id: 'open_url',
    label: 'Open links',
    description: 'Open websites and videos in the browser panel.',
    category: 'browser',
    source: 'local',
  },
  {
    id: 'proactive',
    label: 'Proactive routines',
    description: 'Morning briefing and PC health watch, on voice demand.',
    category: 'system',
    source: 'local',
  },
  {
    id: 'local_voice',
    label: 'Local voice',
    description: 'Airplane-mode speech: readiness, speak, ask, on/off.',
    category: 'voice',
    source: 'local',
  },
];

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

/** Pretty-print a daemon action id: `files_trash` → `Files trash`. */
export function labelForAction(id: string): string {
  const words = id.split('_').filter(Boolean);
  if (words.length === 0) return id;
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.join(' ');
}

/** Infer which shelf a daemon action belongs on. */
export function categoryForAction(id: string): SkillCategory {
  if (/^(tts_local|stt_local|voice_info)$/.test(id)) return 'voice';
  if (/^(store_|episodes_)/.test(id)) return 'memory';
  if (/^files_/.test(id)) return 'files';
  if (/^browser_/.test(id)) return 'browser';
  if (/^whatsapp_/.test(id)) return 'device';
  if (/^media_/.test(id)) return 'media';
  if (/^ground_/.test(id)) return 'system';
  if (/^health_/.test(id)) return 'system';
  if (/^(ping|abort|resume)$/.test(id)) return 'system';
  return 'companion';
}

function describeAction(id: string): string {
  if (LOCKED_ACTIONS.has(id)) return 'Core companion link — always on.';
  const pretty = labelForAction(id).toLowerCase();
  return `Companion daemon action: ${pretty}.`;
}

interface PersistedSkills {
  enabled: Record<string, boolean>;
  uses: Record<string, number>;
  lastUsedAt: Record<string, number>;
  companionIds: string[];
}

function loadPersisted(): PersistedSkills {
  const empty: PersistedSkills = { enabled: {}, uses: {}, lastUsedAt: {}, companionIds: [] };
  try {
    if (typeof localStorage === 'undefined') return empty;
    const raw = localStorage.getItem(SKILLS_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<PersistedSkills>;
    return {
      enabled:
        parsed.enabled && typeof parsed.enabled === 'object' ? (parsed.enabled as Record<string, boolean>) : {},
      uses: parsed.uses && typeof parsed.uses === 'object' ? (parsed.uses as Record<string, number>) : {},
      lastUsedAt:
        parsed.lastUsedAt && typeof parsed.lastUsedAt === 'object'
          ? (parsed.lastUsedAt as Record<string, number>)
          : {},
      companionIds: Array.isArray(parsed.companionIds)
        ? parsed.companionIds.filter((s): s is string => typeof s === 'string')
        : [],
    };
  } catch {
    return empty;
  }
}

export class SkillsRegistry extends EventTarget {
  private enabled = new Map<string, boolean>();
  private uses = new Map<string, number>();
  private lastUsedAt = new Map<string, number>();
  private companionIds: string[] = [];

  constructor() {
    super();
    const saved = loadPersisted();
    for (const [k, v] of Object.entries(saved.enabled)) {
      if (typeof v === 'boolean') this.enabled.set(k, v);
    }
    for (const [k, v] of Object.entries(saved.uses)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) this.uses.set(k, Math.floor(v));
    }
    for (const [k, v] of Object.entries(saved.lastUsedAt)) {
      if (typeof v === 'number' && Number.isFinite(v)) this.lastUsedAt.set(k, v);
    }
    this.companionIds = saved.companionIds.filter((id) => !HIDDEN_ACTIONS.has(id));
  }

  private defs(): SkillDef[] {
    const defs: SkillDef[] = [...LOCAL_SKILLS];
    for (const id of this.companionIds) {
      if (defs.some((d) => d.id === id)) continue;
      defs.push({
        id,
        label: labelForAction(id),
        description: describeAction(id),
        category: categoryForAction(id),
        source: 'companion',
        locked: LOCKED_ACTIONS.has(id) || undefined,
      });
    }
    return defs;
  }

  list(): SkillState[] {
    return this.defs().map((d) => ({
      ...d,
      enabled: d.locked ? true : (this.enabled.get(d.id) ?? true),
      uses: this.uses.get(d.id) ?? 0,
      lastUsedAt: this.lastUsedAt.get(d.id) ?? null,
    }));
  }

  get(id: string): SkillState | undefined {
    return this.list().find((s) => s.id === id);
  }

  count(): { total: number; enabled: number; companion: number } {
    const all = this.list();
    return {
      total: all.length,
      enabled: all.filter((s) => s.enabled).length,
      companion: all.filter((s) => s.source === 'companion').length,
    };
  }

  /**
   * Fail-open: unknown ids (tools the registry hasn't catalogued yet) are
   * treated as enabled so new capabilities work before they are listed.
   */
  isEnabled(id: string): boolean {
    if (LOCKED_ACTIONS.has(id)) return true;
    return this.enabled.get(id) ?? true;
  }

  setEnabled(id: string, on: boolean) {
    if (LOCKED_ACTIONS.has(id)) return;
    this.enabled.set(id, on);
    this.persist();
    this.dispatchEvent(new CustomEvent('change', { detail: { id, enabled: on } }));
  }

  recordUse(id: string) {
    this.uses.set(id, (this.uses.get(id) ?? 0) + 1);
    this.lastUsedAt.set(id, Date.now());
    this.persist();
    this.dispatchEvent(new CustomEvent('change', { detail: { id, used: true } }));
  }

  resetUsage() {
    this.uses.clear();
    this.lastUsedAt.clear();
    this.persist();
    this.dispatchEvent(new CustomEvent('change', { detail: { resetUsage: true } }));
  }

  /**
   * Merge daemon action names into the catalogue. Preserves on/off switches
   * and stats; drops actions the daemon no longer reports. Returns how many
   * companion skills are now known.
   */
  mergeCompanionSkills(names: string[]): number {
    const clean = [...new Set(names.filter((n) => typeof n === 'string' && n && !HIDDEN_ACTIONS.has(n)))].sort();
    this.companionIds = clean;
    this.persist();
    this.dispatchEvent(new CustomEvent('change', { detail: { companion: clean.length } }));
    return clean.length;
  }

  /** Ask the daemon for its live action list and merge it in. */
  async refreshFromCompanion(
    caller: CompanionCaller = defaultCaller,
  ): Promise<CompanionCallReply & { merged?: number }> {
    let reply: CompanionCallReply<{ skills?: unknown }>;
    try {
      reply = await caller<{ skills?: unknown }>('skills_list', {});
    } catch {
      return { ok: false, error: 'transport_unavailable' };
    }
    if (!reply.ok) return reply;
    const skills = reply.result?.skills;
    if (!Array.isArray(skills)) {
      return { ok: false, error: 'bad_shape', detail: 'skills_list did not return an array' };
    }
    const merged = this.mergeCompanionSkills(skills.filter((s): s is string => typeof s === 'string'));
    return { ok: true, merged };
  }

  private persist() {
    try {
      if (typeof localStorage === 'undefined') return;
      const saved: PersistedSkills = {
        enabled: Object.fromEntries(this.enabled),
        uses: Object.fromEntries(this.uses),
        lastUsedAt: Object.fromEntries(this.lastUsedAt),
        companionIds: this.companionIds,
      };
      localStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(saved));
    } catch {
      /* storage full / private mode — in-memory still works */
    }
  }
}

export const skillsRegistry = new SkillsRegistry();
