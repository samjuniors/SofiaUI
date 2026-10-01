/**
 * lib/daily-skills.ts — typed client for the Phase 4 daily companion skills.
 *
 * Files, PC health, media controls and the WhatsApp draft-first flow, all
 * driving the daemon actions that already exist (`files_*`, `health_*`,
 * `media_*`, `whatsapp_*`). Every function takes an injectable caller so
 * unit tests run without a daemon; the default caller is the live
 * `companion` link.
 *
 * Failures surface as `DailyError` (machine `code`, human `message`,
 * `needsConfirmation` for the two-step destructive flows).
 */

import { companion, type CompanionReply } from './companion-client.ts';

/** Injectable transport — defaults to the live companion link. */
export type DailyCaller = (
  action: string,
  args?: Record<string, unknown>,
) => Promise<CompanionReply<unknown>>;

export const defaultCaller: DailyCaller = (action, args) =>
  companion.send(action, args ?? {});

export class DailyError extends Error {
  code: string;
  detail?: string;
  needsConfirmation: boolean;

  constructor(code: string, message: string, opts: { detail?: string; needsConfirmation?: boolean } = {}) {
    super(message);
    this.name = 'DailyError';
    this.code = code;
    this.detail = opts.detail;
    this.needsConfirmation = opts.needsConfirmation === true;
  }

  static fromReply(reply: CompanionReply<unknown>): DailyError {
    const code = reply.error || 'action_failed';
    return new DailyError(code, reply.detail || reply.error || 'The companion could not do that.', {
      detail: reply.detail,
      needsConfirmation: reply.needsConfirmation === true,
    });
  }
}

async function call(caller: DailyCaller, action: string, args: Record<string, unknown> = {}): Promise<unknown> {
  let reply: CompanionReply<unknown>;
  try {
    reply = await caller(action, args);
  } catch (err) {
    throw new DailyError('transport', 'Could not reach the companion.', {
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  if (!reply.ok) throw DailyError.fromReply(reply);
  return reply.result;
}

// ─── Validation ─────────────────────────────────────────────────────────────

function needStr(value: unknown, what: string): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) throw new DailyError('validation', `${what} is required.`);
  return s;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Join a child name onto a daemon path, honouring its separator flavour. */
export function joinChild(dir: string, name: string): string {
  const d = needStr(dir, 'Directory');
  const n = needStr(name, 'Name');
  if (n === '.' || n === '..' || n.includes('/') || n.includes('\\')) {
    throw new DailyError('validation', `"${n}" is not a valid file name.`);
  }
  const sep = d.includes('\\') ? '\\' : '/';
  return `${d.replace(/[\\/]+$/, '')}${sep}${n}`;
}

/** Normalise a WhatsApp recipient to `+<digits>` / `<digits>`. */
export function normalisePhone(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().replace(/[\s\-().]/g, '') : '';
  if (!/^\+?\d{7,15}$/.test(s)) {
    throw new DailyError('validation', 'Enter a valid phone number (7–15 digits, optional leading +).');
  }
  return s;
}

/** True when the daemon reports a missing optional backend (playwright, …). */
export function isSetupError(err: unknown): boolean {
  const text = err instanceof DailyError ? `${err.message} ${err.detail ?? ''}` : String(err ?? '');
  return /playwright|not configured|no .* backend|not installed/i.test(text);
}

export const WHATSAPP_SETUP_HINT =
  'WhatsApp needs the optional playwright-core package plus your own Chrome profile on the companion machine. Drafts and sends stay disabled until then.';

// ─── Formatting ─────────────────────────────────────────────────────────────

export function formatBytes(n: unknown): string {
  const v = typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
  if (v < 1024) return `${Math.round(v)} B`;
  const units = ['KB', 'MB', 'GB'];
  let scaled = v / 1024;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(1)} ${units[unit]}`;
}

export function scoreColor(score: number): string {
  if (score >= 80) return '#34d399';
  if (score >= 55) return '#fbbf24';
  return '#f87171';
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

// ─── Files ──────────────────────────────────────────────────────────────────

export interface FileEntry {
  name: string;
  dir: boolean;
}

export interface FileHit {
  path: string;
  dir: boolean;
}

export interface TrashRecord {
  trashed: string;
  trashPath: string;
  at: number;
}

export async function listRoots(caller: DailyCaller = defaultCaller): Promise<string[]> {
  const res = (await call(caller, 'files_roots', {})) as { roots?: unknown };
  if (!res || !Array.isArray(res.roots)) throw new DailyError('bad_shape', 'The companion returned no file roots.');
  return res.roots.filter((r): r is string => typeof r === 'string');
}

export async function listFiles(
  caller: DailyCaller = defaultCaller,
  path: string,
): Promise<{ path: string; entries: FileEntry[] }> {
  const res = (await call(caller, 'files_list', { path: needStr(path, 'Path') })) as {
    path?: unknown;
    entries?: unknown;
  };
  const entries = Array.isArray(res?.entries)
    ? res.entries.filter((e): e is FileEntry => typeof e === 'object' && e !== null && typeof (e as FileEntry).name === 'string')
    : [];
  entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  return { path: typeof res?.path === 'string' ? res.path : path, entries };
}

export async function findFiles(
  caller: DailyCaller = defaultCaller,
  q: string,
  limit = 20,
): Promise<FileHit[]> {
  const query = needStr(q, 'Search text');
  const res = (await call(caller, 'files_find', { q: query, limit: clampInt(limit, 1, 100, 20) })) as {
    hits?: unknown;
  };
  if (!res || !Array.isArray(res.hits)) return [];
  return res.hits.filter((h): h is FileHit => typeof h === 'object' && h !== null && typeof (h as FileHit).path === 'string');
}

export async function readFile(
  caller: DailyCaller = defaultCaller,
  path: string,
): Promise<{ path: string; bytes: number; text: string }> {
  const res = (await call(caller, 'files_read', { path: needStr(path, 'Path') })) as {
    path?: unknown;
    bytes?: unknown;
    text?: unknown;
  };
  return {
    path: typeof res?.path === 'string' ? res.path : path,
    bytes: typeof res?.bytes === 'number' ? res.bytes : 0,
    text: typeof res?.text === 'string' ? res.text : '',
  };
}

export async function openFile(caller: DailyCaller = defaultCaller, path: string): Promise<string> {
  const res = (await call(caller, 'files_open', { path: needStr(path, 'Path') })) as { opened?: unknown };
  return typeof res?.opened === 'string' ? res.opened : path;
}

export async function renameFile(
  caller: DailyCaller = defaultCaller,
  dir: string,
  fromName: string,
  toName: string,
): Promise<{ from: string; to: string }> {
  const from = joinChild(dir, fromName);
  const to = joinChild(dir, toName);
  if (from === to) throw new DailyError('validation', 'The new name is the same as the old one.');
  const res = (await call(caller, 'files_move', { from, to })) as { from?: unknown; to?: unknown };
  return {
    from: typeof res?.from === 'string' ? res.from : from,
    to: typeof res?.to === 'string' ? res.to : to,
  };
}

/**
 * Move to the recoverable trash. First call (no `confirm`) returns a
 * `needsConfirmation` DailyError by design — the UI shows its inline
 * confirm, then retries with `confirm: true`.
 */
export async function trashFile(
  caller: DailyCaller = defaultCaller,
  path: string,
  confirm = false,
): Promise<TrashRecord> {
  const args: Record<string, unknown> = { path: needStr(path, 'Path') };
  if (confirm) args.confirm = true;
  const res = (await call(caller, 'files_trash', args)) as { trashed?: unknown; trashPath?: unknown };
  return {
    trashed: typeof res?.trashed === 'string' ? res.trashed : path,
    trashPath: typeof res?.trashPath === 'string' ? res.trashPath : '',
    at: Date.now(),
  };
}

export async function restoreFile(caller: DailyCaller = defaultCaller, trashPath: string): Promise<string> {
  const res = (await call(caller, 'files_restore', { path: needStr(trashPath, 'Trash path') })) as {
    restored?: unknown;
  };
  return typeof res?.restored === 'string' ? res.restored : trashPath;
}

// ─── PC health ──────────────────────────────────────────────────────────────

export interface DiskInfo {
  mount: string;
  sizeGB: number;
  freeGB: number;
  pctFree: number;
}

export interface HealthSnapshot {
  score: number;
  platform: string;
  cpu: { cores: number; loadPct: number };
  memory: { totalGB: number; usedPct: number };
  disks: DiskInfo[];
  battery: { level: number; charging: boolean } | null;
  uptime: { seconds: number; human: string };
  warnings: string[];
}

export interface ProcessInfo {
  name: string;
  memMB: number;
}

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

export async function healthSnapshot(caller: DailyCaller = defaultCaller): Promise<HealthSnapshot> {
  const res = (await call(caller, 'health_snapshot', {})) as Record<string, unknown>;
  const cpu = (res?.cpu ?? {}) as Record<string, unknown>;
  const memory = (res?.memory ?? {}) as Record<string, unknown>;
  const uptime = (res?.uptime ?? {}) as Record<string, unknown>;
  const battery = res?.battery as { level?: unknown; charging?: unknown } | null | undefined;
  return {
    score: clampInt(res?.score, 0, 100, 0),
    platform: typeof res?.platform === 'string' ? res.platform : 'unknown',
    cpu: { cores: num(cpu.cores), loadPct: clampInt(cpu.loadPct, 0, 100, 0) },
    memory: { totalGB: num(memory.totalGB), usedPct: clampInt(memory.usedPct, 0, 100, 0) },
    disks: Array.isArray(res?.disks)
      ? (res.disks as Array<Record<string, unknown>>).map((d) => ({
          mount: typeof d.mount === 'string' ? d.mount : '?',
          sizeGB: num(d.sizeGB),
          freeGB: num(d.freeGB),
          pctFree: clampInt(d.pctFree, 0, 100, 0),
        }))
      : [],
    battery:
      battery && typeof battery === 'object' && typeof battery.level === 'number'
        ? { level: clampInt(battery.level, 0, 100, 0), charging: battery.charging === true }
        : null,
    uptime: {
      seconds: num(uptime.seconds),
      human: typeof uptime.human === 'string' ? uptime.human : '—',
    },
    warnings: Array.isArray(res?.warnings) ? res.warnings.filter((w): w is string => typeof w === 'string') : [],
  };
}

export async function healthProcesses(caller: DailyCaller = defaultCaller, limit = 6): Promise<ProcessInfo[]> {
  const res = (await call(caller, 'health_processes', { limit: clampInt(limit, 1, 25, 6) })) as {
    processes?: unknown;
  };
  if (!res || !Array.isArray(res.processes)) return [];
  return (res.processes as Array<Record<string, unknown>>)
    .filter((p) => p && typeof p.name === 'string')
    .map((p) => ({ name: p.name as string, memMB: num(p.memMB) }));
}

// ─── Media ──────────────────────────────────────────────────────────────────

export type MediaOp =
  | 'play_pause'
  | 'next'
  | 'previous'
  | 'stop'
  | 'volume_up'
  | 'volume_down'
  | 'mute'
  | 'set_volume';

const MEDIA_OPS = new Set<string>([
  'play_pause',
  'next',
  'previous',
  'stop',
  'volume_up',
  'volume_down',
  'mute',
  'set_volume',
]);

export interface MediaStatus {
  playing: boolean | null;
  source: string | null;
  note?: string;
}

export async function mediaControl(
  caller: DailyCaller = defaultCaller,
  op: string,
  level?: number,
): Promise<{ op: string; level?: number }> {
  if (!MEDIA_OPS.has(op)) throw new DailyError('validation', `Unknown media control "${op}".`);
  const args: Record<string, unknown> = { op };
  if (op === 'set_volume') args.level = clampInt(level, 0, 100, 50);
  const res = (await call(caller, 'media_control', args)) as { op?: unknown; level?: unknown };
  return {
    op: typeof res?.op === 'string' ? res.op : op,
    level: typeof res?.level === 'number' ? res.level : undefined,
  };
}

export async function mediaStatus(caller: DailyCaller = defaultCaller): Promise<MediaStatus> {
  const res = (await call(caller, 'media_status', {})) as {
    playing?: unknown;
    source?: unknown;
    note?: unknown;
  };
  return {
    playing: typeof res?.playing === 'boolean' ? res.playing : null,
    source: typeof res?.source === 'string' && res.source ? res.source : null,
    note: typeof res?.note === 'string' ? res.note : undefined,
  };
}

// ─── WhatsApp (draft-first) ─────────────────────────────────────────────────
// The daemon side is a stub until playwright-core + a Chrome profile are
// configured; these wrappers already enforce the draft-first contract and
// surface setup errors gracefully so the UI works the day the daemon lands.

export interface WhatsAppDraft {
  to: string;
  text: string;
  at: number;
}

export async function whatsappOpen(caller: DailyCaller = defaultCaller, phone?: string): Promise<void> {
  const args: Record<string, unknown> = {};
  if (phone && phone.trim()) args.phone = normalisePhone(phone);
  await call(caller, 'whatsapp_open', args);
}

export async function whatsappDraft(
  caller: DailyCaller = defaultCaller,
  to: string,
  text: string,
): Promise<WhatsAppDraft> {
  const recipient = normalisePhone(to);
  const body = needStr(text, 'Message');
  if (body.length > 4000) throw new DailyError('validation', 'Messages are capped at 4000 characters.');
  await call(caller, 'whatsapp_draft', { to: recipient, text: body });
  return { to: recipient, text: body, at: Date.now() };
}

/**
 * Send a previously drafted message. Draft-first: `draft` must match the
 * exact recipient + text (the UI holds it from `whatsappDraft`).
 * Like trash, the first call needs no `confirm` and the daemon gates it —
 * the UI confirms inline, then retries with `confirm: true`.
 */
export async function whatsappSend(
  caller: DailyCaller = defaultCaller,
  draft: WhatsAppDraft | null,
  to: string,
  text: string,
  confirm = false,
): Promise<void> {
  const recipient = normalisePhone(to);
  const body = needStr(text, 'Message');
  if (!draft || draft.to !== recipient || draft.text !== body) {
    throw new DailyError('validation', 'Draft this exact message first — sending never happens from a cold compose.');
  }
  const args: Record<string, unknown> = { to: recipient, text: body };
  if (confirm) args.confirm = true;
  await call(caller, 'whatsapp_send', args);
}

export interface UnreadChat {
  chat: string;
  count: number;
}

export async function whatsappUnread(caller: DailyCaller = defaultCaller): Promise<UnreadChat[]> {
  const res = (await call(caller, 'whatsapp_unread', {})) as { chats?: unknown; unread?: unknown };
  const list = Array.isArray(res?.chats) ? res.chats : Array.isArray(res?.unread) ? res.unread : [];
  return (list as Array<Record<string, unknown>>)
    .filter((c) => c && typeof c.chat === 'string')
    .map((c) => ({ chat: c.chat as string, count: num(c.count, 1) }));
}
