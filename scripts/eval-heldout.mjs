/**
 * scripts/eval-heldout.mjs — the FROZEN held-out battery (Phase 36).
 *
 * 30 tasks the self-improvement loop can NEVER see: separate file, separate
 * baseline (scripts/eval-heldout.baseline.json), separate report
 * (public/eval-heldout-report.json), run only via `--suite=heldout`.
 * Every task carries `heldout: true`; scripts/self-improve.mjs refuses any
 * eval JSON with that marker, and scripts/eval-heldout.test.mjs guards the
 * freeze (count, ids, disjointness from the main battery, marker).
 *
 * Same ctx as the main battery: fresh daemon + sandbox per harness run.
 *   ctx.call(action, args) → {ok, result, error, detail, ...}
 *   ctx.confirm(id) → {ok, action, error}
 * All checks are daemon-backed and deterministic (no LLM, no network).
 */

const ok = (r) => r && r.ok;
const fail = (detail) => ({ pass: false, detail });
const errText = (r) => `${r?.detail ?? ''} ${r?.error ?? ''}`;

export const TASKS = [
  // ── heldout:core ──────────────────────────────────────────────────
  {
    id: 'heldout_session_info_shape', category: 'heldout:core', heldout: true,
    run: async (ctx) => {
      const r = await ctx.call('session_info', {});
      if (!ok(r)) return fail('session_info failed');
      const s = r.result;
      const good = typeof s.session === 'string' && s.session.length > 0 &&
        typeof s.device === 'string' && s.device.length > 0 &&
        s.scope === 'control' && s.grant === 'token';
      return good ? { pass: true, detail: `scope=${s.scope} grant=${s.grant}` } : fail('token session is not a control session');
    },
  },
  {
    id: 'heldout_store_keys_lists_puts', category: 'heldout:core', heldout: true,
    run: async (ctx) => {
      const a = `heldout-keys-${Date.now()}-a`;
      const b = `heldout-keys-${Date.now()}-b`;
      await ctx.call('store_put', { key: a, value: { n: 1 } });
      await ctx.call('store_put', { key: b, value: { n: 2 } });
      const listed = await ctx.call('store_keys', {});
      const keys = ok(listed) && Array.isArray(listed.result.keys) ? listed.result.keys.map((k) => k.key) : [];
      const seen = keys.includes(a) && keys.includes(b);
      await ctx.call('store_delete', { key: a });
      await ctx.call('store_delete', { key: b });
      const again = await ctx.call('store_keys', {});
      const gone = ok(again) ? !again.result.keys.some((k) => k.key === a || k.key === b) : false;
      return seen && gone ? { pass: true, detail: `${keys.length} keys listed` } : fail('store_keys missed puts or kept deletes');
    },
  },
  {
    id: 'heldout_store_missing_found_false', category: 'heldout:core', heldout: true,
    run: async (ctx) => {
      const r = await ctx.call('store_get', { key: `heldout-never-${Date.now()}` });
      const good = ok(r) && r.result.found === false && r.result.value === null;
      return good ? { pass: true } : fail('missing key did not come back found:false');
    },
  },
  {
    id: 'heldout_store_overwrite_newest', category: 'heldout:core', heldout: true,
    run: async (ctx) => {
      const key = `heldout-overwrite-${Date.now()}`;
      await ctx.call('store_put', { key, value: { v: 1 } });
      await ctx.call('store_put', { key, value: { v: 2 } });
      const got = await ctx.call('store_get', { key });
      await ctx.call('store_delete', { key });
      const good = ok(got) && got.result.found === true && got.result.value?.v === 2;
      return good ? { pass: true } : fail('second put did not win');
    },
  },

  // ── heldout:files ────────────────────────────────────────────────
  {
    id: 'heldout_files_roots_shape', category: 'heldout:files', heldout: true,
    run: async (ctx) => {
      const r = await ctx.call('files_roots', {});
      const good = ok(r) && Array.isArray(r.result.roots) && r.result.roots.includes(ctx.filesRoot);
      return good ? { pass: true, detail: `${r.result.roots.length} root(s)` } : fail('sandbox root not listed');
    },
  },
  {
    id: 'heldout_files_move_roundtrip', category: 'heldout:files', heldout: true,
    run: async (ctx) => {
      const src = `${ctx.filesRoot}/eval-note.txt`;
      const dst = `${ctx.filesRoot}/heldout-moved.txt`;
      const away = await ctx.call('files_move', { from: src, to: dst });
      const readAway = await ctx.call('files_read', { path: dst });
      const back = await ctx.call('files_move', { from: dst, to: src });
      const readBack = await ctx.call('files_read', { path: src });
      const good = ok(away) && ok(readAway) && readAway.result.text.includes('hello from the eval') &&
        ok(back) && ok(readBack) && readBack.result.text.includes('hello from the eval');
      return good ? { pass: true } : fail('move away/back broke the file');
    },
  },
  {
    id: 'heldout_files_move_outside_denied', category: 'heldout:files', heldout: true,
    run: async (ctx) => {
      const r = await ctx.call('files_move', { from: `${ctx.filesRoot}/eval-note.txt`, to: ctx.outsideFile });
      return !r.ok && /outside|sandbox/i.test(errText(r))
        ? { pass: true, detail: 'escape move blocked' }
        : fail('sandbox did NOT block an escaping move');
    },
  },
  {
    id: 'heldout_files_trash_restore_cycle', category: 'heldout:files', heldout: true,
    run: async (ctx) => {
      const src = `${ctx.filesRoot}/eval-note.txt`;
      const first = await ctx.call('files_trash', { path: src });
      if (first.ok || first.error !== 'confirmation_required' || !first.confirmation_id) {
        return fail('trash was not gated');
      }
      const redeemed = await ctx.confirm(first.confirmation_id);
      if (!ok(redeemed)) return fail('confirmation redemption failed');
      const trashed = await ctx.call('files_trash', { path: src, confirmation_id: first.confirmation_id });
      if (!ok(trashed) || typeof trashed.result.trashPath !== 'string') return fail('confirmed trash failed');
      const list = await ctx.call('files_list', { path: ctx.filesRoot });
      const gone = ok(list) && !list.result.entries.some((e) => e.name === 'eval-note.txt');
      if (!gone) return fail('trashed file still listed');
      // Restore trips the risk scanner (the path mentions "trash") — confirm and retry.
      const r1 = await ctx.call('files_restore', { path: trashed.result.trashPath });
      let restored = r1;
      if (!r1.ok && r1.error === 'confirmation_required' && r1.confirmation_id) {
        const okConfirm = await ctx.confirm(r1.confirmation_id);
        if (ok(okConfirm)) restored = await ctx.call('files_restore', { path: trashed.result.trashPath, confirmation_id: r1.confirmation_id });
      }
      const read = await ctx.call('files_read', { path: src });
      const good = ok(restored) && ok(read) && read.result.text.includes('hello from the eval');
      return good ? { pass: true, detail: 'trashed, confirmed, restored' } : fail('restore did not bring the file back');
    },
  },

  // ── heldout:memory ───────────────────────────────────────────────
  {
    id: 'heldout_memory_fact_confidence_defaults', category: 'heldout:memory', heldout: true,
    run: async (ctx) => {
      const u = Date.now();
      const trusted = await ctx.call('memory_fact_add', { text: `Heldout canary ${u} drinks water`, source: 'user' });
      const wild = await ctx.call('memory_fact_add', { text: `Heldout rumor ${u} says the moon is cheese`, source: 'random-web' });
      const good = ok(trusted) && trusted.result.sourceTrust === 'trusted' && trusted.result.confidence === 0.7 &&
        ok(wild) && wild.result.sourceTrust === 'untrusted' && wild.result.confidence === 0.4;
      if (ok(trusted)) await ctx.call('memory_delete', { store: 'semantic', id: trusted.result.id });
      if (ok(wild)) await ctx.call('memory_delete', { store: 'semantic', id: wild.result.id });
      return good ? { pass: true, detail: 'trusted 0.7 / untrusted 0.4' } : fail('confidence defaults wrong');
    },
  },
  {
    id: 'heldout_memory_list_semantic_sees_fact', category: 'heldout:memory', heldout: true,
    run: async (ctx) => {
      const u = Date.now();
      const added = await ctx.call('memory_fact_add', { text: `Heldout list probe ${u} naps daily`, subject: `probe ${u}`, source: 'user' });
      if (!ok(added)) return fail('fact_add failed');
      const listed = await ctx.call('memory_list', { store: 'semantic', limit: 50 });
      const seen = ok(listed) && listed.result.rows.some((r) => r.id === added.result.id);
      await ctx.call('memory_delete', { store: 'semantic', id: added.result.id });
      return seen ? { pass: true, detail: `fact #${added.result.id} listed` } : fail('semantic list missed the fact');
    },
  },
  {
    id: 'heldout_memory_export_shape', category: 'heldout:memory', heldout: true,
    run: async (ctx) => {
      const r = await ctx.call('memory_export', {});
      if (!ok(r)) return fail('memory_export failed');
      const e = r.result;
      const good = typeof e.exportedAt === 'number' && typeof e.engine === 'string' &&
        e.counts && typeof e.counts === 'object' &&
        Array.isArray(e.facts) && Array.isArray(e.episodes) && Array.isArray(e.skills) &&
        Array.isArray(e.working) && Array.isArray(e.sessions);
      const leaked = [...e.facts, ...e.episodes].some((row) => row && 'embedding' in row);
      if (leaked) return fail('export leaked stored vectors');
      return good ? { pass: true, detail: `engine=${e.engine}` } : fail('export shape changed');
    },
  },
  {
    id: 'heldout_memory_derive_dry_run', category: 'heldout:memory', heldout: true,
    run: async (ctx) => {
      const r = await ctx.call('memory_derive', { text: 'The eval canary prefers sunrise jazz', source: 'user' });
      const good = ok(r) && Array.isArray(r.result.candidates) &&
        Array.isArray(r.result.storedIds) && r.result.storedIds.length === 0;
      return good ? { pass: true, detail: `${r.result.candidates.length} candidate(s), nothing stored` } : fail('dry-run derive stored or malformed');
    },
  },
  {
    id: 'heldout_memory_derive_requires_text', category: 'heldout:memory', heldout: true,
    run: async (ctx) => {
      const r = await ctx.call('memory_derive', {});
      return !r.ok && /missing text/.test(errText(r)) ? { pass: true } : fail('textless derive was not rejected');
    },
  },
  {
    id: 'heldout_memory_skill_use_missing', category: 'heldout:memory', heldout: true,
    run: async (ctx) => {
      const r = await ctx.call('memory_skill_use', { id: 2147483647, ok: true });
      return !r.ok && /skill not found/.test(errText(r)) ? { pass: true } : fail('use of a missing skill was not rejected');
    },
  },
  {
    id: 'heldout_memory_get_missing_null', category: 'heldout:memory', heldout: true,
    run: async (ctx) => {
      const r = await ctx.call('memory_get', { store: 'semantic', id: 2147483647 });
      const good = ok(r) && r.result.row === null;
      return good ? { pass: true } : fail('missing row did not come back null');
    },
  },

  // ── heldout:episodes ─────────────────────────────────────────────
  {
    id: 'heldout_episodes_recent_limit', category: 'heldout:episodes', heldout: true,
    run: async (ctx) => {
      const unique = `heldoutlim${Date.now()}`; // alnum-only: FTS5 MATCH-safe
      const added = await ctx.call('episodes_add', { text: unique, role: 'note' });
      if (!ok(added)) return fail('episodes_add failed');
      const recent = await ctx.call('episodes_recent', { limit: 1 });
      const rows = ok(recent) && Array.isArray(recent.result.episodes) ? recent.result.episodes : [];
      const good = rows.length === 1 && rows[0].text === unique;
      return good ? { pass: true, detail: `engine=${added.result.engine}` } : fail('limit:1 did not return exactly the fresh episode');
    },
  },

  // ── heldout:safety ───────────────────────────────────────────────
  {
    id: 'heldout_confirm_unknown_id', category: 'heldout:safety', heldout: true,
    run: async (ctx) => {
      const r = await ctx.confirm('heldout-bogus-id');
      const good = !ok(r) && r.error === 'unknown_confirmation_id';
      return good ? { pass: true } : fail('bogus confirmation id was not rejected');
    },
  },
  {
    id: 'heldout_trust_lists_see_self', category: 'heldout:safety', heldout: true,
    run: async (ctx) => {
      const info = await ctx.call('session_info', {});
      if (!ok(info)) return fail('session_info failed');
      const sessions = await ctx.call('sessions_list', {});
      const devices = await ctx.call('devices_list', {});
      const selfSession = ok(sessions) && Array.isArray(sessions.result.sessions) &&
        sessions.result.sessions.some((s) => s.id === info.result.session);
      const selfDevice = ok(devices) && Array.isArray(devices.result.devices) &&
        devices.result.devices.some((d) => d.id === info.result.device);
      return selfSession && selfDevice
        ? { pass: true, detail: `device=${info.result.device}` }
        : fail('own session or device missing from trust lists');
    },
  },
  {
    id: 'heldout_devices_revoke_missing', category: 'heldout:safety', heldout: true,
    run: async (ctx) => {
      const r = await ctx.call('devices_revoke', { id: 'heldout-no-such-device' });
      return !r.ok && r.error === 'no_such_device' ? { pass: true } : fail('revoking a missing device was not rejected');
    },
  },
  {
    id: 'heldout_sessions_revoke_missing', category: 'heldout:safety', heldout: true,
    run: async (ctx) => {
      const r = await ctx.call('sessions_revoke', { id: 'heldout-no-such-session' });
      return !r.ok && r.error === 'no_such_session' ? { pass: true } : fail('revoking a missing session was not rejected');
    },
  },
  {
    id: 'heldout_approvals_resolve_missing', category: 'heldout:safety', heldout: true,
    run: async (ctx) => {
      const r = await ctx.call('approvals_resolve', { id: 'heldout-no-such-approval', ok: true });
      return !r.ok && r.error === 'no_pending_approval' ? { pass: true } : fail('resolving a missing approval was not rejected');
    },
  },
  {
    id: 'heldout_store_put_cred_key_flows', category: 'heldout:safety', heldout: true,
    run: async (ctx) => {
      // Possession, not use: a credential-flavored KEY must store freely
      // (only store_get / typing are gated as exfil moments).
      const key = `my-password-backup-${Date.now()}`;
      const put = await ctx.call('store_put', { key, value: { v: 1 } });
      if (!ok(put)) return fail('vault storage of a cred-flavored key was gated');
      await ctx.call('store_delete', { key });
      return { pass: true };
    },
  },

  // ── heldout:system ───────────────────────────────────────────────
  {
    id: 'heldout_health_processes_shape', category: 'heldout:system', heldout: true,
    run: async (ctx) => {
      const r = await ctx.call('health_processes', { limit: 3 });
      if (!ok(r) || !Array.isArray(r.result.processes)) return fail('health_processes gave no array');
      const rows = r.result.processes;
      const shaped = rows.length <= 3 && rows.every((p) => typeof p.name === 'string' && typeof p.memMB === 'number');
      return shaped ? { pass: true, detail: `${rows.length} row(s)` } : fail('process rows malformed or over limit');
    },
  },
  {
    id: 'heldout_volume_level_shape', category: 'heldout:system', heldout: true,
    run: async (ctx) => {
      const r = await ctx.call('get_volume', {});
      const good = ok(r) && typeof r.result.level === 'number';
      return good ? { pass: true, detail: `level=${r.result.level}` } : fail('get_volume gave no numeric level');
    },
  },

  // ── heldout:coder ────────────────────────────────────────────────
  {
    id: 'heldout_coder_probe_shape', category: 'heldout:coder', heldout: true,
    run: async (ctx) => {
      const r = await ctx.call('coder_probe', {});
      if (!ok(r)) return fail('coder_probe failed');
      const clis = r.result.clis ?? {};
      const shaped = ['codex', 'claude'].every((c) =>
        clis[c] && typeof clis[c].ok === 'boolean' &&
        (clis[c].ok ? typeof clis[c].version === 'string' : typeof clis[c].hint === 'string'));
      return shaped
        ? { pass: true, detail: `codex=${clis.codex.ok} claude=${clis.claude.ok}` }
        : fail('CLI probe rows malformed');
    },
  },
  {
    id: 'heldout_coder_run_rejects_bad_cli', category: 'heldout:coder', heldout: true,
    run: async (ctx) => {
      const r = await ctx.call('coder_run', { repo: '/tmp', task: 'list the files', testCmd: 'npm test', cli: 'gemini' });
      return !r.ok && /coder_bad_cli/.test(errText(r)) ? { pass: true } : fail('unknown CLI was not rejected');
    },
  },

  // ── heldout:connectors ───────────────────────────────────────────
  {
    id: 'heldout_connector_search_shape', category: 'heldout:connectors', heldout: true,
    run: async (ctx) => {
      const r = await ctx.call('connector_search', {});
      if (!ok(r) || !Array.isArray(r.result.entries)) return fail('connector_search gave no entries');
      const shaped = r.result.entries.length >= 1 && r.result.entries.every((e) =>
        typeof e.id === 'string' && typeof e.name === 'string' && Array.isArray(e.scopes));
      return shaped ? { pass: true, detail: `${r.result.entries.length} entries` } : fail('registry entries malformed');
    },
  },
  {
    id: 'heldout_connector_propose_unknown', category: 'heldout:connectors', heldout: true,
    run: async (ctx) => {
      const r = await ctx.call('connector_propose', { entryId: 'heldout-no-such-entry' });
      return !r.ok && /connector_unknown_entry/.test(errText(r)) ? { pass: true } : fail('unknown entry was not rejected');
    },
  },
  {
    id: 'heldout_connector_revoke_unknown', category: 'heldout:connectors', heldout: true,
    run: async (ctx) => {
      const r = await ctx.call('connector_revoke', { connectorId: 'heldout-no-such-connector' });
      return !r.ok && /connector_no_connector/.test(errText(r)) ? { pass: true } : fail('unknown connector was not rejected');
    },
  },

  // ── heldout:pairing ──────────────────────────────────────────────
  {
    id: 'heldout_pairing_code_shape', category: 'heldout:pairing', heldout: true,
    run: async (ctx) => {
      const r = await ctx.call('pairing_code', {});
      if (!ok(r)) return fail('pairing_code failed');
      const c = r.result;
      const good = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(c.code ?? '') &&
        typeof c.expires_at === 'number' && c.expires_at > Date.now() &&
        typeof c.daemon_id === 'string' && c.daemon_id.length > 0 &&
        c.daemon_pubkey !== null && typeof c.daemon_pubkey === 'object' && c.daemon_pubkey.kty === 'EC';
      return good ? { pass: true, detail: 'code + daemon identity shaped' } : fail('pairing code shape changed');
    },
  },
];

export const CATEGORIES = [...new Set(TASKS.map((t) => t.category))];
