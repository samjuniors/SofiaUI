/**
 * settings/BrainSection.tsx — "Brain & LLM Intelligence".
 * Extracted verbatim from SettingsSheet (Phase 22 split).
 */

import { useState } from 'react';
import { controlLayer } from '../../sophia/control';
import { AccordionSection } from './controls';
import { BRAIN_OPTIONS } from './voice-data';

export function BrainSection({
  serverStatus,
  isOpen,
  onToggle,
}: {
  serverStatus: any;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  return (
    <AccordionSection
      title="Brain & LLM Intelligence"
      badge={controlLayer.brainMode.toUpperCase()}
      isOpen={isOpen}
      onToggle={onToggle}
    >
      <div>
        <p className="mb-2 text-[9px] font-normal uppercase tracking-[0.24em] text-white/40">Brain Provider</p>
        <select
          value={controlLayer.brainMode}
          onChange={(e) => {
            controlLayer.brainMode = e.target.value as any;
            controlLayer.saveControlPrefs();
            rerender();
          }}
          className="w-full rounded-lg border border-white/10 bg-[#080d1a] px-2.5 py-1.5 text-[11px] text-white/90 outline-none focus:border-sky-400"
        >
          {BRAIN_OPTIONS.map((b) => (
            <option key={b.id} value={b.id} className="bg-[#080d1a] text-white">
              {b.label}
            </option>
          ))}
        </select>
      </div>

      {/* Ollama Local LLM Configuration */}
      {(controlLayer.brainMode === 'ollama' || controlLayer.brainMode === 'auto') && (
        <div className="space-y-2 rounded-xl border border-emerald-500/20 bg-emerald-950/15 p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-[0.2em] text-emerald-300/80">Ollama Local Config</span>
            <span className="font-mono text-[8px] text-emerald-400/70">Port 11434</span>
          </div>
          <div>
            <p className="mb-1 text-[8.5px] text-white/40">Model Name</p>
            <input
              type="text"
              placeholder="e.g. ornith-1.5:9b, gemma4:cloud, llama3.2"
              value={controlLayer.ollamaModel}
              onChange={(e) => {
                controlLayer.ollamaModel = e.target.value;
                controlLayer.saveControlPrefs();
                rerender();
              }}
              className="w-full rounded-lg border border-white/10 bg-[#080d1a] px-2.5 py-1 text-[11px] font-mono text-emerald-200 outline-none focus:border-emerald-400"
            />
          </div>
          <div>
            <p className="mb-1 text-[8.5px] text-white/40">Ollama Server Endpoint</p>
            <input
              type="text"
              placeholder="http://localhost:11434"
              value={controlLayer.ollamaUrl}
              onChange={(e) => {
                controlLayer.ollamaUrl = e.target.value;
                controlLayer.saveControlPrefs();
                rerender();
              }}
              className="w-full rounded-lg border border-white/10 bg-[#080d1a] px-2.5 py-1 text-[11px] font-mono text-white/80 outline-none focus:border-emerald-400"
            />
          </div>
        </div>
      )}

      {/* LM Studio Local Configuration */}
      {controlLayer.brainMode === 'lmstudio' && (
        <div className="space-y-2 rounded-xl border border-violet-500/20 bg-violet-950/15 p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-[0.2em] text-violet-300/80">LM Studio Config</span>
            <span className="font-mono text-[8px] text-violet-400/70">Port 1234</span>
          </div>
          <div>
            <p className="mb-1 text-[8.5px] text-white/40">LM Studio Endpoint</p>
            <input
              type="text"
              placeholder="http://localhost:1234/v1"
              value={controlLayer.lmStudioUrl}
              onChange={(e) => {
                controlLayer.lmStudioUrl = e.target.value;
                controlLayer.saveControlPrefs();
                rerender();
              }}
              className="w-full rounded-lg border border-white/10 bg-[#080d1a] px-2.5 py-1 text-[11px] font-mono text-white/80 outline-none focus:border-violet-400"
            />
          </div>
        </div>
      )}

      {/* Backend Key Status */}
      {serverStatus && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2">
          <p className="mb-1 text-[8.5px] uppercase tracking-wider text-white/40">Provider Keys in Environment</p>
          <div className="flex flex-wrap gap-1 font-mono text-[8px]">
            <span className={`px-1.5 py-0.5 rounded ${serverStatus.elevenlabs ? 'bg-sky-500/20 text-sky-300' : 'bg-rose-500/10 text-rose-300/60'}`}>
              ElevenLabs: {serverStatus.elevenlabs ? 'Configured' : 'Missing'}
            </span>
            <span className={`px-1.5 py-0.5 rounded ${serverStatus.deepgram ? 'bg-sky-500/20 text-sky-300' : 'bg-rose-500/10 text-rose-300/60'}`}>
              Deepgram: {serverStatus.deepgram ? 'Configured' : 'Missing'}
            </span>
            <span className={`px-1.5 py-0.5 rounded ${serverStatus.gemini ? 'bg-sky-500/20 text-sky-300' : 'bg-rose-500/10 text-rose-300/60'}`}>
              Gemini: {serverStatus.gemini ? 'Configured' : 'Missing'}
            </span>
            <span className={`px-1.5 py-0.5 rounded ${serverStatus.xai ? 'bg-sky-500/20 text-sky-300' : 'bg-white/5 text-white/30'}`}>
              Grok: {serverStatus.xai ? 'Configured' : 'Unset'}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
              Ollama: Local Ready
            </span>
          </div>
        </div>
      )}
    </AccordionSection>
  );
}
