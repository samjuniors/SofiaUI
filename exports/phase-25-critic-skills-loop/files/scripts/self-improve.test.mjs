/**
 * scripts/self-improve.test.mjs — the approval logic under test, including
 * red-team cases: forbidden paths, eval-suite tampering, self-modification,
 * regressions, and missed margins must all refuse to auto-merge.
 *
 * Pure functions only — these tests never touch git, the network, or Ollama.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFiles,
  decideMerge,
  extractCause,
  buildSkillPatch,
  validateSkillPatch,
} from './self-improve.mjs';

const skill = (over = {}) => ({
  id: 7, name: 'reboot router', trigger: 'when wifi down', status: 'active',
  steps: { trail: ['observe', 'click'], failureModes: ['timeout'], via: 'induction', support: 3 },
  successCount: 6, useCount: 8, ...over,
});

test('classifyFiles: skill/prompt/code/forbidden', () => {
  assert.equal(classifyFiles(['memory/patches/20250101-skill-7-0.json', 'SELF_IMPROVE_REPORT.md']), 'skill');
  assert.equal(classifyFiles(['src/core/task-decider.ts']), 'prompt');
  assert.equal(classifyFiles(['src/core/task-decider.ts', 'src/ui/Foo.tsx']), 'code');
  assert.equal(classifyFiles(['SELF_IMPROVE_REPORT.md']), 'code'); // docs-only: human eyes
  assert.equal(classifyFiles(['memory/patches/x.json', 'src/core/task-decider.ts']), 'code'); // mixed
});

test('red-team: the agent can never touch policy, the suite, or itself', () => {
  for (const f of [
    'companion/policy.mjs', 'companion/policy.test.mjs',
    'scripts/eval-tasks.mjs', 'scripts/eval-harness.mjs', 'scripts/eval-baseline.json',
    'scripts/self-improve.mjs', 'scripts/self-improve.test.mjs',
  ]) {
    assert.equal(classifyFiles([f]), 'forbidden', f);
    assert.equal(classifyFiles(['src/core/task-decider.ts', f]), 'forbidden', `mixed ${f}`);
  }
  // …and forbidden always drops, even with a perfect gate otherwise.
  const v = decideMerge({ kind: 'forbidden', baseFailures: ['a'], branchFailures: [], patchValid: true, motivating: 3 });
  assert.deepEqual(v.action, 'drop');
});

test('decideMerge: code and reports always go to a human', () => {
  for (const kind of ['code', 'report']) {
    const v = decideMerge({ kind, baseFailures: ['a', 'b'], branchFailures: [] });
    assert.equal(v.action, 'pr', kind);
  }
});

test('decideMerge: prompt needs no-regressions + margin', () => {
  const merge = decideMerge({ kind: 'prompt', baseFailures: ['a', 'b'], branchFailures: ['a'], margin: 0.5 });
  assert.equal(merge.action, 'merge'); // 1/2 fixed, need ceil(0.5*2)=1
  const miss = decideMerge({ kind: 'prompt', baseFailures: ['a', 'b', 'c', 'd'], branchFailures: ['a', 'b', 'c'], margin: 0.5 });
  assert.equal(miss.action, 'pr'); // 1/4 fixed, need 2 → human decides
  const regr = decideMerge({ kind: 'prompt', baseFailures: ['a'], branchFailures: ['b'], margin: 0.5 });
  assert.equal(regr.action, 'pr'); // fixed a but broke b → no auto-merge
  const green = decideMerge({ kind: 'prompt', baseFailures: [], branchFailures: [] });
  assert.equal(green.action, 'drop'); // nothing to beat
});

test('decideMerge: skill needs validity + linked traces + green sandbox', () => {
  const merge = decideMerge({ kind: 'skill', baseFailures: [], branchFailures: [], patchValid: true, motivating: 2 });
  assert.equal(merge.action, 'merge');
  assert.equal(decideMerge({ kind: 'skill', baseFailures: [], branchFailures: [], patchValid: false, motivating: 2 }).action, 'drop');
  assert.equal(decideMerge({ kind: 'skill', baseFailures: [], branchFailures: [], patchValid: true, motivating: 0 }).action, 'drop');
  assert.equal(decideMerge({ kind: 'skill', baseFailures: [], branchFailures: ['x'], patchValid: true, motivating: 2 }).action, 'drop');
});

test('extractCause reads the first Failed: line', () => {
  assert.equal(extractCause('Reflection — "g" done.\nFailed: step 1 click — gate: nope\nFailed: step 2 x'), 'step 1 click — gate: nope');
  assert.equal(extractCause('all clean'), null);
  assert.equal(extractCause(null), null);
});

test('buildSkillPatch/validateSkillPatch: dedupe, caps, retired refusal', () => {
  const p = buildSkillPatch({ skill: skill(), cause: 'login moved' });
  assert.deepEqual(p.addFailureModes, ['login moved']);
  assert.equal(p.skillId, 7);
  assert.ok(validateSkillPatch(p, skill()));
  assert.equal(buildSkillPatch({ skill: skill(), cause: 'timeout' }), null); // dup
  assert.equal(buildSkillPatch({ skill: skill(), cause: '  ' }), null); // empty
  assert.equal(buildSkillPatch({ skill: skill({ status: 'retired' }), cause: 'x' }), null);
  assert.equal(validateSkillPatch({ ...p, addFailureModes: ['timeout'] }, skill()), false);
  assert.equal(validateSkillPatch({ ...p, version: 2 }, skill()), false);
  assert.equal(validateSkillPatch(p, skill({ status: 'retired' })), false); // went stale
});
