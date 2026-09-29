/**
 * ui/MindPanels.tsx — Settings UI for the Phase 2 mind.
 *
 *   - `MemoryPanel` — durable facts (name, people, preferences, standing
 *     instructions) with companion push/pull.
 *   - `SoulPanel` — persona presets + dials + catchphrases + boundaries.
 *   - `SkillsPanel` — every capability with on/off + usage stats, merged
 *     with the companion daemon's live `skills_list`.
 */

import { useEffect, useState } from 'react';
import { memoryStore } from '../core/MemoryStore';
import { soulStore, SOUL_PRESETS, type SoulDials, type SoulPresetId } from '../core/Soul';
import { skillsRegistry, type SkillCategory, type SkillState } from '../core/SkillsRegistry';
import { companion } from '../lib/companion-client';

// ─── Shared bits ──────────────────────────────────────────────────────────────

function useMindVersion(stores: EventTarget[]): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV((n) => n + 1);
    for (const s of stores) s.addEventListener('change', bump);
    companion.addEventListener('status', bump);
    return () => {
      for (const s of stores) s.removeEventListener('change', bump);
      companion.removeEventListener('status', bump);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[9px] font-normal uppercase tracking-[0.24em] text-white/40">
      {children}
    </p>
  );
}

function MiniToggle({
  on,
  disabled,
  label,
  onChange,
}: {
  on: boolean;
  disabled?: boolean;
  label: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-200 ${
        on
          ? 'border-sky-400/50 bg-sky-400/30 shadow-[0_0_10px_rgba(56,189,248,0.3)]'
          : 'border-white/10 bg-white/5'
      } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
    >
      <span
        className={`block size-3.5 rounded-full transition-transform duration-200 ${
          on ? 'translate-x-4 bg-sky-300 shadow-[0_0_6px_rgba(125,211,252,0.8)]' : 'translate-x-0.5 bg-white/40'
        }`}
      />
    </button>
  );
}

function MiniSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-normal uppercase tracking-[0.2em] text-white/55">{label}</span>
        <span className="font-mono text-[9px] text-sky-300/80">{value}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="sophia-range w-full"
      />
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-white/10 bg-[#080d1a] px-2.5 py-1.5 text-[11px] text-white/90 outline-none placeholder:text-white/20 focus:border-sky-400';

function timeAgo(ts: number | null): string {
  if (ts === null) return 'never';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ─── Memory ───────────────────────────────────────────────────────────────────

export function MemoryPanel() {
  useMindVersion([memoryStore]);
  const snap = memoryStore.snapshot();
  const [nameDraft, setNameDraft] = useState(snap.userName);
  const [personName, setPersonName] = useState('');
  const [personRelation, setPersonRelation] = useState('');
  const [personNotes, setPersonNotes] = useState('');
  const [prefKey, setPrefKey] = useState('');
  const [prefVal, setPrefVal] = useState('');
  const [instruction, setInstruction] = useState('');
  const [syncMsg, setSyncMsg] = useState('');

  useEffect(() => setNameDraft(memoryStore.snapshot().userName), []);

  const commitName = () => {
    if (nameDraft.trim() !== snap.userName) memoryStore.setUserName(nameDraft);
  };

  const sync = async (dir: 'push' | 'pull') => {
    setSyncMsg(dir === 'push' ? 'Saving to companion…' : 'Loading from companion…');
    try {
      const r =
        dir === 'push' ? await memoryStore.pushToCompanion() : await memoryStore.pullFromCompanion();
      setSyncMsg(
        r.ok
          ? dir === 'push'
            ? 'Saved to the companion.'
            : (r as { adopted?: boolean }).adopted
              ? 'Loaded newer companion copy.'
              : 'Local copy is already newest.'
          : `Companion: ${r.error === 'not_connected' ? 'not connected' : (r.detail ?? r.error ?? 'failed')}`,
      );
    } catch {
      setSyncMsg('Companion: unreachable.');
    }
    setTimeout(() => setSyncMsg(''), 2600);
  };

  return (
    <div className="space-y-3">
      <div>
        <Label>What should Sofia call you?</Label>
        <input
          type="text"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          placeholder="Your name…"
          aria-label="Your name"
          className={inputCls}
        />
      </div>

      <div>
        <Label>People in your life ({snap.people.length})</Label>
        <div className="space-y-1.5">
          {snap.people.map((p) => (
            <div
              key={p.name.toLowerCase()}
              className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5"
            >
              <p className="truncate text-[11px] text-white/85">
                {p.name}
                {p.relation && <span className="text-white/45"> · {p.relation}</span>}
                {p.notes && <span className="text-white/35"> — {p.notes}</span>}
              </p>
              <button
                type="button"
                onClick={() => memoryStore.removePerson(p.name)}
                aria-label={`Forget ${p.name}`}
                className="shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] text-white/35 transition hover:bg-rose-500/15 hover:text-rose-300"
              >
                ✕
              </button>
            </div>
          ))}
          <div className="grid grid-cols-3 gap-1.5">
            <input
              type="text"
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
              placeholder="Name"
              aria-label="Person name"
              className={inputCls}
            />
            <input
              type="text"
              value={personRelation}
              onChange={(e) => setPersonRelation(e.target.value)}
              placeholder="Relation"
              aria-label="Person relation"
              className={inputCls}
            />
            <input
              type="text"
              value={personNotes}
              onChange={(e) => setPersonNotes(e.target.value)}
              placeholder="Notes"
              aria-label="Person notes"
              className={inputCls}
            />
          </div>
          <button
            type="button"
            disabled={!personName.trim()}
            onClick={() => {
              memoryStore.upsertPerson({
                name: personName,
                relation: personRelation || undefined,
                notes: personNotes || undefined,
              });
              setPersonName('');
              setPersonRelation('');
              setPersonNotes('');
            }}
            className="h-7 w-full rounded-lg border border-sky-400/25 bg-sky-400/[0.08] text-[9.5px] tracking-[0.14em] text-sky-100 transition hover:bg-sky-400/[0.16] disabled:opacity-30"
          >
            + REMEMBER PERSON
          </button>
        </div>
      </div>

      <div>
        <Label>Preferences ({Object.keys(snap.preferences).length})</Label>
        <div className="space-y-1.5">
          {Object.entries(snap.preferences).map(([k, v]) => (
            <div
              key={k}
              className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5"
            >
              <p className="truncate font-mono text-[10.5px] text-white/80">
                {k} <span className="text-sky-300/70">= {v}</span>
              </p>
              <button
                type="button"
                onClick={() => memoryStore.removePreference(k)}
                aria-label={`Forget preference ${k}`}
                className="shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] text-white/35 transition hover:bg-rose-500/15 hover:text-rose-300"
              >
                ✕
              </button>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-1.5">
            <input
              type="text"
              value={prefKey}
              onChange={(e) => setPrefKey(e.target.value)}
              placeholder="e.g. coffee"
              aria-label="Preference name"
              className={inputCls}
            />
            <input
              type="text"
              value={prefVal}
              onChange={(e) => setPrefVal(e.target.value)}
              placeholder="e.g. flat white"
              aria-label="Preference value"
              className={inputCls}
            />
          </div>
          <button
            type="button"
            disabled={!prefKey.trim() || !prefVal.trim()}
            onClick={() => {
              memoryStore.setPreference(prefKey, prefVal);
              setPrefKey('');
              setPrefVal('');
            }}
            className="h-7 w-full rounded-lg border border-sky-400/25 bg-sky-400/[0.08] text-[9.5px] tracking-[0.14em] text-sky-100 transition hover:bg-sky-400/[0.16] disabled:opacity-30"
          >
            + SAVE PREFERENCE
          </button>
        </div>
      </div>

      <div>
        <Label>Standing instructions ({snap.instructions.length})</Label>
        <div className="space-y-1.5">
          {snap.instructions.map((s) => (
            <div
              key={s}
              className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5"
            >
              <p className="text-[11px] leading-snug text-white/85">{s}</p>
              <button
                type="button"
                onClick={() => memoryStore.removeInstruction(s)}
                aria-label="Remove instruction"
                className="shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] text-white/35 transition hover:bg-rose-500/15 hover:text-rose-300"
              >
                ✕
              </button>
            </div>
          ))}
          <div className="flex gap-1.5">
            <input
              type="text"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && instruction.trim()) {
                  memoryStore.addInstruction(instruction);
                  setInstruction('');
                }
              }}
              placeholder="e.g. Always confirm before sending anything."
              aria-label="New standing instruction"
              className={inputCls}
            />
            <button
              type="button"
              disabled={!instruction.trim()}
              onClick={() => {
                memoryStore.addInstruction(instruction);
                setInstruction('');
              }}
              className="shrink-0 rounded-lg border border-sky-400/25 bg-sky-400/[0.08] px-3 text-[11px] text-sky-100 transition hover:bg-sky-400/[0.16] disabled:opacity-30"
            >
              Add
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-white/[0.06] pt-2.5">
        <p className="font-mono text-[8.5px] text-white/40">
          {syncMsg || (companion.connected ? 'Companion linked · auto-saved' : 'Local only · pair the companion to back up')}
        </p>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => void sync('pull')}
            disabled={!companion.connected}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[8.5px] text-white/70 transition hover:bg-white/[0.08] disabled:opacity-30"
          >
            Load ↓
          </button>
          <button
            type="button"
            onClick={() => void sync('push')}
            disabled={!companion.connected}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[8.5px] text-white/70 transition hover:bg-white/[0.08] disabled:opacity-30"
          >
            Save ↑
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Soul ─────────────────────────────────────────────────────────────────────

const DIAL_LABELS: Array<{ id: keyof SoulDials; label: string }> = [
  { id: 'warmth', label: 'Warmth' },
  { id: 'humour', label: 'Humour' },
  { id: 'formality', label: 'Formality' },
  { id: 'verbosity', label: 'Verbosity' },
  { id: 'energy', label: 'Energy' },
];

export function SoulPanel() {
  useMindVersion([soulStore]);
  const snap = soulStore.snapshot();
  const [phrase, setPhrase] = useState('');
  const [boundary, setBoundary] = useState('');

  return (
    <div className="space-y-3">
      <div>
        <Label>Persona preset</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(SOUL_PRESETS) as SoulPresetId[]).map((id) => {
            const p = SOUL_PRESETS[id];
            const active = snap.preset === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => soulStore.applyPreset(id)}
                className={`rounded-lg border p-2 text-left transition-all ${
                  active
                    ? 'border-sky-400/50 bg-sky-400/10 text-sky-200 shadow-[0_0_10px_rgba(56,189,248,0.2)]'
                    : 'border-white/5 bg-white/[0.02] text-white/50 hover:bg-white/[0.05] hover:text-white/80'
                }`}
              >
                <p className="font-mono text-[9px] font-semibold text-white/90">{p.label}</p>
                <p className="mt-0.5 text-[7.5px] leading-tight text-white/40">{p.blurb}</p>
              </button>
            );
          })}
        </div>
        {snap.preset === 'custom' && (
          <p className="mt-1.5 font-mono text-[8.5px] text-amber-300/80">
            Custom blend — nudge a preset above to start over.
          </p>
        )}
      </div>

      <div className="space-y-2.5">
        {DIAL_LABELS.map((d) => (
          <MiniSlider
            key={d.id}
            label={d.label}
            value={snap[d.id]}
            onChange={(v) => soulStore.setDials({ [d.id]: v })}
          />
        ))}
      </div>

      <div>
        <Label>Signature phrases ({snap.catchphrases.length})</Label>
        <div className="flex flex-wrap gap-1.5">
          {snap.catchphrases.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => soulStore.setCatchphrases(snap.catchphrases.filter((x) => x !== p))}
              title="Remove phrase"
              className="rounded-full border border-sky-400/25 bg-sky-400/[0.08] px-2.5 py-1 font-mono text-[9.5px] text-sky-100 transition hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-200"
            >
              “{p}” ✕
            </button>
          ))}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          <input
            type="text"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && phrase.trim()) {
                soulStore.setCatchphrases([...snap.catchphrases, phrase]);
                setPhrase('');
              }
            }}
            placeholder="e.g. too easy"
            aria-label="New signature phrase"
            className={inputCls}
          />
          <button
            type="button"
            disabled={!phrase.trim()}
            onClick={() => {
              soulStore.setCatchphrases([...snap.catchphrases, phrase]);
              setPhrase('');
            }}
            className="shrink-0 rounded-lg border border-sky-400/25 bg-sky-400/[0.08] px-3 text-[11px] text-sky-100 transition hover:bg-sky-400/[0.16] disabled:opacity-30"
          >
            Add
          </button>
        </div>
      </div>

      <div>
        <Label>Hard boundaries ({snap.boundaries.length})</Label>
        <div className="space-y-1.5">
          {snap.boundaries.map((b) => (
            <div
              key={b}
              className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5"
            >
              <p className="text-[11px] leading-snug text-white/85">{b}</p>
              <button
                type="button"
                onClick={() => soulStore.setBoundaries(snap.boundaries.filter((x) => x !== b))}
                aria-label="Remove boundary"
                className="shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] text-white/35 transition hover:bg-rose-500/15 hover:text-rose-300"
              >
                ✕
              </button>
            </div>
          ))}
          <div className="flex gap-1.5">
            <input
              type="text"
              value={boundary}
              onChange={(e) => setBoundary(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && boundary.trim()) {
                  soulStore.setBoundaries([...snap.boundaries, boundary]);
                  setBoundary('');
                }
              }}
              placeholder="e.g. Never discuss politics."
              aria-label="New boundary"
              className={inputCls}
            />
            <button
              type="button"
              disabled={!boundary.trim()}
              onClick={() => {
                soulStore.setBoundaries([...snap.boundaries, boundary]);
                setBoundary('');
              }}
              className="shrink-0 rounded-lg border border-sky-400/25 bg-sky-400/[0.08] px-3 text-[11px] text-sky-100 transition hover:bg-sky-400/[0.16] disabled:opacity-30"
            >
              Add
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-white/[0.06] pt-2.5">
        <p className="font-mono text-[8.5px] text-white/40">
          {companion.connected ? 'Companion linked · auto-saved' : 'Local only · pair the companion to back up'}
        </p>
        <button
          type="button"
          onClick={() => soulStore.reset()}
          className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[8.5px] text-white/70 transition hover:bg-white/[0.08]"
        >
          Reset to Warm Companion
        </button>
      </div>
    </div>
  );
}

// ─── Skills ───────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<SkillCategory, string> = {
  voice: 'Voice',
  chat: 'Chat & tools',
  device: 'Device',
  browser: 'Browser',
  files: 'Files',
  memory: 'Memory',
  media: 'Media',
  system: 'System',
  companion: 'Companion',
};

const CATEGORY_ORDER: SkillCategory[] = [
  'chat',
  'voice',
  'device',
  'browser',
  'files',
  'memory',
  'media',
  'system',
  'companion',
];

function SkillRow({ skill }: { skill: SkillState }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
      <div className="min-w-0">
        <p className="truncate text-[11px] text-white/85">
          {skill.label}
          {skill.source === 'companion' && (
            <span className="ml-1.5 rounded border border-white/10 bg-white/[0.04] px-1 py-px font-mono text-[7.5px] uppercase tracking-wider text-white/40">
              daemon
            </span>
          )}
          {skill.locked && (
            <span className="ml-1.5 rounded border border-emerald-400/20 bg-emerald-400/10 px-1 py-px font-mono text-[7.5px] uppercase tracking-wider text-emerald-300/80">
              always on
            </span>
          )}
        </p>
        <p className="truncate font-mono text-[8px] text-white/35">
          {skill.uses === 0 ? 'unused' : `used ${skill.uses}× · ${timeAgo(skill.lastUsedAt)}`}
        </p>
      </div>
      <MiniToggle
        on={skill.enabled}
        disabled={skill.locked}
        label={`Toggle ${skill.label}`}
        onChange={(on) => skillsRegistry.setEnabled(skill.id, on)}
      />
    </div>
  );
}

export function SkillsPanel() {
  useMindVersion([skillsRegistry]);
  const [msg, setMsg] = useState('');
  const all = skillsRegistry.list();
  const counts = skillsRegistry.count();

  const refresh = async () => {
    setMsg('Asking the daemon…');
    const r = await skillsRegistry.refreshFromCompanion();
    setMsg(
      r.ok
        ? `Daemon reports ${r.merged} actions.`
        : `Daemon: ${r.error === 'not_connected' ? 'not connected — showing local skills' : (r.detail ?? r.error ?? 'failed')}`,
    );
    setTimeout(() => setMsg(''), 2600);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[8.5px] text-white/45">
          {msg || `${counts.enabled}/${counts.total} on · ${counts.companion} from daemon`}
        </p>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => skillsRegistry.resetUsage()}
            title="Clear usage counters"
            className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[8.5px] text-white/70 transition hover:bg-white/[0.08]"
          >
            Clear stats
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={!companion.connected}
            className="rounded-lg border border-sky-400/25 bg-sky-400/[0.08] px-2 py-1 text-[8.5px] text-sky-100 transition hover:bg-sky-400/[0.16] disabled:opacity-30"
          >
            ⟳ Daemon skills
          </button>
        </div>
      </div>

      {!companion.connected && counts.companion === 0 && (
        <p className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] px-3 py-2 text-[10px] font-light leading-relaxed text-amber-200/80">
          Pair the companion daemon to see its live capabilities here — file, browser, health,
          media and local-voice actions appear automatically.
        </p>
      )}

      <div className="max-h-[300px] space-y-3 overflow-y-auto pr-1">
        {CATEGORY_ORDER.map((cat) => {
          const group = all.filter((s) => s.category === cat);
          if (group.length === 0) return null;
          return (
            <div key={cat}>
              <Label>
                {CATEGORY_LABELS[cat]} ({group.filter((s) => s.enabled).length}/{group.length})
              </Label>
              <div className="space-y-1.5">
                {group.map((s) => (
                  <SkillRow key={s.id} skill={s} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <p className="border-t border-white/[0.06] pt-2 font-mono text-[8.5px] leading-relaxed text-white/35">
        Switching a skill off blocks it for both voice and chat. Usage counts update live as
        Sofia works.
      </p>
    </div>
  );
}
