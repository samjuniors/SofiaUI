/**
 * lib/sophia-fetch.ts — fetch wrapper for every `/api/sophia/*` call.
 *
 * Attaches the live-preview bearer session (when one exists) as
 * `Authorization: Bearer …` so the server-side better-auth gate
 * (`sophia-server.ts`) can resolve the caller. Deployed same-origin
 * traffic (cookie auth) and callers without a token behave exactly
 * like plain `fetch` — this only ever ADDS a header.
 *
 * The auth client is imported lazily and browser-only: node test runs
 * (no `window`) never touch the better-auth chain, so this module stays
 * import-safe under `node --experimental-strip-types`.
 */
type AuthClientModule = typeof import("./auth/client");

let clientModule: Promise<AuthClientModule | null> | null = null;

function previewToken(): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  clientModule ??= import("./auth/client").then(
    (m) => m,
    () => null,
  );
  return clientModule.then((m) => {
    if (!m) return null;
    try {
      return m.getBearerToken();
    } catch {
      return null;
    }
  });
}

export async function sophiaFetch(
  input: string | URL | Request,
  init: RequestInit = {},
): Promise<Response> {
  const token = await previewToken();
  if (!token) return fetch(input, init);
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
