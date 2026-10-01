import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODER_CLIS,
  buildClaudeArgs,
  buildCodexArgs,
  coderAction,
  createJobStore,
  mergeCoderJob,
  probeCli,
  runCoderJob,
  splitTestCmd,
  validateTestCmd,
} from './coder.mjs';

/** Scripted execFile fake. Rules match (file, args); unmatched calls throw. */
function scripted(rules) {
  const calls = [];
  const execFn = async (file, args, opts) => {
    calls.push({ file, args, cwd: opts?.cwd, timeout: opts?.timeout });
    const rule = rules.find((r) => r.match(file, args));
    if (!rule) throw new Error(`unexpected exec: ${file} ${(args ?? []).join(' ')}`);
    if (rule.reject) {
      const e = new Error(rule.reject.message ?? 'failed');
      e.stdout = rule.reject.stdout ?? '';
      e.stderr = rule.reject.stderr ?? '';
      e.code = rule.reject.code ?? 1;
      e.killed = !!rule.reject.killed;
      throw e;
    }
    return { stdout: rule.resolve?.stdout ?? '', stderr: rule.resolve?.stderr ?? '' };
  };
  return { execFn, calls };
}

const gitOk = (over = {}) => [
  { match: (f, a) => f === 'git' && a.includes('rev-parse'), resolve: { stdout: 'true\n' } },
  { match: (f, a) => f === 'git' && a.includes('--porcelain'), resolve: { stdout: over.status ?? '' } },
  { match: (f, a) => f === 'codex' && a[0] === '--version', resolve: { stdout: 'codex-cli 1.2.3\n' } },
  { match: (f, a) => f === 'git' && a.includes('worktree') && a.includes('add'), resolve: { stdout: '' } },
  { match: (f, a) => f === 'codex' && a[0] === 'exec', resolve: { stdout: over.cli ?? '{"type":"assistant","text":"added feature"}\n' } },
  { match: (f, a) => f === 'npm', resolve: { stdout: over.tests ?? 'ok 3 pass\n' } },
  { match: (f, a) => f === 'git' && a.includes('--stat'), resolve: { stdout: ' src/a.ts | 2 +-\n' } },
  { match: (f, a) => f === 'git' && a[a.length - 1] === 'HEAD' && !a.includes('--stat') && !a.includes('merge'), resolve: { stdout: over.diff ?? 'diff --git a/src/a.ts b/src/a.ts\n' } },
  { match: (f, a) => f === 'git' && a.includes('remove'), resolve: { stdout: '' } },
];

const SPEC = { repo: '/repo', task: 'add a widget', testCmd: 'npm test' };

test('CLI allowlist holds exactly the two supported CLIs', () => {
  assert.deepEqual(CODER_CLIS, ['codex', 'claude']);
});

test('buildCodexArgs uses the verified headless flags', () => {
  assert.deepEqual(buildCodexArgs({ prompt: 'do it', workdir: '/wt' }), [
    'exec', '--sandbox', 'workspace-write', '--json', '-C', '/wt', '--ephemeral', 'do it',
  ]);
  assert.deepEqual(buildCodexArgs({ prompt: 'do it', workdir: '/wt', model: 'gpt-5.4-mini' }), [
    'exec', '--sandbox', 'workspace-write', '--json', '-C', '/wt', '-m', 'gpt-5.4-mini', '--ephemeral', 'do it',
  ]);
  assert.throws(() => buildCodexArgs({ prompt: '', workdir: '/wt' }), /coder_bad_prompt/);
});

test('buildClaudeArgs uses the verified print-mode flags', () => {
  assert.deepEqual(buildClaudeArgs({ prompt: 'do it' }), [
    '-p', 'do it', '--output-format', 'json', '--max-turns', '25',
    '--allowedTools', 'Read,Write,Edit,Bash,Glob,Grep',
  ]);
  const full = buildClaudeArgs({ prompt: 'do it', maxTurns: 5, budgetUsd: 0.5, model: 'sonnet' });
  assert.deepEqual(full, [
    '-p', 'do it', '--output-format', 'json', '--max-turns', '5',
    '--max-budget-usd', '0.5', '--model', 'sonnet',
    '--allowedTools', 'Read,Write,Edit,Bash,Glob,Grep',
  ]);
  assert.ok(buildClaudeArgs({ prompt: 'x', maxTurns: 9999 }).includes('200'));
  assert.throws(() => buildClaudeArgs({ prompt: 'x', budgetUsd: -1 }), /coder_bad_prompt/);
});

test('test commands split quotes and reject shells and unknown runners', () => {
  assert.deepEqual(splitTestCmd('npm test'), ['npm', 'test']);
  assert.deepEqual(splitTestCmd('pytest -q "tests/a b.py"'), ['pytest', '-q', 'tests/a b.py']);
  assert.deepEqual(validateTestCmd('npm run test:unit -- --watch'), ['npm', 'run', 'test:unit', '--', '--watch']);
  assert.throws(() => validateTestCmd('rm -rf /'), /not a known test runner/);
  assert.throws(() => validateTestCmd('npm test | tee out'), /metacharacters/);
  assert.throws(() => validateTestCmd('npm test && echo pwned'), /metacharacters/);
  assert.throws(() => validateTestCmd(''), /required/);
  assert.throws(() => splitTestCmd('npm "oops'), /unterminated/);
});

test('runCoderJob: clean → worktree → CLI → tests → diff → cleanup', async () => {
  const { execFn, calls } = scripted(gitOk());
  const jobs = createJobStore();
  const r = await runCoderJob(SPEC, { execFn, jobs, id: 'job1' });
  assert.equal(r.jobId, 'job1');
  assert.equal(r.cli, 'codex');
  assert.equal(r.branch, 'sofia-coder/job1');
  assert.equal(r.testsPassed, true);
  assert.match(r.testOutput, /ok 3 pass/);
  assert.match(r.diffStat, /src\/a\.ts/);
  assert.match(r.transcript, /added feature/);
  const files = calls.map((c) => `${c.file} ${(c.args ?? [])[0] ?? ''}`);
  const addAt = calls.findIndex((c) => c.args?.includes('add'));
  const execAt = calls.findIndex((c) => c.file === 'codex' && c.args?.[0] === 'exec');
  const removeAt = calls.findIndex((c) => c.args?.includes('remove'));
  assert.ok(addAt >= 0 && execAt > addAt && removeAt === calls.length - 1, files.join(' | '));
  // The CLI ran inside the worktree, never in the repo.
  assert.ok(calls[execAt].cwd.includes('sofia-coder-job1'));
  assert.ok(jobs.get('job1'));
});

test('runCoderJob refuses dirty repos before creating anything', async () => {
  const { execFn, calls } = scripted(gitOk({ status: ' M src/a.ts\n' }));
  await assert.rejects(() => runCoderJob(SPEC, { execFn, jobs: createJobStore() }), /coder_dirty_repo/);
  assert.equal(calls.some((c) => c.args?.includes('add')), false);
});

test('runCoderJob refuses unknown repos and missing CLIs', async () => {
  const { execFn } = scripted([
    { match: (f, a) => f === 'git' && a.includes('rev-parse'), resolve: { stdout: 'false\n' } },
  ]);
  await assert.rejects(() => runCoderJob(SPEC, { execFn, jobs: createJobStore() }), /coder_not_a_repo/);
  const missing = scripted([
    ...gitOk().slice(0, 2),
    { match: (f, a) => f === 'codex' && a[0] === '--version', reject: { message: 'ENOENT' } },
  ]);
  await assert.rejects(() => runCoderJob(SPEC, { execFn: missing.execFn, jobs: createJobStore() }), /coder_no_cli/);
  await assert.rejects(() => runCoderJob({ ...SPEC, repo: 'relative/path' }, { execFn, jobs: createJobStore() }), /coder_bad_repo/);
  await assert.rejects(() => runCoderJob({ ...SPEC, cli: 'gemini' }, { execFn, jobs: createJobStore() }), /coder_bad_cli/);
});

test('runCoderJob still cleans up when the CLI times out', async () => {
  const rules = gitOk().map((r) =>
    r.match('codex', ['exec']) ? { match: r.match, reject: { message: 'timeout', killed: true } } : r,
  );
  const { execFn, calls } = scripted(rules);
  await assert.rejects(() => runCoderJob(SPEC, { execFn, jobs: createJobStore() }), /coder_cli_timeout/);
  assert.ok(calls.some((c) => c.args?.includes('remove')));
});

test('runCoderJob reports failing tests and blocks their merge', async () => {
  const rules = gitOk().map((r) =>
    r.match('npm', []) ? { match: r.match, reject: { message: 'exit 1', stdout: 'FAIL src/a.test\n', code: 1 } } : r,
  );
  const { execFn } = scripted(rules);
  const jobs = createJobStore();
  const r = await runCoderJob(SPEC, { execFn, jobs, id: 'job2' });
  assert.equal(r.testsPassed, false);
  assert.match(r.testOutput, /FAIL/);
  assert.match(r.diff, /diff --git/);
  await assert.rejects(() => mergeCoderJob({ jobId: 'job2' }, { execFn, jobs }), /coder_tests_failed/);
});

test('mergeCoderJob merges green jobs and deletes the branch', async () => {
  const { execFn, calls } = scripted(gitOk());
  const jobs = createJobStore();
  await runCoderJob(SPEC, { execFn, jobs, id: 'job3' });
  const merger = scripted([
    { match: (f, a) => a.includes('merge'), resolve: { stdout: 'Merge made by ort.\n' } },
    { match: (f, a) => a.includes('branch'), resolve: { stdout: 'Deleted branch.\n' } },
  ]);
  const m = await mergeCoderJob({ jobId: 'job3' }, { execFn: merger.execFn, jobs });
  assert.equal(m.merged, true);
  assert.equal(m.branch, 'sofia-coder/job3');
  assert.equal(jobs.get('job3'), null);
  await assert.rejects(() => mergeCoderJob({ jobId: 'job3' }, { execFn: merger.execFn, jobs }), /coder_no_job/);
  void calls;
});

test('mergeCoderJob keeps the branch on conflict', async () => {
  const { execFn } = scripted(gitOk());
  const jobs = createJobStore();
  await runCoderJob(SPEC, { execFn, jobs, id: 'job4' });
  const conflicter = scripted([
    { match: (f, a) => a.includes('merge'), reject: { message: 'exit 1', stderr: 'CONFLICT (content)\n', code: 1 } },
  ]);
  await assert.rejects(() => mergeCoderJob({ jobId: 'job4' }, { execFn: conflicter.execFn, jobs }), /coder_merge_conflict/);
  assert.equal(conflicter.calls.some((c) => c.args?.includes('branch')), false);
  assert.ok(jobs.get('job4'));
});

test('probeCli reports per-CLI availability', async () => {
  const { execFn } = scripted([
    { match: (f) => f === 'codex', resolve: { stdout: 'codex-cli 1.2.3\n' } },
    { match: (f) => f === 'claude', reject: { message: 'ENOENT' } },
  ]);
  const p = await probeCli(execFn);
  assert.equal(p.codex.ok, true);
  assert.match(p.codex.version, /codex-cli/);
  assert.equal(p.claude.ok, false);
  assert.match(p.claude.hint, /codex/);
});

test('coderAction dispatches probe/run/merge', async () => {
  const { execFn } = scripted(gitOk());
  const jobs = createJobStore();
  const ctx = { execFn, jobs };
  const p = await coderAction('coder_probe', {}, ctx);
  assert.equal(p.clis.codex.ok, true);
  const r = await coderAction('coder_run', SPEC, ctx);
  assert.equal(r.testsPassed, true);
  await assert.rejects(() => coderAction('coder_merge', { jobId: 'nope' }, ctx), /coder_no_job/);
  await assert.rejects(() => coderAction('coder_hack', {}, ctx), /coder_unknown_action/);
});
