import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decidePrompt,
  parseDecision,
  decideWithBrain,
  normalizeObservation,
  toShotBounds,
  formatTreeLine,
  recallSimilar,
  type TaskObservation,
  type UiNode,
} from './task-decider.ts';

function node(over: Partial<UiNode> = {}): UiNode {
  return { id: 'e1', name: 'Send', role: 'Button', bounds: { x: 100, y: 200, width: 60, height: 24 }, enabled: true, depth: 3, ...over };
}

function obs(over: Partial<TaskObservation> = {}): TaskObservation {
  return {
    screenshot_b64: 'iVBORw0KGgo'.padEnd(200, 'A'),
    mime: 'image/png',
    scale: 0.5,
    shot: { width: 960, height: 540 },
    screen: { width: 1920, height: 1080, offsetX: 0, offsetY: 0 },
    window: 'Mail - Inbox',
    app: 'outlook',
    tree: [node()],
    treeSource: 'uia',
    notes: [],
    ...over,
  };
}

test('toShotBounds scales physical bounds into screenshot space', () => {
  assert.deepEqual(toShotBounds({ x: 100, y: 200, width: 60, height: 24 }, 0.5), {
    x: 50,
    y: 100,
    width: 30,
    height: 12,
  });
  assert.deepEqual(toShotBounds({ x: 3, y: 3, width: 1, height: 1 }, 0.5), {
    x: 2,
    y: 2,
    width: 1,
    height: 1,
  });
});

test('formatTreeLine renders ids, roles, values and flags', () => {
  assert.equal(formatTreeLine(node(), 0.5), 'e1 [Button] "Send" (50,100 30x12)');
  assert.match(formatTreeLine(node({ value: 'hi', enabled: false }), 1), /value="hi" DISABLED/);
  assert.match(formatTreeLine(node({ bounds: null }), 0.5), /\(no bounds\)/);
  assert.match(formatTreeLine(node(), null), /\(100,200 60x24\)/, 'null scale keeps physical');
});

test('decidePrompt grounds the goal with shot space + tree + history', () => {
  const p = decidePrompt('send the mail', obs(), { step: 3, history: ['1. open_app outlook — verified'] });
  assert.match(p, /send the mail/);
  assert.match(p, /Step 3/);
  assert.match(p, /960x540/);
  assert.match(p, /screenshot pixels/);
  assert.match(p, /Mail - Inbox/);
  assert.match(p, /e1 \[Button\] "Send" \(50,100 30x12\)/);
  assert.match(p, /open_app outlook — verified/);
  assert.match(p, /JSON ONLY/);
  assert.match(p, /"target":"eN"/);
});

test('decidePrompt degrades without a screenshot and carries failure + memory', () => {
  const p = decidePrompt('g', obs({ screenshot_b64: null, shot: null, scale: null, notes: ['screenshot: down'] }), {
    step: 1,
    failure: 'click missed',
    history: [],
    memory: '- Do X first.',
  });
  assert.match(p, /UNAVAILABLE/);
  assert.match(p, /do NOT use coordinates/);
  assert.match(p, /FAILED: click missed/);
  assert.match(p, /copy what worked/);
  assert.match(p, /Do X first/);
  assert.match(p, /\(100,200 60x24\)/, 'physical bounds when the shot is missing');
});

test('parseDecision accepts done + target/coords pointer steps', () => {
  const done = parseDecision('{"done":true,"summary":"sent"}');
  assert.ok('decision' in done && done.decision.done && done.decision.summary === 'sent');
  const click = parseDecision('{"tool":"computer","args":{"action":"click","target":"e7"},"expect":{"textVisible":"Sent"},"note":"Hit send"}');
  assert.ok('decision' in click);
  assert.equal(click.decision.done, false);
  assert.deepEqual(click.decision.args, { action: 'click', target: 'e7' });
  assert.deepEqual(click.decision.expect, { textVisible: 'Sent' });
  const coords = parseDecision('```json\n{"tool":"computer","args":{"action":"move_mouse","x":10,"y":20}}\n```');
  assert.ok('decision' in coords, 'strips fences');
});

test('parseDecision rejects bad shapes, tools, actions and targets', () => {
  assert.match((parseDecision('just prose') as { error: string }).error, /not_json/);
  assert.match((parseDecision('[1]') as { error: string }).error, /bad_shape/);
  assert.match((parseDecision('{"tool":"task","args":{}}') as { error: string }).error, /must be "computer"/);
  assert.match((parseDecision('{"tool":"computer","args":{"action":"dance"}}') as { error: string }).error, /unknown computer action/);
  assert.match((parseDecision('{"tool":"computer","args":{"action":"click"}}') as { error: string }).error, /missing_target/);
  assert.match((parseDecision('{"tool":"computer","args":{"action":"click","target":"nope"}}') as { error: string }).error, /bad_target/);
  assert.match((parseDecision('{"tool":"computer","args":{"action":"click","x":-1,"y":5}}') as { error: string }).error, /bad_coords/);
  assert.match(
    (parseDecision('{"tool":"computer","args":{"action":"click","target":"e1"},"expect":{"windowContains":42}}') as { error: string }).error,
    /windowContains must be a string/,
  );
});

test('parseDecision validates per-action args', () => {
  const drag = parseDecision('{"tool":"computer","args":{"action":"drag","fromX":1,"fromY":2,"toX":3,"toY":4}}');
  assert.ok('decision' in drag);
  assert.match((parseDecision('{"tool":"computer","args":{"action":"drag","fromX":1}}') as { error: string }).error, /bad_coords/);
  assert.match((parseDecision('{"tool":"computer","args":{"action":"type_text"}}') as { error: string }).error, /bad_text/);
  assert.match((parseDecision('{"tool":"computer","args":{"action":"hotkey","keys":""}}') as { error: string }).error, /bad_keys/);
  assert.match((parseDecision('{"tool":"computer","args":{"action":"open_app"}}') as { error: string }).error, /bad_app/);
  assert.match((parseDecision('{"tool":"computer","args":{"action":"open_url","url":"ftp://x"}}') as { error: string }).error, /bad_url/);
  assert.match((parseDecision('{"tool":"computer","args":{"action":"open_file"}}') as { error: string }).error, /bad_path/);
  assert.match(
    (parseDecision('{"tool":"computer","args":{"action":"scroll","dy":"lots"}}') as { error: string }).error,
    /bad_coords/,
  );
  const kept = parseDecision('{"tool":"computer","args":{"action":"click","target":"e1"},"needsConfirm":true,"note":"n"}');
  assert.ok('decision' in kept && kept.decision.needsConfirm === true && kept.decision.note === 'n');
});

test('decideWithBrain posts prompt + screenshot and parses', async () => {
  const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string, init: { body: string }) => {
    seen.push({ url, body: JSON.parse(init.body) });
    return { json: async () => ({ text: '{"done":true}' }) };
  }) as unknown as typeof fetch;
  const d = await decideWithBrain('g', obs(), { step: 1, history: [] }, fetchImpl);
  assert.equal(d.done, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, '/api/sophia/chat');
  assert.deepEqual((seen[0].body as { history: unknown[] }).history, []);
  assert.match(String((seen[0].body as { lastUser: string }).lastUser), /ONE next computer action/);
  const img = (seen[0].body as { image: { data: string; mimeType: string } }).image;
  assert.equal(img.mimeType, 'image/png');
  assert.ok(img.data.length > 100, 'screenshot rides every step');
});

test('decideWithBrain omits the image when the shot is missing; errors are decider_*', async () => {
  const seen: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    seen.push(JSON.parse(init.body));
    return { json: async () => ({ text: '{"done":true}' }) };
  }) as unknown as typeof fetch;
  await decideWithBrain('g', obs({ screenshot_b64: null }), { step: 1, history: [] }, fetchImpl);
  assert.ok(!('image' in seen[0]));
  const down = (() => Promise.reject(new Error('nope'))) as unknown as typeof fetch;
  await assert.rejects(() => decideWithBrain('g', obs(), { step: 1, history: [] }, down), /decider_unreachable/);
  const badBrain = (() => Promise.resolve({ json: async () => ({ text: 'not json' }) })) as unknown as typeof fetch;
  await assert.rejects(() => decideWithBrain('g', obs(), { step: 1, history: [] }, badBrain), /decider_not_json/);
});

test('normalizeObservation coerces daemon shapes defensively', () => {
  const full = normalizeObservation({
    screenshot_b64: 'AAA',
    mime: 'image/png',
    scale: 0.5,
    shot: { width: 10, height: 20 },
    screen: { width: 20, height: 40, offsetX: -5, offsetY: 0 },
    active_window: { title: 'T', app: 'a', pid: 1, bounds: { x: 1, y: 2, width: 3, height: 4 } },
    ui_tree: [{ id: 'e1', name: 'N', role: 'Button', bounds: { x: 1, y: 1, width: 2, height: 2 }, enabled: true, depth: 1 }],
    tree_source: 'uia',
    notes: ['n'],
  });
  assert.equal(full.window, 'T');
  assert.equal(full.tree.length, 1);
  assert.equal(full.screen?.offsetX, -5);
  const empty = normalizeObservation('garbage');
  assert.deepEqual(empty, {
    screenshot_b64: null,
    mime: null,
    scale: null,
    shot: null,
    screen: null,
    window: null,
    app: null,
    tree: [],
    treeSource: 'unknown',
    notes: [],
  });
  assert.equal(normalizeObservation({ window: 'flat' }).window, 'flat');
  assert.equal(normalizeObservation({ ui_tree: [{ id: 'e1' }] }).tree[0].role, 'Unknown');
});

test('recallSimilar formats top hits and degrades gracefully', async () => {
  const hits = [
    { text: 'Done "open vlc" — 1/1 steps verified.' },
    { text: '  ' },
    { text: 'Failed "open missing" — window lacks it.' },
    { text: 'Middle one.' },
    { text: 'Old one.' },
  ];
  const mem = await recallSimilar('open vlc', async () => hits);
  assert.match(mem, /Done "open vlc"/);
  assert.match(mem, /Failed "open missing"/);
  assert.ok(!mem.includes('Old one.'));
  assert.equal(await recallSimilar('x', async () => []), '');
  assert.equal(
    await recallSimilar('x', async () => {
      throw new Error('down');
    }),
    '',
  );
});
