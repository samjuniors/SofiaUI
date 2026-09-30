/**
 * companion/coder.mjs — headless coding CLI in an isolated git worktree (Phase 34).
 *
 * coder_probe: which CLIs are installed (codex / claude).
 * coder_run:   worktree + CLI run + REQUIRED test command + diff. The main
 *              checkout is never touched; the branch stays for review.
 * coder_merge: merge a job's branch — refused unless its tests passed, and
 *              always behind a user confirmation (policy ALWAYS_CONFIRM).
 *
 * Safety: no shell anywhere (execFile + validated argv), the test command
 * must start with a known runner and contain no shell metacharacters, the
 * repo must be clean, every run has a timeout, and the worktree is always
 * removed in a `finally`.
 */
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { isAbsolute, join } from 'node:path';

const defaultExec = promisify(nodeExecFile);

export const CODER_CLIS = ['codex', 'claude'];
export const CODER_JOB_PREFIX = 'sofia-coder';
const MAX_DIFF_CHARS = 200_000;
const MAX_TAIL_CHARS = 4_000;

/* ── CLI argv builders (flags verified 2026-09-30) ──────────────────────────
 * Codex: official CLI reference (developers.openai.com/codex/cli/reference)
 *   `codex exec` is the non-interactive entry; `--sandbox workspace-write`
 *   is preferred (`--full-auto` is deprecated); `--json` streams NDJSON;
 *   `-C` sets the workspace root; stdout carries the final message.
 * Claude: Anthropic docs + CLI reference —
 *   `claude -p` (print) is headless; `--output-format json` returns one
 *   result object; `--max-turns` caps agentic steps; `--allowedTools`
 *   scopes tools; `--max-budget-usd` caps spend.
 */
export function buildCodexArgs({ prompt, workdir, model }) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('coder_bad_prompt: prompt must be non-empty.');
  if (typeof workdir !== 'string' || !workdir) throw new Error('coder_bad_prompt: workdir must be set.');
  const args = ['exec', '--sandbox', 'workspace-write', '--json', '-C', workdir];
  if (model) args.push('-m', String(model));
  args.push('--ephemeral', prompt);
  return args;
}

export function buildClaudeArgs({ prompt, maxTurns = 25, budgetUsd, model, allowedTools }) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('coder_bad_prompt: prompt must be non-empty.');
  const turns = Math.max(1, Math.min(200, Math.floor(Number(maxTurns) || 25)));
  const args = ['-p', prompt, '--output-format', 'json', '--max-turns', String(turns)];
  if (budgetUsd !== undefined && budgetUsd !== null && budgetUsd !== '') {
    const b = Number(budgetUsd);
    if (!Number.isFinite(b) || b <= 0) throw new Error('coder_bad_prompt: budgetUsd must be a positive number.');
    args.push('--max-budget-usd', String(b));
  }
  if (model) args.push('--model', String(model));
  args.push('--allowedTools', allowedTools || 'Read,Write,Edit,Bash,Glob,Grep');
  return args;
}

/* ── test-command validation (no shell, known runners only) ───────────────── */

const TEST_RUNNERS = new Set([
  'npm', 'npx', 'yarn', 'pnpm', 'bun', 'deno',
  'pytest', 'python', 'python3', 'vitest', 'jest',
  'go', 'cargo', 'dotnet', 'mvn', 'gradle', 'gradlew', 'make', 'ctest',
]);
const SHELL_METACHARS = /[;&|$`(){}\\<>!*?~#\n\r]/;

/** Minimal shellsplit (single/double quotes + backslash). Throws on misuse. */
export function splitTestCmd(cmd) {
  if (typeof cmd !== 'string' || !cmd.trim()) throw new Error('coder_bad_testcmd: a test command is required.');
  const parts = [];
  let cur = '';
  let quote = null;
  let esc = false;
  for (const ch of cmd.trim()) {
    if (esc) { cur += ch; esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (/\s/.test(ch)) {
      if (cur) { parts.push(cur); cur = ''; }
      continue;
    }
    cur += ch;
  }
  if (esc || quote) throw new Error('coder_bad_testcmd: unterminated quote or escape.');
  if (cur) parts.push(cur);
  if (parts.length === 0) throw new Error('coder_bad_testcmd: a test command is required.');
  return parts;
}

/** The test command must start with a known runner and hold no metacharacters. */
export function validateTestCmd(cmd) {
  const parts = splitTestCmd(cmd);
  if (SHELL_METACHARS.test(cmd)) {
    throw new Error('coder_bad_testcmd: shell metacharacters are not allowed (no pipes/redirects/subshells).');
  }
  const head = parts[0].split('/').pop();
  if (!TEST_RUNNERS.has(head)) {
    throw new Error(`coder_bad_testcmd: "${parts[0]}" is not a known test runner (${[...TEST_RUNNERS].sort().join(', ')}).`);
  }
  return parts;
}

/* ── job records (merge gate) ─────────────────────────────────────────────── */

export function createJobStore() {
  const jobs = new Map();
  return {
    record: (job) => { jobs.set(job.id, job); },
    get: (id) => jobs.get(id) ?? null,
    remove: (id) => { jobs.delete(id); },
    clear: () => jobs.clear(),
  };
}

const defaultJobs = createJobStore();
export function _resetJobs() { defaultJobs.clear(); }

function tail(s, max = MAX_TAIL_CHARS) {
  const t = String(s ?? '');
  return t.length > max ? `…${t.slice(-max)}` : t;
}

function clampMs(v, fallback, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

async function runExec(execFn, file, args, opts) {
  try {
    const r = await execFn(file, args, opts);
    return { ok: true, stdout: String(r?.stdout ?? ''), stderr: String(r?.stderr ?? '') };
  } catch (err) {
    return {
      ok: false,
      stdout: String(err?.stdout ?? ''),
      stderr: String(err?.stderr ?? ''),
      code: err?.code,
      killed: err?.killed === true,
      message: err?.message ?? String(err),
    };
  }
}

function parseClaudeResult(stdout) {
  try {
    const j = JSON.parse(stdout.trim());
    return {
      transcript: typeof j?.result === 'string' && j.result ? j.result : tail(stdout, 2000),
      costUsd: typeof j?.total_cost_usd === 'number' ? j.total_cost_usd : 0,
    };
  } catch {
    return { transcript: tail(stdout, 2000), costUsd: 0 };
  }
}

function parseCodexResult(stdout) {
  let lastText = '';
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const j = JSON.parse(t);
      for (const k of ['text', 'message', 'output', 'content']) {
        if (typeof j?.[k] === 'string' && j[k].trim()) lastText = j[k];
      }
    } catch { /* NDJSON progress lines vary — keep scanning */ }
  }
  return { transcript: lastText || tail(stdout, 2000), costUsd: 0 };
}

/** Which coding CLIs answer `--version`. Never throws. */
export async function probeCli(execFn = defaultExec) {
  const out = {};
  for (const cli of CODER_CLIS) {
    const r = await runExec(execFn, cli, ['--version'], { timeout: 15000 });
    out[cli] = r.ok
      ? { ok: true, version: tail((r.stdout || r.stderr || '').trim().split('\n')[0] || 'unknown', 120) }
      : { ok: false, hint: `Install it or pass cli:"${cli === 'codex' ? 'claude' : 'codex'}" instead.` };
  }
  return out;
}

/**
 * Run a headless coding job: clean-repo check → worktree → CLI → tests →
 * diff. Always removes the worktree; the branch stays for review/merge.
 */
export async function runCoderJob(spec = {}, deps = {}) {
  const execFn = deps.execFn ?? defaultExec;
  const jobs = deps.jobs ?? defaultJobs;
  const { repo, task, testCmd } = spec;
  const cli = spec.cli ?? 'codex';
  if (typeof repo !== 'string' || !isAbsolute(repo)) {
    throw new Error('coder_bad_repo: repo must be an absolute path to a git checkout.');
  }
  if (typeof task !== 'string' || !task.trim() || task.length > 4000) {
    throw new Error('coder_bad_task: task must be 1–4000 chars.');
  }
  if (!CODER_CLIS.includes(cli)) throw new Error(`coder_bad_cli: cli must be one of ${CODER_CLIS.join(', ')}.`);
  const testParts = validateTestCmd(testCmd);
  const timeoutMs = clampMs(spec.timeoutMs, 600_000, 60_000, 1_800_000);
  const testTimeoutMs = clampMs(spec.testTimeoutMs, 300_000, 30_000, 1_800_000);

  const id = deps.id ?? `coder-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const branch = `${CODER_JOB_PREFIX}/${id}`;
  const worktree = join(tmpdir(), `${CODER_JOB_PREFIX}-${id}`);

  const rev = await runExec(execFn, 'git', ['-C', repo, 'rev-parse', '--is-inside-work-tree'], { timeout: 15000 });
  if (!rev.ok || rev.stdout.trim() !== 'true') {
    throw new Error(`coder_not_a_repo: "${repo}" is not inside a git work tree.`);
  }
  const dirty = await runExec(execFn, 'git', ['-C', repo, 'status', '--porcelain'], { timeout: 15000 });
  if (!dirty.ok) throw new Error(`coder_git_failed: status check failed (${tail(dirty.message)})`);
  if (dirty.stdout.trim()) {
    throw new Error('coder_dirty_repo: the repo has uncommitted changes — commit or stash first (the coder never touches dirty trees).');
  }
  const probe = await runExec(execFn, cli, ['--version'], { timeout: 15000 });
  if (!probe.ok) {
    throw new Error(`coder_no_cli: "${cli}" did not answer --version. Install it or pass cli:"${cli === 'codex' ? 'claude' : 'codex'}".`);
  }
  const added = await runExec(execFn, 'git', ['-C', repo, 'worktree', 'add', worktree, '-b', branch], { timeout: 60000 });
  if (!added.ok) throw new Error(`coder_worktree_failed: ${tail(added.stderr || added.message)}`);

  let transcript = '';
  let costUsd = 0;
  let testsPassed = false;
  let testOutput = '';
  let cliError = null;
  try {
    const prompt = `${task.trim()}\n\nWork only inside this checkout. When finished, run the project's tests. Reply with a short summary of what changed.`;
    const cliArgs = cli === 'codex'
      ? buildCodexArgs({ prompt, workdir: worktree, model: spec.model })
      : buildClaudeArgs({ prompt, maxTurns: spec.maxTurns, budgetUsd: spec.budgetUsd, model: spec.model });
    const cliRun = await runExec(execFn, cli, cliArgs, { cwd: worktree, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
    if (!cliRun.ok && cliRun.killed) throw new Error(`coder_cli_timeout: "${cli}" exceeded ${Math.round(timeoutMs / 1000)}s and was killed.`);
    if (!cliRun.ok) cliError = tail(cliRun.stderr || cliRun.message);
    const parsed = cli === 'codex' ? parseCodexResult(cliRun.stdout) : parseClaudeResult(cliRun.stdout);
    transcript = cliError ? `${parsed.transcript}\n\n[cli stderr] ${cliError}` : parsed.transcript;
    costUsd = parsed.costUsd;

    const testRun = await runExec(execFn, testParts[0], testParts.slice(1), { cwd: worktree, timeout: testTimeoutMs, maxBuffer: 32 * 1024 * 1024 });
    testsPassed = testRun.ok;
    testOutput = tail(`${testRun.stdout}\n${testRun.stderr}`.trim() || (testRun.ok ? '(no output)' : testRun.message));

    const statRun = await runExec(execFn, 'git', ['-C', worktree, 'diff', '--stat', 'HEAD'], { timeout: 30000 });
    const diffRun = await runExec(execFn, 'git', ['-C', worktree, 'diff', 'HEAD'], { timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
    const diffStat = tail(statRun.stdout.trim() || '(no changes)', 2000);
    const fullDiff = diffRun.ok ? String(diffRun.stdout ?? '') : '';
    const diffTruncated = fullDiff.length > MAX_DIFF_CHARS;
    const diff = diffTruncated ? `${fullDiff.slice(0, MAX_DIFF_CHARS)}\n…[truncated]` : fullDiff;
    jobs.record({ id, repo, branch, testsPassed, at: Date.now() });
    return { jobId: id, cli, branch, testsPassed, testOutput, diffStat, diff, diffTruncated, transcript, costUsd };
  } finally {
    const removed = await runExec(execFn, 'git', ['-C', repo, 'worktree', 'remove', '--force', worktree], { timeout: 60000 });
    if (!removed.ok) {
      // Best-effort: the branch still holds the work; surface the path.
      transcript += `\n\n[cleanup] worktree remove failed (${tail(removed.stderr || removed.message)}); left at ${worktree}`;
    }
  }
}

/**
 * Merge a job's branch into the repo. Refused unless that job's tests
 * passed. The caller (policy) additionally requires a user confirmation.
 */
export async function mergeCoderJob(spec = {}, deps = {}) {
  const execFn = deps.execFn ?? defaultExec;
  const jobs = deps.jobs ?? defaultJobs;
  const job = jobs.get(String(spec.jobId ?? ''));
  if (!job) throw new Error('coder_no_job: unknown or expired jobId — run coder_run first.');
  if (!job.testsPassed) {
    throw new Error(`coder_tests_failed: refusing to merge ${job.branch} — its tests did not pass.`);
  }
  const merged = await runExec(execFn, 'git', ['-C', job.repo, 'merge', '--no-ff', job.branch], { timeout: 120000 });
  if (!merged.ok) {
    throw new Error(`coder_merge_conflict: merge failed (${tail(merged.stderr || merged.message)}). Resolve in ${job.repo}, then merge ${job.branch} by hand.`);
  }
  await runExec(execFn, 'git', ['-C', job.repo, 'branch', '-d', job.branch], { timeout: 30000 });
  jobs.remove(job.id);
  return { merged: true, branch: job.branch, output: tail(`${merged.stdout}\n${merged.stderr}`.trim() || '(merged)') };
}

/** server.mjs dispatcher: coder_probe / coder_run / coder_merge. */
export async function coderAction(action, args = {}, ctx = {}) {
  const execFn = ctx.execFn ?? defaultExec;
  const jobs = ctx.jobs ?? defaultJobs;
  switch (action) {
    case 'coder_probe':
      return { clis: await probeCli(execFn) };
    case 'coder_run':
      return runCoderJob(
        {
          repo: args.repo,
          task: args.task,
          testCmd: args.testCmd,
          cli: args.cli,
          model: args.model,
          timeoutMs: args.timeoutMs,
          testTimeoutMs: args.testTimeoutMs,
          maxTurns: args.maxTurns,
          budgetUsd: args.budgetUsd,
        },
        { execFn, jobs },
      );
    case 'coder_merge':
      return mergeCoderJob({ jobId: args.jobId }, { execFn, jobs });
    default:
      throw new Error(`coder_unknown_action: ${action}`);
  }
}
