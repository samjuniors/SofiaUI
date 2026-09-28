/**
 * Pure, dependency-free helpers for `sophia-server.ts` request handling.
 * Kept separate so they can be unit-tested with `node --test` without
 * dragging in the Gemini SDK, child_process, or the Vite/Nitro runtime.
 */

/** Hostnames that mean "the machine running the dev server". */
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

/** Cloud metadata / link-local names that must never be a fetch target. */
const METADATA_HOSTNAMES = /(^|\.)(metadata\.google\.internal|metadata|instance-data)$/i;

export function isLinkLocalIPv4(hostname: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(hostname);
  return Boolean(m) && Number(m![1]) === 169 && Number(m![2]) === 254;
}

/**
 * True when the request is being served from a local dev host. The `Host`
 * header is client-supplied, so this is a *convenience* signal for local desktop
 * use, not an auth boundary — production deployments (VERCEL set) never qualify.
 */
export function isLocalDevRequest(req: Pick<Request, "headers">, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VERCEL || env.NODE_ENV === "production") return false;
  const host = (req.headers.get("host") || "").toLowerCase().replace(/:\d+$/, "");
  return LOCAL_HOSTNAMES.has(host);
}

/**
 * Whether a client-supplied Ollama / LM Studio base URL may be honoured.
 * Allowed for local dev requests, or when explicitly opted in via env.
 */
export function allowLlmUrlOverride(req: Pick<Request, "headers">, env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SOPHIA_ALLOW_LLM_URL_OVERRIDE === "1" || isLocalDevRequest(req, env);
}

/**
 * Validate a user-supplied LLM base URL. Returns the normalised URL (no
 * trailing slash) or `null` if it is not acceptable as a server-side fetch target.
 */
export function sanitizeLlmBaseUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  if (METADATA_HOSTNAMES.test(host) || isLinkLocalIPv4(host)) return null;
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/+$/, "");
}

/**
 * Resolve the base URL for a local LLM backend from (client override, env, default),
 * applying the override policy. Never throws.
 */
export function resolveLlmBaseUrl(opts: {
  override?: unknown;
  overrideAllowed: boolean;
  envValue?: string;
  fallback: string;
}): string {
  if (opts.overrideAllowed) {
    const clean = sanitizeLlmBaseUrl(opts.override);
    if (clean) return clean;
  }
  const fromEnv = sanitizeLlmBaseUrl(opts.envValue);
  return fromEnv || opts.fallback;
}

export type BrowserAction = "open_browser" | "search_browser" | "stream_media";

/**
 * Turn the free-form `url`/`query` a voice command produced into the URL the
 * desktop opener should launch. Returns `null` when the result is not a safe
 * http(s) URL. This is the only thing that may reach the OS opener.
 */
export function resolveBrowserTarget(action: BrowserAction, input: { url?: string; query?: string }): string | null {
  const raw = (input.url || input.query || "").trim();
  let target = "https://www.google.com";

  if (action === "search_browser") {
    const q = input.query || raw;
    target = q ? `https://www.google.com/search?q=${encodeURIComponent(q)}` : "https://www.google.com";
  } else if (action === "stream_media") {
    const q = input.query || raw || "lofi chill music";
    target = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  } else if (raw) {
    const low = raw.toLowerCase();
    if (/^https?:\/\//i.test(raw)) {
      target = raw;
    } else if (low === "google" || low === "browser" || low === "new tab") {
      target = "https://www.google.com";
    } else if (low === "youtube") {
      target = "https://www.youtube.com";
    } else if (low === "spotify") {
      target = "https://open.spotify.com";
    } else if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#].*)?$/i.test(raw) && !/\s/.test(raw)) {
      target = "https://" + raw;
    } else {
      target = `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.toString();
}
