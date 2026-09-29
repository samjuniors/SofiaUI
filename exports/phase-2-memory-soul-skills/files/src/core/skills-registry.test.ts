/**
 * core/skills-registry.test.ts — capability catalogue, toggles, usage, sync.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SkillsRegistry,
  LOCAL_SKILLS,
  categoryForAction,
  labelForAction,
} from './SkillsRegistry.ts';
import type { CompanionCaller } from './Soul.ts';

test('local catalogue covers the known tools, all enabled by default', () => {
  assert.ok(LOCAL_SKILLS.length >= 7);
  const ids = LOCAL_SKILLS.map((s) => s.id);
  for (const must of ['web_search', 'ui_control', 'system_control', 'generate_image', 'transform_shape']) {
    assert.ok(ids.includes(must), `missing local skill ${must}`);
  }
  const reg = new SkillsRegistry();
  assert.ok(reg.list().every((s) => s.enabled));
  assert.equal(reg.get('web_search')?.label, 'Web search');
});

test('unknown ids fail open so new tools work before listing', () => {
  const reg = new SkillsRegistry();
  assert.equal(reg.isEnabled('some_future_tool'), true);
  assert.equal(reg.get('some_future_tool'), undefined);
});

test('toggles flip and persist per instance', () => {
  const reg = new SkillsRegistry();
  reg.setEnabled('web_search', false);
  assert.equal(reg.isEnabled('web_search'), false);
  assert.equal(reg.get('web_search')?.enabled, false);
  reg.setEnabled('web_search', true);
  assert.equal(reg.isEnabled('web_search'), true);
});

test('protocol actions are locked on', () => {
  const reg = new SkillsRegistry();
  reg.mergeCompanionSkills(['ping', 'abort', 'resume', 'store_put']);
  for (const id of ['ping', 'abort', 'resume']) {
    assert.equal(reg.get(id)?.locked, true);
    reg.setEnabled(id, false);
    assert.equal(reg.isEnabled(id), true);
  }
  const c = reg.count();
  assert.equal(c.total, LOCAL_SKILLS.length + 4);
  assert.equal(c.companion, 4);
});

test('usage stats accumulate with timestamps', () => {
  const reg = new SkillsRegistry();
  assert.equal(reg.get('web_search')?.uses, 0);
  assert.equal(reg.get('web_search')?.lastUsedAt, null);
  reg.recordUse('web_search');
  reg.recordUse('web_search');
  assert.equal(reg.get('web_search')?.uses, 2);
  assert.ok(typeof reg.get('web_search')?.lastUsedAt === 'number');
  reg.resetUsage();
  assert.equal(reg.get('web_search')?.uses, 0);
});

test('merge preserves switches, drops stale actions, hides meta', () => {
  const reg = new SkillsRegistry();
  reg.setEnabled('store_put', false);
  reg.mergeCompanionSkills(['store_put', 'files_list', 'skills_list']);
  assert.equal(reg.get('skills_list'), undefined);
  assert.equal(reg.get('store_put')?.enabled, false);
  assert.equal(reg.get('store_put')?.source, 'companion');
  reg.mergeCompanionSkills(['files_list']);
  assert.equal(reg.get('store_put'), undefined);
  assert.ok(reg.get('files_list'));
});

test('action labels and categories are sensible', () => {
  assert.equal(labelForAction('files_trash'), 'Files trash');
  assert.equal(categoryForAction('store_put'), 'memory');
  assert.equal(categoryForAction('episodes_search'), 'memory');
  assert.equal(categoryForAction('files_read'), 'files');
  assert.equal(categoryForAction('browser_navigate'), 'browser');
  assert.equal(categoryForAction('whatsapp_send'), 'device');
  assert.equal(categoryForAction('media_control'), 'media');
  assert.equal(categoryForAction('health_snapshot'), 'system');
  assert.equal(categoryForAction('tts_local'), 'voice');
  assert.equal(categoryForAction('ping'), 'system');
  assert.equal(categoryForAction('something_new'), 'companion');
});

test('refreshFromCompanion merges the live daemon list', async () => {
  const reg = new SkillsRegistry();
  const caller = (async (action: string) => {
    assert.equal(action, 'skills_list');
    return { ok: true, result: { skills: ['store_put', 'ping'] } };
  }) as CompanionCaller;
  const r = await reg.refreshFromCompanion(caller);
  assert.equal(r.ok, true);
  assert.equal(r.merged, 2);
  assert.ok(reg.get('store_put'));
});

test('refreshFromCompanion rejects malformed replies', async () => {
  const reg = new SkillsRegistry();
  const bad = (async () => ({ ok: true, result: { skills: 'nope' } })) as CompanionCaller;
  const r = await reg.refreshFromCompanion(bad);
  assert.equal(r.ok, false);
  const down = (async () => ({ ok: false, error: 'not_connected' })) as CompanionCaller;
  const r2 = await reg.refreshFromCompanion(down);
  assert.equal(r2.ok, false);
});
