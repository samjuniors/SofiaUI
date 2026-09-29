/**
 * electron/dev.mjs — `npm run electron:dev`.
 * Waits for the Vite dev server, then launches the desktop shell against it.
 * (Start `npm run dev` first, in another terminal.)
 */
import { spawn } from 'node:child_process';

const DEV_URL = process.env.ELECTRON_START_URL || 'http://127.0.0.1:8080';
const TIMEOUT_MS = Number(process.env.ELECTRON_DEV_WAIT_MS || 90_000);

async function waitForDev() {
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(DEV_URL, { method: 'HEAD' });
      if (res.ok || res.status < 500) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - started > TIMEOUT_MS) {
      throw new Error(`dev server never answered at ${DEV_URL} — is \`npm run dev\` running?`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function main() {
  let electronPath;
  try {
    electronPath = (await import('electron')).default;
  } catch {
    console.error('[sophia-desktop] electron is not installed. Run `npm i -D electron` first.');
    process.exit(1);
  }
  if (typeof electronPath !== 'string' || !electronPath) {
    console.error('[sophia-desktop] could not resolve the electron binary.');
    process.exit(1);
  }
  console.log(`[sophia-desktop] waiting for ${DEV_URL} …`);
  await waitForDev();
  console.log('[sophia-desktop] dev server is up — launching the shell.');
  const child = spawn(electronPath, ['.'], {
    env: { ...process.env, ELECTRON_START_URL: DEV_URL },
    stdio: 'inherit',
    windowsHide: false,
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(`[sophia-desktop] ${err.message}`);
  process.exit(1);
});
