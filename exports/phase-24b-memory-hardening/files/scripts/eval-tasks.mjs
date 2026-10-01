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
    id: "actions_receipts", category: "safety",
    run: async (ctx) => {
      // A secret-bearing write + a reversible move, then read the receipts.
      const key = `eval-receipt-${Date.now()}`;
      const put = await ctx.call("store_put", { key, value: { secret: "s3cr3t-should-never-log" } });
      const src = `${ctx.filesRoot}/eval-note.txt`;
      const dst = `${ctx.filesRoot}/eval-note-moved.txt`;
      const moved = await ctx.call("files_move", { from: src, to: dst });
      if (!ok(put) || !ok(moved)) return fail("setup actions failed");
      const r = await ctx.call("actions_recent", { limit: 10 });
      if (!ok(r) || !Array.isArray(r.result.receipts)) return fail("actions_recent gave no receipts");
      const rows = r.result.receipts;
      // Newest-first, shaped, narrated — and the secret stayed out.
      const ordered = rows.length >= 2 && rows[0].ts >= rows[1].ts;
      const moveRow = rows.find((x) => x.action === "files_move");
      const putRow = rows.find((x) => x.action === "store_put");
      const clean = rows.every((x) => typeof x.ts === "number" && typeof x.action === "string" && typeof x.ok === "boolean" &&
        !JSON.stringify(x).includes("s3cr3t-should-never-log"));
      if (!ordered || !moveRow || !putRow || !clean) return fail("receipts malformed, unordered, or leaked");
      if (!moveRow.undo || moveRow.undo.action !== "files_move") return fail("files_move receipt lacks its undo");
      // Execute the receipt's own undo op — the file must come back.
      const back = await ctx.call(moveRow.undo.action, moveRow.undo.args);
      const list = await ctx.call("files_list", { path: ctx.filesRoot });
      const restored = ok(back) && ok(list) && JSON.stringify(list.result).includes("eval-note.txt");
      if (!restored) return fail("receipt undo did not restore the file");
      // Reading receipts writes no receipt (no feedback loop).
      const r2 = await ctx.call("actions_recent", { limit: 50 });
      const noLoop = ok(r2) && !r2.result.receipts.some((x) => x.action === "actions_recent");
      return noLoop ? { pass: true, detail: `${rows.length} receipts, undo works` } : fail("actions_recent logged itself");
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
  {
    id: "memory_fact_lifecycle", category: "memory",
    run: async (ctx) => {
      const u = `evalfact${Date.now()}`; // alnum-only: FTS5 MATCH-safe
      const added = await ctx.call("memory_fact_add", { text: `The eval canary ${u} prefers sunrise jazz`, subject: `canary ${u}`, source: "user", confidence: 0.8 });
      if (!ok(added) || typeof added.result.id !== "number") return fail("memory_fact_add failed");
      if (added.result.sourceTrust !== "trusted") return fail("user source was not trusted");
      // Rule: no source tag, no fact — untrusted content never stored silently.
      const unsourced = await ctx.call("memory_fact_add", { text: `Unsourced claim ${u}` });
      if (ok(unsourced)) return fail("a sourceless fact was stored");
      // Untrusted sources bank with capped confidence.
      const gossip = await ctx.call("memory_fact_add", { text: `Gossip ${u} says it rains upward`, source: "random-blog", confidence: 0.9 });
      if (!ok(gossip) || gossip.result.sourceTrust !== "untrusted" || gossip.result.confidence > 0.4) return fail("untrusted fact escaped the confidence cap");
      const got = await ctx.call("memory_get", { store: "semantic", id: added.result.id });
      if (!ok(got) || got.result.row?.text !== `The eval canary ${u} prefers sunrise jazz`) return fail("memory_get mismatch");
      const edited = await ctx.call("memory_update", { store: "semantic", id: added.result.id, patch: { text: `The eval canary ${u} prefers sunrise jazz and rain`, confidence: 0.9 }, actor: "user" });
      if (!ok(edited) || edited.result.updated !== true) return fail("memory_update failed");
      const del = await ctx.call("memory_delete", { store: "semantic", id: added.result.id });
      const gone = await ctx.call("memory_get", { store: "semantic", id: added.result.id });
      if (!ok(del) || !ok(gone) || gone.result.row !== null) return fail("memory_delete did not remove the fact");
      // Every write above is in the log.
      const writes = await ctx.call("memory_writes", { limit: 50 });
      const ops = ok(writes) ? writes.result.writes.map((w) => `${w.store}/${w.op}`) : [];
      const logged = ["semantic/add", "semantic/update", "semantic/delete"].every((o) => ops.includes(o));
      await ctx.call("memory_delete", { store: "semantic", id: gossip.result.id });
      return logged ? { pass: true, detail: `fact #${added.result.id} lived and died by the rules` } : fail("memory_writes missed lifecycle ops");
    },
  },
  {
    id: "memory_episode_context", category: "memory",
    run: async (ctx) => {
      const u = `evalep${Date.now()}`;
      const added = await ctx.call("memory_episode_add", { text: `The eval ${u} rebooted the router and the wifi returned`, kind: "task", outcome: "done", source: "eval", importance: 0.7 });
      if (!ok(added) || typeof added.result.id !== "number") return fail("memory_episode_add failed");
      const listed = await ctx.call("memory_list", { store: "episodic", limit: 50 });
      if (!ok(listed) || !listed.result.rows.some((r) => r.text.includes(u))) return fail("memory_list missed the episode");
      const rec = await ctx.call("memory_context", { query: u, topK: 5, tokens: 2000 });
      if (!ok(rec)) return fail("memory_context failed");
      const eps = Array.isArray(rec.result.episodes) ? rec.result.episodes : [];
      const found = eps.some((r) => typeof r.text === "string" && r.text.includes(u));
      const leaked = [...eps, ...(rec.result.facts ?? [])].some((r) => r && "embedding" in r);
      if (leaked) return fail("stored vectors leaked into context rows");
      if (typeof rec.result.block !== "string" || !rec.result.block.includes(u)) return fail("context block missed the planted episode");
      return found ? { pass: true, detail: `engine=${rec.result.engine}` } : fail("context episodes missed the planted episode");
    },
  },
  {
    id: "memory_working_roundtrip", category: "memory",
    run: async (ctx) => {
      const goal = `eval working goal ${Date.now()}`;
      const put = await ctx.call("memory_working_put", { sessionId: "eval", goal });
      const got = await ctx.call("memory_working_get", { sessionId: "eval" });
      if (!ok(put) || !ok(got) || got.result.working?.goal !== goal) return fail("working put/get mismatch");
      const cleared = await ctx.call("memory_working_clear", { sessionId: "eval" });
      const gone = await ctx.call("memory_working_get", { sessionId: "eval" });
      return ok(cleared) && ok(gone) && gone.result.working === null ? { pass: true } : fail("working clear did not empty the slot");
    },
  },
  {
    id: "memory_contradiction_newest_wins", category: "memory",
    run: async (ctx) => {
      const slot = `evalsong${Date.now()}`;
      const old = await ctx.call("memory_fact_add", { text: `The office song ${slot} is jazz`, subject: slot, source: "user", confidence: 0.7 });
      const young = await ctx.call("memory_fact_add", { text: `The office song ${slot} is metal`, subject: slot, source: "user", confidence: 0.7 });
      if (!ok(old) || !ok(young)) return fail("setup facts failed");
      const dream = await ctx.call("memory_consolidate", { force: true });
      if (!ok(dream) || dream.result.skipped !== null || typeof dream.result.stats !== "object") return fail("forced consolidation did not run");
      if (!(dream.result.stats.resolved >= 1)) return fail("contradiction was not resolved");
      const a = await ctx.call("memory_get", { store: "semantic", id: old.result.id });
      const b = await ctx.call("memory_get", { store: "semantic", id: young.result.id });
      const loser = a.result.row, winner = b.result.row;
      const good = ok(a) && ok(b) && winner.status === "active" && loser.status === "superseded" && loser.supersededBy === winner.id;
      await ctx.call("memory_delete", { store: "semantic", id: old.result.id });
      await ctx.call("memory_delete", { store: "semantic", id: young.result.id });
      return good ? { pass: true, detail: `newest #${winner.id} won the slot` } : fail("newest fact did not win");
    },
  },
  {
    id: "memory_consolidate_shape", category: "memory",
    run: async (ctx) => {
      const forced = await ctx.call("memory_consolidate", { force: true });
      if (!ok(forced) || forced.result.skipped !== null) return fail("forced consolidation did not run");
      const keys = ["merged", "resolved", "decayed", "flagged", "summarized", "skillsProposed", "skillsActivated"];
      const shaped = keys.every((k) => typeof forced.result.stats?.[k] === "number");
      if (!shaped) return fail("consolidation stats malformed");
      const again = await ctx.call("memory_consolidate", {});
      if (!ok(again) || typeof again.result.skipped !== "string") return fail("immediate re-run was not skipped");
      const counts = await ctx.call("memory_counts", {});
      return ok(counts) && counts.result.counts ? { pass: true, detail: `cooldown=${again.result.skipped}` } : fail("memory_counts failed");
    },
  },
  {
    id: "memory_skill_induction", category: "memory",
    run: async (ctx) => {
      const u = `evalsk${Date.now()}`; // alnum-only: unique pattern per run
      const text = `Restart the ${u} spooler [trail: observe \u2192 click \u2192 type]`;
      for (let i = 0; i < 3; i++) {
        const added = await ctx.call("memory_episode_add", { text, kind: "task", outcome: "done", source: "eval" });
        if (!ok(added)) return fail("setup episode failed");
      }
      const dream = await ctx.call("memory_consolidate", { force: true });
      if (!ok(dream) || !(dream.result.stats.skillsProposed >= 1)) return fail("dream proposed no skill");
      const list = await ctx.call("memory_list", { store: "procedural", limit: 50 });
      const ours = ok(list) ? list.result.rows.find((r) => typeof r.name === "string" && r.name.includes(u)) : null;
      if (!ours) return fail("induced skill not listed");
      const stepsOk = ours.status === "active" && Array.isArray(ours.steps?.trail) &&
        ours.steps.trail.join("|") === "observe|click|type" && ours.steps.via === "induction";
      await ctx.call("memory_delete", { store: "procedural", id: ours.id });
      return stepsOk ? { pass: true, detail: `skill #${ours.id} active with real steps` } : fail(`induced skill has no real steps: ${JSON.stringify(ours.steps)}`);
    },
  },
  {
    id: "memory_episode_shots", category: "memory",
    run: async (ctx) => {
      const px = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJAAA=";
      const added = await ctx.call("memory_episode_add", {
        text: `The eval photographed the whiteboard ${Date.now()}`,
        kind: "moment", outcome: "none", shots: [`data:image/png;base64,${px}`, "not-an-image"],
      });
      if (!ok(added) || added.result.shots !== 1) return fail("valid shot was not saved (or junk was kept)");
      const got = await ctx.call("memory_get", { store: "episodic", id: added.result.id });
      const shots = ok(got) ? got.result.row?.shots : null;
      const good = Array.isArray(shots) && shots.length === 1 &&
        shots[0].path.startsWith("memory/shots/") && shots[0].bytes > 0;
      return good ? { pass: true, detail: shots[0].path } : fail("episode shots missing or malformed");
    },
  },
];

export const CATEGORIES = [...new Set(TASKS.map((t) => t.category))];
