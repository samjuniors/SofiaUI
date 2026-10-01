import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computerTool, __setComputerBackend, normalizeAppName, COMPUTER_SCHEMA, type ComputerBackend } from './computer-tool.ts';

function setup(callImpl?: ComputerBackend['call'], vision = false) {
  const calls: Array<{ action: string; args?: Record<string, unknown> }> = [];
  __setComputerBackend({
    call: async (action, args) => {
      calls.push({ action, args });
      return callImpl ? callImpl(action, args) : { ok: true, result: {} };
    },
    visionActive: () => vision,
  });
  return { calls };
}

test('normalizeAppName maps friendly names to allowlist ids', () => {
  assert.equal(normalizeAppName('Windows Media Player'), 'wmplayer');
  assert.equal(normalizeAppName('media player'), 'wmplayer');
  assert.equal(normalizeAppName('Paint'), 'mspaint');
  assert.equal(normalizeAppName('Snipping Tool'), 'snippingtool');
  assert.equal(normalizeAppName('Task Manager'), 'taskmgr');
  assert.equal(normalizeAppName('  NOTEPAD.EXE '), 'notepad');
  assert.equal(normalizeAppName('some-unknown-app'), 'some-unknown-app');
});

test('open_app normalizes the name before calling the daemon', async () => {
  const { calls } = setup();
  const r = await computerTool.invoke({ action: 'open_app', app: 'Windows Media Player' });
  assert.equal(r.success, true);
  assert.deepEqual(calls, [{ action: 'open_app', args: { app: 'wmplayer' } }]);
});

test('click passes coords through; bare click sends no move', async () => {
  const { calls } = setup();
  await computerTool.invoke({ action: 'click', x: 40, y: 900 });
  await computerTool.invoke({ action: 'right_click' });
  assert.deepEqual(calls[0], { action: 'click', args: { x: 40, y: 900 } });
  assert.deepEqual(calls[1], { action: 'right_click', args: {} });
});

test('move_mouse requires coords; scroll defaults down', async () => {
  const { calls } = setup();
  const bad = await computerTool.invoke({ action: 'move_mouse', x: 10 });
  assert.equal(bad.success, false);
  assert.equal(bad.error, 'missing_coords');
  const ok = await computerTool.invoke({ action: 'scroll' });
  assert.equal(ok.success, true);
  assert.deepEqual(calls, [{ action: 'scroll', args: { dy: 3 } }]);
});

test('type_text caps length; hotkey passes keys through', async () => {
  const { calls } = setup();
  await computerTool.invoke({ action: 'type_text', text: 'x'.repeat(5000) });
  await computerTool.invoke({ action: 'hotkey', keys: 'win' });
  assert.equal((calls[0].args as { text: string }).text.length, 1000);
  assert.deepEqual(calls[1], { action: 'hotkey', args: { keys: 'win' } });
});

test('browser actions map onto the same-tab CDP calls', async () => {
  const { calls } = setup();
  await computerTool.invoke({ action: 'browser_go', url: 'https://example.com' });
  await computerTool.invoke({ action: 'browser_click', text: 'Log in' });
  assert.deepEqual(calls[0], { action: 'browser_navigate', args: { url: 'https://example.com' } });
  assert.deepEqual(calls[1], { action: 'browser_click_text', args: { text: 'Log in' } });
});

test('active_window passes list:true for enumeration', async () => {
  const { calls } = setup(async () => ({ ok: true, result: { windows: [], count: 0 } }));
  const r = await computerTool.invoke({ action: 'active_window', list: true });
  assert.equal(r.success, true);
  assert.deepEqual(calls, [{ action: 'get_active_window', args: { list: true } }]);
});

test('find_text maps onto ground_text', async () => {
  const { calls } = setup(async () => ({ ok: true, result: { x: 12, y: 34 } }));
  const r = await computerTool.invoke({ action: 'find_text', text: 'Start' });
  assert.equal(r.success, true);
  assert.deepEqual(calls, [{ action: 'ground_text', args: { text: 'Start' } }]);
  assert.equal((r.data as { x: number }).x, 12);
});

test('daemon errors surface with their keys (confirmation, not_connected)', async () => {
  setup(async (action) =>
    action === 'open_app'
      ? { ok: false, error: 'confirmation_required', detail: 'Risky: args mention "send".', confirmation_id: 'abc123' }
      : { ok: false, error: 'not_connected', detail: 'Companion is not connected.' },
  );
  const c = await computerTool.invoke({ action: 'open_app', app: 'vlc' });
  assert.equal(c.success, false);
  assert.equal(c.error, 'confirmation_required');
  assert.match(String(c.errorDetail), /Risky: args mention "send"/);
  assert.match(String(c.errorDetail), /abc123/);
  assert.deepEqual(c.data, { confirmation_id: 'abc123' });
  const n = await computerTool.invoke({ action: 'click' });
  assert.equal(n.success, false);
  assert.equal(n.error, 'not_connected');
});

test('UI-supplied confirmation_id is forwarded; model confirm is dropped', async () => {
  const { calls } = setup();
  await computerTool.invoke({ action: 'open_app', app: 'vlc', confirmation_id: 'abc123', confirm: true });
  assert.deepEqual(calls, [{ action: 'open_app', args: { app: 'vlc', confirmation_id: 'abc123' } }]);
});

test('see reports vision flag, window, cursor and a hint', async () => {
  setup(
    async (action) =>
      action === 'get_active_window'
        ? { ok: true, result: { title: 'Untitled - Notepad' } }
        : { ok: true, result: { x: 5, y: 6 } },
    true,
  );
  const r = await computerTool.invoke({ action: 'see' });
  assert.equal(r.success, true);
  const d = r.data as { vision: boolean; window: string; hint: string };
  assert.equal(d.vision, true);
  assert.equal(d.window, 'Untitled - Notepad');
  assert.match(d.hint, /LIVE/);
});

test('see stays useful when vision is off and the link is down', async () => {
  setup(async () => ({ ok: false, error: 'not_connected' }), false);
  const r = await computerTool.invoke({ action: 'see' });
  assert.equal(r.success, true);
  const d = r.data as { vision: boolean; connected: boolean; hint: string };
  assert.equal(d.vision, false);
  assert.equal(d.connected, false);
  assert.match(d.hint, /Companion OFFLINE/);
  assert.match(d.hint, /npm run companion/);
});

test('unknown action and bad urls fail cleanly', async () => {
  setup();
  const u = await computerTool.invoke({ action: 'dance' });
  assert.equal(u.success, false);
  assert.equal(u.error, 'invalid_action');
  const b = await computerTool.invoke({ action: 'browser_go', url: 'file:///etc/passwd' });
  assert.equal(b.success, false);
  assert.equal(b.error, 'bad_url');
});

test('schema declares the computer tool with action required', () => {
  assert.equal(COMPUTER_SCHEMA.name, 'computer');
  assert.deepEqual(COMPUTER_SCHEMA.parameters.required, ['action']);
  const actions = (COMPUTER_SCHEMA.parameters.properties as Record<string, { enum?: string[] }>).action.enum ?? [];
  assert.ok(actions.includes('open_app') && actions.includes('click') && actions.includes('see'));
  assert.ok(actions.includes('open_file'));
});

test('observe passes the daemon payload through (loop-only, not in schema)', async () => {
  const payload = {
    screenshot_b64: 'AAA',
    mime: 'image/png',
    scale: 0.5,
    shot: { width: 10, height: 10 },
    screen: null,
    active_window: { title: 'T', pid: null, app: null, bounds: null },
    ui_tree: [],
    tree_source: 'uia',
    notes: [],
  };
  const { calls } = setup(async () => ({ ok: true, result: payload }));
  const r = await computerTool.invoke({ action: 'observe' });
  assert.equal(r.success, true);
  assert.deepEqual(calls, [{ action: 'observe', args: {} }]);
  assert.equal((r.data as { scale: number }).scale, 0.5);
  const actions = (COMPUTER_SCHEMA.parameters.properties as Record<string, { enum?: string[] }>).action.enum ?? [];
  assert.ok(!actions.includes('observe'), 'base64 pixels must not ride LLM function responses');
});

test('open_file maps onto the daemon files_open call', async () => {
  const { calls } = setup();
  const r = await computerTool.invoke({ action: 'open_file', path: 'C:\\Users\\sam\\notes.txt' });
  assert.equal(r.success, true);
  assert.deepEqual(calls, [{ action: 'files_open', args: { path: 'C:\\Users\\sam\\notes.txt' } }]);
  const missing = await computerTool.invoke({ action: 'open_file', path: '  ' });
  assert.equal(missing.success, false);
  assert.equal(missing.error, 'missing_path');
});

test('not_connected failures tell the model exactly how to fix it', async () => {
  setup(async () => ({ ok: false, error: 'not_connected', detail: 'Companion is not connected.' }));
  const r = await computerTool.invoke({ action: 'move_mouse', x: 1, y: 2 });
  assert.equal(r.success, false);
  assert.equal(r.error, 'not_connected');
  assert.match(String(r.errorDetail), /npm run companion/);
  assert.match(String(r.errorDetail), /pairing code/);
});

test('xdotool-missing failures suggest the Linux fix', async () => {
  setup(async () => ({ ok: false, error: 'action_failed', detail: 'spawn xdotool ENOENT' }));
  const r = await computerTool.invoke({ action: 'click', x: 1, y: 1 });
  assert.equal(r.success, false);
  assert.match(String(r.errorDetail), /sudo apt install xdotool/);
});
