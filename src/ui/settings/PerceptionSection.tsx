/**
 * settings/PerceptionSection.tsx — "Multimodal Vision & Decision Engine".
 * Extracted verbatim from SettingsSheet (Phase 22 split).
 */

import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { screenVisionBridge } from '../../sophia/vision/ScreenVisionBridge';
import { decisionEngine, type PreferredMusicSource } from '../../sophia/decision-engine';
import { AccordionSection } from './controls';

export function PerceptionSection({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
  const [visionActive, setVisionActive] = useState(screenVisionBridge.active);
  const [prefMusic, setPrefMusic] = useState<PreferredMusicSource>(decisionEngine.getPreferredMusic());

  useEffect(() => {
    const handleVision = (e: Event) => {
      setVisionActive(Boolean((e as CustomEvent).detail?.active));
    };
    screenVisionBridge.addEventListener('vision:state', handleVision);
    return () => screenVisionBridge.removeEventListener('vision:state', handleVision);
  }, []);

  return (
    <AccordionSection
      title="Multimodal Vision & Decision Engine"
      badge={visionActive ? 'Vision Live' : 'Smart'}
      isOpen={isOpen}
      onToggle={onToggle}
    >
      {/* Screen Vision (Visual Perception) Card */}
      <div className={`space-y-2.5 rounded-xl border p-3 transition-colors ${
        visionActive
          ? 'border-emerald-500/40 bg-emerald-950/30 shadow-[0_0_16px_rgba(16,185,129,0.15)]'
          : 'border-white/10 bg-white/[0.03]'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`block size-2 rounded-full ${
              visionActive ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-pulse' : 'bg-neutral-500'
            }`} />
            <span className="text-[10px] uppercase tracking-[0.2em] font-semibold text-white/90">
              Real-Time Screen Vision
            </span>
          </div>
          <button
            type="button"
            onClick={() => void screenVisionBridge.toggleCapture()}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[9px] font-semibold transition-all ${
              visionActive
                ? 'border-rose-500/40 bg-rose-950/30 text-rose-300 hover:bg-rose-950/50'
                : 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-950/50'
            }`}
          >
            {visionActive ? <EyeOff size={11} /> : <Eye size={11} />}
            <span>{visionActive ? 'Stop Sharing' : 'Share Screen'}</span>
          </button>
        </div>

        <p className="text-[8.5px] leading-relaxed text-white/60">
          Pipes display video frames at 1 fps into the Gemini Live multimodal session so Sofia sees your active windows, code, errors, and tabs in real time.
        </p>
      </div>

      {/* Smart Music Decision Routing */}
      <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <p className="text-[9px] font-normal uppercase tracking-[0.24em] text-white/40">Preferred Music Experience</p>
        <div className="grid grid-cols-2 gap-1.5 pt-1">
          {(
            [
              { id: 'smart', label: 'Smart Decision', desc: 'In-app ambient for study, Spotify/YT for songs' },
              { id: 'inapp', label: 'In-App Soundscape', desc: 'Always play ambient audio inside Sofia' },
              { id: 'spotify', label: 'Spotify', desc: 'Open Spotify web/app for music queries' },
              { id: 'youtube', label: 'YouTube Music', desc: 'Open YouTube video/music player' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                decisionEngine.setPreferredMusic(opt.id);
                setPrefMusic(opt.id);
              }}
              className={`rounded-lg border p-2 text-left transition-all ${
                prefMusic === opt.id
                  ? 'border-sky-400/50 bg-sky-400/10 text-sky-200 shadow-[0_0_10px_rgba(var(--th-glow),0.2)]'
                  : 'border-white/5 bg-white/[0.02] text-white/50 hover:bg-white/[0.05] hover:text-white/80'
              }`}
            >
              <p className="font-mono text-[9px] font-semibold text-white/90">{opt.label}</p>
              <p className="text-[7.5px] text-white/40 leading-tight mt-0.5">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </AccordionSection>
  );
}
