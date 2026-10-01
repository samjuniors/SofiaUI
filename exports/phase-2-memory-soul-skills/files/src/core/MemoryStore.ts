/**
 * core/MemoryStore.ts — Sofia's durable facts about the user.
 *
 * Phase 2 (Memory · Soul · Skills). Distinct from `SophiaMemory` (episodic
 * story/topic recall): this store holds long-lived facts — the user's name,
 * the people in their life, preferences, and standing instructions — that
 * survive browser resets via the companion daemon (`store_*` under key
 * `sophia:memory-store`) and are readable by every brain through the chat
 * `context` field.
 *
 * Pure module: no browser or companion imports at load time, so unit tests
 * run under plain node. Emits `change` for the Settings → Memory UI.
 */

import type { CompanionCaller, CompanionCallReply } from './Soul';

export interface PersonEntry {
  name: string;
  relation?: string;
  notes?: string;
}

export interface MemorySnapshot {
  /** What Sofia should call the user ('' = unknown). */
  userName: string;
  people: PersonEntry[];
  preferences: Record<string, string>;
  instructions: string[];
  updatedAt: number;
}

export const MEMORY_STORAGE_KEY = 'sophia:memory-store:v1';
export const MEMORY_COMPANION_KEY = 'sophia:memory-store';

const MAX_NAME_LEN = 80;
const MAX_PEOPLE = 50;
const MAX_PERSON_FIELD = 160;
const MAX_PREFS = 100;
const MAX_PREF_KEY = 60;
const MAX_PREF_VALUE = 300;
const MAX_INSTRUCTIONS = 30;
const MAX_INSTRUCTION_LEN = 500;

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

function cleanPerson(p: unknown): PersonEntry | null {
  if (typeof p === 'string') {
    const name = p.trim().slice(0, MAX_NAME_LEN);
    return name ? { name } : null;
  }
  if (typeof p !== 'object' || p === null) return null;
  const obj = p as Record<string, unknown>;
  const name = typeof obj.name === 'string' ? obj.name.trim().slice(0, MAX_NAME_LEN) : '';
  if (!name) return null;
  const entry: PersonEntry = { name };
  if (typeof obj.relation === 'string' && obj.relation.trim()) {
    entry.relation = obj.relation.trim().slice(0, MAX_PERSON_FIELD);
  }
  if (typeof obj.notes === 'string' && obj.notes.trim()) {
    entry.notes = obj.notes.trim().slice(0, MAX_PERSON_FIELD);
  }
  return entry;
}

function cleanPreferences(p: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof p !== 'object' || p === null) return out;
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
    if (typeof v !== 'string') continue;
    const key = k.trim().slice(0, MAX_PREF_KEY);
    const val = v.trim().slice(0, MAX_PREF_VALUE);
    if (key && val) out[key] = val;
    if (Object.keys(out).length >= MAX_PREFS) break;
  }
  return out;
}

function cleanInstructions(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const t = item.trim().slice(0, MAX_INSTRUCTION_LEN);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_INSTRUCTIONS) break;
  }
  return out;
}

function normaliseSnapshot(input: Partial<MemorySnapshot>): MemorySnapshot {
  const people: PersonEntry[] = [];
  if (Array.isArray(input.people)) {
    for (const p of input.people) {
      const c = cleanPerson(p);
      if (c && !people.some((e) => e.name.toLowerCase() === c.name.toLowerCase())) {
        people.push(c);
      }
      if (people.length >= MAX_PEOPLE) break;
    }
  }
  return {
    userName: typeof input.userName === 'string' ? input.userName.trim().slice(0, MAX_NAME_LEN) : '',
    people,
    preferences: cleanPreferences(input.preferences),
    instructions: cleanInstructions(input.instructions),
    updatedAt:
      typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt)
        ? input.updatedAt
        : Date.now(),
  };
}

export function defaultMemorySnapshot(): MemorySnapshot {
  return { userName: '', people: [], preferences: {}, instructions: [], updatedAt: Date.now() };
}

function loadLocal(): MemorySnapshot | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(MEMORY_STORAGE_KEY);
    if (!raw) return null;
    return normaliseSnapshot(JSON.parse(raw) as Partial<MemorySnapshot>);
  } catch {
    return null;
  }
}

/** Render facts as a compact prompt block. Returns '' when there is nothing to say. */
export function memoryContextFor(snap: Partial<MemorySnapshot> | null | undefined): string {
  if (!snap || typeof snap !== 'object') return '';
  const parts: string[] = [];
  const name = typeof snap.userName === 'string' ? snap.userName.trim() : '';
  if (name) parts.push(`The user's name is "${name}".`);
  const people = Array.isArray(snap.people) ? snap.people : [];
  const rendered = people
    .map(cleanPerson)
    .filter((p): p is PersonEntry => p !== null)
    .map((p) => {
      let s = p.name;
      if (p.relation) s += ` (${p.relation})`;
      if (p.notes) s += ` — ${p.notes}`;
      return s;
    });
  if (rendered.length > 0) parts.push(`People in their life: ${rendered.join('; ')}.`);
  const prefs = snap.preferences && typeof snap.preferences === 'object' ? snap.preferences : {};
  const prefPairs = Object.entries(prefs).filter(
    ([k, v]) => typeof k === 'string' && k.trim() && typeof v === 'string' && v.trim(),
  );
  if (prefPairs.length > 0) {
    parts.push(`Preferences: ${prefPairs.map(([k, v]) => `${k.trim()} = ${String(v).trim()}`).join('; ')}.`);
  }
  const instructions = cleanInstructions(snap.instructions);
  if (instructions.length > 0) {
    parts.push(`Standing instructions: ${instructions.map((s, i) => `(${i + 1}) ${s}`).join(' ')}`);
  }
  if (parts.length === 0) return '';
  return `[USER MEMORY — durable facts, treat as known context] ${parts.join(' ')}`;
}

export class MemoryStore extends EventTarget {
  private snap: MemorySnapshot;

  constructor(seed?: Partial<MemorySnapshot>) {
    super();
    this.snap = seed ? normaliseSnapshot(seed) : (loadLocal() ?? defaultMemorySnapshot());
  }

  snapshot(): MemorySnapshot {
    return {
      ...this.snap,
      people: this.snap.people.map((p) => ({ ...p })),
      preferences: { ...this.snap.preferences },
      instructions: [...this.snap.instructions],
    };
  }

  isEmpty(): boolean {
    return (
      !this.snap.userName &&
      this.snap.people.length === 0 &&
      Object.keys(this.snap.preferences).length === 0 &&
      this.snap.instructions.length === 0
    );
  }

  toPromptContext(): string {
    return memoryContextFor(this.snap);
  }

  private commit(next: MemorySnapshot) {
    this.snap = next;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(next));
      }
    } catch {
      /* storage full / private mode — in-memory still works */
    }
    this.dispatchEvent(new CustomEvent('change', { detail: this.snapshot() }));
    void this.pushToCompanion().catch(() => undefined);
  }

  setUserName(name: string) {
    this.commit({
      ...this.snap,
      userName: name.trim().slice(0, MAX_NAME_LEN),
      updatedAt: Date.now(),
    });
  }

  /** Add a person, or merge fields into the existing entry (matched by name). */
  upsertPerson(entry: PersonEntry) {
    const clean = cleanPerson(entry);
    if (!clean) return;
    const needle = clean.name.toLowerCase();
    const existing = this.snap.people.find((p) => p.name.toLowerCase() === needle);
    const merged: PersonEntry = existing
      ? {
          name: existing.name,
          relation: clean.relation ?? existing.relation,
          notes: clean.notes ?? existing.notes,
        }
      : clean;
    if (merged.relation === undefined) delete merged.relation;
    if (merged.notes === undefined) delete merged.notes;
    const people = this.snap.people.filter((p) => p.name.toLowerCase() !== needle);
    people.push(merged);
    while (people.length > MAX_PEOPLE) people.shift();
    this.commit({ ...this.snap, people, updatedAt: Date.now() });
  }

  removePerson(name: string) {
    const needle = name.trim().toLowerCase();
    if (!needle) return;
    this.commit({
      ...this.snap,
      people: this.snap.people.filter((p) => p.name.toLowerCase() !== needle),
      updatedAt: Date.now(),
    });
  }

  setPreference(key: string, value: string) {
    const k = key.trim().slice(0, MAX_PREF_KEY);
    const v = value.trim().slice(0, MAX_PREF_VALUE);
    if (!k) return;
    const preferences = { ...this.snap.preferences };
    if (v) {
      preferences[k] = v;
    } else {
      delete preferences[k];
    }
    this.commit({ ...this.snap, preferences, updatedAt: Date.now() });
  }

  removePreference(key: string) {
    const k = key.trim();
    if (!k || !(k in this.snap.preferences)) return;
    const preferences = { ...this.snap.preferences };
    delete preferences[k];
    this.commit({ ...this.snap, preferences, updatedAt: Date.now() });
  }

  addInstruction(text: string) {
    const t = text.trim().slice(0, MAX_INSTRUCTION_LEN);
    if (!t || this.snap.instructions.includes(t)) return;
    const instructions = [...this.snap.instructions, t].slice(-MAX_INSTRUCTIONS);
    this.commit({ ...this.snap, instructions, updatedAt: Date.now() });
  }

  removeInstruction(text: string) {
    const t = text.trim();
    if (!this.snap.instructions.includes(t)) return;
    this.commit({
      ...this.snap,
      instructions: this.snap.instructions.filter((s) => s !== t),
      updatedAt: Date.now(),
    });
  }

  clear() {
    this.commit(defaultMemorySnapshot());
  }

  // ── Companion sync (durable across browser resets) ────────────────────────

  async pushToCompanion(caller: CompanionCaller = defaultCaller): Promise<CompanionCallReply> {
    try {
      return await caller('store_put', { key: MEMORY_COMPANION_KEY, value: this.snapshot() });
    } catch {
      return { ok: false, error: 'transport_unavailable' };
    }
  }

  /**
   * Pull remote facts. Adopts them only when newer than local state; returns
   * `{found, adopted}` so callers can push the local copy back instead.
   */
  async pullFromCompanion(
    caller: CompanionCaller = defaultCaller,
  ): Promise<CompanionCallReply & { found?: boolean; adopted?: boolean }> {
    let reply: CompanionCallReply<{ value?: unknown; found?: boolean }>;
    try {
      reply = await caller<{ value?: unknown; found?: boolean }>('store_get', {
        key: MEMORY_COMPANION_KEY,
      });
    } catch {
      return { ok: false, error: 'transport_unavailable' };
    }
    if (!reply.ok) return reply;
    const remote = reply.result?.value as Partial<MemorySnapshot> | null | undefined;
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

export const memoryStore = new MemoryStore();
