import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deleteSecret,
  getSecret,
  keychainAvailable,
  keychainBackend,
  storeSecret,
} from './keychain.mjs';

function fakeRun(script = {}) {
  const calls = [];
  const run = async (file, args, opts = {}) => {
    calls.push({ file, args, stdin: opts.stdin ?? '' });
    const key = `${file} ${args[0] ?? ''}`;
    if (script[key] !== undefined) {
      const v = script[key];
      if (v instanceof Error) throw v;
      return v;
    }
    return { stdout: script.__stdout ?? '', stderr: '' };
  };
  return { run, calls };
}

test('backend mapping per OS', () => {
  assert.equal(keychainBackend('darwin'), 'security');
  assert.equal(keychainBackend('linux'), 'secret-tool');
  assert.equal(keychainBackend('win32'), 'dpapi-file');
  assert.equal(keychainBackend('sunos'), null);
});

test('macOS stores via security add-generic-password -U', async () => {
  const { run, calls } = fakeRun();
  await storeSecret({ service: 'S', account: 'A', password: 'pw' }, { platform: 'darwin', run });
  assert.deepEqual(calls[0].args, ['add-generic-password', '-s', 'S', '-a', 'A', '-w', 'pw', '-U']);
  const g = fakeRun({ __stdout: 'pw\n' });
  assert.equal(await getSecret({ service: 'S', account: 'A' }, { platform: 'darwin', run: g.run }), 'pw');
  assert.deepEqual(g.calls[0].args, ['find-generic-password', '-s', 'S', '-a', 'A', '-w']);
  const d = fakeRun();
  await deleteSecret({ service: 'S', account: 'A' }, { platform: 'darwin', run: d.run });
  assert.deepEqual(d.calls[0].args, ['delete-generic-password', '-s', 'S', '-a', 'A']);
});

test('linux passes the secret on stdin, never argv', async () => {
  const { run, calls } = fakeRun();
  await storeSecret({ service: 'S', account: 'A', password: 's3cret' }, { platform: 'linux', run });
  assert.equal(calls[0].file, 'secret-tool');
  assert.deepEqual(calls[0].args, ['store', '--label', 'Sofia S A', 'service', 'S', 'account', 'A']);
  assert.equal(calls[0].stdin, 's3cret');
  assert.ok(!calls[0].args.includes('s3cret'));
  const g = fakeRun({ __stdout: 's3cret\n' });
  assert.equal(await getSecret({ service: 'S', account: 'A' }, { platform: 'linux', run: g.run }), 's3cret');
});

test('windows encrypts with DPAPI and base64s the secret over stdin', async () => {
  const { run, calls } = fakeRun();
  await storeSecret({ service: 'S', account: 'A', password: 'pw' }, { platform: 'win32', run, env: { LOCALAPPDATA: 'C:/L' } });
  assert.equal(calls[0].file, 'powershell');
  const cmd = calls[0].args.join(' ');
  assert.match(cmd, /ProtectedData.*Protect/);
  assert.match(cmd, /C:\/L\/Sofia\/keychain\//);
  assert.equal(calls[0].stdin, Buffer.from('pw', 'utf8').toString('base64'));
  const g = fakeRun({ __stdout: `${Buffer.from('pw', 'utf8').toString('base64')}\n` });
  assert.equal(await getSecret({ service: 'S', account: 'A' }, { platform: 'win32', run: g.run, env: {} }), 'pw');
  const d = fakeRun();
  await deleteSecret({ service: 'S', account: 'A' }, { platform: 'win32', run: d.run, env: {} });
  assert.match(d.calls[0].args.join(' '), /Remove-Item/);
});

test('missing backends fail unavailable, never plaintext', async () => {
  const enoent = new Error('spawn which ENOENT');
  enoent.code = 'ENOENT';
  const { run } = fakeRun({ 'secret-tool store': enoent });
  await assert.rejects(() => storeSecret({ service: 'S', account: 'A', password: 'pw' }, { platform: 'linux', run }), /keychain_unavailable: .*libsecret/);
  await assert.rejects(() => storeSecret({ service: 'S', account: 'A', password: 'pw' }, { platform: 'sunos', run }), /keychain_unavailable/);
  const avail = await keychainAvailable({ platform: 'linux', run: fakeRun({ 'which secret-tool': enoent }).run });
  assert.deepEqual(avail, { available: false, backend: 'secret-tool' });
  const ok = await keychainAvailable({ platform: 'linux', run: fakeRun().run });
  assert.deepEqual(ok, { available: true, backend: 'secret-tool' });
});

test('names and passwords are validated', async () => {
  const { run } = fakeRun();
  await assert.rejects(() => storeSecret({ service: '', account: 'A', password: 'pw' }, { platform: 'linux', run }), /keychain_bad_name/);
  await assert.rejects(() => storeSecret({ service: 'S', account: 'A', password: '' }, { platform: 'linux', run }), /keychain_bad_name/);
  const boom = fakeRun({ 'secret-tool store': new Error('exit 1: locked') });
  await assert.rejects(() => storeSecret({ service: 'S', account: 'A', password: 'pw' }, { platform: 'linux', run: boom.run }), /keychain_failed/);
});
