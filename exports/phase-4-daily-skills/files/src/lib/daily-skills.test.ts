/**
 * lib/daily-skills.test.ts — daily companion skills with a fake transport.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DailyError,
  WHATSAPP_SETUP_HINT,
  findFiles,
  formatBytes,
  healthProcesses,
  healthSnapshot,
  isSetupError,
  joinChild,
  listFiles,
  listRoots,
  mediaControl,
  mediaStatus,
  normalisePhone,
  openFile,
  readFile,
  renameFile,
  restoreFile,
  scoreColor,
  trashFile,
  truncate,
  whatsappDraft,
  whatsappOpen,
  whatsappSend,
  whatsappUnread,
} from './daily-skills.ts';
import type { DailyCaller } from './daily-skills.ts';

function fake(result: unknown = {}) {
  const calls: Array<{ action: string; args: Record<string, unknown> }> = [];
  const caller: DailyCaller = async (action, args = {}) => {
    calls.push({ action, args });
    return { ok: true, result };
  };
  return { calls, caller };
}

function failing(error: string, detail = '', needsConfirmation = false): DailyCaller {
  return async () => ({ ok: false, error, detail, needsConfirmation });
}

async function rejectsCode(fn: () => Promise<unknown>, code: string): Promise<DailyError> {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof DailyError, `expected DailyError, got ${err}`);
    assert.equal(err.code, code);
    return err;
  }
  assert.fail(`expected rejection with code ${code}`);
}

// ─── Files ──────────────────────────────────────────────────────────────────

test('listRoots returns daemon roots and rejects bad shapes', async () => {
  const { caller } = fake({ roots: ['/a', '/b', 42] });
  assert.deepEqual(await listRoots(caller), ['/a', '/b']);
  await rejectsCode(() => listRoots(fake({}).caller), 'bad_shape');
});

test('listFiles sorts directories first, then alphabetically', async () => {
  const { caller } = fake({
    path: '/a',
    entries: [{ name: 'z.txt', dir: false }, { name: 'docs', dir: true }, { name: 'a.txt', dir: false }],
  });
  const r = await listFiles(caller, '/a');
  assert.deepEqual(
    r.entries.map((e) => e.name),
    ['docs', 'a.txt', 'z.txt'],
  );
});

test('findFiles validates the query and clamps the limit', async () => {
  const { calls, caller } = fake({ hits: [] });
  await findFiles(caller, 'report', 999);
  assert.equal(calls[0].args.q, 'report');
  assert.equal(calls[0].args.limit, 100);
  await rejectsCode(() => findFiles(caller, '   '), 'validation');
});

test('readFile and openFile shape their results', async () => {
  assert.deepEqual(await readFile(fake({ path: '/a', bytes: 3, text: 'hi\n' }).caller, '/a'), {
    path: '/a',
    bytes: 3,
    text: 'hi\n',
  });
  assert.equal(await openFile(fake({ opened: '/a' }).caller, '/a'), '/a');
});

test('renameFile moves within the directory and rejects no-ops', async () => {
  const { calls, caller } = fake({ from: '/d/a', to: '/d/b' });
  const r = await renameFile(caller, '/d', 'a', 'b');
  assert.deepEqual([calls[0].action, calls[0].args.from, calls[0].args.to], ['files_move', '/d/a', '/d/b']);
  assert.equal(r.to, '/d/b');
  await rejectsCode(() => renameFile(caller, '/d', 'a', 'a'), 'validation');
  await rejectsCode(() => renameFile(caller, '/d', 'a', '../x'), 'validation');
});

test('trashFile threads the confirm flag for the two-step flow', async () => {
  const gated = failing('confirmation_required', 'say the confirmation', true);
  const err = await rejectsCode(() => trashFile(gated, '/d/a'), 'confirmation_required');
  assert.equal(err.needsConfirmation, true);
  const { calls, caller } = fake({ trashed: '/d/a', trashPath: '/trash/1-a' });
  const rec = await trashFile(caller, '/d/a', true);
  assert.equal(calls[0].args.confirm, true);
  assert.equal(rec.trashPath, '/trash/1-a');
  assert.ok(rec.at > 0);
});

test('restoreFile validates its trash path', async () => {
  const { caller } = fake({ restored: '/d/a' });
  assert.equal(await restoreFile(caller, '/trash/1-a'), '/d/a');
  await rejectsCode(() => restoreFile(caller, '  '), 'validation');
});

test('joinChild honours both separator flavours', () => {
  assert.equal(joinChild('/d/sub', 'a.txt'), '/d/sub/a.txt');
  assert.equal(joinChild('/d/sub/', 'a.txt'), '/d/sub/a.txt');
  assert.equal(joinChild('C:\\Users\\Sam', 'a.txt'), 'C:\\Users\\Sam\\a.txt');
  assert.throws(() => joinChild('/d', '..'), DailyError);
  assert.throws(() => joinChild('/d', 'a/b'), DailyError);
  assert.throws(() => joinChild('  ', 'a'), DailyError);
});

// ─── Health ─────────────────────────────────────────────────────────────────

test('healthSnapshot normalises the full shape', async () => {
  const { caller } = fake({
    score: 92,
    platform: 'linux',
    cpu: { cores: 8, loadPct: 12 },
    memory: { totalGB: 16, usedPct: 44 },
    disks: [{ mount: '/', sizeGB: 100, freeGB: 40, pctFree: 40 }],
    battery: { level: 80, charging: true },
    uptime: { seconds: 3700, human: '1h 1m' },
    warnings: ['hi'],
  });
  const s = await healthSnapshot(caller);
  assert.equal(s.score, 92);
  assert.equal(s.cpu.cores, 8);
  assert.equal(s.disks[0].mount, '/');
  assert.deepEqual(s.battery, { level: 80, charging: true });
  assert.deepEqual(s.warnings, ['hi']);
});

test('healthSnapshot tolerates missing fields', async () => {
  const s = await healthSnapshot(fake({}).caller);
  assert.equal(s.score, 0);
  assert.equal(s.platform, 'unknown');
  assert.equal(s.battery, null);
  assert.deepEqual(s.disks, []);
  assert.deepEqual(s.warnings, []);
});

test('healthProcesses clamps the limit and filters junk', async () => {
  const { calls, caller } = fake({ processes: [{ name: 'a', memMB: 10 }, { nope: 1 }, { name: 'b' }] });
  const procs = await healthProcesses(caller, 99);
  assert.equal(calls[0].args.limit, 25);
  assert.deepEqual(procs, [
    { name: 'a', memMB: 10 },
    { name: 'b', memMB: 0 },
  ]);
  assert.deepEqual(await healthProcesses(fake({}).caller), []);
});

// ─── Media ──────────────────────────────────────────────────────────────────

test('mediaControl validates ops and clamps set_volume', async () => {
  const { calls, caller } = fake({ op: 'set_volume', level: 100 });
  await mediaControl(caller, 'set_volume', 140);
  assert.equal(calls[0].args.level, 100);
  await mediaControl(caller, 'next');
  assert.equal(calls[1].args.op, 'next');
  await rejectsCode(() => mediaControl(caller, 'explode'), 'validation');
});

test('mediaStatus normalises best-effort nulls', async () => {
  assert.deepEqual(await mediaStatus(fake({ playing: true, source: 'Spotify' }).caller), {
    playing: true,
    source: 'Spotify',
    note: undefined,
  });
  assert.deepEqual(await mediaStatus(fake({ playing: null, source: null, note: 'x' }).caller), {
    playing: null,
    source: null,
    note: 'x',
  });
});

// ─── WhatsApp ───────────────────────────────────────────────────────────────

test('normalisePhone accepts digits with optional +', () => {
  assert.equal(normalisePhone('+91 98765 43210'), '+919876543210');
  assert.equal(normalisePhone('(555) 123-4567'), '5551234567');
  assert.throws(() => normalisePhone('abc'), DailyError);
  assert.throws(() => normalisePhone('123'), DailyError);
  assert.throws(() => normalisePhone(''), DailyError);
});

test('whatsappDraft validates recipient and body', async () => {
  const { calls, caller } = fake({});
  const d = await whatsappDraft(caller, '+1234567890', 'hello');
  assert.deepEqual([calls[0].action, d.to, d.text], ['whatsapp_draft', '+1234567890', 'hello']);
  await rejectsCode(() => whatsappDraft(caller, 'bad', 'hi'), 'validation');
  await rejectsCode(() => whatsappDraft(caller, '+1234567890', '  '), 'validation');
  await rejectsCode(() => whatsappDraft(caller, '+1234567890', 'x'.repeat(4001)), 'validation');
});

test('whatsappSend is draft-first and confirm-gated', async () => {
  const { calls, caller } = fake({});
  const draft = { to: '+1234567890', text: 'hello', at: 1 };
  await rejectsCode(() => whatsappSend(caller, null, '+1234567890', 'hello', true), 'validation');
  await rejectsCode(() => whatsappSend(caller, draft, '+1234567890', 'different', true), 'validation');
  await rejectsCode(() => whatsappSend(caller, draft, '+9999999999', 'hello', true), 'validation');
  await whatsappSend(caller, draft, '+1234567890', 'hello', true);
  assert.deepEqual(calls[0].args, { to: '+1234567890', text: 'hello', confirm: true });
});

test('whatsappUnread tolerates either list shape', async () => {
  assert.deepEqual(await whatsappUnread(fake({ chats: [{ chat: 'Ada', count: 2 }] }).caller), [
    { chat: 'Ada', count: 2 },
  ]);
  assert.deepEqual(await whatsappUnread(fake({ unread: [{ chat: 'Bo' }] }).caller), [{ chat: 'Bo', count: 1 }]);
  assert.deepEqual(await whatsappUnread(fake({}).caller), []);
});

test('whatsappOpen passes an optional phone', async () => {
  const { calls, caller } = fake({});
  await whatsappOpen(caller);
  assert.deepEqual(calls[0].args, {});
  await whatsappOpen(caller, '+1234567890');
  assert.equal(calls[1].args.phone, '+1234567890');
});

// ─── Errors & formatting ────────────────────────────────────────────────────

test('daemon failures surface with codes and confirmation flags', async () => {
  const err = await rejectsCode(() => listRoots(failing('not_connected', 'no link')), 'not_connected');
  assert.equal(err.needsConfirmation, false);
  assert.equal(err.message, 'no link');
});

test('transport throws become DailyError', async () => {
  const boom: DailyCaller = async () => {
    throw new Error('socket died');
  };
  const err = await rejectsCode(() => listRoots(boom), 'transport');
  assert.equal(err.detail, 'socket died');
});

test('formatters behave', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(scoreColor(90), '#34d399');
  assert.equal(scoreColor(70), '#fbbf24');
  assert.equal(scoreColor(10), '#f87171');
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(truncate('ab', 4), 'ab');
});

test('setup errors are recognised', () => {
  assert.equal(isSetupError(new DailyError('action_failed', 'WhatsApp needs playwright-core installed.')), true);
  assert.equal(isSetupError(new DailyError('action_failed', 'xdotool missing, not installed?')), true);
  assert.equal(isSetupError(new DailyError('action_failed', 'Path is outside the sandbox.')), false);
  assert.ok(WHATSAPP_SETUP_HINT.includes('playwright'));
});
