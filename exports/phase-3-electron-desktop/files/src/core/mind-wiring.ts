/**
 * core/mind-wiring.ts — connect the Phase 2 mind (Memory · Soul · Skills) to
 * the running organism. Client-only: imported once from `App.tsx`.
 *
 *   - Installs the Skills guard on the tool registry (disabled skills refuse
 *     voice + chat invocations with `skill_disabled`).
 *   - Records skill usage from the registry's `tool:lifecycle` events.
 *   - Syncs Memory/Soul with the companion daemon when the link is up:
 *     pull first, adopt newer remotes, push the local copy otherwise.
 *   - Refreshes the companion half of the Skills catalogue.
 */

import { toolRegistry } from '../tools/registry';
import { controlLayer } from '../sophia/control';
import type { ToolLifecyclePayload } from '../tools/types';
import { memoryStore } from './MemoryStore';
import { soulStore } from './Soul';
import { skillsRegistry } from './SkillsRegistry';

let wired = false;

async function syncMindWithCompanion(): Promise<void> {
  try {
    const { companion } = await import('../lib/companion-client');
    if (!companion.connected) return;
    // Memory: adopt the newer side, then make sure the daemon holds a copy.
    try {
      const mem = await memoryStore.pullFromCompanion();
      if (mem.ok && (!mem.found || !mem.adopted)) await memoryStore.pushToCompanion();
    } catch {
      /* link flapped mid-sync — next status event retries */
    }
    // Soul: same newest-wins dance.
    try {
      const soul = await soulStore.pullFromCompanion();
      if (soul.ok && (!soul.found || !soul.adopted)) await soulStore.pushToCompanion();
    } catch {
      /* link flapped mid-sync — next status event retries */
    }
    // Skills: the daemon's live action list merges into the catalogue.
    try {
      await skillsRegistry.refreshFromCompanion();
    } catch {
      /* non-fatal */
    }
  } catch {
    /* companion client unavailable (SSR) — stay local-only */
  }
}

export function wireMind(): void {
  if (wired) return;
  wired = true;

  toolRegistry.guard = (name: string) => skillsRegistry.isEnabled(name);

  controlLayer.addEventListener('tool:lifecycle', (e: Event) => {
    const detail = (e as CustomEvent<ToolLifecyclePayload>).detail;
    if (detail?.type === 'TOOL_RESULT' && detail.tool) {
      try {
        skillsRegistry.recordUse(detail.tool);
      } catch {
        /* stats must never break a tool call */
      }
    }
  });

  void (async () => {
    try {
      const { companion } = await import('../lib/companion-client');
      companion.addEventListener('status', () => void syncMindWithCompanion());
      if (companion.connected) void syncMindWithCompanion();
      else void autoPairDesktop();
    } catch {
      /* companion client unavailable (SSR) — stay local-only */
    }
  })();
}

/**
 * Desktop auto-pair: under the Electron shell the preload bridge already
 * holds the companion token+port, so connect on boot (one retry while the
 * managed daemon finishes starting). Plain browsers have no bridge and
 * skip this silently.
 */
async function autoPairDesktop(): Promise<void> {
  try {
    if (typeof window === 'undefined' || !window.sophiaDesktop) return;
    const { companion } = await import('../lib/companion-client');
    if (companion.connected) return;
    const ok = await companion.connect();
    if (!ok) {
      await new Promise((r) => setTimeout(r, 2500));
      if (!companion.connected) await companion.connect();
    }
  } catch {
    /* auto-pair is best-effort — manual pairing still works */
  }
}
