/**
 * scripts/self-improve.mjs — Phase 25: the self-improvement loop.
 *
 *   npm run self-improve -- --eval-json=eval.json   # full loop
 *   npm run self-improve -- --report                # analyze only, change nothing
 *
 * Reads failed task traces (daemon memory: failed `task` episodes + their
 * `reflection` episodes) and failed eval tasks (`--eval-json`), proposes ONE
 * branch per fix, replays the full eval suite in a disposable sandbox
 * (git worktree + the harness's own fresh daemon), and then:
 *
 *   skill prompt/skill change + no regressions + margin met → auto-merge
 *   code/report change, or anything short of the gate → PR for the user
 *   anything touching the forbidden paths → DROPPED, branch deleted, loud log
 *
 * THE AGENT CAN NEVER MODIFY: companion/policy*, scripts/eval* (the suite),
 * or scripts/self-improve* (its own approval logic). The FORBIDDEN guard
 * below is checked on every branch diff before any merge or PR — a
 * violation deletes the branch. Skill "margin" is defined over the failed
 * task traces that motivate the patch (linked, ≥1) plus a green sandbox
 * run; prompt margin is failed-eval count reduction (see decideMerge).
 * Skill patches deploy to live daemon memory only AFTER their branch merges.
 *
 * Daemon: connects to 127.0.0.1:$SOPHIA_COMPANION_PORT with
 * $SOPHIA_COMPANION_TOKEN (same env as any client). Unreachable → skill
 * signals are skipped with a warning; eval-json proposals still run.
 * Code drafts need a local Ollama (http://127.0.0.1:11434); absent → the
 * proposal degrades to a diagnosis report PR. Nothing here phones home.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchSkills } from '../memory/retrieve.mjs';

const exec = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ── The law ─────────────────────────────────────────────────────────── */

export const FORBIDDEN = [/^companion\/policy/, /^scripts\/eval/, /^scripts\/self-improve/];
/** Files whose diffs are prompt-tuning (auto-mergeable on margin + green). */
export const PROMPT_FILES = new Set(['src/core/task-decider.ts']);
export const DEFAULT_MARGIN = 0.5;
export const MAX_SKILL_PROPOSALS = 3;

/**
 * Classify a branch diff. Pure.
 * @returns {'skill'|'prompt'|'code'|'forbidden'} (docs/*.md never classify)
 */
export function classifyFiles(files) {
  const real = files.filter((f) => !f.endsWith('.md'));
  if (real.some((f) => FORBIDDEN.some((re) => re.test(f)))) return 'forbidden';
  if (real.some((f) => f.startsWith('memory/patches/'))) {
    return real.every((f) => f.startsWith('memory/patches/')) ? 'skill' : 'code';
  }
  if (!real.length) return 'code'; // docs-only branch: human eyes, never auto-merge
  return real.every((f) => PROMPT_FILES.has(f)) ? 'prompt' : 'code';
}

/**
 * The approval logic. THE AGENT MUST NEVER MODIFY THIS FUNCTION
 * (it lives in a FORBIDDEN path: scripts/self-improve*). Pure.
 *
 * Margin counts FIXED failures: |fixed| >= max(1, ceil(margin * |base|)).
 * Skill patches substitute patch-validity + linked task traces for the
 * eval margin (skills move future behavior, not current suite scores) but
 * still require a regression-free sandbox run.
 */
export function decideMerge({ kind, baseFailures = [], branchFailures = [], margin = DEFAULT_MARGIN, patchValid = false, motivating = 0 }) {
  if (kind === 'forbidden') return { action: 'drop', reason: 'forbidden path touched — branch must be deleted' };
  const base = new Set(baseFailures);
  const branch = new Set(branchFailures);
  const regressions = [...branch].filter((f) => !base.has(f));
  const fixed = [...base].filter((f) => !branch.has(f));
  if (kind === 'code' || kind === 'report') {
    return { action: 'pr', reason: `human review required (${fixed.length} fixed, ${regressions.length} regressions)` };
  }
  if (regressions.length > 0) {
    return { action: kind === 'prompt' ? 'pr' : 'drop', reason: `regressions: ${regressions.join(', ')}` };
  }
  if (kind === 'skill') {
    if (!patchValid) return { action: 'drop', reason: 'patch failed validation' };
    if (motivating < 1) return { action: 'drop', reason: 'no linked failed task trace' };
    return { action: 'merge', reason: `${motivating} linked trace(s), sandbox green` };
  }
  // prompt
  const need = Math.max(1, Math.ceil(margin * base.size));
  if (base.size === 0) return { action: 'drop', reason: 'baseline already green — nothing to beat' };
  if (fixed.length >= need) return { action: 'merge', reason: `${fixed.length}/${base.size} failures fixed (margin ${margin})` };
  return { action: 'pr', reason: `margin missed: ${fixed.length}/${need} fixed — human decides` };
}

/** First `Failed:` line of a critic reflection → skill failure-mode cause. Pure. */
export function extractCause(reflectionText) {
  for (const line of String(reflectionText ?? '').split('\n')) {
    const m = /^Failed:\s*(.+)$/.exec(line.trim());
    if (m) return m[1].trim().slice(0, 200);
  }
  return null;
}

/** Build a skill patch from a failure (null when there is nothing to add). Pure. */
export function buildSkillPatch({ skill, cause, severity = 'fail' }) {
  if (!skill || typeof skill.id !== 'number') return null;
  if (skill.status === 'retired') return null;
  const modes = Array.isArray(skill.steps?.failureModes) ? skill.steps.failureModes : [];
  const clean = String(cause ?? '').trim().slice(0, 200);
  if (!clean || modes.includes(clean)) return null;
  return {
    version: 1,
    skillId: skill.id,
    skillName: skill.name,
    addFailureModes: [clean],
    setStatus: severity === 'retire' ? 'retired' : null,
    rationale: `observed in production (${severity})`,
  };
}

/** Patch sanity before it may ride a branch. Pure (skill row passed in). */
export function validateSkillPatch(patch, skill) {
  if (!patch || patch.version !== 1) return false;
  if (!skill || skill.id !== patch.skillId || skill.status === 'retired') return false;
  if (!Array.isArray(patch.addFailureModes) || !patch.addFailureModes.length) return false;
  if (patch.addFailureModes.some((m) => typeof m !== 'string' || !m.trim() || m.length > 200)) return false;
  const modes = Array.isArray(skill.steps?.failureModes) ? skill.steps.failureModes : [];
  if (patch.addFailureModes.some((m) => modes.includes(m))) return false;
  if (patch.setStatus !== null && patch.setStatus !== 'retired') return false;
  return true;
}

/* ── Daemon client ───────────────────────────────────────────────────── */

async function daemonCall(port, token, action, args = {}) {
  const { default: WebSocket } = await import('ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('daemon timeout')); }, 15000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token })));
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.type === 'welcome') ws.send(JSON.stringify({ type: 'action', id: 1, action, args }));
      if (m.type === 'result' || m.type === 'action_result') {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        resolve({ ok: m.ok === true, result: m.result ?? {}, error: m.error, detail: m.detail });
      }
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

/* ── Git + sandbox ───────────────────────────────────────────────────── */

async function git(args, cwd = ROOT) {
  const r = await exec('git', args, { cwd, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  return r.stdout.trim();
}

async function sandboxFailures(worktree, jsonName) {
  const jsonPath = join(worktree, jsonName);
  try {
    await exec('node', ['scripts/eval-harness.mjs', '--suite=all', `--json=${jsonName}`], { cwd: worktree, timeout: 600000, maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    // The harness exits nonzero on failure — the JSON still tells the tale.
    if (!await fs.stat(jsonPath).then(() => true).catch(() => false)) {
      throw new Error(`sandbox eval produced no JSON: ${String(e.message ?? e).slice(0, 200)}`);
    }
  }
  const data = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  await fs.rm(jsonPath, { force: true });
  return (data.results ?? []).filter((r) => r.outcome === 'fail').map((r) => String(r.id));
}

async function withWorktree(ref, fn) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'sophia-improve-'));
  await fs.rmdir(dir);
  await git(['worktree', 'add', '--detach', dir, ref]);
  try {
    // Deps are identical unless the branch touches manifests — link, don't reinstall.
    for (const nm of ['node_modules', join('companion', 'node_modules')]) {
      await fs.symlink(join(ROOT, nm), join(dir, nm), 'dir').catch(() => {});
    }
    return await fn(dir);
  } finally {
    await git(['worktree', 'remove', '--force', dir]).catch(() => {});
  }
}

/* ── Ollama drafts (guarded, optional) ────────────────────────────────── */

async function ollamaModel() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: ctl.signal });
    clearTimeout(t);
    const names = ((await r.json()).models ?? []).map((m) => m.name);
    return names.find((n) => /coder/i.test(n)) ?? names[0] ?? null;
  } catch {
    return null;
  }
}

async function draftDiff(model, file, content, failures) {
  const prompt = `You repair a bug in ONE repo file. Reply with ONLY a unified diff (no prose, no fences) that applies with git apply.
File: ${file}
Failing evals:
${failures.map((f) => `- ${f.id}: ${f.detail ?? 'no detail'}`).join('\n')}
Current content:
---BEGIN---
${content.slice(0, 12000)}
---END---
Rules: minimal change; never touch safety policy, eval suites, or approval logic; keep all public shapes.`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 180000);
  try {
    const r = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0, num_predict: 3000 } }),
      signal: ctl.signal,
    });
    const text = String((await r.json()).response ?? '');
    const fenced = /```(?:diff)?\n([\s\S]*?)```/.exec(text);
    const diff = (fenced ? fenced[1] : text).trim();
    return diff.startsWith('--- ') || diff.startsWith('diff --git') ? diff : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/* ── The loop ─────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const out = { report: false, margin: DEFAULT_MARGIN, evalJson: null, fixFiles: [], port: null, token: null, model: null };
  for (const a of argv) {
    if (a === '--report') out.report = true;
    else if (a.startsWith('--margin=')) out.margin = Number(a.slice(9)) || DEFAULT_MARGIN;
    else if (a.startsWith('--eval-json=')) out.evalJson = a.slice(12);
    else if (a.startsWith('--fix-file=')) out.fixFiles.push(a.slice(11));
    else if (a.startsWith('--daemon-port=')) out.port = Number(a.slice(14));
    else if (a.startsWith('--token=')) out.token = a.slice(8);
    else if (a.startsWith('--model=')) out.model = a.slice(8);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = [];
  const say = (s) => { log.push(s); console.log(s); };
  say('Sofia self-improve — analyze → branch → sandbox → gate');

  const dirty = await git(['status', '--porcelain']).catch(() => 'unknown');
  if (dirty) { console.error('REFUSING: working tree is dirty — commit or stash first.'); process.exit(1); }
  for (const f of args.fixFiles) {
    if (FORBIDDEN.some((re) => re.test(f))) { console.error(`REFUSING: --fix-file=${f} is a forbidden path.`); process.exit(1); }
  }
  const baseRef = await git(['rev-parse', 'HEAD']);
  const baseBranch = await git(['branch', '--show-current']);

  // ── Signals ──
  const port = args.port ?? Number(process.env.SOPHIA_COMPANION_PORT ?? 7788);
  const token = args.token ?? process.env.SOPHIA_COMPANION_TOKEN ?? '';
  let daemonUp = false;
  const call = (a, b) => daemonCall(port, token, a, b);
  const failedTasks = []; // {episode, reflectionText|null}
  const skills = [];
  try {
    const eps = await call('memory_list', { store: 'episodic', kind: 'task', outcome: 'failed', limit: 50 });
    const refs = await call('memory_list', { store: 'episodic', kind: 'reflection', limit: 100 });
    const sk = await call('memory_list', { store: 'procedural', limit: 100 });
    if (eps.ok && refs.ok && sk.ok) {
      daemonUp = true;
      const refByTask = new Map();
      for (const r of refs.result.rows ?? []) {
        const m = /task episode #(\d+)/.exec(r.text ?? '');
        if (m) refByTask.set(Number(m[1]), r.text);
      }
      for (const e of eps.result.rows ?? []) failedTasks.push({ episode: e, reflectionText: refByTask.get(e.id) ?? null });
      skills.push(...(sk.result.rows ?? []));
    }
  } catch (e) {
    say(`daemon unreachable (${String(e.message ?? e).slice(0, 80)}) — skill signals skipped`);
  }
  say(`signals: ${failedTasks.length} failed task trace(s), ${skills.length} skill(s)${daemonUp ? '' : ' (no daemon)'}`);

  let evalFailures = [];
  if (args.evalJson) {
    const data = JSON.parse(await fs.readFile(args.evalJson, 'utf8'));
    evalFailures = (data.results ?? []).filter((r) => r.outcome === 'fail').map((r) => ({ id: String(r.id), detail: r.detail ?? null }));
    say(`signals: ${evalFailures.length} failed eval task(s) from ${args.evalJson}`);
  }
  if (!failedTasks.length && !evalFailures.length) {
    say('already green — nothing to improve.'); return;
  }

  // ── Proposals ──
  const proposals = []; // {slug, kind:'skill'|'draft'|'report', files:{path:content}|null, patches[], motivating, note}
  const seen = new Set();
  for (const t of failedTasks.slice(0, 20)) {
    if (proposals.filter((p) => p.kind === 'skill').length >= MAX_SKILL_PROPOSALS) break;
    const [match] = matchSkills(skills.filter((s) => s.status !== 'retired'), t.episode.text ?? '', 1);
    if (!match || seen.has(match.id)) continue;
    const cause = t.reflectionText ? extractCause(t.reflectionText) : null;
    const patch = buildSkillPatch({ skill: match, cause });
    if (!patch) continue;
    seen.add(match.id);
    patch.motivatingEpisode = t.episode.id;
    proposals.push({ slug: `skill-${match.id}`, kind: 'skill', patches: [patch], motivating: 1, note: `failure mode for #${match.id} (${match.name}): ${cause}` });
  }
  for (const s of skills) {
    if (s.status === 'retired' || (s.useCount ?? 0) < 5) continue;
    const rate = (s.successCount ?? 0) / s.useCount;
    if (rate < 0.5 && !seen.has(s.id)) {
      seen.add(s.id);
      proposals.push({ slug: `retire-${s.id}`, kind: 'skill', patches: [{ version: 1, skillId: s.id, skillName: s.name, addFailureModes: [], setStatus: 'retired', rationale: `rate ${rate} over ${s.useCount}` }], motivating: 1, note: `retire #${s.id} (rate ${Math.round(rate * 100) / 100})` });
    }
  }
  if (evalFailures.length && !args.report) {
    if (args.fixFiles.length) {
      const model = args.model ?? await ollamaModel();
      if (!model) {
        proposals.push({ slug: 'eval-diagnosis', kind: 'report', motivating: evalFailures.length, note: `${evalFailures.length} eval failure(s), no local brain for drafts` });
      } else {
        for (const f of args.fixFiles) {
          const content = await fs.readFile(join(ROOT, f), 'utf8').catch(() => null);
          if (!content) { say(`skip --fix-file=${f}: unreadable`); continue; }
          say(`drafting ${f} with ${model}…`);
          const diff = await draftDiff(model, f, content, evalFailures);
          if (!diff) {
            proposals.push({ slug: `diagnosis-${f.replaceAll('/', '-')}`, kind: 'report', motivating: evalFailures.length, note: `draft for ${f} unusable — diagnosis only` });
            continue;
          }
          proposals.push({ slug: `fix-${f.replaceAll('/', '-')}`, kind: 'draft', diff, motivating: evalFailures.length, note: `drafted ${f} (${diff.split('\n').length} lines)` });
        }
      }
    } else {
      proposals.push({ slug: 'eval-diagnosis', kind: 'report', motivating: evalFailures.length, note: `${evalFailures.length} eval failure(s) — pass --fix-file= to draft repairs` });
    }
  }
  if (!proposals.length) { say('signals produced no actionable proposals.'); return; }
  say(`proposals: ${proposals.map((p) => `${p.slug} (${p.kind})`).join(', ')}`);
  if (args.report) {
    for (const p of proposals) say(`  - ${p.slug}: ${p.note}`);
    return;
  }

  // ── Baseline failures (fresh sandbox on base, so the margin is honest) ──
  say('sandbox: evaluating base…');
  const baseFailures = await withWorktree(baseRef, (dir) => sandboxFailures(dir, 'improve-base.json'));
  say(`base failures: ${baseFailures.length ? baseFailures.join(', ') : '(none)'}`);

  // ── One branch per proposal ──
  for (const p of proposals) {
    const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    const branch = `improve/${stamp}-${p.slug}`;
    say(`\n── ${branch} ──`);
    try {
      await git(['checkout', '-b', branch]);
      const report = [`# Self-improve report: ${p.slug}`, ``, `- kind: ${p.kind}`, `- note: ${p.note}`, `- base: ${baseRef.slice(0, 8)}`, `- base failures: ${baseFailures.join(', ') || '(none)'}`];
      if (p.kind === 'skill') {
        for (const [i, patch] of p.patches.entries()) {
          await fs.mkdir(join(ROOT, 'memory', 'patches'), { recursive: true });
          await fs.writeFile(join(ROOT, 'memory', 'patches', `${stamp}-${p.slug}-${i}.json`), JSON.stringify(patch, null, 2) + '\n');
        }
        report.push(`- patches: ${p.patches.map((x) => `#${x.skillId}`).join(', ')}`);
      } else if (p.kind === 'draft') {
        const tmp = join(tmpdir(), `improve-${Date.now()}.diff`);
        await fs.writeFile(tmp, p.diff.endsWith('\n') ? p.diff : p.diff + '\n');
        try {
          await git(['apply', '--check', tmp]);
          await git(['apply', tmp]);
        } catch {
          say('draft does not apply — degrading to report');
          p.kind = 'report';
        } finally {
          await fs.rm(tmp, { force: true });
        }
      }
      await fs.writeFile(join(ROOT, 'SELF_IMPROVE_REPORT.md'), report.join('\n') + '\n');
      await git(['add', '-A']);
      const diffFiles = (await git(['diff', '--cached', '--name-only'])).split('\n').filter(Boolean);
      const kind = p.kind === 'skill' ? 'skill' : p.kind === 'report' ? 'report' : classifyFiles(diffFiles);
      const forbidden = kind === 'forbidden' || classifyFiles(diffFiles) === 'forbidden';
      if (forbidden) {
        say(`FORBIDDEN PATH in diff (${diffFiles.join(', ')}) — deleting branch, change dropped`);
        await git(['checkout', baseBranch || baseRef]);
        await git(['branch', '-D', branch]);
        continue;
      }
      await git(['commit', '-m', `self-improve: ${p.slug}`, '-m', p.note]);
      say(`sandbox: evaluating ${branch}…`);
      const branchFailures = await withWorktree(branch, (dir) => sandboxFailures(dir, 'improve-branch.json'));
      const patchValid = p.kind === 'skill'
        ? p.patches.every((patch) => validateSkillPatch(patch, skills.find((s) => s.id === patch.skillId)))
        : true;
      const verdict = decideMerge({ kind: kind === 'draft' ? classifyFiles(diffFiles) : kind, baseFailures, branchFailures, margin: args.margin, patchValid, motivating: p.motivating });
      say(`gate: ${verdict.action} — ${verdict.reason}`);
      await git(['checkout', baseBranch || baseRef]);
      if (verdict.action === 'merge') {
        await git(['merge', '--no-ff', branch, '-m', `self-improve: merge ${p.slug} (${verdict.reason})`]);
        await git(['branch', '-d', branch]);
        if (p.kind === 'skill') {
          // Data deployment: patches land in live memory only after merge.
          for (const patch of p.patches) {
            const cur = await call('memory_get', { store: 'procedural', id: patch.skillId });
            if (!cur.ok || !cur.result.row) { say(`  skill #${patch.skillId}: gone — skipped`); continue; }
            const row = cur.result.row;
            if (!validateSkillPatch(patch, row)) { say(`  skill #${patch.skillId}: stale — skipped`); continue; }
            const sp = {};
            if (patch.addFailureModes.length) {
              const modes = [...(row.steps?.failureModes ?? []), ...patch.addFailureModes].slice(-8);
              sp.steps = { ...(row.steps ?? {}), failureModes: modes };
            }
            if (patch.setStatus) sp.status = patch.setStatus;
            const applied = await call('memory_update', { store: 'procedural', id: patch.skillId, patch: sp });
            say(`  skill #${patch.skillId}: ${applied.ok ? 'patched' : 'FAILED TO APPLY — memory unchanged'}`);
          }
        }
        say(`merged ${branch}`);
      } else if (verdict.action === 'pr') {
        try {
          const { stdout } = await exec('gh', ['pr', 'create', '--base', baseBranch || 'main', '--head', branch,
            '--title', `self-improve: ${p.slug} (needs human review)`,
            '--body', `Automated proposal — the gate said PR, not merge.\n\n- ${p.note}\n- Gate: ${verdict.reason}\n- Base failures: ${baseFailures.join(', ') || '(none)'}\n- Branch failures: ${branchFailures.join(', ') || '(none)'}\n\nSee SELF_IMPROVE_REPORT.md on the branch.`]);
          say(`PR opened: ${stdout.trim()} (branch kept)`);
        } catch {
          say(`gh unavailable — branch ${branch} kept; open the PR by hand`);
        }
      } else {
        say(`dropped (branch ${branch} kept for forensics)`);
      }
    } catch (e) {
      say(`ERROR on ${branch}: ${String(e.message ?? e).slice(0, 200)}`);
      await git(['checkout', baseBranch || baseRef]).catch(() => {});
    }
  }
  say('\ndone.');
}

if (basename(process.argv[1] ?? '') === 'self-improve.mjs') {
  main().catch((e) => { console.error('self-improve failed:', e); process.exit(1); });
}
