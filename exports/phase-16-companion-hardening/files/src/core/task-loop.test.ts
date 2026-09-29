import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskLoop, taskEvents, verifyStep, describeStep, type TaskLoopDeps, type TaskResult } from './TaskLoop.ts';
import type { TaskPlan, TaskStep } from './task-planner.ts';

function step(args: Record<string, unknown>, extra: Partial<TaskStep> = {}): TaskStep {
  return { tool: 'computer', args, ...extra };
}

function deps(over: Partial<TaskLoopDeps> = {}): TaskLoopDeps {
  return {
    plan: async () => {
      throw new Error('no plan stub');
    },
    execute: async () => ({ ok: true, data: {} }),
    observe: async () => ({}),
    ...over,
  };
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

test('verifyStep matches window + text expectations', () => {
  assert.equal(verifyStep(step({ action: 'see' }), {}).pass, true);
  assert.equal(verifyStep(step({ action: 'see' }, { expect: { windowContains: 'vlc' } }), { window: 'VLC media player' }).pass, true);
  const miss = verifyStep(step({ action: 'see' }, { expect: { windowContains: 'vlc' } }), { window: 'Notepad' });
  assert.equal(miss.pass, false);
  assert.match(miss.reason ?? '', /Notepad/);
  assert.equal(verifyStep(step({ action: 'see' }, { expect: { textVisible: 'Play' } }), { textFound: true }).pass, true);
  assert.equal(verifyStep(step({ action: 'see' }, { expect: { textVisible: 'Play' } }), {}).pass, false);
});

test('describeStep prefers notes, then app/url/text/keys', () => {
  assert.equal(describeStep(step({ action: 'click' }, { note: 'Hit play' })), 'Hit play');
  assert.equal(describeStep(step({ action: 'open_app', app: 'vlc' })), 'open_app vlc');
  assert.equal(describeStep(step({ action: 'hotkey', keys: 'win' })), 'hotkey win');
});

test('happy path runs plan → verify → done and remembers', async () => {
  const plans: TaskPlan[] = [
    {
      goal: 'g',
      steps: [
        step({ action: 'open_app', app: 'vlc' }, { expect: { windowContains: 'vlc' } }),
        step({ action: 'hotkey', keys: 'ctrl+o' }),
      ],
    },
  ];
  const remembered: string[] = [];
  const loop = new TaskLoop(
    deps({
      plan: async () => plans[0],
      observe: async () => ({ window: 'VLC media player' }),
      remember: async (s) => {
        remembered.push(s);
      },
    }),
  );
  let result: TaskResult | null = null;
  const phases = await phasesDuring(async () => {
    result = await loop.run('open vlc');
  });
  assert.equal(result!.status, 'done');
  assert.match(result!.summary, /2\/2 steps verified/);
  assert.deepEqual(phases, ['started', 'planned', 'step', 'verified', 'step', 'verified', 'done']);
  assert.equal(remembered.length, 1);
  assert.match(remembered[0], /Done/);
});

test('unverified step replans with failure context, then succeeds', async () => {
  let calls = 0;
  const failures: Array<string | undefined> = [];
  const loop = new TaskLoop(
    deps({
      plan: async (_g, ctx) => {
        calls++;
        failures.push(ctx.failure);
        return calls === 1
          ? { goal: 'g', steps: [step({ action: 'click', x: 1, y: 1 }, { expect: { windowContains: 'vlc' } })] }
          : { goal: 'g', steps: [step({ action: 'open_app', app: 'vlc' }, { expect: { windowContains: 'vlc' } })] };
      },
      observe: (() => {
        let n = 0;
        return async () => (++n === 1 ? {} : { window: calls === 1 ? 'Notepad' : 'VLC media player' });
      })(),
    }),
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'done');
  assert.equal(calls, 2);
  assert.match(failures[1] ?? '', /unverified/);
});

test('exhausted replans fail with the reason', async () => {
  const loop = new TaskLoop(
    deps({
      plan: async () => ({ goal: 'g', steps: [step({ action: 'see' }, { expect: { windowContains: 'vlc' } })] }),
      observe: async () => ({ window: 'Notepad' }),
    }),
    { maxReplans: 1 },
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'failed');
  assert.match(result.summary, /unverified/);
  assert.equal(result.steps[0].state, 'failed');
});

test('needsConfirm pauses; resume(true) executes without model confirm', async () => {
  const seen: Array<Record<string, unknown>> = [];
  const loop = new TaskLoop(
    deps({
      plan: async () => ({ goal: 'g', steps: [step({ action: 'click' }, { needsConfirm: true })] }),
      execute: async (_t, args) => {
        seen.push(args);
        return { ok: true };
      },
    }),
  );
  const p = loop.run('g');
  const paused = await oncePhase('paused');
  assert.match(String(paused.question), /needs your OK/);
  loop.resume(true);
  const result = await p;
  assert.equal(result.status, 'done');
  assert.deepEqual(seen, [{ action: 'click' }], 'no confirm:true from the loop');
});

test('resume(false) cancels the task', async () => {
  const loop = new TaskLoop(
    deps({ plan: async () => ({ goal: 'g', steps: [step({ action: 'click' }, { needsConfirm: true })] }) }),
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
  const loop = new TaskLoop(
    deps({
      plan: async () => ({ goal: 'g', steps: [step({ action: 'open_app', app: 'vlc' })] }),
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
      plan: async () => ({ goal: 'g', steps: [step({ action: 'open_app', app: 'vlc' })] }),
      execute: async () => ({ ok: false, error: 'confirmation_required', detail: 'Say yes.', confirmationId: 'cid-9' }),
    }),
    { maxReplans: 0 },
  );
  const p = loop.run('g');
  await oncePhase('paused');
  loop.resume(true);
  const result = await p;
  assert.equal(result.status, 'failed');
  assert.match(result.summary, /deps\.confirm missing/);
});

test('step budget caps execution', async () => {
  const loop = new TaskLoop(
    deps({
      plan: async () => ({
        goal: 'g',
        steps: [step({ action: 'see' }), step({ action: 'see' }), step({ action: 'see' })],
      }),
    }),
    { maxSteps: 2 },
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'failed');
  assert.match(result.summary, /budget/);
});

test('cancel mid-run stops after the current step', async () => {
  const loop = new TaskLoop(
    deps({
      plan: async () => ({ goal: 'g', steps: [step({ action: 'see' }), step({ action: 'see' })] }),
      execute: async () => {
        loop.cancel();
        return { ok: true };
      },
    }),
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'cancelled');
  assert.equal(result.steps.filter((s) => s.state === 'done').length, 1);
});

test('planner failure fails gracefully; autoConfirm skips pauses', async () => {
  const bad = new TaskLoop(deps({ plan: async () => { throw new Error('planner_unreachable: down'); } }));
  const r1 = await bad.run('g');
  assert.equal(r1.status, 'failed');
  assert.match(r1.summary, /Couldn't plan/);

  const seen: Array<Record<string, unknown>> = [];
  const auto = new TaskLoop(
    deps({
      plan: async () => ({ goal: 'g', steps: [step({ action: 'click' }, { needsConfirm: true })] }),
      execute: async (_t, args) => {
        seen.push(args);
        return { ok: true };
      },
    }),
    { autoConfirm: true },
  );
  let r2: TaskResult | null = null;
  const phases = await phasesDuring(async () => {
    r2 = await auto.run('g');
  });
  assert.equal(r2!.status, 'done');
  assert.ok(!phases.includes('paused'));
  assert.ok(!('confirm' in (seen[0] as object)), 'autoConfirm skips pauses but never injects confirm:true');
});

test('run rejects an empty goal', async () => {
  const loop = new TaskLoop(deps());
  await assert.rejects(() => loop.run('   '), /missing_goal/);
});

function judgeStub(over: {
  choice?: () => Promise<{ choice: string; confidence: number }>;
  score?: () => Promise<{ score: number; confidence: number }>;
  noul?: () => Promise<{ noul: number }>;
} = {}) {
  return {
    choice: async () => ({ choice: 'replan', confidence: 0.9 }),
    score: async () => ({ score: 5, confidence: 0.9 }),
    noul: async () => ({ noul: 0.95 }),
    ...over,
  };
}

test('plan gate rejects shaky plans before anything executes', async () => {
  let executed = 0;
  const loop = new TaskLoop(
    deps({
      plan: async () => ({ goal: 'g', steps: [step({ action: 'click' })] }),
      execute: async () => {
        executed++;
        return { ok: true };
      },
      judge: judgeStub({ score: async () => ({ score: 2, confidence: 0.88 }) }),
    }),
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'failed');
  assert.match(result.summary, /plan rejected/);
  assert.match(result.summary, /score 2\/5/);
  assert.equal(executed, 0);
});

test('judge errors fail open to heuristic behavior', async () => {
  const boom = async (): Promise<never> => {
    throw new Error('judge_unreachable: down');
  };
  const loop = new TaskLoop(
    deps({
      plan: async () => ({ goal: 'g', steps: [step({ action: 'see' }, { expect: { windowContains: 'vlc' } })] }),
      observe: async () => ({ window: 'VLC media player' }),
      judge: judgeStub({ score: boom, noul: boom, choice: boom }),
    }),
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'done');
});

test('recovery choice retry_same re-executes once, then proceeds', async () => {
  let n = 0;
  const loop = new TaskLoop(
    deps({
      plan: async () => ({ goal: 'g', steps: [step({ action: 'click' })] }),
      execute: async () => (++n === 1 ? { ok: false, error: 'timeout' } : { ok: true }),
      judge: judgeStub({ choice: async () => ({ choice: 'retry_same', confidence: 0.9 }) }),
    }),
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'done');
  assert.equal(n, 2);
});

test('recovery choice ask_user pauses; approval replans, denial cancels', async () => {
  const mk = () =>
    new TaskLoop(
      deps({
        plan: async (_g, ctx) =>
          ctx.failure
            ? { goal: 'g', steps: [step({ action: 'see' })] }
            : { goal: 'g', steps: [step({ action: 'click' })] },
        execute: (() => {
          let n = 0;
          return async () => (++n === 1 ? { ok: false, error: 'timeout' } : { ok: true });
        })(),
        judge: judgeStub({ choice: async () => ({ choice: 'ask_user', confidence: 0.9 }) }),
      }),
    );
  const yes = mk();
  const p1 = yes.run('g');
  const paused = await oncePhase('paused');
  assert.match(String(paused.question), /Replan and retry/);
  yes.resume(true);
  assert.equal((await p1).status, 'done');

  const no = mk();
  const p2 = no.run('g');
  await oncePhase('paused');
  no.resume(false);
  assert.equal((await p2).status, 'cancelled');
});

test('low-confidence recovery choice falls back to replan', async () => {
  let plans = 0;
  const loop = new TaskLoop(
    deps({
      plan: async () => {
        plans++;
        return plans === 1
          ? { goal: 'g', steps: [step({ action: 'click' })] }
          : { goal: 'g', steps: [step({ action: 'see' })] };
      },
      execute: (() => {
        let n = 0;
        return async () => (++n === 1 ? { ok: false, error: 'timeout' } : { ok: true });
      })(),
      judge: judgeStub({ choice: async () => ({ choice: 'retry_same', confidence: 0.2 }) }),
    }),
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'done');
  assert.equal(plans, 2);
});

test('judge second-opinion overrides a heuristic miss', async () => {
  const loop = new TaskLoop(
    deps({
      plan: async () => ({ goal: 'g', steps: [step({ action: 'see' }, { expect: { windowContains: 'vlc' } })] }),
      observe: async () => ({ window: 'Unrelated window' }),
      judge: judgeStub({ noul: async () => ({ noul: 0.9 }) }),
    }),
    { maxReplans: 0 },
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'done');
});

test('judge doubt flips an expectation-less pass into recovery', async () => {
  const loop = new TaskLoop(
    deps({
      plan: async () => ({ goal: 'g', steps: [step({ action: 'click' })] }),
      judge: judgeStub({ noul: async () => ({ noul: 0.1 }) }),
    }),
    { maxReplans: 0 },
  );
  const result = await loop.run('g');
  assert.equal(result.status, 'failed');
  assert.match(result.summary, /judge doubted/);
});
