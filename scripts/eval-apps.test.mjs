/**
 * scripts/eval-apps.test.mjs — Phase 30: every eval task maps to exactly one
 * app, and aggregation math holds (including the skipped≠failed distinction).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { appForTask, aggregateByApp } from './eval-apps.mjs';
import { TASKS } from './eval-tasks.mjs';
import { DESKTOP_TASKS } from './eval-desktop.mjs';

test('all core tasks map to a known app', () => {
  const known = new Set(['Chrome', 'Files & Media', 'WhatsApp', 'Voice', 'Memory', 'Safety & Trust', 'Core']);
  assert.ok(TASKS.length >= 30, `expected the full battery, saw ${TASKS.length}`);
  for (const t of TASKS) {
    assert.ok(known.has(appForTask(t.id, t.category)), `${t.id} → ${appForTask(t.id, t.category)}`);
  }
});

test('spot checks: each surface lands on its app', () => {
  const cases = [
    ['ping', 'core', 'Core'],
    ['browser_open_read', 'browser', 'Chrome'],
    ['extension_dom_routing', 'browser', 'Chrome'],
    ['files_list_find_read', 'files', 'Files & Media'],
    ['media_status_shape', 'media', 'Files & Media'],
    ['whatsapp_unavailable_graceful', 'messaging', 'WhatsApp'],
    ['local_voice_info_shape', 'voice', 'Voice'],
    ['store_roundtrip', 'memory', 'Memory'],
    ['memory_skill_use_rate', 'memory', 'Memory'],
    ['mirror_roundtrip', 'memory', 'Memory'],
    ['confirmation_gates', 'safety', 'Safety & Trust'],
    ['pairing_flow', 'safety', 'Safety & Trust'],
    ['device_revoke', 'safety', 'Safety & Trust'],
    ['skills_list_shape', 'skills', 'Core'],
    ['unknown_action_rejected', 'safety', 'Safety & Trust'],
  ];
  for (const [id, category, app] of cases) assert.equal(appForTask(id, category), app, id);
});

test('all desktop tasks map from their category', () => {
  assert.ok(DESKTOP_TASKS.length >= 20, `expected the desktop suite, saw ${DESKTOP_TASKS.length}`);
  for (const t of DESKTOP_TASKS) {
    const app = appForTask(t.id, t.category);
    assert.ok(!['Core', 'Desktop'].includes(app), `${t.id} (${t.category}) fell through to ${app}`);
  }
  assert.equal(appForTask('notepad_open_type_save', 'desktop:notepad'), 'Notepad');
  assert.equal(appForTask('calc_result_to_notepad', 'desktop:cross-app'), 'Cross-App');
  assert.equal(appForTask('inject_send_button_click_blocked', 'desktop:injection'), 'Safety');
});

test('aggregation: rates, failures, and skipped≠failed', () => {
  const { apps, failures } = aggregateByApp([
    { id: 'a1', category: 'core', outcome: 'pass' },
    { id: 'a2', category: 'core', outcome: 'fail' },
    { id: 'notepad_x', category: 'desktop:notepad', outcome: 'skip' },
    { id: 'browser_open_read', category: 'browser', outcome: 'pass' },
  ]);
  const core = apps.find((a) => a.app === 'Core');
  assert.deepEqual([core.pass, core.fail, core.skip, core.ran, core.rate], [1, 1, 0, 2, 50]);
  const notepad = apps.find((a) => a.app === 'Notepad');
  assert.equal(notepad.rate, null, 'skipped-only apps report null, never 0%');
  assert.deepEqual(failures, ['a2']);
});

test('aggregation of nothing is empty, not zeroed', () => {
  assert.deepEqual(aggregateByApp([]), { apps: [], failures: [] });
  assert.deepEqual(aggregateByApp(null), { apps: [], failures: [] });
});
