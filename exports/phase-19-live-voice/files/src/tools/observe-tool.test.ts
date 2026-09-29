import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observeTool, observeFrameEvents, __setObserveFallback, OBSERVE_SCHEMA } from './observe-tool.ts';
import { __setComputerBackend, type ComputerBackend } from './computer-tool.ts';
import type { ToolResult } from './types.ts';

function stubBackend(callImpl: ComputerBackend['call']) {
  __setComputerBackend({ call: callImpl, visionActive: () => true });
}

const PAYLOAD = {
  screenshot_b64: 'AAAABBBB',
  mime: 'image/png',
  scale: 0.5,
  active_window: { title: 'Mail', pid: null, app: null, bounds: null },
  ui_tree: [{ id: 'e1' }],
  tree_source: 'uia',
  notes: [],
};

async function invokeOnce(): Promise<{ result: ToolResult; frames: Array<Record<string, unknown>> }> {
  const frames: Array<Record<string, unknown>> = [];
  const h = (e: Event) => frames.push((e as CustomEvent).detail as Record<string, unknown>);
  observeFrameEvents.addEventListener('observe:frame', h);
  try {
    const result = await observeTool.invoke({});
    return { result, frames };
  } finally {
    observeFrameEvents.removeEventListener('observe:frame', h);
  }
}

test('companion observe: metadata in the response, pixels on the frame bus', async () => {
  stubBackend(async () => ({ ok: true, result: PAYLOAD }));
  __setObserveFallback(null);
  try {
    const { result: r, frames } = await invokeOnce();
    assert.equal(r.success, true);
    const d = r.data as Record<string, unknown>;
    assert.ok(!('screenshot_b64' in d), 'base64 must not ride the function response');
    assert.equal(d.screenshot, 'attached as a video frame you can see');
    assert.equal((d.active_window as { title: string }).title, 'Mail');
    assert.deepEqual(d.ui_tree, [{ id: 'e1' }]);
    assert.deepEqual(frames, [{ b64: 'AAAABBBB', mime: 'image/png', source: 'companion' }]);
  } finally {
    __setComputerBackend(null);
    __setObserveFallback(undefined);
  }
});

test('browser fallback fires when the companion is offline', async () => {
  stubBackend(async () => ({ ok: false, error: 'not_connected' }));
  __setObserveFallback(async () => ({ b64: 'ZZZ', mime: 'image/jpeg' }));
  try {
    const { result: r, frames } = await invokeOnce();
    assert.equal(r.success, true);
    assert.equal((r.data as { source: string }).source, 'browser-capture');
    assert.deepEqual(frames, [{ b64: 'ZZZ', mime: 'image/jpeg', source: 'browser-capture' }]);
  } finally {
    __setComputerBackend(null);
    __setObserveFallback(undefined);
  }
});

test('no companion and no capture fails cleanly', async () => {
  stubBackend(async () => ({ ok: false, error: 'not_connected' }));
  __setObserveFallback(async () => null);
  try {
    const { result: r, frames } = await invokeOnce();
    assert.equal(r.success, false);
    assert.match(String(r.errorDetail), /Companion OFFLINE/, 'companion fix-it steps pass through');
    assert.deepEqual(frames, []);
  } finally {
    __setComputerBackend(null);
    __setObserveFallback(undefined);
  }
});

test('schema declares a parameter-less observe tool', () => {
  assert.equal(OBSERVE_SCHEMA.name, 'observe');
  assert.deepEqual(OBSERVE_SCHEMA.parameters, { type: 'OBJECT', properties: {} });
});
