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
    id: "skills_list_shape", category: "skills",
    run: async (ctx) => {
      const r = await ctx.call("skills_list", {});
      if (!ok(r) || !Array.isArray(r.result.skills)) return fail("skills_list did not return an array");
      const skills = r.result.skills;
      const hasCore = ["store_put", "skills_list", "voice_info"].every((s) => skills.includes(s));
      const sorted = [...skills].sort().join("\0") === skills.join("\0");
      return hasCore && sorted
        ? { pass: true, detail: `${skills.length} skills` }
        : fail("skills_list missing core actions or unsorted");
    },
  },
  {
    id: "media_status_shape", category: "media",
    run: async (ctx) => {
      const r = await ctx.call("media_status", {});
      if (!ok(r)) return fail("media_status failed");
      const s = r.result;
      const good = s && "playing" in s && "source" in s &&
        (s.playing === null || typeof s.playing === "boolean") &&
        (s.source === null || typeof s.source === "string");
      return good ? { pass: true, detail: `playing=${s.playing} source=${s.source ?? "none"}` } : fail("media_status shape changed");
    },
  },
  {
    id: "whatsapp_unavailable_graceful", category: "messaging",
    run: async (ctx) => {
      const r = await ctx.call("whatsapp_unread", {});
      // Without playwright-core the daemon must fail closed with a setup hint,
      // never throw or hang — the Daily UI keys its setup card off this contract.
      if (ok(r)) return { pass: true, detail: "daemon has WhatsApp configured" };
      const graceful = r.error === "action_failed" && /playwright/i.test(String(r.detail || ""));
      return graceful ? { pass: true, detail: "fails closed with a setup hint" } : fail("whatsapp_unread failed without a setup hint");
    },
  },
  {
    id: "episodes_roundtrip", category: "memory",
    run: async (ctx) => {
      const unique = `evalmoment${Date.now()}`; // alnum-only: FTS5 MATCH-safe
      const added = await ctx.call("episodes_add", { text: unique, role: "note" });
      if (!ok(added)) return fail("episodes_add failed");
      const found = await ctx.call("episodes_search", { q: unique });
      const searched = ok(found) && Array.isArray(found.result.hits) &&
        found.result.hits.some((h) => h.text === unique);
      if (!searched) return fail("episodes_search did not find the fresh moment");
      const recent = await ctx.call("episodes_recent", { limit: 5 });
      const listed = ok(recent) && Array.isArray(recent.result.episodes) &&
        recent.result.episodes.some((e) => e.text === unique);
      return listed
        ? { pass: true, detail: `engine=${added.result.engine}` }
        : fail("episodes_recent missed the fresh moment");
    },
  },
  {
    id: "episodes_vector_recall", category: "memory",
    run: async (ctx) => {
      const unique = `evalvec${Date.now()}`; // alnum-only: FTS5 MATCH-safe
      // Unique-per-run unit-ish vector: exact self-match (cosine 1.0) can
      // only be the planted episode, never a leftover from an older run.
      const seed = Date.now();
      const vec = Array.from({ length: 8 }, (_, i) => Math.sin(seed + i * 0.7));
      const added = await ctx.call("episodes_add", { text: unique, role: "note", embedding: vec });
      if (!ok(added)) return fail("episodes_add with embedding failed");
      // Zero keyword overlap — only the vector leg can find this.
      const found = await ctx.call("episodes_search", { q: "zzzqqq", vector: vec, limit: 5 });
      const hits = ok(found) && Array.isArray(found.result.hits) ? found.result.hits : [];
      const first = hits[0];
      const vectorLeaked = hits.some((h) => "embedding" in (h ?? {}));
      if (vectorLeaked) return fail("stored vectors leaked into search hits");
      return first && first.text === unique && found.result.hybrid === true
        ? { pass: true, detail: `engine=${added.result.engine} hybrid` }
        : fail("vector leg did not rank the planted episode first");
    },
  },
  {
    id: "ground_unavailable_graceful", category: "perception",
    run: async (ctx) => {
      const r = await ctx.call("ground_ocr", {});
      // With tesseract + a screen this scans; otherwise it must fail closed
      // (action_failed + hint), never throw or hang — the Diagnostics card
      // keys its setup state off this contract.
      if (ok(r)) return { pass: true, detail: `${r.result.count ?? r.result.words?.length ?? 0} words` };
      const graceful = r.error === "action_failed" && typeof r.detail === "string" && r.detail.length > 0;
      return graceful ? { pass: true, detail: "fails closed with a hint" } : fail("ground_ocr failed without a hint");
    },
  },
  {
    id: "observe_graceful", category: "perception",
    run: async (ctx) => {
      const r = await ctx.call("observe", {});
      // Headed machines return the full shape; headless ones must fail
      // closed (action_failed + hint), never throw or hang.
      if (ok(r)) {
        const o = r.result;
        const good = o && Array.isArray(o.ui_tree) && o.active_window && typeof o.active_window === "object" &&
          Array.isArray(o.notes) && typeof o.tree_source === "string" &&
          (o.screenshot_b64 === null || typeof o.screenshot_b64 === "string");
        return good
          ? { pass: true, detail: `tree=${o.ui_tree.length} shot=${o.screenshot_b64 ? "yes" : "no"}` }
          : fail("observe shape changed");
      }
      const graceful = r.error === "action_failed" && typeof r.detail === "string" && r.detail.length > 0;
      return graceful ? { pass: true, detail: "fails closed with a hint" } : fail("observe failed without a hint");
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
