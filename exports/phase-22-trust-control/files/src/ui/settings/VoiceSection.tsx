/**
 * settings/VoiceSection.tsx — "Ear & Mouth (Voice System)".
 * Extracted verbatim from SettingsSheet (Phase 22 split).
 */

import { useEffect, useState } from 'react';
import { ChevronDown, Music, Volume2 } from 'lucide-react';
import type { ProviderPref, SophiaOS } from '../../sophia/SophiaOS';
import { controlLayer } from '../../sophia/control';
import { scoreEngine } from '../../sophia/audio/ScoreEngine';
import { userVoiceProfile } from '../../core/UserVoiceProfile';
import { sophiaFetch } from '../../lib/sophia-fetch.ts';
import { AirplanePanel } from '../AirplanePanel';
import { WakeWordBlock } from '../WakeWordBlock';
import { AccordionSection, SegRow, ToggleRow } from './controls';
import { DEEPGRAM_VOICES, DEFAULT_ELEVENLABS_VOICES, GEMINI_VOICES, TTS_VOICE_PROFILES } from './voice-data';

export function VoiceSection({
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
  const p = os.prefs;

  const [elevenVoices, setElevenVoices] = useState(DEFAULT_ELEVENLABS_VOICES);
  const [customVoiceId, setCustomVoiceId] = useState(controlLayer.elevenLabsVoiceId);
  const [isCustomSelected, setIsCustomSelected] = useState(
    !DEFAULT_ELEVENLABS_VOICES.some((v) => v.id === controlLayer.elevenLabsVoiceId && v.id !== 'custom'),
  );
  const [testingVoice, setTestingVoice] = useState(false);
  const [scoreEnabled, setScoreEnabled] = useState(scoreEngine.isEnabled);
  const [scoreAmbientLoop, setScoreAmbientLoop] = useState(scoreEngine.isAmbientLoopEnabled);
  const [scoreVolume, setScoreVolume] = useState(scoreEngine.getMasterVolume());

  useEffect(() => {
    sophiaFetch('/api/sophia/elevenlabs/voices')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.voices) && data.voices.length > 0) {
          const mapped = data.voices.map((v: any) => ({
            id: v.voice_id,
            label: `${v.name} (${v.voice_id.slice(0, 6)}…)`,
          }));
          mapped.push({ id: 'custom', label: 'Custom Voice ID…' });
          setElevenVoices(mapped);
        }
      })
      .catch(() => undefined);
  }, []);

  const handleVoiceProfileChange = (profileId: string) => {
    const prof = TTS_VOICE_PROFILES.find((p) => p.id === profileId);
    if (!prof) return;

    // Save in OS configuration (Prefs)
    os.savePrefs({ voiceProfile: profileId });

    // Update ControlLayer runtime parameters
    controlLayer.voiceProfile = profileId;
    controlLayer.voiceName = prof.geminiVoice;
    controlLayer.elevenLabsVoiceId = prof.elevenLabsVoiceId;
    controlLayer.dgVoice = prof.dgVoice;
    controlLayer.saveControlPrefs();

    setIsCustomSelected(false);
    rerender();
    void os.applyVoiceSettings();
  };

  const handleVoiceSelect = (id: string) => {
    if (id === 'custom') {
      setIsCustomSelected(true);
    } else {
      setIsCustomSelected(false);
      controlLayer.elevenLabsVoiceId = id;
      controlLayer.saveControlPrefs();
      rerender();
      void os.applyVoiceSettings();
    }
  };

  const handleCustomVoiceSubmit = (val: string) => {
    const trimmed = val.trim();
    setCustomVoiceId(trimmed);
    if (trimmed) {
      controlLayer.elevenLabsVoiceId = trimmed;
      controlLayer.saveControlPrefs();
      rerender();
      void os.applyVoiceSettings();
    }
  };

  return (
    <AccordionSection
      title="Ear & Mouth (Voice System)"
      badge={controlLayer.mouthProvider === 'elevenlabs' ? 'ElevenLabs' : 'Deepgram'}
      isOpen={isOpen}
      onToggle={onToggle}
    >
      {/* Hearing / Provider */}
      <SegRow<ProviderPref>
        label="Hearing & Voice Transport"
        value={controlLayer.pureGeminiLive ? 'gemini-live' : p.provider}
        onChange={(provider) => {
          if (controlLayer.pureGeminiLive && provider !== 'gemini-live') {
            controlLayer.setPureGeminiLive(false);
          }
          os.savePrefs({ provider });
          rerender();
        }}
        options={[
          { id: 'auto', label: 'Auto' },
          { id: 'gemini-live', label: 'Gemini' },
          { id: 'deepgram', label: 'Deepgram' },
          { id: 'elevenlabs', label: 'ElevenLabs' },
        ]}
      />

      {/* USER VOICE MEMORY & CROWD REJECTION */}
      <div className="space-y-2.5 rounded-xl border border-indigo-400/30 bg-indigo-950/20 p-3 shadow-[0_0_12px_rgba(99,102,241,0.12)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className={`block size-2 rounded-full ${userVoiceProfile.isEnrolled ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-amber-400 animate-pulse'}`} />
            <span className="text-[9.5px] uppercase tracking-[0.2em] font-medium text-indigo-200">User Voice Print & Memory</span>
          </div>
          <span className="font-mono text-[8px] text-indigo-300/80">
            {userVoiceProfile.isEnrolled ? 'Locked to Your Voice' : 'Learning Voice'}
          </span>
        </div>
        <p className="text-[8.5px] leading-relaxed text-white/60">
          {userVoiceProfile.isEnrolled
            ? `Sofia remembers your voice (Pitch: ~${Math.round(userVoiceProfile.profileData.f0Mean)} Hz, Confidence: ${Math.round(userVoiceProfile.profileData.confidence * 100)}%). She ignores surrounding crowd chatter and focuses only on you.`
            : 'Speak naturally into your microphone. Sofia learns and locks onto your voice characteristics so she ignores surrounding crowd chatter.'}
        </p>
        <div className="flex items-center justify-between pt-1">
          <ToggleRow
            label="Crowd Noise Rejection"
            hint="Listen and respond ONLY to your voice — ignore other people and crowd chatter."
            on={controlLayer.crowdFilterEnabled}
            onChange={(on) => {
              controlLayer.crowdFilterEnabled = on;
              controlLayer.saveControlPrefs();
              rerender();
            }}
          />
        </div>
        <div className="flex items-center gap-2 pt-1 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={() => {
              userVoiceProfile.resetProfile();
              controlLayer.dispatchEvent(new CustomEvent('command:notification', {
                detail: { message: 'Voice print cleared. Sofia will learn your voice again as you speak.', level: 'info' }
              }));
              rerender();
            }}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[8.5px] text-white/70 hover:bg-white/[0.08] active:scale-95"
          >
            Recalibrate / Re-enroll Voice
          </button>
        </div>
      </div>

      {/* TTS Voice Profile Selection */}
      <div className="space-y-2 rounded-xl border border-sky-400/30 bg-sky-950/25 p-2.5 shadow-[inset_0_0_12px_rgba(var(--th-glow),0.12)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="block size-1.5 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(var(--th-glow),0.8)]" />
            <span className="text-[9px] uppercase tracking-[0.2em] font-medium text-sky-200">TTS Voice Profile</span>
          </div>
          <span className="font-mono text-[8px] text-sky-300/80">
            {TTS_VOICE_PROFILES.find((vp) => vp.id === (p.voiceProfile || controlLayer.voiceProfile))?.accent ?? 'Configured'}
          </span>
        </div>
        <div className="relative">
          <select
            value={p.voiceProfile || controlLayer.voiceProfile || 'au-female'}
            onChange={(e) => handleVoiceProfileChange(e.target.value)}
            className="w-full appearance-none rounded-lg border border-sky-500/30 bg-[#080d1a] py-2 pl-2.5 pr-8 text-[11px] font-medium text-white shadow-[0_2px_8px_rgba(0,0,0,0.5)] outline-none transition focus:border-sky-400 focus:ring-1 focus:ring-sky-400"
          >
            {TTS_VOICE_PROFILES.map((vp) => (
              <option key={vp.id} value={vp.id} className="bg-[#080d1a] text-white">
                {vp.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sky-300/70" />
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <p className="text-[8.5px] leading-relaxed text-sky-200/70">
            {TTS_VOICE_PROFILES.find((vp) => vp.id === (p.voiceProfile || controlLayer.voiceProfile))?.description ??
              'Select voice personality and accent (Australian female, US male/female, British, etc.). Persisted in OS configuration.'}
          </p>
          <button
            type="button"
            onClick={async () => {
              setTestingVoice(true);
              try {
                await os.testVoice();
              } finally {
                setTestingVoice(false);
              }
            }}
            disabled={testingVoice}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-sky-400/30 bg-sky-500/15 px-2.5 py-1 text-[9.5px] font-medium text-sky-200 transition hover:border-sky-400/60 hover:bg-sky-500/25 active:scale-95 disabled:opacity-50"
            title="Play sample in selected voice"
          >
            <Volume2 size={12} className={testingVoice ? 'animate-pulse text-amber-300' : ''} />
            <span>{testingVoice ? 'Playing…' : 'Play Sample'}</span>
          </button>
        </div>
      </div>

      {/* Gemini Live Voice Selection */}
      <div className="space-y-2 rounded-xl border border-sky-500/20 bg-sky-950/15 p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[9px] uppercase tracking-[0.2em] text-sky-200/70">Gemini Live Voice</span>
          <span className="font-mono text-[8px] text-sky-300/60">
            {controlLayer.voiceName}
          </span>
        </div>
        <select
          value={controlLayer.voiceName}
          onChange={(e) => {
            controlLayer.voiceName = e.target.value;
            controlLayer.saveControlPrefs();
            rerender();
            void os.applyVoiceSettings();
          }}
          className="w-full rounded-lg border border-white/10 bg-[#080d1a] px-2.5 py-1.5 text-[11px] text-white/90 outline-none focus:border-sky-400"
        >
          {GEMINI_VOICES.map((v) => (
            <option key={v.id} value={v.id} className="bg-[#080d1a] text-white">
              {v.label}
            </option>
          ))}
        </select>
        <p className="text-[8.5px] text-white/40">
          Primary voice used for real-time live conversations with Gemini Live.
        </p>
      </div>

      {/* Speaking Mouth Engine */}
      <div>
        <p className="mb-2 text-[9px] font-normal uppercase tracking-[0.24em] text-white/40">Mouth TTS Engine</p>
        <div className="flex overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02] p-0.5">
          <button
            type="button"
            onClick={() => {
              controlLayer.mouthProvider = 'gemini';
              controlLayer.saveControlPrefs();
              rerender();
              void os.applyVoiceSettings();
            }}
            className={`h-7 flex-1 rounded-lg text-[9px] font-normal tracking-[0.08em] transition-all duration-200 ${
              controlLayer.mouthProvider === 'gemini' || controlLayer.mouthProvider === 'auto'
                ? 'border border-sky-400/30 bg-sky-400/[0.18] text-sky-100 shadow-[inset_0_0_10px_rgba(var(--th-glow),0.18)]'
                : 'text-white/45 hover:text-white/80'
            }`}
          >
            Gemini (Neural)
          </button>
          <button
            type="button"
            onClick={() => {
              controlLayer.mouthProvider = 'elevenlabs';
              controlLayer.saveControlPrefs();
              rerender();
              void os.applyVoiceSettings();
            }}
            className={`h-7 flex-1 rounded-lg text-[9px] font-normal tracking-[0.08em] transition-all duration-200 ${
              controlLayer.mouthProvider === 'elevenlabs'
                ? 'border border-sky-400/30 bg-sky-400/[0.18] text-sky-100 shadow-[inset_0_0_10px_rgba(var(--th-glow),0.18)]'
                : 'text-white/45 hover:text-white/80'
            }`}
          >
            ElevenLabs
          </button>
          <button
            type="button"
            onClick={() => {
              controlLayer.mouthProvider = 'deepgram';
              controlLayer.saveControlPrefs();
              rerender();
              void os.applyVoiceSettings();
            }}
            className={`h-7 flex-1 rounded-lg text-[9px] font-normal tracking-[0.08em] transition-all duration-200 ${
              controlLayer.mouthProvider === 'deepgram'
                ? 'border border-sky-400/30 bg-sky-400/[0.18] text-sky-100 shadow-[inset_0_0_10px_rgba(var(--th-glow),0.18)]'
                : 'text-white/45 hover:text-white/80'
            }`}
          >
            Deepgram
          </button>
        </div>
      </div>

      {/* ElevenLabs Voice Selection */}
      {controlLayer.mouthProvider === 'elevenlabs' && (
        <div className="space-y-2 rounded-xl border border-sky-500/20 bg-sky-950/15 p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-[0.2em] text-sky-200/70">ElevenLabs Voice</span>
            <span className="font-mono text-[8px] text-sky-300/60">
              ID: {controlLayer.elevenLabsVoiceId.slice(0, 8)}…
            </span>
          </div>

          <select
            value={isCustomSelected ? 'custom' : controlLayer.elevenLabsVoiceId}
            onChange={(e) => handleVoiceSelect(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-[#080d1a] px-2.5 py-1.5 text-[11px] text-white/90 outline-none focus:border-sky-400"
          >
            {elevenVoices.map((v) => (
              <option key={v.id} value={v.id} className="bg-[#080d1a] text-white">
                {v.label}
              </option>
            ))}
          </select>

          {isCustomSelected && (
            <div>
              <p className="mb-1 text-[8.5px] text-white/40">Custom ElevenLabs Voice ID</p>
              <input
                type="text"
                placeholder="Paste ElevenLabs Voice ID…"
                value={customVoiceId}
                onChange={(e) => handleCustomVoiceSubmit(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#080d1a] px-2.5 py-1 text-[11px] font-mono text-sky-200 placeholder:text-white/20 outline-none focus:border-sky-400"
              />
            </div>
          )}

          <SegRow<string>
            label="ElevenLabs Model"
            value={controlLayer.elevenLabsModelId}
            onChange={(m) => {
              controlLayer.elevenLabsModelId = m;
              controlLayer.saveControlPrefs();
              rerender();
            }}
            options={[
              { id: 'eleven_turbo_v2_5', label: 'Turbo 2.5' },
              { id: 'eleven_multilingual_v2', label: 'Multilingual' },
              { id: 'eleven_flash_v2_5', label: 'Flash 2.5' },
            ]}
          />
        </div>
      )}

      {/* Deepgram Aura Voice Selection */}
      {controlLayer.mouthProvider === 'deepgram' && (
        <div className="space-y-2 rounded-xl border border-sky-500/20 bg-sky-950/15 p-2.5">
          <span className="text-[9px] uppercase tracking-[0.2em] text-sky-200/70">Deepgram Voice Model</span>
          <select
            value={controlLayer.dgVoice}
            onChange={(e) => {
              controlLayer.dgVoice = e.target.value;
              controlLayer.saveControlPrefs();
              rerender();
              void os.applyVoiceSettings();
            }}
            className="w-full rounded-lg border border-white/10 bg-[#080d1a] px-2.5 py-1.5 text-[11px] text-white/90 outline-none focus:border-sky-400"
          >
            {DEEPGRAM_VOICES.map((v) => (
              <option key={v.id} value={v.id} className="bg-[#080d1a] text-white">
                {v.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Boot Music & Acoustic Score */}
      <div className="mt-3 space-y-2.5 rounded-xl border border-sky-500/20 bg-sky-950/20 p-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Music size={12} className="text-sky-300" />
            <span className="text-[9px] uppercase tracking-[0.2em] text-sky-200">Boot & Wake Audio Score</span>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = !scoreEnabled;
              setScoreEnabled(next);
              scoreEngine.setEnabled(next);
            }}
            className={`rounded-full px-2 py-0.5 text-[8.5px] font-mono uppercase tracking-wider transition ${
              scoreEnabled
                ? 'border border-emerald-400/40 bg-emerald-500/20 text-emerald-200'
                : 'border border-white/10 bg-white/5 text-white/40'
            }`}
          >
            {scoreEnabled ? 'Enabled' : 'Muted'}
          </button>
        </div>

        <p className="text-[8.5px] text-white/50 leading-relaxed">
          Plays a short wake flourish on awakening (customizable via <code className="text-sky-300 font-mono">public/audio/boot-music.mp3</code>) with dynamic voice ducking. Continuous music is disabled by default.
        </p>

        {scoreEnabled && (
          <div className="space-y-2 pt-1 border-t border-white/[0.06]">
            <div className="flex items-center justify-between text-[8px] font-mono text-white/60">
              <span>Flourish Volume</span>
              <span>{Math.round(scoreVolume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={scoreVolume}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setScoreVolume(v);
                scoreEngine.setMasterVolume(v);
              }}
              className="w-full accent-sky-400 cursor-pointer"
            />
            <div className="flex items-center justify-between pt-1 text-[8px] text-white/60">
              <span className="font-mono">Loop Ambient Bed when Idle</span>
              <button
                type="button"
                onClick={() => {
                  const next = !scoreAmbientLoop;
                  setScoreAmbientLoop(next);
                  scoreEngine.setAmbientLoopEnabled(next);
                }}
                className={`rounded px-1.5 py-0.5 text-[8px] font-mono ${
                  scoreAmbientLoop
                    ? 'border border-sky-400/40 bg-sky-400/20 text-sky-200'
                    : 'border border-white/10 bg-white/5 text-white/40'
                }`}
              >
                {scoreAmbientLoop ? 'ON' : 'OFF (Default)'}
              </button>
            </div>
          </div>
        )}
      </div>

      <WakeWordBlock os={os} />
      <AirplanePanel serverStatus={serverStatus} />
    </AccordionSection>
  );
}
