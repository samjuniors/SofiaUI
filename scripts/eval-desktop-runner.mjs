/**
 * scripts/eval-desktop-runner.mjs — Phase 23: real agent loop, deterministic brain.
 *
 * Each desktop task runs the PRODUCTION TaskLoop with a REAL SofiaJudge
 * against the REAL companion daemon on the (Windows) runner. The only
 * test double is the decider: instead of an LLM it plays back the task's
 * scripted plan — one decision per step — resolving `find` queries against
 * the live UI tree and polling `waitForWindow` probes until the app lands.
 * Failures feed back into plan retries exactly like a confused model would,
 * so recovery, gating, and verification all run for real. No LLM, no flaky
 * model, no cost — determinism with the honest machinery underneath.
 *
 * A task is:
 *   { id, goal, plan?, hostile?, setup?, verify, approvals?, timeoutMs?,
 *     maxSteps?, maxRetries?, settleMs? }
 * Plan steps:
 *   { action, args?, argsFn?(seen), find?{role?,name?,nth?}, expect?, note? }
 *   { waitForWindow: 'Notepad' }            // read-only poll, retries itself
 * Hostile tasks (injection): { prefix: [...plan steps...], injected: {...step} }
 *   — the stub plays the benign prefix, then proposes the injected step
 *   forever (worst case: the model fully complied). The task passes only if
 *   the loop/judge/daemon block it: no successful injected execute.
 */

import { TaskLoop, taskEvents } from '../src/core/TaskLoop.ts';
import { SofiaJudge } from '../src/core/decision-judge.ts';
import { normalizeObservation } from '../src/core/task-decider.ts';

/**
 * Resolve a `find` query against the live UI tree. Name is a
 * case-insensitive substring (UIA names carry prefixes/suffixes); role must
 * match exactly (case-insensitive). Prefers nodes with bounds (clickable).
 */
export function findNode(tree, q = {}) {
  const nodes = Array.isArray(tree) ? tree : [];
  const role = typeof q.role === 'string' ? q.role.toLowerCase() : null;
  const name = typeof q.name === 'string' ? q.name.toLowerCase() : null;
  const cands = nodes.filter((n) => {
    if (!n || typeof n !== 'object') return false;
    if (role && String(n.role ?? '').toLowerCase() !== role) return false;
    if (name && !String(n.name ?? '').toLowerCase().includes(name)) return false;
    return true;
  });
  cands.sort((a, b) => Number(Boolean(b.bounds)) - Number(Boolean(a.bounds)));
  const nth = Number.isInteger(q.nth) && q.nth >= 0 ? q.nth : 0;
  return cands[nth] ?? null;
}

function actionList(record) {
  return record.executed.map((e) => e.action).join(', ') || '(none)';
}

function failureDiagnostics(lastObs, record) {
  const names = (lastObs?.tree ?? [])
    .map((n) => (n && n.name ? `${n.id}[${n.role}] ${String(n.name).slice(0, 40)}` : null))
    .filter(Boolean)
    .slice(0, 30);
  return (
    `window=${JSON.stringify(lastObs?.window ?? null)} app=${lastObs?.app ?? null} ` +
    `treeNodes=${lastObs?.tree?.length ?? 0} executed=[${actionList(record)}] ` +
    `pauses=${record.pauses.length} approvals=[${record.approvals.join(',')}] ` +
    `tree=[${names.join(' | ')}]`
  );
}

export async function runDesktopTask(ctx, task) {
  const record = { executed: [], attempts: [], pauses: [], approvals: [], rejections: [] };
  const seen = []; // successful executes, for argsFn
  const shared = { lastAction: null };
  let lastObs = null;
  const t0 = Date.now();

  if (typeof task.setup === 'function') {
    await task.setup(ctx);
  }

  const plan = Array.isArray(task.plan) ? task.plan : [];
  const hostile = task.hostile && typeof task.hostile === 'object' ? task.hostile : null;
  const prefix = hostile && Array.isArray(hostile.prefix) ? hostile.prefix : [];
  let planIdx = 0;
  let emitted = false;

  const emitStep = (step, obs) => {
    if (step && typeof step.waitForWindow === 'string') {
      shared.lastAction = 'get_active_window';
      return {
        done: false,
        tool: 'computer',
        args: { action: 'get_active_window' },
        expect: { windowContains: step.waitForWindow },
        note: `wait for window “${step.waitForWindow}”`,
      };
    }
    const base = typeof step.argsFn === 'function' ? step.argsFn(seen) : { ...(step.args ?? {}) };
    if (step.find) {
      const node = findNode(obs.tree, step.find);
      if (!node) {
        // No target: resolveStepTarget fails → failure feedback → the next
        // decide retries the same step. UI polling for free.
        return {
          done: false,
          tool: 'computer',
          args: { action: step.action },
          note: `find ${JSON.stringify(step.find)} (not on screen yet)`,
        };
      }
      shared.lastAction = step.action;
      return {
        done: false,
        tool: 'computer',
        args: { action: step.action, ...base, target: node.id },
        ...(step.expect ? { expect: step.expect } : {}),
        note: step.note ?? `${step.action} ${node.id} “${String(node.name ?? '').slice(0, 40)}”`,
      };
    }
    shared.lastAction = step.action;
    return {
      done: false,
      tool: 'computer',
      args: { action: step.action, ...base },
      ...(step.expect ? { expect: step.expect } : {}),
      ...(typeof step.note === 'string' ? { note: step.note } : {}),
    };
  };

  const loop = new TaskLoop(
    {
      observe: async () => {
        // Slow CI spinners can take a while on screenshot + UIA dump.
        const r = await ctx.call('observe', {}, 60000);
        if (!r.ok || !r.result) throw new Error(r.detail || r.error || 'observe failed');
        lastObs = normalizeObservation(r.result);
        return lastObs;
      },
      decide: async (_goal, dctx) => {
        if (hostile) {
          // Benign prefix first (proves the pipeline is alive), then the
          // injected step forever — worst case: total model compliance.
          if (!dctx.failure && emitted) planIdx++;
          emitted = true;
          if (planIdx < prefix.length) return emitStep(prefix[planIdx], dctx.obs);
          return emitStep(hostile.injected, dctx.obs);
        }
        if (!dctx.failure && emitted) planIdx++;
        emitted = true;
        if (planIdx >= plan.length) {
          return { done: true, summary: `plan complete (${plan.length} steps)` };
        }
        return emitStep(plan[planIdx], dctx.obs);
      },
      execute: async (_tool, args) => {
        const { action, ...rest } = args;
        const name = String(action ?? '?');
        record.attempts.push({ action: name });
        const r = await ctx.call(name, rest);
        if (!r.ok) {
          return {
            ok: false,
            error: r.error,
            detail: r.detail,
            confirmationId: typeof r.confirmation_id === 'string' ? r.confirmation_id : undefined,
          };
        }
        const entry = { action: name, result: r.result };
        seen.push(entry);
        record.executed.push(entry);
        return { ok: true, data: r.result };
      },
      confirm: async (id) => {
        const r = await ctx.confirm(id);
        return r.ok ? { ok: true } : { ok: false, error: r.error ?? 'redemption_failed' };
      },
      judge: new SofiaJudge(),
    },
    {
      maxSteps: task.maxSteps ?? plan.length * 4 + prefix.length * 4 + 10,
      maxRetries: task.maxRetries ?? 6,
      settleMs: task.settleMs ?? 1200,
    },
  );

  const onState = (e) => {
    const d = e.detail;
    if (!d || d.id !== loop.id) return;
    if (d.phase === 'retry' && d.reason) record.rejections.push(String(d.reason));
    if (d.phase === 'paused') {
      record.pauses.push(String(d.question ?? ''));
      // Default deny. Tasks declare explicit approvals (e.g. one trash) to
      // exercise the REAL pause → redeem → retry path end to end.
      // NB: resume() is deferred a microtask — the loop emits 'paused'
      // synchronously BEFORE it starts waiting, so a sync resume would be
      // swallowed (pausedResolve isn't set yet) and hang forever.
      const allowed = (task.approvals ?? []).some((a) => a && a.action === shared.lastAction);
      if (allowed) record.approvals.push(shared.lastAction);
      queueMicrotask(() => loop.resume(allowed));
    }
  };
  taskEvents.addEventListener('task:state', onState);

  const timeoutMs = task.timeoutMs ?? 180000;
  let result;
  let timer = null;
  try {
    result = await Promise.race([
      loop.run(task.goal),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          loop.cancel();
          reject(new Error(`timeout after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
      }),
    ]);
  } catch (err) {
    if (timer) clearTimeout(timer);
    taskEvents.removeEventListener('task:state', onState);
    return {
      pass: false,
      detail: `${err?.message || err} :: ${failureDiagnostics(lastObs, record)}`,
      ms: Date.now() - t0,
      steps: record.executed.length,
      costUsd: 0,
      record,
    };
  }
  if (timer) clearTimeout(timer);
  taskEvents.removeEventListener('task:state', onState);

  try {
    const v = await task.verify(ctx, { result, record, seen, lastObs });
    if (!v || v.pass !== true) {
      return {
        pass: false,
        detail: `${(v && v.detail) || 'verify failed'} :: ${failureDiagnostics(lastObs, record)}`,
        ms: Date.now() - t0,
        steps: record.executed.length,
        costUsd: 0,
        record,
      };
    }
    // costUsd is LLM spend: the plan stub is deterministic, so desktop runs
    // are free. The column stays so a future LLM-brained run can fill it.
    return { pass: true, detail: v.detail || result.summary, ms: Date.now() - t0, steps: record.executed.length, costUsd: 0, record };
  } catch (err) {
    return {
      pass: false,
      detail: `verify threw: ${err?.message || err} :: ${failureDiagnostics(lastObs, record)}`,
      ms: Date.now() - t0,
      steps: record.executed.length,
      costUsd: 0,
      record,
    };
  }
}
