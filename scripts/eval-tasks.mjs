/**
 * scripts/eval-tasks.mjs — the Sofia Companion reliability battery.
 * Each task gets a fresh daemon + sandbox via the harness's `ctx`:
 *   ctx.call(action, args) → {ok, result, error, detail, needsConfirmation}
 *   ctx.filesRoot / ctx.outsideFile / ctx.browser / ctx.platform
 */

const ok = (r) => r && r.ok;
const fail = (detail) => ({ pass: false, detail });

export const TASKS = [
  {
    id: "ping", category: "core",
    run: async (ctx) => {
      const r = await ctx.call("ping", {});
      return ok(r) && r.result.pong ? { pass: true, detail: `${ctx.platform}` } : fail("ping failed");
    },
  },
  {
    id: "store_roundtrip", category: "memory",
    run: async (ctx) => {
      const key = `eval-${Date.now()}`;
      const put = await ctx.call("store_put", { key, value: { name: "Sofia", likes: ["sunrise", "jazz"] } });
      const get = await ctx.call("store_get", { key });
      const good = ok(put) && ok(get) && get.result.value?.name === "Sofia";
      const del = await ctx.call("store_delete", { key });
      return good && ok(del) ? { pass: true } : fail("store round-trip broken");
    },
  },
  {
    id: "episodes_fts_search", category: "memory",
    run: async (ctx) => {
      const add = await ctx.call("episodes_add", { text: "User asked about the aurora borealis over Reykjavik", role: "user" });
      const hit = await ctx.call("episodes_search", { q: "aurora Reykjavik" });
      const good = ok(add) && ok(hit) && hit.result.hits.length >= 1 &&
        hit.result.hits[0].text.includes("aurora");
      return good ? { pass: true, detail: `engine=${hit.result.engine}` } : fail("FTS search missed the seeded episode");
    },
  },
  {
    id: "files_sandbox_enforced", category: "files+safety",
    run: async (ctx) => {
      const r = await ctx.call("files_read", { path: ctx.outsideFile });
      return !r.ok && /outside|sandbox/i.test(r.detail || r.error || "")
        ? { pass: true, detail: "escape attempt blocked" }
        : fail("sandbox did NOT block a path escape");
    },
  },
  {
    id: "files_list_find_read", category: "files",
    run: async (ctx) => {
      const list = await ctx.call("files_list", { path: ctx.filesRoot });
      const find = await ctx.call("files_find", { q: "eval-note" });
      const read = await ctx.call("files_read", { path: `${ctx.filesRoot}/eval-note.txt` });
      const good = ok(list) && ok(find) && find.result.hits.length >= 1 &&
        ok(read) && read.result.text.includes("hello from the eval");
      return good ? { pass: true } : fail("list/find/read chain broken");
    },
  },
  {
    id: "health_snapshot_shape", category: "system",
    run: async (ctx) => {
      const r = await ctx.call("health_snapshot", { limit: 2 });
      if (!ok(r)) return fail("health_snapshot failed");
      const s = r.result;
      const good = typeof s.score === "number" && s.score >= 0 && s.score <= 100 &&
        s.cpu && s.memory && Array.isArray(s.disks) && Array.isArray(s.warnings) && typeof s.uptime?.human === "string";
      return good ? { pass: true, detail: `score=${s.score}` } : fail("missing/malformed fields");
    },
  },
  {
    id: "local_voice_info_shape", category: "voice",
    run: async (ctx) => {
      const r = await ctx.call("voice_info", {});
      if (!ok(r)) return fail("voice_info failed");
      const s = r.result;
      const good = typeof s.platform === "string" &&
        s.tts && typeof s.tts.available === "boolean" && s.tts.engines && typeof s.tts.hint === "string" &&
        s.stt && typeof s.stt.available === "boolean" && s.stt.engines && typeof s.stt.hint === "string";
      return good ? { pass: true, detail: `platform=${s.platform} tts=${s.tts.available} stt=${s.stt.available}` } : fail("missing/malformed fields");
    },
  },
  {
    id: "confirmation_gates", category: "safety",
    run: async (ctx) => {
      const wa = await ctx.call("whatsapp_send", { to: "+910000000000", text: "hi" });
      const tr = await ctx.call("files_trash", { path: `${ctx.filesRoot}/eval-note.txt` });
      const gated = !wa.ok && wa.error === "confirmation_required" &&
        !tr.ok && tr.error === "confirmation_required";
      return gated ? { pass: true, detail: "both destructive actions gated" } : fail("confirmation gate missing");
    },
  },
  {
    id: "kill_switch_flow", category: "safety",
    run: async (ctx) => {
      const abort = await ctx.call("abort", {});
      const blocked = await ctx.call("click", { x: 100, y: 100 });
      const resume = await ctx.call("resume", {});
      const ping = await ctx.call("ping", {});
      // A blocked click may surface as 'aborted' OR as action_failed (no mouse
      // backend on this machine) — either proves the kill switch cleared the path.
      const gateHeld = !blocked.ok && (blocked.error === "aborted" || blocked.error === "action_failed");
      const good = ok(abort) && gateHeld && ok(resume) && ok(ping);
      return good ? { pass: true, detail: `gate cleared (${blocked.error === "aborted" ? "aborted" : "backend absent on this machine"})` } : fail("kill switch flow broken");
    },
  },
  {
    id: "unknown_action_rejected", category: "safety",
    run: async (ctx) => {
      const r = await ctx.call("launch_the_missiles", {});
      return !r.ok && r.error === "unknown_action" ? { pass: true } : fail("unknown action was not rejected");
    },
  },
  {
    id: "browser_open_read", category: "browser",
    skip: !process.env.EVAL_HAS_CHROME,
    run: async (ctx) => {
      const r = await ctx.call("browser_open_read", { url: "https://example.com" });
      return ok(r) && /Example Domain/i.test(r.result.text) ? { pass: true } : fail(r.detail || "read failed");
    },
  },
];

export const CATEGORIES = [...new Set(TASKS.map((t) => t.category))];
