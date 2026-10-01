/**
 * settings/EnvSection.tsx — "Environment & Gemini Live Setup".
 * Extracted verbatim from SettingsSheet (Phase 22 split).
 */

import { useState } from 'react';
import type { SophiaOS } from '../../sophia/SophiaOS';
import { controlLayer } from '../../sophia/control';
import { AccordionSection, ToggleRow } from './controls';

export function EnvSection({
  os,
  serverStatus,
  isOpen,
  onToggle,
}: {
  os: SophiaOS;
  serverStatus: any;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  return (
    <AccordionSection
      title="Environment & Gemini Live Setup"
      badge={controlLayer.pureGeminiLive ? 'Pure Gemini' : 'Configured'}
      isOpen={isOpen}
      onToggle={onToggle}
    >
      {/* Pure Gemini Live Master Mode */}
      <div className="space-y-2.5 rounded-xl border border-sky-400/40 bg-gradient-to-b from-sky-950/40 to-sky-950/10 p-3 shadow-[0_0_16px_rgba(var(--th-glow),0.15)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="block size-2 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(var(--th-glow),0.9)] animate-pulse" />
            <span className="text-[10px] uppercase tracking-[0.2em] font-semibold text-sky-200">
              Pure Gemini Live API Mode
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={controlLayer.pureGeminiLive}
            onClick={() => {
              const next = !controlLayer.pureGeminiLive;
              controlLayer.setPureGeminiLive(next);
              if (next) {
                os.savePrefs({ provider: 'gemini-live' });
              }
              rerender();
            }}
            className={`relative h-5 w-9 rounded-full border transition-colors duration-200 ${
              controlLayer.pureGeminiLive
                ? 'border-sky-400/50 bg-sky-400/30 shadow-[0_0_10px_rgba(var(--th-glow),0.3)]'
                : 'border-white/10 bg-white/5'
            }`}
          >
            <span
              className={`block size-3.5 rounded-full transition-transform duration-200 ${
                controlLayer.pureGeminiLive
                  ? 'translate-x-4 bg-sky-300 shadow-[0_0_6px_rgba(var(--th-glow-soft),0.8)]'
                  : 'translate-x-0.5 bg-white/40'
              }`}
            />
          </button>
        </div>

        <p className="text-[8.5px] leading-relaxed text-sky-200/80">
          Uses the Gemini Live API key for microphone streaming, brain reasoning, and voice output across the application. External split backends are bypassed.
        </p>

        <div className="flex items-center justify-between pt-1 border-t border-sky-400/15">
          <span className="text-[8.5px] font-mono text-sky-300/70">Model: models/gemini-3.8-live</span>
          <button
            type="button"
            onClick={() => {
              void os.resetGeminiLiveSession();
              rerender();
            }}
            className="rounded-lg border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-[8.5px] font-medium text-sky-200 hover:bg-sky-400/20 active:scale-95"
          >
            Reset & Reconnect
          </button>
        </div>
      </div>

      {/* ASR Voice Interruption (Barge-In) Card */}
      <div className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 shadow-[0_0_12px_rgba(16,185,129,0.1)]">
        <ToggleRow
          label="ASR Barge-in Interruption"
          hint="When you speak into the microphone, immediately cut off Sophia's current voice playback so you can interrupt live."
          on={controlLayer.asrInterruption}
          onChange={(on) => {
            controlLayer.asrInterruption = on;
            controlLayer.saveControlPrefs();
            rerender();
          }}
        />
      </div>

      {/* Environment Status Summary */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2.5 font-mono text-[8.5px] space-y-1">
        <div className="flex justify-between text-white/60">
          <span>API Protocol</span>
          <span className="text-sky-300">WebSocket Bidi (PCM16)</span>
        </div>
        <div className="flex justify-between text-white/60">
          <span>Environment Key</span>
          <span className={serverStatus?.gemini ? 'text-emerald-400' : 'text-amber-400'}>
            {serverStatus?.gemini ? 'GEMINI_API_KEY Configured' : 'Checking Key...'}
          </span>
        </div>
      </div>
    </AccordionSection>
  );
}
