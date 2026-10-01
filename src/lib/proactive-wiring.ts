/**
 * lib/proactive-wiring.ts — connect the AmbientScheduler to the organism.
 *
 * Client-only, called once from `App.tsx` next to `wireMind()`:
 *   - healthCheck → companion `health_snapshot` (via daily-skills)
 *   - briefing   → a composed morning card (date, health, link state)
 *   - alert      → toast notification + info card via controlLayer
 *   - companion (re)connect → an immediate scheduling pass, so the first
 *     health check lands once the link is actually up
 */

import { ambientScheduler } from '../sophia/AmbientScheduler';
import { controlLayer } from '../sophia/control';
import { healthSnapshot } from './daily-skills';

let wired = false;

function notify(title: string, body: string, level: 'info' | 'warning'): void {
  const firstLine = body.split('\n')[0]?.slice(0, 140) || title;
  try {
    controlLayer.dispatchEvent(
      new CustomEvent('command:notification', {
        detail: { message: `${title}: ${firstLine}`, level, duration: 7000 },
      }),
    );
    controlLayer.dispatchEvent(
      new CustomEvent('command:info_card', {
        detail: { open: true, title, content: body, type: 'info' },
      }),
    );
  } catch {
    /* alerts must never break the scheduler */
  }
}

async function buildBriefing(): Promise<string> {
  const lines: string[] = [];
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  lines.push(`Good morning — ${today}.`);
  try {
    const snap = await healthSnapshot();
    lines.push(`PC health ${snap.score}/100 · CPU ${snap.cpu.loadPct}% · RAM ${snap.memory.usedPct}%.`);
    for (const w of snap.warnings.slice(0, 3)) lines.push(`• ${w}`);
    if (snap.score < 70) lines.push('Worth a look when you have a minute.');
    else if (snap.warnings.length === 0) lines.push('All quiet on the machine front.');
  } catch {
    lines.push('The companion is unreachable, so no PC health today.');
  }
  return lines.join('\n');
}

export function wireProactive(): void {
  if (wired) return;
  wired = true;

  ambientScheduler.setHandlers({
    healthCheck: async () => {
      const snap = await healthSnapshot();
      return { score: snap.score, warnings: snap.warnings };
    },
    briefing: buildBriefing,
    consolidate: async () => {
      // Nightly dream via the daemon. Companion down → throw → the
      // scheduler records lastError and backs off to the next slot.
      const { runConsolidationNow } = await import('./memory.ts');
      const r = await runConsolidationNow();
      const s = r.stats ?? {};
      return {
        merged: s.merged ?? 0,
        resolved: s.resolved ?? 0,
        flagged: s.flagged ?? 0,
        skillsProposed: s.skillsProposed ?? 0,
        skipped: r.skipped,
      };
    },
    alert: (title, body, level) => notify(title, body, level),
  });
  ambientScheduler.start();

  // The link is usually still pairing at boot — catch up when it lands.
  void (async () => {
    try {
      const { companion } = await import('./companion-client');
      companion.addEventListener('status', () => {
        if (companion.connected) void ambientScheduler.tick();
      });
      if (companion.connected) void ambientScheduler.tick();
    } catch {
      /* companion client unavailable (SSR) — the 30s ticks still run */
    }
  })();
}
