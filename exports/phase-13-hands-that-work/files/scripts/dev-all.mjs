#!/usr/bin/env node
/**
 * scripts/dev-all.mjs — Phase 13: one command for the whole organism.
 *
 * Boots the companion daemon + the vite app together with prefixed logs,
 * installing companion deps first when missing. Ctrl-C stops both.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const onWin = process.platform === 'win32';

if (!existsSync(join(root, 'companion', 'node_modules', 'ws'))) {
  console.log('[setup] companion deps missing — installing…');
  const r = spawnSync('npm', ['install', '--prefix', 'companion', '--no-audit', '--no-fund'], {
    cwd: root,
    stdio: 'inherit',
    shell: onWin,
  });
  if (r.status !== 0) {
    console.error('[setup] companion install failed — run `npm run setup` and retry.');
    process.exit(1);
  }
}

const procs = [];
function run(name, cmd, args) {
  const p = spawn(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  p.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  p.on('exit', (code) => {
    console.log(`[${name}] exited (${code ?? 'signal'}) — stopping everything.`);
    shutdown();
  });
  p.on('error', (err) => {
    console.error(`[${name}] failed to start:`, err.message);
    shutdown();
  });
  procs.push(p);
}

function shutdown() {
  for (const p of procs) {
    try {
      p.kill();
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(0), 300).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

run('companion', 'node', ['companion/server.mjs']);
run('web', 'node', ['scripts/with-app-env.mjs', 'vite', 'dev', '--host', '0.0.0.0', '--port', '8080']);
