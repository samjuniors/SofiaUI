import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TaskLoop,
  taskEvents,
  describeStep,
  verifyExpectation,
  fingerprintObservation,
  resolveStepTarget,
  shotToPhysical,
  clampToScreen,
  type TaskLoopDeps,
  type TaskResult,
} from './TaskLoop.ts';
import type { StepDecision, TaskObservation, UiNode } from './task-decider.ts';

function node(over: Partial<UiNode> = {}): UiNode {
  return { id: 'e1', name: 'Send', role: 'Button', bounds: { x: 100, y: 200, width: 60, height: 24 }, enabled: true, depth: 3, ...over };
}

function mkObs(over: Partial<TaskObservation> = {}): TaskObservation {
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

function decide(args: Record<string, unknown>, extra: Partial<StepDecision> = {}): StepDecision {
  return { done: false, tool: 'computer', args, ...extra };
}

function deps(over: Partial<TaskLoopDeps> = {}): TaskLoopDeps {
  return {
    observe: async () => mkObs(),
    decide: async () => {
      throw new Error('no decide stub');
    },
    execute: async () => ({ ok: true, data: {} }),
    ...over,
  };
}

function loopOpts(over: Record<string, unknown> = {}) {
  return { settleMs: 0, ...over };
}

function oncePhase(phase: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as Record<string, unknown>;
      if (d.phase === phase) {
        taskEvents.removeEventListener('task:state', h);
        resolve(d);
      }
    };
    taskEvents.addEventListener('task:state', h);
  });
}

async function phasesDuring(fn: () => Promise<unknown>): Promise<string[]> {
  const phases: string[] = [];
  const h = (e: Event) => phases.push(String((e as CustomEvent).detail.phase));
  taskEvents.addEventListener('task:state', h);
  try {
    await fn();
  } finally {
    taskEvents.removeEventListener('task:state', h);
  }
  return phases;
}

/* ── pure helpers ────────────────────────────────────────────────────────── */

test('resolveStepTarget prefers element ids, falls back to scaled coords', () => {
  const obs = mkObs();
  // Element center is already physical — no scale mapping.
  const byId = resolveStepTarget(decide({ action: 'click', target: 'e1' }), obs);
  assert.ok(!('error' in byId));
  assert.deepEqual(byId.args, { action: 'click', x: 130, y: 212 });
  assert.equal(byId.target, 'e1');
  assert.ok(!('target' in byId.args), 'daemon never sees element ids');
  // Unknown id + coords → falls back to coordinates.
  const byCoords = resolveStepTarget(decide({ action: 'click', target: 'e9', x: 100, y: 100 }), obs);
  assert.ok(!('error' in byCoords));
  assert.deepEqual(byCoords.args, { action: 'click', x: 200, y: 200 });
  assert.equal((byCoords as { target?: string }).target, undefined);
  // Coords without a screenshot are unusable.
  const blind = resolveStepTarget(
    decide({ action: 'click', x: 1, y: 1 }),
    mkObs({ screenshot_b64: null, shot: null, scale: null }),
  );
  assert.ok('error' in blind);
  assert.match(blind.error, /need a screenshot/);
  // Neither target nor coords → error.
  const neither = resolveStepTarget(decide({ action: 'click' }), obs);
  assert.ok('error' in neither);
  assert.match(neither.error, /target or x\/y/);
});

test('resolveStepTarget maps drags and clamps to the screen', () => {
  const obs = mkObs();
  const drag = resolveStepTarget(decide({ action: 'drag', fromX: 10, fromY: 10, toX: 20, toY: 20 }), obs);
  assert.ok(!('error' in drag));
  assert.deepEqual(drag.args, { action: 'drag', fromX: 20, fromY: 20, toX: 40, toY: 40 });
  // Off-screen model coords clamp into the observed screen.
  const wild = resolveStepTarget(decide({ action: 'click', x: 5000, y: -50 }), obs);
  assert.ok(!('error' in wild));
  assert.deepEqual(wild.args, { action: 'click', x: 1919, y: 0 });
  // Non-pointer actions pass through (target stripped).
  const typed = resolveStepTarget(decide({ action: 'type_text', text: 'hi', target: 'e1' }), obs);
  assert.ok(!('error' in typed));
  assert.deepEqual(typed.args, { action: 'type_text', text: 'hi' });
});

test('shotToPhysical / clampToScreen handle scales and offsets', () => {
  assert.equal(shotToPhysical(100, 0.5), 200);
  assert.equal(shotToPhysical(784, 1568 / 2000), 1000);
  assert.deepEqual(clampToScreen(5, 5, null), { x: 5, y: 5 });
  assert.deepEqual(
    clampToScreen(-3000, 500, { width: 3840, height: 1080, offsetX: -1920, offsetY: 0 }),
    { x: -1920, y: 500 },
  );
});

test('fingerprintObservation keys on window + tree, not pixels', () => {
  const a = mkObs();
  const b = mkObs({ screenshot_b64: 'different'.padEnd(200, 'A') });
  assert.equal(fingerprintObservation(a), fingerprintObservation(b), 'blinking pixels must not fork states');
  assert.notEqual(fingerprintObservation(a), fingerprintObservation(mkObs({ window: 'Other' })));
  assert.notEqual(
    fingerprintObservation(a),
    fingerprintObservation(mkObs({ tree: [node({ name: 'Delete' })] })),
  );
  assert.notEqual(
    fingerprintObservation(a),
    fingerprintObservation(mkObs({ tree: [node({ value: 'typed!' })] })),
    'typed values change state (no false repeat-stop while typing)',
  );
});

test('verifyExpectation matches window + tree text', () => {
  assert.equal(verifyExpectation(undefined, mkObs()).pass, true);
  assert.equal(verifyExpectation({ windowContains: 'mail' }, mkObs()).pass, true);
  const miss = verifyExpectation({ windowContains: 'vlc' }, mkObs());
  assert.equal(miss.pass, false);
  assert.match(miss.reason ?? '', /Mail - Inbox/);
  assert.equal(verifyExpectation({ textVisible: 'send' }, mkObs()).pass, true);
  assert.equal(verifyExpectation({ textVisible: 'draft' }, mkObs({ tree: [node({ value: 'draft v2' })] })).pass, true);
  const tmiss = verifyExpectation({ textVisible: 'Play' }, mkObs());
  assert.equal(tmiss.pass, false);
  assert.match(tmiss.reason ?? '', /UI tree \(1 nodes\)/);
});

test('describeStep prefers notes, then action + target/app/keys', () => {
  assert.equal(describeStep({ note: 'Hit play', args: {} }), 'Hit play');
  assert.equal(describeStep({ tool: 'computer', args: { action: 'click' }, target: 'e7' }), 'click e7');
  assert.equal(describeStep({ tool: 'computer', args: { action: 'open_app', app: 'vlc' } }), 'open_app vlc');
  assert.equal(describeStep({ tool: 'computer', args: { action: 'hotkey', keys: 'win' } }), 'hotkey win');
});

/* ── the loop ────────────────────────────────────────────────────────────── */

test('happy path: observe → decide → act → verify → done, and remembers', async () => {
  const remembered: string[] = [];
  const obses = [mkObs(), mkObs({ window: 'VLC media player', tree: [] })];
  let oi = 0;
  const loop = new TaskLoop(
    deps({
      observe: async () => obses[Math.min(oi++, obses.length - 1)],
      decide: async (_g, ctx) =>
        ctx.step === 1
          ? decide({ action: 'open_app', app: 'vlc' }, { expect: { windowContains: 'vlc' } })
          : { done: true, summary: 'VLC is open.' },
      remember: async (s) => {
        remembered.push(s);
      },
    }),
    loopOpts(),
  );
  let result: TaskResult | null = null;
  let decided: Record<string, unknown> | null = null;
  const h = (e: Event) => {
    const d = (e as CustomEvent).detail as Record<string, unknown>;
    if (d.phase === 'decided') decided = d;
  };
  taskEvents.addEventListener('task:state', h);
  const phases = await phasesDuring(async () => {
    result = await loop.run('open vlc');
  });
  taskEvents.removeEventListener('task:state', h);
  assert.equal(result!.status, 'done');
  assert.match(result!.summary, /1\/1 steps verified/);
  assert.match(result!.summary, /VLC is open/);
  // Terminal states also dismiss the preview overlay (a no-op when none is open).
  assert.deepEqual(phases, ['started', 'decided', 'step', 'verified', 'done', 'preview']);
  assert.equal((decided as unknown as { label: string }).label, 'open_app vlc');
  assert.equal(remembered.length, 1);
});

test('resolve failures feed back into the next decide', async () => {
  const failures: Array<string | undefined> = [];
  let n = 0;
  const loop = new TaskLoop(
    deps({
      decide: async (_g, ctx) => {
        failures.push(ctx.failure);
        return ++n === 1 ? decide({ action: 'click' }) : { done: true };
      },
    }),
    loopOpts(),
  );
  let result: TaskResult | null = null;
  const phases = await phasesDuring(async () => {
    result = await loop.run('g');
  });
  assert.equal(result!.status, 'done');
  assert.deepEqual(failures, [undefined, 'click needs a UI-tree target or x/y coordinates.']);
  assert.ok(phases.includes('retry'));
});

test('unverified step decides fresh with failure context, then succeeds', async () => {
  const seen: Array<string | undefined> = [];
  const obses = [mkObs({ window: 'A' }), mkObs({ window: 'A' }), mkObs({ window: 'VLC media player' })];
  let oi = 0;
  let n = 0;
  const loop = new TaskLoop(
    deps({
      observe: async () => obses[Math.min(oi++, obses.length - 1)],
      decide: async (_g, ctx) => {
        seen.push(ctx.failure);
        return ++n <= 2
          ? decide({ action: 'open_app', app: 'vlc' }, { expect: { windowContains: 'vlc' } })
          : { done: true };
      },
    }),
    loopOpts(),
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'done');
  assert.equal(n, 3);
  assert.match(seen[1] ?? '', /unverified/);
});

test('exhausted retries fail with the reason', async () => {
  const obses = ['A', 'B', 'C'].map((w) => mkObs({ window: w }));
  let oi = 0;
  const loop = new TaskLoop(
    deps({
      observe: async () => obses[Math.min(oi++, obses.length - 1)],
      decide: async () => decide({ action: 'open_app', app: 'vlc' }, { expect: { windowContains: 'vlc' } }),
    }),
    loopOpts({ maxRetries: 1 }),
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'failed');
  assert.match(result.summary, /unverified/);
  assert.match(result.summary, /2 consecutive failures/);
  assert.equal(result.steps[0].state, 'failed');
});

test('repeated screen states stop the task (no progress)', async () => {
  const loop = new TaskLoop(
    deps({ decide: async () => decide({ action: 'click', target: 'e1' }) }),
    loopOpts(),
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'failed');
  assert.match(result.summary, /same screen state 3×/);
  assert.match(result.summary, /no progress/);
  assert.deepEqual(
    result.steps.map((s) => s.state),
    ['done', 'failed'],
  );
});

test('repeatTolerance 0 stops on the first repeat', async () => {
  const loop = new TaskLoop(
    deps({ decide: async () => decide({ action: 'click', target: 'e1' }) }),
    loopOpts({ repeatTolerance: 0 }),
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'failed');
  assert.match(result.summary, /same screen state 2×/);
});

test('needsConfirm pauses; resume(true) executes without model confirm', async () => {
  const seen: Array<Record<string, unknown>> = [];
  const loop = new TaskLoop(
    deps({
      decide: async () => decide({ action: 'click', target: 'e1' }, { needsConfirm: true }),
      execute: async (_t, args) => {
        seen.push(args);
        return { ok: true };
      },
    }),
    loopOpts(),
  );
  // Decide done on the second iteration so the task can finish.
  const p = loop.run('g');
  const paused = await oncePhase('paused');
  assert.match(String(paused.question), /needs your OK/);
  loop.resume(true);
  // The loop decides the same gated step again — approve once more, then it
  // repeats the screen state and stops. Cancel instead for a clean assertion.
  const paused2 = await oncePhase('paused');
  assert.match(String(paused2.question), /needs your OK/);
  loop.cancel();
  const result = await p;
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(seen, [{ action: 'click', x: 130, y: 212 }], 'resolved physical args, no confirm:true');
});

test('resume(false) cancels the task', async () => {
  const loop = new TaskLoop(
    deps({ decide: async () => decide({ action: 'click', target: 'e1' }, { needsConfirm: true }) }),
    loopOpts(),
  );
  const p = loop.run('g');
  await oncePhase('paused');
  loop.resume(false);
  const result = await p;
  assert.equal(result.status, 'cancelled');
});

test('daemon confirmation_required pauses, redeems the id, retries once', async () => {
  let n = 0;
  const seen: Array<Record<string, unknown>> = [];
  const redeemed: string[] = [];
  let calls = 0;
  const loop = new TaskLoop(
    deps({
      decide: async () => (++calls === 1 ? decide({ action: 'open_app', app: 'vlc' }) : { done: true }),
      execute: async (_t, args) => {
        seen.push(args);
        return ++n === 1
          ? { ok: false, error: 'confirmation_required', detail: 'Say yes.', confirmationId: 'cid-1' }
          : { ok: true };
      },
      confirm: async (id) => {
        redeemed.push(id);
        return { ok: true };
      },
    }),
    loopOpts(),
  );
  const p = loop.run('g');
  const paused = await oncePhase('paused');
  assert.match(String(paused.question), /gated/);
  loop.resume(true);
  const result = await p;
  assert.equal(result.status, 'done');
  assert.equal(seen.length, 2);
  assert.deepEqual(redeemed, ['cid-1'], 'UI/voice-confirm handler redeems after approval');
  assert.equal(seen[1].confirmation_id, 'cid-1');
  assert.ok(!('confirm' in (seen[1] as object)), 'no confirm:true anywhere');
});

test('daemon gate without a confirm dep fails the step (no self-confirm)', async () => {
  const loop = new TaskLoop(
    deps({
      decide: async () => decide({ action: 'open_app', app: 'vlc' }),
      execute: async () => ({ ok: false, error: 'confirmation_required', detail: 'Say yes.', confirmationId: 'cid-9' }),
    }),
    loopOpts({ maxRetries: 0 }),
  );
  const p = loop.run('g');
  await oncePhase('paused');
  loop.resume(true);
  const result = await p;
  assert.equal(result.status, 'failed');
  assert.match(result.summary, /deps\.confirm missing/);
});

test('step budget caps decisions', async () => {
  const loop = new TaskLoop(
    deps({ decide: async () => decide({ action: 'click', target: 'e1' }) }),
    loopOpts({ maxSteps: 1 }),
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'failed');
  assert.match(result.summary, /budget/);
});

test('cancel mid-run stops after the current step', async () => {
  const obses = [mkObs({ window: 'A' }), mkObs({ window: 'B' })];
  let oi = 0;
  const loop = new TaskLoop(
    deps({
      observe: async () => obses[Math.min(oi++, obses.length - 1)],
      decide: async () => decide({ action: 'click', target: 'e1' }),
      execute: async () => {
        loop.cancel();
        return { ok: true };
      },
    }),
    loopOpts(),
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'cancelled');
  assert.equal(result.steps.filter((s) => s.state === 'done').length, 1);
});

test('observe failure fails closed (never acts blind)', async () => {
  let calls = 0;
  const loop = new TaskLoop(
    deps({
      observe: async () => {
        calls++;
        throw new Error('not_connected');
      },
    }),
    loopOpts(),
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'failed');
  assert.match(result.summary, /Couldn't observe/);
  assert.equal(calls, 2, 'one retry, then fail closed');
  assert.deepEqual(result.steps, []);
});

test('losing observation after acting fails the task', async () => {
  let n = 0;
  const loop = new TaskLoop(
    deps({
      observe: async () => {
        if (++n === 1) return mkObs();
        throw new Error('timeout');
      },
      decide: async () => decide({ action: 'click', target: 'e1' }),
    }),
    loopOpts(),
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'failed');
  assert.match(result.summary, /lost screen observation/);
});

test('run rejects an empty goal', async () => {
  const loop = new TaskLoop(deps(), loopOpts());
  await assert.rejects(() => loop.run('   '), /missing_goal/);
});

test('decide maps shot coords to physical pixels end to end', async () => {
  const seen: Array<Record<string, unknown>> = [];
  let calls = 0;
  const loop = new TaskLoop(
    deps({
      decide: async () => (++calls === 1 ? decide({ action: 'click', x: 100, y: 60 }) : { done: true }),
      execute: async (_t, args) => {
        seen.push(args);
        return { ok: true };
      },
    }),
    loopOpts(),
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'done');
  assert.deepEqual(seen, [{ action: 'click', x: 200, y: 120 }], 'shot ÷ 0.5 scale');
});

function judgeStub(
  over: {
    choice?: () => Promise<{ choice: string; confidence: number }>;
    score?: () => Promise<{ score: number; confidence: number }>;
    noul?: () => Promise<{ noul: number }>;
  } = {},
) {
  return {
    choice: async () => ({ choice: 'replan', confidence: 0.9 }),
    score: async () => ({ score: 5, confidence: 0.9 }),
    noul: async () => ({ noul: 0.95 }),
    ...over,
  };
}

test('step gate rejects feed back as failures, not terminal stops', async () => {
  let gates = 0;
  let n = 0;
  const loop = new TaskLoop(
    deps({
      decide: async () => (++n <= 2 ? decide({ action: 'click', target: 'e1' }) : { done: true }),
      judge: judgeStub({ score: async () => ({ score: ++gates === 1 ? 2 : 5, confidence: 0.88 }) }),
    }),
    loopOpts(),
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'done');
  assert.equal(gates, 2);
});

test('judge errors fail open to heuristic behavior', async () => {
  const boom = async (): Promise<never> => {
    throw new Error('judge_unreachable: down');
  };
  const obses = [mkObs(), mkObs({ window: 'VLC media player', tree: [] })];
  let oi = 0;
  let n = 0;
  const loop = new TaskLoop(
    deps({
      observe: async () => obses[Math.min(oi++, obses.length - 1)],
      decide: async () => (++n === 1 ? decide({ action: 'click', target: 'e1' }, { expect: { windowContains: 'vlc' } }) : { done: true }),
      judge: judgeStub({ score: boom, noul: boom, choice: boom }),
    }),
    loopOpts(),
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'done');
});

test('recovery choice retry_same re-executes once, then proceeds', async () => {
  let n = 0;
  let dn = 0;
  const loop = new TaskLoop(
    deps({
      decide: async () => (++dn === 1 ? decide({ action: 'click', target: 'e1' }) : { done: true }),
      execute: async () => (++n === 1 ? { ok: false, error: 'timeout' } : { ok: true }),
      judge: judgeStub({ choice: async () => ({ choice: 'retry_same', confidence: 0.9 }) }),
    }),
    loopOpts(),
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'done');
  assert.equal(n, 2);
  assert.equal(dn, 2, 'no fresh decide for the retry');
});

test('recovery choice ask_user pauses; approval continues, denial cancels', async () => {
  const mk = () =>
    new TaskLoop(
      deps({
        decide: (() => {
          let dn = 0;
          return async () => (++dn === 1 ? decide({ action: 'click', target: 'e1' }) : { done: true });
        })(),
        execute: (() => {
          let n = 0;
          return async () => (++n === 1 ? { ok: false, error: 'timeout' } : { ok: true });
        })(),
        judge: judgeStub({ choice: async () => ({ choice: 'ask_user', confidence: 0.9 }) }),
      }),
      loopOpts(),
    );
  const yes = mk();
  const p1 = yes.run('g');
  const paused = await oncePhase('paused');
  assert.match(String(paused.question), /Keep trying/);
  yes.resume(true);
  assert.equal((await p1).status, 'done');

  const no = mk();
  const p2 = no.run('g');
  await oncePhase('paused');
  no.resume(false);
  assert.equal((await p2).status, 'cancelled');
});

test('low-confidence recovery choice decides fresh instead of retrying', async () => {
  let decides = 0;
  let executes = 0;
  const loop = new TaskLoop(
    deps({
      decide: async () => (++decides === 1 ? decide({ action: 'click', target: 'e1' }) : { done: true }),
      execute: async () => (++executes === 1 ? { ok: false, error: 'timeout' } : { ok: true }),
      judge: judgeStub({ choice: async () => ({ choice: 'retry_same', confidence: 0.2 }) }),
    }),
    loopOpts(),
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'done');
  assert.equal(decides, 2);
  assert.equal(executes, 1, 'no re-execution without confident retry_same');
});

test('judge second-opinion overrides a heuristic miss', async () => {
  let n = 0;
  const loop = new TaskLoop(
    deps({
      decide: async () => (++n === 1 ? decide({ action: 'click', target: 'e1' }, { expect: { windowContains: 'vlc' } }) : { done: true }),
      judge: judgeStub({ noul: async () => ({ noul: 0.9 }) }),
    }),
    loopOpts({ maxRetries: 0 }),
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'done');
});

test('judge doubt flips an expectation-less pass into recovery', async () => {
  const loop = new TaskLoop(
    deps({
      decide: async () => decide({ action: 'click', target: 'e1' }),
      judge: judgeStub({ noul: async () => ({ noul: 0.1 }) }),
    }),
    loopOpts({ maxRetries: 0 }),
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'failed');
  assert.match(result.summary, /judge doubted/);
});

/* ── Phase 22: preview data for the approval overlay ─────────────────────── */

test('resolveStepTarget exposes a preview point + element box', () => {
  const obs = mkObs();
  // Element id → center of bounds + the bounds themselves.
  const byId = resolveStepTarget(decide({ action: 'click', target: 'e1' }), obs);
  assert.ok(!('error' in byId));
  assert.deepEqual(byId.preview, { x: 130, y: 212, bounds: { x: 100, y: 200, width: 60, height: 24 } });
  // Bare coordinates → the resolved point, no box.
  const byCoord = resolveStepTarget(decide({ action: 'click', x: 100, y: 100 }), obs);
  assert.ok(!('error' in byCoord));
  assert.deepEqual(byCoord.preview, { x: 200, y: 200, bounds: null });
  // Drags carry the end point too.
  const drag = resolveStepTarget(decide({ action: 'drag', fromX: 10, fromY: 10, toX: 20, toY: 30 }), obs);
  assert.ok(!('error' in drag));
  assert.deepEqual(drag.preview, { x: 20, y: 20, toX: 40, toY: 60, bounds: null });
  // Targetless steps have no single screen target.
  const plain = resolveStepTarget(decide({ action: 'type_text', text: 'hi' }), obs);
  assert.ok(!('error' in plain));
  assert.equal(plain.preview, undefined);
});

test('step events carry the preview target; pauses raise preview with shot', async () => {
  const loop = new TaskLoop(
    deps({ decide: async () => decide({ action: 'click', target: 'e1' }, { needsConfirm: true }) }),
    loopOpts(),
  );
  let step: Record<string, unknown> | null = null;
  const previews: Array<Record<string, unknown>> = [];
  const h = (e: Event) => {
    const d = (e as CustomEvent).detail as Record<string, unknown>;
    if (d.phase === 'step') step = d;
    if (d.phase === 'preview') previews.push(d);
  };
  taskEvents.addEventListener('task:state', h);
  const p = loop.run('g');
  const paused = await oncePhase('paused');
  taskEvents.removeEventListener('task:state', h);
  assert.match(String(paused.question), /needs your OK/);
  assert.deepEqual(step!.target, { x: 130, y: 212, bounds: { x: 100, y: 200, width: 60, height: 24 } });
  assert.equal(previews.length, 1);
  assert.equal(previews[0].reason, 'confirm');
  assert.deepEqual((previews[0].shot as Record<string, unknown>).width, 960);
  assert.deepEqual(previews[0].target, step!.target);
  loop.resume(false);
  const result = await p;
  assert.equal(result.status, 'cancelled');
  // The record itself keeps the preview for the step log.
  assert.deepEqual(result.steps[0].preview, step!.target);
});

test('approving a pause dismisses the preview overlay', async () => {
  const loop = new TaskLoop(
    deps({
      decide: async (_g, ctx) =>
        ctx.step === 1
          ? decide({ action: 'click', target: 'e1' }, { needsConfirm: true })
          : { done: true, summary: 'ok' },
    }),
    loopOpts(),
  );
  const previews: Array<Record<string, unknown>> = [];
  const h = (e: Event) => {
    const d = (e as CustomEvent).detail as Record<string, unknown>;
    if (d.phase === 'preview') previews.push(d);
  };
  taskEvents.addEventListener('task:state', h);
  const p = loop.run('g');
  await oncePhase('paused');
  loop.resume(true);
  const result = await p;
  taskEvents.removeEventListener('task:state', h);
  assert.equal(result.status, 'done');
  assert.ok(previews.length >= 2, `expected raise + dismiss, saw ${previews.length}`);
  assert.equal(previews[0].dismissed, undefined);
  assert.equal(previews[previews.length - 1].dismissed, true);
});
