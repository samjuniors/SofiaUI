/**
 * memory/actions.mjs — Phase 24: daemon dispatch for `memory_*` actions.
 * Thin: validate (schema) → store → log the write. Auto-derives conclusions
 * from new task/chat/turn episodes (the Deriver runs at write time, like
 * Honcho). Every mutation lands in the writes log.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createMemoryStore } from './store.mjs';
import {
  validFactInput, validEpisodeInput, validSkillInput, validWorkingInput, validShots, trustOf,
} from './schema.mjs';
import { derive } from './derive.mjs';
import { assembleContext } from './retrieve.mjs';
import { runConsolidation } from './consolidate.mjs';

const handles = new Map();

function handle(dataDir) {
  let h = handles.get(dataDir);
  if (!h) {
    h = createMemoryStore(dataDir);
    handles.set(dataDir, h);
  }
  return h;
}

/** Test seam — drop cached handles so tests get fresh dirs. */
export function __resetMemory() {
  for (const h of handles.values()) {
    try { h.close(); } catch { /* ignore */ }
  }
  handles.clear();
}

export const MEMORY_ACTIONS = [
  'memory_working_put', 'memory_working_get', 'memory_working_clear',
  'memory_episode_add', 'memory_fact_add', 'memory_skill_add', 'memory_derive',
  'memory_context', 'memory_list', 'memory_get', 'memory_update', 'memory_delete',
  'memory_export', 'memory_writes', 'memory_counts', 'memory_consolidate',
];

async function saveShots(dataDir, episodeId, shots) {
  const dir = join(dataDir, 'memory', 'shots');
  await fs.mkdir(dir, { recursive: true });
  const out = [];
  let n = 0;
  for (const s of shots) {
    n++;
    const name = `${episodeId}-${n}.${s.ext}`;
    await fs.writeFile(join(dir, name), s.buf);
    out.push({ path: `memory/shots/${name}`, bytes: s.buf.length });
  }
  return out;
}

async function deriveInto(store, text, source, episodeId, actor) {
  const cands = derive(text, { source, episodeId });
  const ids = [];
  for (const c of cands) {
    try {
      const id = await store.insertFact(validFactInput(c));
      ids.push(id);
      await store.logWrite({ store: 'semantic', op: 'derive', refId: String(id), actor, summary: c.text.slice(0, 100) });
    } catch {
      /* one bad candidate must not fail the episode write */
    }
  }
  return ids;
}

export async function memoryAction(action, a = {}, dataDir) {
  const store = handle(dataDir);
  const actor = a.actor === 'user' ? 'user' : 'agent';

  switch (action) {
    case 'memory_working_put': {
      const w = validWorkingInput(a);
      const r = await store.putWorking(w);
      await store.logWrite({ store: 'working', op: 'put', refId: w.sessionId, actor, summary: (w.goal || 'scratchpad update').slice(0, 100) });
      return { ...r, engine: store.engine() };
    }
    case 'memory_working_get': {
      const sessionId = typeof a.sessionId === 'string' && a.sessionId ? a.sessionId : 'default';
      return { working: await store.getWorking(sessionId), engine: store.engine() };
    }
    case 'memory_working_clear': {
      const sessionId = typeof a.sessionId === 'string' && a.sessionId ? a.sessionId : 'default';
      const ok = await store.deleteWorking(sessionId);
      await store.logWrite({ store: 'working', op: 'clear', refId: sessionId, actor, summary: 'working state cleared' });
      return { sessionId, cleared: ok };
    }
    case 'memory_episode_add': {
      const e = validEpisodeInput(a);
      const id = await store.insertEpisode({ ...e, shots: [] });
      const files = await saveShots(dataDir, id, validShots(a.shots));
      if (files.length) await store.updateEpisode(id, { shots: JSON.stringify(files) });
      await store.logWrite({ store: 'episodic', op: 'add', refId: String(id), actor, summary: `${e.kind}/${e.outcome}: ${e.text.slice(0, 90)}` });
      // The Deriver runs at write time: explicit conclusions are banked now,
      // consolidation merges and weights them later.
      const derivedIds = (e.kind === 'task' || e.kind === 'chat' || e.kind === 'turn')
        ? await deriveInto(store, e.text, typeof a.source === 'string' && a.source ? a.source : 'user', id, 'deriver')
        : [];
      return { id, ts: Date.now(), shots: files.length, derivedIds, engine: store.engine() };
    }
    case 'memory_fact_add': {
      const f = validFactInput(a);
      const id = await store.insertFact(f);
      await store.logWrite({ store: 'semantic', op: 'add', refId: String(id), actor, summary: `${f.source}/${f.sourceTrust}: ${f.text.slice(0, 90)}` });
      return { id, ts: Date.now(), sourceTrust: f.sourceTrust, confidence: f.confidence, engine: store.engine() };
    }
    case 'memory_skill_add': {
      const s = validSkillInput(a);
      const id = await store.insertSkill(s);
      await store.logWrite({ store: 'procedural', op: 'add', refId: String(id), actor, summary: s.name.slice(0, 100) });
      return { id, ts: Date.now(), status: 'candidate', engine: store.engine() };
    }
    case 'memory_derive': {
      const text = typeof a.text === 'string' ? a.text : '';
      if (!text.trim()) throw new Error('missing text');
      const source = typeof a.source === 'string' && a.source.trim() ? a.source.trim() : 'user';
      const episodeId = Number.isInteger(a.episodeId) ? a.episodeId : null;
      const cands = derive(text, { source, sourceTrust: a.sourceTrust, episodeId });
      if (a.store === true) {
        const ids = [];
        for (const c of cands) {
          const id = await store.insertFact(validFactInput(c));
          ids.push(id);
          await store.logWrite({ store: 'semantic', op: 'derive', refId: String(id), actor, summary: c.text.slice(0, 100) });
        }
        return { candidates: cands, storedIds: ids };
      }
      return { candidates: cands, storedIds: [] };
    }
    case 'memory_context': {
      return { ...(await assembleContext(store, a)), engine: store.engine() };
    }
    case 'memory_list': {
      const st = String(a.store ?? '');
      if (st === 'semantic') return { store: st, rows: await store.listFacts(a) };
      if (st === 'episodic') return { store: st, rows: await store.listEpisodes(a) };
      if (st === 'procedural') return { store: st, rows: await store.listSkills(a) };
      if (st === 'working') return { store: st, rows: await store.allWorking() };
      if (st === 'sessions') return { store: st, rows: await store.allSessions() };
      throw new Error('unknown store (want semantic|episodic|procedural|working|sessions)');
    }
    case 'memory_get': {
      const st = String(a.store ?? '');
      const id = a.store === 'working' || a.store === 'sessions' ? String(a.id ?? '') : Number(a.id);
      if (st === 'semantic') return { row: await store.getFact(id) };
      if (st === 'episodic') {
        const row = await store.getEpisode(id);
        return { row };
      }
      if (st === 'procedural') return { row: await store.getSkill(id) };
      if (st === 'working') return { row: id ? await store.getWorking(id) : null };
      if (st === 'sessions') return { row: id ? await store.getSession(id) : null };
      throw new Error('unknown store (want semantic|episodic|procedural|working|sessions)');
    }
    case 'memory_update': {
      const st = String(a.store ?? '');
      const patch = a.patch && typeof a.patch === 'object' ? a.patch : {};
      if (st === 'semantic') {
        const id = Number(a.id);
        if (!Number.isInteger(id)) throw new Error('missing id');
        const p = {};
        if (typeof patch.text === 'string' && patch.text.trim()) p.text = patch.text.trim().slice(0, 500);
        if (typeof patch.subject === 'string') p.subject = patch.subject.trim().slice(0, 80) || null;
        if (typeof patch.confidence === 'number' && Number.isFinite(patch.confidence)) {
          p.confidence = Math.min(1, Math.max(0, patch.confidence));
        }
        if (typeof patch.source === 'string' && patch.source.trim()) {
          p.source = patch.source.trim().slice(0, 160);
          // Relabeling the source must not launder trust: non-user actors
          // can never lift a fact above its current trust; the user (explicit
          // edit = endorsement) may set whatever the new source allows.
          const current = await store.getFact(id);
          const candidate = trustOf(p.source, patch.sourceTrust);
          p.source_trust = actor === 'user' || current?.sourceTrust === 'trusted' ? candidate : 'untrusted';
        } else if (patch.sourceTrust === 'untrusted') {
          p.source_trust = 'untrusted'; // anyone may downgrade
        }
        if (patch.status === 'active' || patch.status === 'flagged') p.status = patch.status;
        if (typeof patch.pinned === 'boolean') p.pinned = patch.pinned ? 1 : 0;
        const ok = await store.updateFact(id, p);
        if (ok) await store.logWrite({ store: 'semantic', op: 'update', refId: String(id), actor, summary: `fields: ${Object.keys(p).join(',')}` });
        return { id, updated: ok };
      }
      if (st === 'procedural') {
        const id = Number(a.id);
        if (!Number.isInteger(id)) throw new Error('missing id');
        const p = {};
        if (typeof patch.name === 'string' && patch.name.trim()) p.name = patch.name.trim().slice(0, 120);
        if (typeof patch.trigger === 'string' && patch.trigger.trim()) p.trigger = patch.trigger.trim().slice(0, 300);
        if (patch.steps && typeof patch.steps === 'object') p.steps = JSON.stringify(patch.steps).slice(0, 4000);
        if (patch.status === 'candidate' || patch.status === 'active' || patch.status === 'retired') p.status = patch.status;
        const ok = await store.updateSkill(id, p);
        if (ok) await store.logWrite({ store: 'procedural', op: 'update', refId: String(id), actor, summary: `fields: ${Object.keys(p).join(',')}` });
        return { id, updated: ok };
      }
      if (st === 'episodic') {
        const id = Number(a.id);
        if (!Number.isInteger(id)) throw new Error('missing id');
        const p = {};
        if (typeof patch.text === 'string' && patch.text.trim()) p.text = patch.text.trim().slice(0, 4000);
        if (typeof patch.summary === 'string') p.summary = patch.summary.trim().slice(0, 500) || null;
        if (typeof patch.importance === 'number' && Number.isFinite(patch.importance)) p.importance = Math.min(1, Math.max(0, patch.importance));
        const ok = await store.updateEpisode(id, p);
        if (ok) await store.logWrite({ store: 'episodic', op: 'update', refId: String(id), actor, summary: `fields: ${Object.keys(p).join(',')}` });
        return { id, updated: ok };
      }
      throw new Error('memory_update supports semantic|procedural|episodic (working writes go through memory_working_put)');
    }
    case 'memory_delete': {
      const st = String(a.store ?? '');
      let ok = false;
      if (st === 'semantic') ok = await store.deleteFact(Number(a.id));
      else if (st === 'episodic') ok = await store.deleteEpisode(Number(a.id));
      else if (st === 'procedural') ok = await store.deleteSkill(Number(a.id));
      else if (st === 'working') ok = await store.deleteWorking(String(a.id ?? ''));
      else throw new Error('unknown store (want semantic|episodic|procedural|working)');
      await store.logWrite({ store: st, op: 'delete', refId: String(a.id ?? ''), actor, summary: ok ? 'deleted by user request' : 'not found' });
      return { deleted: ok };
    }
    case 'memory_export': {
      const includeVectors = a.includeVectors === true;
      const facts = await store.scanFacts(includeVectors);
      const episodes = await store.scanEpisodes(includeVectors);
      if (!includeVectors) {
        for (const r of [...facts, ...episodes]) delete r.embedding;
      }
      return {
        exportedAt: Date.now(),
        engine: store.engine(),
        counts: await store.counts(),
        facts, episodes,
        skills: await store.allSkills(),
        working: await store.allWorking(),
        sessions: await store.allSessions(),
      };
    }
    case 'memory_writes': {
      return { writes: await store.recentWrites(a.limit) };
    }
    case 'memory_counts': {
      return { counts: await store.counts(), engine: store.engine() };
    }
    case 'memory_consolidate': {
      const r = await runConsolidation(store, { force: a.force === true, actor });
      if (r.runId) await store.logWrite({ store: '*', op: 'consolidate', refId: String(r.runId), actor, summary: JSON.stringify(r.stats).slice(0, 140) });
      return r;
    }
    default: throw new Error(`Unsupported memory action ${action}`);
  }
}
