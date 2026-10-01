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
      ? { ok: false, error: 'confirmation_required', detail: 'Say yes first.' }
      : { ok: false, error: 'not_connected', detail: 'Companion is not connected.' },
  );
  const c = await computerTool.invoke({ action: 'open_app', app: 'vlc' });
  assert.equal(c.success, false);
  assert.equal(c.error, 'confirmation_required');
  assert.equal(c.errorDetail, 'Say yes first.');
  const n = await computerTool.invoke({ action: 'click' });
  assert.equal(n.success, false);
  assert.equal(n.error, 'not_connected');
});

test('confirm:true is forwarded on retry', async () => {
  const { calls } = setup();
  await computerTool.invoke({ action: 'open_app', app: 'vlc', confirm: true });
  assert.deepEqual(calls, [{ action: 'open_app', args: { app: 'vlc', confirm: true } }]);
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
  assert.match(d.hint, /Vision \(eye\) button/);
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
});
