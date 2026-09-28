import assert from "node:assert/strict";
import test from "node:test";
import {
  allowLlmUrlOverride,
  isLocalDevRequest,
  resolveBrowserTarget,
  resolveLlmBaseUrl,
  sanitizeLlmBaseUrl,
} from "./sophia-server-policy.ts";

const reqWithHost = (host: string) => ({ headers: new Headers({ host }) });

test("resolveBrowserTarget: full http(s) URLs pass through", () => {
  assert.equal(resolveBrowserTarget("open_browser", { url: "https://example.com/a?b=1" }), "https://example.com/a?b=1");
  assert.equal(resolveBrowserTarget("open_browser", { url: "http://example.com" }), "http://example.com/");
});

test("resolveBrowserTarget: shell metacharacters stay inside the URL, never a shell", () => {
  const out = resolveBrowserTarget("open_browser", { url: "https://x.com/$(touch /tmp/pwn)" });
  assert.ok(out?.startsWith("https://x.com/"));
  const search = resolveBrowserTarget("open_browser", { query: "`id`; rm -rf ~" });
  assert.ok(search?.startsWith("https://www.google.com/search?q="));
  assert.ok(!search!.includes("`"));
});

test("resolveBrowserTarget: non-http schemes never reach the opener as-is", () => {
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", "ms-settings:", "shell:startup"]) {
    const out = resolveBrowserTarget("open_browser", { url });
    // Either refused, or downgraded to a harmless Google search for the literal text.
    assert.ok(out === null || out.startsWith("https://www.google.com/search?q="), url);
  }
});

test("resolveBrowserTarget: aliases and bare domains", () => {
  assert.equal(resolveBrowserTarget("open_browser", { url: "youtube" }), "https://www.youtube.com/");
  assert.equal(resolveBrowserTarget("open_browser", { url: "Spotify" }), "https://open.spotify.com/");
  assert.equal(resolveBrowserTarget("open_browser", { url: "github.com/samjuniors" }), "https://github.com/samjuniors");
  assert.equal(resolveBrowserTarget("open_browser", {}), "https://www.google.com/");
});

test("resolveBrowserTarget: search and media actions encode the query", () => {
  assert.equal(
    resolveBrowserTarget("search_browser", { query: "weather in delhi & more" }),
    "https://www.google.com/search?q=weather%20in%20delhi%20%26%20more",
  );
  assert.equal(
    resolveBrowserTarget("stream_media", {}),
    "https://www.youtube.com/results?search_query=lofi%20chill%20music",
  );
});

test("sanitizeLlmBaseUrl: accepts local http endpoints and strips trailing slash", () => {
  assert.equal(sanitizeLlmBaseUrl("http://localhost:11434/"), "http://localhost:11434");
  assert.equal(sanitizeLlmBaseUrl("http://192.168.1.20:1234/v1"), "http://192.168.1.20:1234/v1");
  assert.equal(sanitizeLlmBaseUrl("https://my-tunnel.example.com/v1/"), "https://my-tunnel.example.com/v1");
});

test("sanitizeLlmBaseUrl: rejects metadata, link-local, credentials and odd schemes", () => {
  assert.equal(sanitizeLlmBaseUrl("http://169.254.169.254/latest/meta-data"), null);
  assert.equal(sanitizeLlmBaseUrl("http://metadata.google.internal/"), null);
  assert.equal(sanitizeLlmBaseUrl("http://user:pass@host/"), null);
  assert.equal(sanitizeLlmBaseUrl("file:///etc/passwd"), null);
  assert.equal(sanitizeLlmBaseUrl("gopher://x"), null);
  assert.equal(sanitizeLlmBaseUrl(""), null);
  assert.equal(sanitizeLlmBaseUrl(42), null);
});

test("isLocalDevRequest / allowLlmUrlOverride policy", () => {
  const devEnv = {} as NodeJS.ProcessEnv;
  assert.equal(isLocalDevRequest(reqWithHost("localhost:8080"), devEnv), true);
  assert.equal(isLocalDevRequest(reqWithHost("127.0.0.1:8080"), devEnv), true);
  assert.equal(isLocalDevRequest(reqWithHost("sophia.example.com"), devEnv), false);
  // Production never counts as local, even with a spoofed Host header.
  assert.equal(isLocalDevRequest(reqWithHost("localhost"), { VERCEL: "1" } as NodeJS.ProcessEnv), false);
  assert.equal(isLocalDevRequest(reqWithHost("localhost"), { NODE_ENV: "production" } as NodeJS.ProcessEnv), false);
  // Explicit opt-in works anywhere.
  assert.equal(
    allowLlmUrlOverride(reqWithHost("sophia.example.com"), { SOPHIA_ALLOW_LLM_URL_OVERRIDE: "1" } as NodeJS.ProcessEnv),
    true,
  );
});

test("resolveLlmBaseUrl: override only when allowed, env next, fallback last", () => {
  const base = { envValue: "http://10.0.0.5:11434", fallback: "http://localhost:11434" };
  assert.equal(resolveLlmBaseUrl({ ...base, override: "http://box:11434/", overrideAllowed: true }), "http://box:11434");
  assert.equal(resolveLlmBaseUrl({ ...base, override: "http://box:11434/", overrideAllowed: false }), "http://10.0.0.5:11434");
  assert.equal(resolveLlmBaseUrl({ override: undefined, overrideAllowed: true, fallback: "http://localhost:1234/v1" }), "http://localhost:1234/v1");
  // A blocked override silently falls back rather than being fetched.
  assert.equal(resolveLlmBaseUrl({ ...base, override: "http://169.254.169.254", overrideAllowed: true }), "http://10.0.0.5:11434");
});
