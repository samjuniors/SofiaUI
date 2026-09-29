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

test('weights nudge up on agreement, down on miss', () => {
  const c = new BucketCalibrator();
  assert.equal(c.weight('plan:risk'), 1);
  assert.equal(c.weight(undefined), 1);
  const mk = (p: number) => c.pending('plan_gate', p, [{ weight: 2.5, p, why: 'r', kind: 'plan:risk' }]);
  c.resolve(mk(0.8), 1);
  assert.ok(c.weight('plan:risk') > 1);
  const up = c.weight('plan:risk');
  c.resolve(mk(0.8), 0);
  assert.ok(c.weight('plan:risk') < up);
});

test('weights clamp to [0.25, 4]', () => {
  const c = new BucketCalibrator();
  const mk = () => c.pending('q', 0.9, [{ weight: 1, p: 0.9, why: 'x', kind: 'k' }]);
  for (let i = 0; i < 200; i++) c.resolve(mk(), 0);
  assert.equal(c.weight('k'), 0.25);
  for (let i = 0; i < 400; i++) c.resolve(mk(), 1);
  assert.equal(c.weight('k'), 4);
});

test('gate tickets carry kind-bearing evidence for learning', async () => {
  const j = new SofiaJudge();
  const r = await j.score(
    'goal: delete downloads\nplan:\n1. open files\nsteps: [{"action":"click","expect":false,"needsConfirm":false}]',
    'plan_gate',
    ['1', '2', '3', '4', '5'],
  );
  assert.ok(r.ticket && r.ticket.ev && r.ticket.ev.length >= 2);
  assert.ok(r.ticket.ev.every((e) => typeof e.kind === 'string' && e.kind.startsWith('plan:')));
});

test('learned weights move future gate judgments', async () => {
  const steps = [
    '{"action":"open_app","expect":true}',
    '{"action":"click","expect":true}',
    '{"action":"click","expect":true}',
    '{"action":"click"}',
    '{"action":"type"}',
    '{"action":"click"}',
    '{"action":"click"}',
  ].join(',');
  const state =
    `goal: open vlc and play the movie\nplan:\n1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\nsteps: [${steps}]`;
  const levels = ['1', '2', '3', '4', '5'];
  const before = await new SofiaJudge().score(state, 'plan_gate', levels);
  assert.equal(before.score, 3);
  const taught = new SofiaJudge();
  for (let i = 0; i < 12; i++) {
    const s = await taught.score(state, 'plan_gate', levels);
    assert.ok(s.ticket);
    taught.report(s.ticket, 0);
  }
  const after = await taught.score(state, 'plan_gate', levels);
  assert.ok(after.score < before.score);
  const w = taught.calibrationSnapshot().weights;
  assert.ok(w['plan:length'] > 1);
  assert.ok(w['plan:expect'] < 1);
});

test('snapshot round-trips buckets and weights; legacy and garbage restore safely', () => {
  const c = new BucketCalibrator();
  c.resolve(c.pending('plan_gate', 0.8, [{ weight: 1, p: 0.8, why: 'x', kind: 'plan:expect' }]), 1);
  const snap = c.snapshot();
  assert.ok(snap.buckets.plan_gate && typeof snap.weights['plan:expect'] === 'number');
  const c2 = new BucketCalibrator();
  c2.restore(snap);
  assert.equal(c2.weight('plan:expect'), c.weight('plan:expect'));
  assert.equal(c2.samples('plan_gate', 0.8), 1);
  const legacy = new BucketCalibrator();
  legacy.restore({ plan_gate: { n: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0], k: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0] } });
  assert.equal(legacy.samples('plan_gate', 0.85), 1);
  assert.equal(legacy.weight('plan:expect'), 1);
  const garbage = new BucketCalibrator();
  garbage.restore(null);
  garbage.restore(undefined);
  garbage.restore({} as never);
  garbage.restore({ plan_gate: { n: [1], k: 'x' } } as never);
  garbage.restore({ buckets: {}, weights: { k: NaN, j: Infinity, ok: 2 } });
  assert.equal(garbage.weight('k'), 1);
  assert.equal(garbage.weight('ok'), 2);
});
