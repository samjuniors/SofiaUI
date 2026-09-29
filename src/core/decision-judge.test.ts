import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fuseEvidence,
  confidenceOf,
  BucketCalibrator,
  parseJudgeState,
  SofiaJudge,
} from './decision-judge.ts';

test('fuseEvidence pools log-odds: prior only, strong evidence, conflict', () => {
  assert.ok(Math.abs(fuseEvidence(0.5, []).p - 0.5) < 1e-9);
  const strong = fuseEvidence(0.5, [{ weight: 3, p: 0.92, why: 'x' }]);
  assert.ok(strong.p > 0.9 && strong.agreement > 0.7);
  const weak = fuseEvidence(0.5, [{ weight: 0.5, p: 0.9, why: 'x' }]);
  assert.ok(weak.p > 0.5 && weak.p < strong.p);
  const conflict = fuseEvidence(0.5, [
    { weight: 2, p: 0.9, why: 'yes' },
    { weight: 2, p: 0.1, why: 'no' },
  ]);
  assert.ok(Math.abs(conflict.p - 0.5) < 0.05);
  assert.ok(conflict.agreement < 0.3);
});

test('confidenceOf rewards extremity, agreement and experience', () => {
  const high = confidenceOf(0.95, 0.95, 20);
  const mid = confidenceOf(0.5, 0.5, 0);
  assert.ok(high > 0.6 && mid < 0.25);
  assert.ok(confidenceOf(0.9, 0.9, 20) > confidenceOf(0.9, 0.9, 0));
});

test('calibrator is identity without history, then bends toward observed rates', () => {
  const c = new BucketCalibrator();
  assert.equal(c.adjusted('q', 0.8), 0.8);
  for (let i = 0; i < 6; i++) c.resolve(c.pending('q', 0.8), 0);
  const bent = c.adjusted('q', 0.8);
  assert.ok(bent < 0.8 && bent > 0.1);
  assert.equal(c.samples('q', 0.8), 6);
  assert.equal(c.samples('q', 0.2), 0);
  // Laplace smoothing: one sample never slams to 0 or 1
  const fresh = new BucketCalibrator();
  fresh.resolve(fresh.pending('q', 0.9), 0);
  const one = fresh.adjusted('q', 0.9);
  assert.ok(one < 0.9 && one > 0.4);
});

test('calibrator snapshot/restore round-trips', () => {
  const c = new BucketCalibrator();
  c.resolve(c.pending('q', 0.8), 1);
  const d = new BucketCalibrator();
  d.restore(c.snapshot());
  assert.equal(d.samples('q', 0.8), 1);
  d.restore({ bogus: { n: [1], k: [1] } });
  assert.equal(d.samples('bogus', 0.1), 0);
});

test('parseJudgeState reads the loop contract; malformed JSON degrades', () => {
  const st = parseJudgeState(
    'goal: open vlc\nplan:\n1. open_app vlc\n2. hotkey ctrl+o\nsteps: [{"action":"open_app","expect":true},{"action":"hotkey"}]\nstep: open_app vlc\nargs: {"action":"open_app"}\nobservation: {"window":"VLC"}\nexpect: {"windowContains":"vlc"}\nfailure: none\nreplans left: 2',
  );
  assert.equal(st.goal, 'open vlc');
  assert.deepEqual(st.planLines, ['1. open_app vlc', '2. hotkey ctrl+o']);
  assert.deepEqual(st.stepActions, ['open_app', 'hotkey']);
  assert.deepEqual(st.stepsExpect, [true, false]);
  assert.equal(st.step, 'open_app vlc');
  assert.equal(st.args.action, 'open_app');
  assert.equal(st.observation.window, 'VLC');
  assert.equal(st.expect?.windowContains, 'vlc');
  assert.equal(st.replansLeft, 2);
  const bad = parseJudgeState('args: {{{nope\nobservation: [1,2\nreplans left: many');
  assert.deepEqual(bad.args, {});
  assert.equal(bad.replansLeft, 0);
});

const GATE = (goal: string, stepsJson: string, lines: string[]) =>
  `goal: ${goal}\nplan:\n${lines.join('\n')}\nsteps: ${stepsJson}`;
const LEVELS = ['unsafe or nonsense', 'risky or confused', 'acceptable', 'solid', 'excellent'];

test('score rates solid plans high, risky-ungated plans low', async () => {
  const j = new SofiaJudge();
  const good = await j.score(
    GATE('open vlc and play', '[{"action":"open_app","expect":true},{"action":"hotkey","expect":true}]', [
      '1. open_app vlc',
      '2. hotkey ctrl+o',
    ]),
    'plan_gate',
    LEVELS,
  );
  assert.ok(good.score >= 4);
  assert.ok(good.ticket);
  const bad = await j.score(
    GATE('delete the downloads folder', '[{"action":"click"},{"action":"hotkey"},{"action":"click"}]', [
      '1. click',
      '2. hotkey',
      '3. click',
    ]),
    'plan_gate',
    LEVELS,
  );
  assert.ok(bad.score <= 2);
});

test('score learns from reported outcomes', async () => {
  const j = new SofiaJudge();
  const state = GATE('open vlc', '[{"action":"open_app","expect":true}]', ['1. open_app vlc']);
  const before = (await j.score(state, 'plan_gate', LEVELS)).score;
  for (let i = 0; i < 6; i++) {
    const s = await j.score(state, 'plan_gate', LEVELS);
    if (s.ticket) j.report(s.ticket, 0);
  }
  const after = (await j.score(state, 'plan_gate', LEVELS)).score;
  assert.ok(after < before);
});

test('score rejects non-5-level rubrics (honest strictness)', async () => {
  const j = new SofiaJudge();
  await assert.rejects(() => j.score('goal: x', 'g', ['a', 'b']), /judge_unsupported_score/);
});

test('noul verifies window/text evidence and degrades without expectations', async () => {
  const j = new SofiaJudge();
  const hit = await j.noul(
    'goal: g\nstep: s\nargs: {"action":"see"}\nobservation: {"window":"VLC media player"}\nexpect: {"windowContains":"vlc"}',
    'verify',
    'window contains vlc',
  );
  assert.ok(hit.noul > 0.8);
  const miss = await j.noul(
    'goal: g\nstep: s\nargs: {"action":"see"}\nobservation: {"window":"Notepad"}\nexpect: {"windowContains":"vlc"}',
    'verify',
    'window contains vlc',
  );
  assert.ok(miss.noul < 0.3);
  const found = await j.noul(
    'goal: g\nstep: s\nargs: {"action":"see"}\nobservation: {"textFound":true}\nexpect: {"textVisible":"Play"}',
    'verify',
    'text visible',
  );
  assert.ok(found.noul > 0.7);
  const vague = await j.noul(
    'goal: g\nstep: open_app vlc\nargs: {"action":"open_app","app":"vlc"}\nobservation: {"window":"VLC media player"}',
    'verify',
    'step achieved its intent',
  );
  assert.ok(vague.noul >= 0.5);
  const blind = await j.noul('goal: g\nstep: s\nargs: {"action":"see"}\nobservation: {}', 'verify', 'intent?');
  assert.ok(blind.noul < 0.55);
});

test('choice picks recovery by failure shape', async () => {
  const j = new SofiaJudge();
  const OPTS = ['retry_same', 'replan', 'ask_user'];
  const t = await j.choice('goal: g\nstep: click\nfailure: step 1 (click) failed: timeout\nreplans left: 2', 'recovery', OPTS);
  assert.equal(t.choice, 'retry_same');
  const g = await j.choice('goal: g\nstep: click\nfailure: step 1 was gated: confirmation_required\nreplans left: 2', 'recovery', OPTS);
  assert.equal(g.choice, 'ask_user');
  const u = await j.choice('goal: g\nstep: click\nfailure: step 1 unverified: window lacks "vlc"\nreplans left: 2', 'recovery', OPTS);
  assert.equal(u.choice, 'replan');
  const spent = await j.choice('goal: g\nstep: click\nfailure: click failed: timeout\nreplans left: 0', 'recovery', OPTS);
  assert.equal(spent.choice, 'ask_user');
});

test('choice rejects unknown option sets (honest strictness)', async () => {
  const j = new SofiaJudge();
  await assert.rejects(() => j.choice('goal: x', 'c', ['a', 'b']), /judge_unsupported_choice/);
});
