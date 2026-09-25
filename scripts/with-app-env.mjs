#!/usr/bin/env node
/**
 * Run a command with `.grok/app-env.json` merged into its environment.
 *
 * `dev`, `build` and `preview` all route through this wrapper, so the dev
 * server, the built bundle and the preview server can never disagree about
 * `VITE_AUTH_ENABLED` — a divergence that only shows up as a built-output
 * mismatch long after the fact. Anything that starts Vite directly bypasses it.
 *
 * Only `VITE_`-prefixed keys are honored: the file is a build flag carrier, not
 * a secret store, and only `VITE_` vars reach the browser anyway. A real
 * `process.env` entry always wins, so an explicit override still works.
 *
 * That precedence also means the file governs this workspace only. A deployed
 * build runs with the provider's project env, where the deployer sets
 * `VITE_AUTH_ENABLED` itself (today unconditionally `"true"`), so the deployed
 * flag is the platform's, not this file's.
 *
 * Vite picks the values up because `loadEnv` prefix-matches entries already in
 * `process.env`, which is why the merge has to happen before Vite starts.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_ENV_REL_PATH = ".grok/app-env.json";

const VITE_PREFIX = "VITE_";

/**
 * Parse an app-env document, keeping only `VITE_`-prefixed string entries.
 * Anything unparseable is an empty environment — a workspace without the file
 * must behave exactly like today (auth on, no overrides).
 */
export function parseAppEnv(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const env = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.startsWith(VITE_PREFIX)) continue;
    if (typeof value !== "string") continue;
    env[key] = value;
  }
  return env;
}

/** The app env recorded under `root`, or `{}` when the file is absent. */
export function readAppEnv(root) {
  try {
    return parseAppEnv(readFileSync(join(root, APP_ENV_REL_PATH), "utf8"));
  } catch {
    return {};
  }
}

/** File values under the process environment: an explicit override wins. */
export function mergeAppEnv(appEnv, processEnv) {
  return { ...appEnv, ...processEnv };
}

/**
 * Translate a child's `exit` `(code, signal)` into this process's exit status.
 *
 * Do not re-raise the signal with `process.kill(process.pid, signal)`: under
 * qemu-user (amd64 image builds on an arm host) a self-directed signal is
 * routinely delivered as SIGSEGV to the wrong process, which takes down the
 * test worker and fails the image build. `128 + signo` is what a shell reports
 * for a signal-killed command, so a cancelled `vite build` is still a failure.
 */
export function exitStatusFromChild(code, signal) {
  if (signal) {
    const signo = osConstants.signals[signal];
    return 128 + (typeof signo === "number" ? signo : 1);
  }
  return code ?? 1;
}

/** The workspace root (this file lives in `<root>/scripts/`). */
export function projectRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

/**
 * Whether `moduleUrl` is the script node was asked to run.
 *
 * Both sides are resolved through symlinks: node realpaths `import.meta.url`
 * but leaves `process.argv[1]` as typed, so comparing them raw makes a CLI
 * launched through a symlinked path (`/tmp` on macOS) a silent no-op.
 */
export function isMainModule(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(moduleUrl);
  } catch {
    return false;
  }
}

/**
 * Resolve a command to a full path if it exists in node_modules/.bin.
 * On Windows, spawn can't execute .cmd files directly, so we resolve
 * the underlying .js entry point and prepend `process.execPath` (node).
 */
function resolveCommand(command) {
  // If the command contains a path separator, use it as-is
  if (command.includes(sep) || command.includes("/")) return { cmd: command, args: [] };
  const root = projectRoot();
  const binDir = join(root, "node_modules", ".bin");
  if (process.platform === "win32") {
    // Try .exe
    const exePath = join(binDir, command + ".exe");
    if (existsSync(exePath)) return { cmd: exePath, args: [] };

    // On Windows, read the .cmd shim to find the real script, or fall back to .cmd
    const cmdPath = join(binDir, command + ".cmd");
    if (existsSync(cmdPath)) {
      // .cmd shims contain a node path reference like: node "%~dp0\..\vite\bin\vite.js" or "%dp0%\..\vite\bin\vite.js"
      // Just use process.execPath and resolve the package's bin directly
      try {
        const shimContent = readFileSync(cmdPath, "utf8");
        const match = shimContent.match(/"%(?:~dp0|dp0%)\\(\.\.[^"\r\n]+)"/);
        if (match) {
          const scriptRel = match[1].replace(/\\/g, "/");
          const scriptPath = join(binDir, scriptRel);
          if (existsSync(scriptPath)) {
            return { cmd: process.execPath, args: [scriptPath] };
          }
        }
      } catch { /* fall through */ }
      return { cmd: cmdPath, args: [], shell: true };
    }
  } else {
    const candidate = join(binDir, command);
    if (existsSync(candidate)) return { cmd: candidate, args: [] };
  }
  return { cmd: command, args: [] };
}

function main(argv) {
  const [rawCommand, ...args] = argv;
  if (!rawCommand) {
    console.error("usage: node scripts/with-app-env.mjs <command> [args…]");
    process.exit(2);
  }
  const { cmd, args: resolvedArgs, shell } = resolveCommand(rawCommand);
  const allArgs = [...resolvedArgs, ...args];
  const env = mergeAppEnv(readAppEnv(projectRoot()), process.env);
  const child = spawn(cmd, allArgs, { stdio: "inherit", env, ...(shell ? { shell: true } : {}) });
  // The dev server is long-running and is stopped by signalling this wrapper.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", (err) => {
    console.error(`[with-app-env] failed to run ${cmd}:`, err?.message || err);
    process.exit(127);
  });
  child.on("exit", (code, signal) => {
    process.exit(exitStatusFromChild(code, signal));
  });
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2));
}
