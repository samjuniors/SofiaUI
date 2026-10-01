/**
 * ui/HandsCard.tsx — Phase 15: "why can't voice move the mouse?", answered
 * at a glance. Shows the three gates between a voice command and the real
 * PC (cloud brain with tools, Computer skill switch, companion link) plus
 * a safe read-only test that reads the cursor without moving anything.
 */

import { useEffect, useState } from 'react';
import { Hand, Loader2 } from 'lucide-react';
import { companion } from '../lib/companion-client';
import { skillsRegistry } from '../core/SkillsRegistry';
import { toolRegistry } from '../tools/registry';
import { airplaneMode } from '../lib/airplane-mode';
import { loadVoiceMode } from '../lib/voice-router';

function Dot({ ok }: { ok: boolean }) {
  return <span className={`block size-2 shrink-0 rounded-full ${ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />;
}

export function HandsCard() {
  const [, setV] = useState(0);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    const bump = () => setV((n) => n + 1);
    companion.addEventListener('status', bump);
    skillsRegistry.addEventListener('change', bump);
    airplaneMode.addEventListener('change', bump);
    return () => {
      companion.removeEventListener('status', bump);
      skillsRegistry.removeEventListener('change', bump);
      airplaneMode.removeEventListener('change', bump);
    };
  }, []);

  const local = airplaneMode.enabled || loadVoiceMode() === 'local';
  const skillOn = skillsRegistry.isEnabled('computer');
  const linked = companion.connected;

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const r = (await toolRegistry.invoke({ name: 'computer', args: { action: 'cursor' } })) as Record<
        string,
        unknown
      >;
      if (r && typeof r === 'object' && 'error' in r) {
        setResult(`FAIL: ${String(r.detail ?? r.error)}`);
      } else {
        const x = r?.x;
        const y = r?.y;
        setResult(
          typeof x === 'number' && typeof y === 'number'
            ? `OK: cursor at ${x}, ${y} — hands work.`
            : `OK: ${JSON.stringify(r).slice(0, 120)}`,
        );
      }
    } catch (e) {
      setResult(`FAIL: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[9px]">
          <Hand size={12} className="shrink-0 text-sky-300/80" />
          <span className="text-white/70">Hands check — voice → mouse + keys</span>
        </div>
        <button
          type="button"
          onClick={() => void runTest()}
          disabled={testing}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-sky-400/30 bg-sky-400/10 px-2.5 py-1 text-[9px] font-medium text-sky-200 hover:bg-sky-400/20 disabled:opacity-50"
        >
          {testing ? <Loader2 size={12} className="animate-spin" /> : null}
          {testing ? 'Testing…' : 'Test hands (safe)'}
        </button>
      </div>
      <div className="mt-2 space-y-1.5 font-mono text-[8.5px]">
        <div className="flex items-center gap-2">
          <Dot ok={!local} />
          <span className="text-white/50">
            Voice brain: {local ? 'LOCAL — voice has no tools here' : 'cloud — tools available'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Dot ok={skillOn} />
          <span className="text-white/50">
            Computer skill: {skillOn ? 'on' : 'OFF — enable in Settings → Skills'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Dot ok={linked} />
          <span className="text-white/50">
            Companion:{' '}
            {linked
              ? `linked :${companion.info.port} · ${companion.info.actions ?? 0} actions`
              : `offline — ${companion.lastError || 'pair from the banner'}`}
          </span>
        </div>
        {result && (
          <p
            role="status"
            className={`truncate rounded-lg border px-2 py-1.5 ${
              result.startsWith('OK')
                ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200'
                : 'border-amber-400/25 bg-amber-500/10 text-amber-100'
            }`}
            title={result}
          >
            {result}
          </p>
        )}
      </div>
      {!local && skillOn && linked && (
        <p className="mt-2 text-[8.5px] leading-snug text-white/35">
          All green — say “move the mouse a little to the right”. If she says she can’t, fully reload
          the page: the voice session may still hold older tools.
        </p>
      )}
    </div>
  );
}
