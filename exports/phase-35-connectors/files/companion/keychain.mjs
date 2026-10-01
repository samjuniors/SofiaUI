/**
 * companion/keychain.mjs — OS-credential storage for connector secrets (Phase 35).
 *
 * macOS: `security` (Keychain). Linux: `secret-tool` (libsecret / Secret
 * Service). Windows: DPAPI (CurrentUser scope) via PowerShell + a file under
 * %LOCALAPPDATA% — the OS still owns the encryption key; Sofia only holds
 * ciphertext at rest. There is deliberately NO plaintext fallback: if no
 * backend answers, secrets are refused, not written to disk.
 *
 * Secrets travel on stdin wherever the backend allows it (secret-tool,
 * PowerShell). `security -w` only accepts argv, so on macOS the password is
 * briefly visible in the process table — accepted and documented.
 */
import { spawn as nodeSpawn } from 'node:child_process';

export function keychainBackend(platform = process.platform) {
  if (platform === 'darwin') return 'security';
  if (platform === 'linux') return 'secret-tool';
  if (platform === 'win32') return 'dpapi-file';
  return null;
}

const HINTS = {
  security: 'macOS Keychain (`security`) did not answer — is this a real Mac with unlocked login keychain?',
  'secret-tool': 'libsecret (`secret-tool`) is missing — install libsecret (e.g. `sudo apt install libsecret-1-0 gnome-keyring`).',
  'dpapi-file': 'PowerShell DPAPI storage failed — is this Windows with PowerShell 5.1+?',
};

function checkName(v, what) {
  if (typeof v !== 'string' || !v.trim() || v.length > 128) {
    throw new Error(`keychain_bad_name: ${what} must be 1–128 chars.`);
  }
  return v.trim();
}

/** Default runner: spawn, feed stdin, collect stdout. Rejects with stderr tail. */
export function runCommand(file, args, { stdin = '', timeoutMs = 15000, spawnFn = nodeSpawn } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      reject(new Error(`timeout after ${timeoutMs}ms: ${file} ${args.join(' ')}`));
    }, timeoutMs);
    child.stdout?.on('data', (d) => { stdout += String(d); });
    child.stderr?.on('data', (d) => { stderr += String(d); });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`exit ${code}: ${tail(stderr || stdout)}`));
    });
    try {
      if (stdin) child.stdin?.write(stdin);
      child.stdin?.end();
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

function tail(s, max = 300) {
  const t = String(s ?? '').trim();
  return t.length > max ? `…${t.slice(-max)}` : t;
}

function b64url(s) {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Windows DPAPI one-liners. $env:SF_* carry paths (non-secret); secret via stdin. */
function psStore(file) {
  return [
    '-NoProfile', '-NonInteractive', '-Command',
    `$in=[Console]::In.ReadToEnd(); Add-Type -AssemblyName System.Security; ` +
    `$dir=Split-Path -Parent '${file}'; New-Item -ItemType Directory -Force -Path $dir | Out-Null; ` +
    `[IO.File]::WriteAllBytes('${file}',[Security.Cryptography.ProtectedData]::Protect([Convert]::FromBase64String($in),$null,'CurrentUser'))`,
  ];
}

function psRead(file) {
  return [
    '-NoProfile', '-NonInteractive', '-Command',
    `Add-Type -AssemblyName System.Security; ` +
    `[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes('${file}'),$null,'CurrentUser'))`,
  ];
}

function dpapiFile(accountDir, service, account) {
  // accountDir like %LOCALAPPDATA%/Sofia/keychain — joined by the caller.
  return `${accountDir}/${b64url(service)}.${b64url(account)}.dpapi`;
}

export function dpapiDir(env = process.env) {
  const base = env.LOCALAPPDATA || env.APPDATA || env.TEMP || env.TMP || '.';
  return `${base}/Sofia/keychain`;
}

function unavailable(backend, detail) {
  return new Error(`keychain_unavailable: ${HINTS[backend]} (${tail(detail)})`);
}

function failed(backend, op, detail) {
  return new Error(`keychain_failed: ${backend} ${op} failed (${tail(detail)})`);
}

/**
 * Store (upsert) a secret. deps: {platform, run, env}.
 * `run` matches runCommand(file, args, {stdin, timeoutMs}).
 */
export async function storeSecret({ service, account, password }, deps = {}) {
  const backend = keychainBackend(deps.platform);
  if (!backend) throw new Error(`keychain_unavailable: no keychain backend on ${deps.platform ?? process.platform}.`);
  service = checkName(service, 'service');
  account = checkName(account, 'account');
  if (typeof password !== 'string' || !password || password.length > 4000) {
    throw new Error('keychain_bad_name: password must be 1–4000 chars.');
  }
  const run = deps.run ?? runCommand;
  try {
    if (backend === 'security') {
      // -U upserts; -w only takes argv (see header note).
      await run('security', ['add-generic-password', '-s', service, '-a', account, '-w', password, '-U'], {});
      return { stored: true };
    }
    if (backend === 'secret-tool') {
      await run('secret-tool', ['store', '--label', `Sofia ${service} ${account}`, 'service', service, 'account', account], { stdin: password });
      return { stored: true };
    }
    const file = dpapiFile(dpapiDir(deps.env), service, account);
    await run('powershell', psStore(file), { stdin: Buffer.from(password, 'utf8').toString('base64') });
    return { stored: true };
  } catch (err) {
    if (err?.code === 'ENOENT' || /not found|not recognized/i.test(err?.message ?? '')) throw unavailable(backend, err.message);
    throw failed(backend, 'store', err?.message);
  }
}

/** Read a secret back. Returns the password string. */
export async function getSecret({ service, account }, deps = {}) {
  const backend = keychainBackend(deps.platform);
  if (!backend) throw new Error(`keychain_unavailable: no keychain backend on ${deps.platform ?? process.platform}.`);
  service = checkName(service, 'service');
  account = checkName(account, 'account');
  const run = deps.run ?? runCommand;
  try {
    if (backend === 'security') {
      const r = await run('security', ['find-generic-password', '-s', service, '-a', account, '-w'], {});
      return r.stdout.replace(/\n$/, '');
    }
    if (backend === 'secret-tool') {
      const r = await run('secret-tool', ['lookup', 'service', service, 'account', account], {});
      return r.stdout.replace(/\n$/, '');
    }
    const file = dpapiFile(dpapiDir(deps.env), service, account);
    const r = await run('powershell', psRead(file), {});
    return Buffer.from(r.stdout.trim(), 'base64').toString('utf8');
  } catch (err) {
    if (err?.code === 'ENOENT' || /not found|not recognized/i.test(err?.message ?? '')) throw unavailable(backend, err.message);
    throw failed(backend, 'read', err?.message);
  }
}

/** Delete a secret. Missing entries are success (idempotent). */
export async function deleteSecret({ service, account }, deps = {}) {
  const backend = keychainBackend(deps.platform);
  if (!backend) throw new Error(`keychain_unavailable: no keychain backend on ${deps.platform ?? process.platform}.`);
  service = checkName(service, 'service');
  account = checkName(account, 'account');
  const run = deps.run ?? runCommand;
  try {
    if (backend === 'security') {
      await run('security', ['delete-generic-password', '-s', service, '-a', account], {});
      return { deleted: true };
    }
    if (backend === 'secret-tool') {
      await run('secret-tool', ['clear', 'service', service, 'account', account], {});
      return { deleted: true };
    }
    const file = dpapiFile(dpapiDir(deps.env), service, account);
    await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Remove-Item -Force -ErrorAction SilentlyContinue '${file}'`], {});
    return { deleted: true };
  } catch (err) {
    if (err?.code === 'ENOENT' || /not found|not recognized/i.test(err?.message ?? '')) throw unavailable(backend, err.message);
    throw failed(backend, 'delete', err?.message);
  }
}

/** Probe whether the backend binary answers. Never throws. */
export async function keychainAvailable(deps = {}) {
  const backend = keychainBackend(deps.platform);
  if (!backend) return { available: false, backend: null };
  const run = deps.run ?? runCommand;
  try {
    if (backend === 'security') await run('which', ['security'], {});
    else if (backend === 'secret-tool') await run('which', ['secret-tool'], {});
    else await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], {});
    return { available: true, backend };
  } catch {
    return { available: false, backend };
  }
}
