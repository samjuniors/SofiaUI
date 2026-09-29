/**
 * ui/AirplanePanel.tsx — fully-local voice at a glance (Phase 8–9 UI).
 *
 * Airplane toggle, per-leg readiness lights, the Auto/Cloud/Local routing
 * segment with its resolved chain, and Test voice / Test brain buttons.
 * Lives in Settings → Ear & Mouth (Voice System).
 */
import { useEffect, useState } from 'react';
import { Loader2, Plane, RotateCw, Vibrate, Brain } from 'lucide-react';
import { airplaneMode, type Readiness } from '../lib/airplane-mode';
import {
  describeChain,
  loadVoiceMode,
  planRoutes,
  routeInputFrom,
  saveVoiceMode,
  type StatusLike,
  type VoiceMode,
} from '../lib/voice-router';

const MODES: Array<{ id: VoiceMode; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'cloud', label: 'Cloud' },
  { id: 'local', label: 'Local' },
];

function Light({ on, label, hint }: { on: boolean; label: string; hint?: string }) {
  return (
    <div className="flex items-center gap-1.5" title={hint}>
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 rounded-full ${on ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-white/20'}`}
      />
      <span className={`text-[10px] ${on ? 'text-white/75' : 'text-white/40'}`}>{label}</span>
      {!on && hint && <span className="min-w-0 flex-1 truncate text-[9px] text-white/30">{hint}</span>}
    </div>
  );
}

export function AirplanePanel({ serverStatus }: { serverStatus: StatusLike | null }) {
  const [airplane, setAirplane] = useState(airplaneMode.enabled);
  const [mode, setMode] = useState<VoiceMode>(() => loadVoiceMode());
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [probing, setProbing] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [brainBusy, setBrainBusy] = useState(false);
  const [voiceResult, setVoiceResult] = useState<string | null>(null);
  const [brainResult, setBrainResult] = useState<string | null>(null);

  useEffect(() => {
    const onChange = () => setAirplane(airplaneMode.enabled);
    airplaneMode.addEventListener('change', onChange);
    return () => airplaneMode.removeEventListener('change', onChange);
  }, []);

  async function probe() {
    setProbing(true);
    try {
      setReadiness(await airplaneMode.readiness());
    } finally {
      setProbing(false);
    }
  }

  useEffect(() => {
    void probe();
  }, []);

  function pickMode(next: VoiceMode) {
    setMode(next);
    saveVoiceMode(next);
  }

  async function testVoice() {
    setVoiceBusy(true);
    setVoiceResult(null);
    try {
      const r = await airplaneMode.speakLocal('G’day — local voice check, over.');
      setVoiceResult(`Spoke via ${r.engine} in ${r.ms}ms.`);
    } catch (err) {
      setVoiceResult(err instanceof Error ? err.message : 'Voice test failed.');
    } finally {
      setVoiceBusy(false);
    }
  }

  async function testBrain() {
    setBrainBusy(true);
    setBrainResult(null);
    try {
      const reply = await airplaneMode.askLocalBrain('Reply with exactly: OK');
      setBrainResult(`Brain answered: ${reply.slice(0, 140)}`);
    } catch (err) {
      setBrainResult(err instanceof Error ? err.message : 'Brain test failed.');
    } finally {
      setBrainBusy(false);
    }
  }

  const chain = readiness
    ? describeChain(planRoutes(routeInputFrom(serverStatus, readiness, mode, airplane)))
    : 'Probing local legs…';

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-2.5">
      {/* Airplane toggle + refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`grid size-6 place-items-center rounded-lg ${airplane ? 'bg-amber-500/20 text-amber-300' : 'bg-white/5 text-white/50'}`}>
            <Plane size={13} />
          </span>
          <div>
            <p className="text-[10px] font-normal uppercase tracking-[0.2em] text-white/70">Airplane mode</p>
            <p className="text-[8.5px] font-light text-white/35">100% on-device voice, no cloud</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Refresh local readiness"
            disabled={probing}
            onClick={() => void probe()}
            className="rounded-md border border-white/10 bg-white/5 p-1.5 text-white/60 transition-colors hover:text-white disabled:opacity-50"
          >
            <RotateCw size={12} className={probing ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={airplane}
            aria-label="Airplane mode"
            onClick={() => airplaneMode.setEnabled(!airplane)}
            className={`relative h-5 w-9 rounded-full border transition-colors duration-200 ${
              airplane ? 'border-amber-400/50 bg-amber-400/30' : 'border-white/10 bg-white/5'
            }`}
          >
            <span
              className={`block size-3.5 rounded-full transition-transform duration-200 ${
                airplane ? 'translate-x-4 bg-amber-300' : 'translate-x-0.5 bg-white/40'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Readiness lights */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border border-white/[0.06] bg-black/30 p-2">
        {readiness === null && probing && (
          <p className="col-span-2 flex items-center gap-1.5 text-[10px] text-white/40">
            <Loader2 size={11} className="animate-spin" /> Probing companion, engines, brain…
          </p>
        )}
        {readiness && (
          <>
            <Light on={readiness.companion} label="Companion" hint="Start companion/server.mjs" />
            <Light on={readiness.tts} label="TTS" hint={readiness.ttsHint} />
            <Light on={readiness.stt} label="STT" hint={readiness.sttHint} />
            <Light on={readiness.brain} label="Brain" hint={readiness.brainHint} />
          </>
        )}
      </div>

      {/* Routing segment + resolved chain */}
      <div>
        <p className="mb-1.5 text-[9px] font-normal uppercase tracking-[0.24em] text-white/40">Voice routing</p>
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1" role="radiogroup" aria-label="Voice routing mode">
          {MODES.map((m) => {
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => pickMode(m.id)}
                className={`rounded-lg px-1 py-1.5 text-[11px] font-medium transition-colors ${
                  active ? 'bg-sky-500/25 text-sky-100' : 'text-white/50 hover:bg-white/[0.06] hover:text-white'
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1 truncate font-mono text-[10px] text-sky-200/70" title={chain}>
          {chain}
        </p>
      </div>

      {/* Self tests */}
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          disabled={voiceBusy}
          onClick={() => void testVoice()}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-white/75 transition-colors hover:text-white disabled:opacity-50"
        >
          {voiceBusy ? <Loader2 size={12} className="animate-spin" /> : <Vibrate size={12} />}
          Test voice
        </button>
        <button
          type="button"
          disabled={brainBusy}
          onClick={() => void testBrain()}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-white/75 transition-colors hover:text-white disabled:opacity-50"
        >
          {brainBusy ? <Loader2 size={12} className="animate-spin" /> : <Brain size={12} />}
          Test brain
        </button>
      </div>
      {(voiceResult || brainResult) && (
        <div className="flex flex-col gap-0.5">
          {voiceResult && <p className="truncate text-[10px] text-white/55" title={voiceResult}>Voice · {voiceResult}</p>}
          {brainResult && <p className="truncate text-[10px] text-white/55" title={brainResult}>Brain · {brainResult}</p>}
        </div>
      )}
    </div>
  );
}
