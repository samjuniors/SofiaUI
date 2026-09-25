/**
 * SophiaOS — the runtime that wires the organism to the world.
 *
 *   VoiceProvider(s) ──normalized events──▶ SophiaState ──▶ VisualDirector ──▶ ParticleRenderer
 *        ▲                                        ▲
 *   AudioEngine (real mic/playback)          ControlLayer (ONE brain)
 *
 * Owns the render loop, activation paths (wake phrase / mic / chat),
 * silence & post-turn housekeeping, and provider selection with graceful
 * offline behaviour.
 */

import { AudioEngine, type MicStatus } from './audio/AudioEngine';
import { controlLayer } from './control';
import { pulse, setHapticsEnabled } from './haptics';
import { stageLayout } from './layout';
import { ParticleRenderer } from './ParticleRenderer';
import type { SophiaForm } from './ShapeGenerator';
import { DEFAULT_TUNE, THEMES, type DensityTier, type ShapeTune, type ThemeId } from './VisualDirector';
import { SophiaState } from './SophiaState';
import type {
  ActivationSource,
  SophiaEventDetail,
  SophiaEventType,
  SophiaShape,
  SophiaStateName,
  VoiceProviderId,
} from './types';
import { DeepgramVoiceProvider } from './voice/DeepgramVoiceProvider';
import { GeminiLiveProvider } from './voice/GeminiLiveProvider';
import { ElevenLabsVoiceProvider } from './voice/ElevenLabsVoiceProvider';
import type { VoiceProvider } from './voice/VoiceProvider';
import { WakeWordSpotter } from './voice/wake';
import { VisualDirector } from './VisualDirector';

export type OSStatus = 'idle' | 'connecting' | 'live' | 'offline' | 'denied' | 'error';
export type ProviderPref = VoiceProviderId | 'auto';
export type MotionPref = 'auto' | 'reduce' | 'full';
export type DensityPref = DensityTier | 'auto';

interface Prefs {
  provider: ProviderPref;
  wake: boolean;
  motion: MotionPref;
  form: SophiaForm;
  density: DensityPref;
  tune: ShapeTune;
  haptics: boolean;
  voiceProfile?: string;
}

const DEFAULT_PREFS: Prefs = {
  provider: 'auto',
  wake: true,
  motion: 'auto',
  form: 'sphere',
  density: 'auto',
  tune: { ...DEFAULT_TUNE },
  haptics: true,
  voiceProfile: 'au-female',
};

export interface LogLine {
  id: number;
  ts: number;
  level: 'info' | 'event' | 'cmd' | 'error';
  text: string;
}

export interface DiagnosticsSnapshot {
  mic: {
    status: MicStatus;
    level: number;
    error: string | null;
  };
  live: {
    status: 'connected' | 'connecting' | 'idle' | 'error';
    provider: string;
    model: string;
    voice: string;
    packetsSent: number;
    packetsReceived: number;
  };
  brain: {
    mode: string;
    pureGemini: boolean;
  };
  mouth: {
    engine: string;
    level: number;
  };
  visuals: {
    fps: number;
    density: string;
    shape: string;
  };
}

const PREF_KEY = 'sophia:prefs';
const VOICE_EVENTS: SophiaEventType[] = [
  'listening',
  'speech_started',
  'transcript',
  'thinking',
  'response_started',
  'audio_started',
  'audio_chunk',
  'interrupted',
  'response_finished',
  'error',
];

export class SophiaOS extends EventTarget {
  readonly state = new SophiaState();
  readonly director = new VisualDirector();
  readonly audio = new AudioEngine();
  readonly prefs: Prefs;

  private renderer: ParticleRenderer | null = null;
  private providers: Record<VoiceProviderId, VoiceProvider>;
  private activeProvider: VoiceProvider | null = null;
  private spotter: WakeWordSpotter | null = null;
  private raf = 0;
  private tPrev = 0;
  
  status: OSStatus = 'idle';
  rendererFailed = false;
  micStatus: MicStatus = 'idle';
  micErrorDetails: string | null = null;

  private micLvl = 0;
  private playLvl = 0;
  private localSilenceMs = 0;
  private postTurnTimer: ReturnType<typeof setTimeout> | null = null;
  private mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  private focusingTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private completeTimer: ReturnType<typeof setTimeout> | null = null;
  private pausedHadCapture = false;
  private batteryUnsub: (() => void) | null = null;
  private fpsCounter = 60;
  private frameCount = 0;
  private lastFpsTime = performance.now();

  constructor() {
    super();
    this.prefs = this.loadPrefs();
    this.providers = {
      'gemini-live': new GeminiLiveProvider(this.audio),
      deepgram: new DeepgramVoiceProvider(this.audio),
      elevenlabs: new ElevenLabsVoiceProvider(this.audio),
    };
    this.wireProvider(this.providers['gemini-live']);
    this.wireProvider(this.providers.deepgram);
    this.wireProvider(this.providers.elevenlabs);

    this.audio.onMicLevel((l) => (this.micLvl = l));
    this.audio.onPlaybackLevel((l) => (this.playLvl = l));
    this.audio.onClap(() => this.handleClap());
    this.audio.onMicStatus((status, err) => {
      this.micStatus = status;
      this.micErrorDetails = err ?? null;
      if (status === 'denied') {
        this.pushLog('error', `Microphone permission denied: ${err}`);
      } else if (status === 'error') {
        this.pushLog('error', `Microphone error: ${err}`);
      } else if (status === 'capturing') {
        this.pushLog('info', 'Microphone active (16 kHz PCM stream)');
      }
      this.dispatchEvent(new CustomEvent('mic-status', { detail: { status, err } }));
    });

    controlLayer.addEventListener('command:transform', (e) => {
      const { shape } = (e as CustomEvent).detail;
      this.handleTransform(shape as SophiaShape);
    });
    controlLayer.addEventListener('command:state', (e) => {
      const raw = String((e as CustomEvent).detail?.state ?? '');
      if (raw === 'resume') {
        this.state.resume('command');
        this.pushLog('event', 'resumed from pause');
        return;
      }
      if (raw === 'paused') {
        this.state.pause('command');
        return;
      }
      if (raw === 'wakeup') {
        this.wakeUp('command');
        return;
      }
      this.state.setState(raw as SophiaStateName, { reason: 'user-command' });
    });
    controlLayer.addEventListener('command:tune', (e) => {
      const patch = (e as CustomEvent).detail;
      this.savePrefs({ tune: { ...this.prefs.tune, ...patch } });
    });
    this.director.onTransformEnd = () => this.state.releaseTransform();
    this.director.setForm(this.prefs.form);
    this.director.setTune(this.prefs.tune);
    setHapticsEnabled(this.prefs.haptics);

    this.state.subscribe((s, prev, meta) => {
      this.director.state = s;
      this.dispatchEvent(new CustomEvent('state', { detail: { state: s, prev, ...meta } }));
      const why = typeof meta?.reason === 'string' ? ` (${(meta as { reason: string }).reason})` : '';
      this.pushLog('event', `state: ${prev} → ${s}${why}`);
      if (s === 'wakeup') pulse('wake');
      else if (s === 'completed') pulse('complete');
      else if (s === 'paused' && prev !== 'paused') pulse('pause');
      if (s === 'wakeup') {
        if (this.wakeTimer) clearTimeout(this.wakeTimer);
        this.wakeTimer = setTimeout(() => {
          if (this.state.is('wakeup')) this.state.transition('focusing', { reason: 'wake-complete' }, true);
        }, 1850);
      } else if (s === 'ambient' && prev !== 'transforming') {
        this.maybeArmWake();
      }
      if (s === 'completed' && this.renderer && this.director.isCustomMorphActive) {
        const baseShape = this.prefs.form === 'ring' ? 'circle' : 'organic';
        this.director.requestTransform(baseShape, this.renderer);
      }
      const stateNeedsBase: SophiaStateName[] = [
        'idle', 'listening', 'thinking', 'speaking', 'rendering',
        'focusing', 'wakeup', 'blocked',
      ];
      if (stateNeedsBase.includes(s) && this.renderer && this.director.isCustomMorphActive) {
        const baseShape = this.prefs.form === 'ring' ? 'circle' : 'organic';
        this.director.requestTransform(baseShape, this.renderer);
      }
      if (s === 'completed' && meta?.reason === 'turn-complete') {
        this.armCompletedHold();
      }
    });

    this.mediaQuery.addEventListener('change', () => this.applyMotion());
    this.applyMotion();
  }

  /* ------------------------------- prefs ------------------------------- */

  private loadPrefs(): Prefs {
    try {
      const raw = localStorage.getItem(PREF_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Prefs>;
        const prefs: Prefs = {
          ...DEFAULT_PREFS,
          ...parsed,
          tune: { ...DEFAULT_TUNE, ...(parsed.tune ?? {}) },
        };
        if (prefs.form !== 'sphere' && prefs.form !== 'ring') prefs.form = 'sphere';
        if (!['auto', 'low', 'medium', 'high'].includes(prefs.density)) prefs.density = 'auto';
        if (typeof prefs.haptics !== 'boolean') prefs.haptics = true;
        if (typeof prefs.voiceProfile === 'string') {
          controlLayer.voiceProfile = prefs.voiceProfile;
        }
        return prefs;
      }
    } catch {
      /* noop */
    }
    return { ...DEFAULT_PREFS, tune: { ...DEFAULT_TUNE } };
  }

  savePrefs(patch: Partial<Prefs>) {
    Object.assign(this.prefs, patch);
    if (patch.tune) this.prefs.tune = { ...this.prefs.tune, ...patch.tune };
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(this.prefs));
    } catch {
      /* noop */
    }
    this.applyMotion();
    this.director.setTune(this.prefs.tune);
    setHapticsEnabled(this.prefs.haptics);
    if (patch.density) this.applyDensity();
    if (patch.form) {
      this.handleTransform(patch.form === 'ring' ? 'circle' : 'organic');
    }
    if (!this.prefs.wake) this.spotter?.stop();
    else this.maybeArmWake();
    this.dispatchEvent(new CustomEvent('prefs', { detail: this.prefs }));
  }

  resetPrefs() {
    this.savePrefs({
      ...DEFAULT_PREFS,
      tune: { ...DEFAULT_TUNE },
    });
    this.pushLog('info', 'settings reset to defaults');
  }

  applyTheme(id: ThemeId) {
    const theme = THEMES.find((t) => t.id === id);
    if (!theme) return;
    this.savePrefs({ form: theme.form, tune: { ...theme.tune } });
    if (theme.shape && this.renderer) this.director.requestTransform(theme.shape, this.renderer);
    this.state.setState(theme.previewState, { reason: `theme:${id}` });
    this.pushLog('cmd', `theme → ${theme.label}`);
  }

  pickAutoDensity(): DensityTier {
    const cores = navigator.hardwareConcurrency || 4;
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    const pixels = window.innerWidth * window.innerHeight * (window.devicePixelRatio || 1);
    const small = Math.min(window.innerWidth, window.innerHeight) < 560 || pixels < 1.4e6;
    if (cores <= 4 || small || (typeof mem === 'number' && mem <= 4)) return 'low';
    if (cores >= 8 && !small) return 'high';
    return 'medium';
  }

  private applyDensity() {
    const tier = this.prefs.density === 'auto' ? this.pickAutoDensity() : this.prefs.density;
    this.renderer?.setDensity(tier);
  }

  private watchBattery() {
    this.batteryUnsub?.();
    this.batteryUnsub = null;
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{
        level: number;
        charging: boolean;
        addEventListener: (t: string, fn: () => void) => void;
        removeEventListener: (t: string, fn: () => void) => void;
      }>;
    };
    if (!nav.getBattery) return;
    void nav.getBattery().then((b) => {
      const drop = () => {
        if (this.prefs.density !== 'auto' || !this.renderer) return;
        if (!b.charging && b.level < 0.22) this.renderer.setDensity('low');
        else this.applyDensity();
      };
      b.addEventListener('levelchange', drop);
      b.addEventListener('chargingchange', drop);
      this.batteryUnsub = () => {
        b.removeEventListener('levelchange', drop);
        b.removeEventListener('chargingchange', drop);
      };
      drop();
    });
  }

  private armCompletedHold() {
    if (this.completeTimer) clearTimeout(this.completeTimer);
    this.completeTimer = setTimeout(() => {
      if (!this.state.is('completed')) return;
      const next: SophiaStateName = this.activeProvider ? 'listening' : 'ambient';
      this.state.transition(next, { reason: 'complete-hold' }, true);
    }, 1700);
  }

  private applyMotion() {
    const reduce =
      this.prefs.motion === 'reduce' || (this.prefs.motion === 'auto' && this.mediaQuery.matches);
    this.director.setReduced(reduce);
  }

  private setStatus(s: OSStatus) {
    this.status = s;
    this.pushLog(s === 'live' ? 'event' : s === 'offline' || s === 'denied' || s === 'error' ? 'error' : 'info', `transport: ${s}`);
    this.dispatchEvent(new CustomEvent('status', { detail: s }));
  }

  /* ------------------------------- terminal ---------------------------- */

  readonly log: LogLine[] = [];
  private logId = 0;

  pushLog(level: LogLine['level'], text: string) {
    const line: LogLine = { id: this.logId++, ts: Date.now(), level, text };
    this.log.push(line);
    if (this.log.length > 220) this.log.splice(0, this.log.length - 220);
    this.dispatchEvent(new CustomEvent('log', { detail: line }));
  }

  execCommand(input: string) {
    const text = input.trim();
    if (!text) return;
    this.pushLog('cmd', `› ${text}`);
    if (/^(retry|retry voice|reconnect|reset live)$/i.test(text)) {
      void this.resetGeminiLiveSession();
      return;
    }
    if (/^(test mic|mic test)$/i.test(text)) {
      void this.testMic();
      return;
    }
    if (/^(test voice|voice test|speak test)$/i.test(text)) {
      void this.testVoice();
      return;
    }
    if (controlLayer.tryDirectCommand(text)) return;
    void this.sendText(text);
  }

  /* ---------------------------- render loop ---------------------------- */

  attach(canvas: HTMLCanvasElement) {
    try {
      this.renderer = new ParticleRenderer(canvas);
      this.applyDensity();
      this.director.setTune(this.prefs.tune);
      this.watchBattery();
    } catch {
      this.rendererFailed = true;
      this.pushLog('error', 'renderer: WebGL2 unavailable — showing static fallback');
      this.dispatchEvent(new CustomEvent('renderer-failed'));
      return;
    }
    this.pushLog('info', `sophia online · form ${this.prefs.form} · density ${this.prefs.density}`);
    this.tPrev = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, Math.max(0.0005, (now - this.tPrev) / 1000));
      this.tPrev = now;
      
      this.frameCount++;
      if (now - this.lastFpsTime >= 1000) {
        this.fpsCounter = Math.round((this.frameCount * 1000) / (now - this.lastFpsTime));
        this.frameCount = 0;
        this.lastFpsTime = now;
      }

      this.housekeeping(dt);
      const params = this.director.frame(dt, { mic: this.micLvl, play: this.playLvl });
      this.renderer!.frame(params);
    };
    this.raf = requestAnimationFrame(loop);
    if (this.prefs.wake) {
      navigator.permissions
        ?.query({ name: 'microphone' as PermissionName })
        .then((p) => {
          if (p.state === 'granted') this.maybeArmWake();
        })
        .catch(() => undefined);
      const once = () => {
        window.removeEventListener('pointerdown', once);
        window.removeEventListener('keydown', once);
        this.maybeArmWake();
      };
      window.addEventListener('pointerdown', once);
      window.addEventListener('keydown', once);
    }
  }

  detach() {
    cancelAnimationFrame(this.raf);
    this.spotter?.stop();
    this.batteryUnsub?.();
    this.batteryUnsub = null;
    this.renderer?.dispose();
    this.renderer = null;
  }

  private housekeeping(dt: number) {
    if (!this.audio.capturing) return;
    if (!this.activeProvider && this.state.is('listening', 'focusing')) {
      if (this.micLvl < 0.03) {
        this.localSilenceMs += dt * 1000;
        if (this.localSilenceMs > 5200) {
          this.localSilenceMs = 0;
          this.deactivate('silence');
        }
      } else {
        this.localSilenceMs = 0;
      }
    }
  }

  /* ---------------------------- activation ----------------------------- */

  setFocusPoint(px: number, py: number, vpW: number, vpH: number) {
    const { cx, cy } = stageLayout(vpW, vpH);
    this.director.setFocusAngle(Math.atan2(-(py - cy), px - cx));
  }

  get form(): SophiaForm {
    return this.director.currentForm;
  }

  get hearing(): boolean {
    return this.audio.capturing;
  }

  wakeUp(reason = 'user') {
    if (this.state.paused) this.state.resume(reason);
    this.director.playWake();
    this.state.transition('wakeup', { reason }, true);
    this.pushLog('event', `wake-up (${reason})`);
  }

  pause() {
    if (this.state.paused) return;
    this.pausedHadCapture = Boolean(this.activeProvider?.isActive());
    this.state.pause('user');
    this.audio.interruptPlayback();
    const p = this.activeProvider;
    this.activeProvider = null;
    void p?.stop().catch(() => undefined);
    this.setStatus('idle');
    this.pushLog('event', 'paused — say hey sophia, clap, or tap the mic to wake');
    this.maybeArmWake();
  }

  resume() {
    if (this.state.paused) {
      this.state.resume('user');
      this.pushLog('event', 'resumed');
    }
  }

  async enterSession(source: ActivationSource): Promise<void> {
    if (this.state.paused) this.resume();
    if (this.status === 'live' && this.activeProvider?.isActive()) {
      this.director.playWake();
      this.state.transition('focusing', { source }, true);
      this.dispatchEvent(new CustomEvent('entered', { detail: { source } }));
      return;
    }
    await this.activate(source);
  }

  async prepareListen(): Promise<boolean> {
    try {
      await this.audio.startCapture();
      this.maybeArmWake();
      return true;
    } catch {
      return false;
    }
  }

  private handleClap() {
    if (this.status === 'live' && !this.state.paused && !this.state.is('ambient', 'idle')) return;
    this.pushLog('event', 'clap detected');
    void this.enterSession('clap');
  }

  get isPaused(): boolean {
    return this.state.paused;
  }

  setDocked(v: boolean) {
    if (this.director.isDocked === v) return;
    this.director.setDocked(v);
    this.dispatchEvent(new CustomEvent('dock', { detail: v }));
  }

  get health(): 'ok' | 'warn' | 'error' {
    if (this.rendererFailed || this.micStatus === 'denied') return 'error';
    if (this.status === 'offline' || this.status === 'connecting' || this.micStatus === 'error') return 'warn';
    return 'ok';
  }

  async activate(source: ActivationSource): Promise<void> {
    if (this.state.paused) this.resume();

    if (this.state.is('speaking')) {
      this.interrupt();
      return;
    }
    if (this.status === 'live' && this.activeProvider?.isActive()) {
      this.state.transition('focusing', { source }, true);
      return;
    }
    this.spotter?.suspend();
    this.pushLog('info', `waking sophia (${source})`);
    this.director.playWake();
    this.state.transition('wakeup', { source }, true);
    this.setStatus('connecting');

    // Attempt real microphone capture
    try {
      await this.audio.startCapture();
    } catch (micErr: any) {
      console.warn('[SophiaOS] Mic capture note:', micErr);
      this.pushLog('info', `Microphone access status: ${micErr.message}`);
    }

    // Determine provider selection
    const isPureGemini = controlLayer.pureGeminiLive;
    const order: VoiceProviderId[] = isPureGemini
      ? ['gemini-live']
      : this.prefs.provider === 'auto'
        ? ['gemini-live', 'deepgram', 'elevenlabs']
        : [this.prefs.provider];

    let started = false;
    for (const id of order) {
      const p = this.providers[id];
      try {
        this.pushLog('info', `connecting ${id}…`);
        this.activeProvider = p;
        await p.start();
        this.setStatus('live');
        this.pushLog('event', `${id} session live & listening`);
        started = true;
        this.state.transition('focusing', { source, transport: id }, true);
        this.dispatchEvent(new CustomEvent('entered', { detail: { source, transport: id } }));
        break;
      } catch (err) {
        this.activeProvider = null;
        this.pushLog('error', `${id} unavailable: ${(err as Error).message}`);
      }
    }

    if (!started) {
      // Fallback: active state with server neural brain/mouth
      this.setStatus('live');
      this.pushLog('info', 'Gemini Neural Mouth TTS & Brain active as conversational transport');
      this.state.transition('focusing', { source, transport: 'neural-fallback' }, true);
      this.dispatchEvent(new CustomEvent('entered', { detail: { source, transport: 'neural-fallback' } }));
    }
  }

  async resetGeminiLiveSession(): Promise<void> {
    this.pushLog('info', 'Resetting Gemini Live session…');
    this.setStatus('connecting');
    const p = this.providers['gemini-live'] as GeminiLiveProvider;
    try {
      this.activeProvider = p;
      await p.reset();
      this.setStatus('live');
      this.pushLog('event', 'Gemini Live session reset and reconnected successfully.');
      this.state.transition('focusing', { source: 'mic-button', transport: 'gemini-live' }, true);
    } catch (err: any) {
      this.pushLog('error', `Gemini Live reset error: ${err.message}`);
      this.setStatus('offline');
    }
  }

  async testMic(): Promise<number> {
    this.pushLog('info', 'Testing microphone input…');
    try {
      await this.audio.startCapture();
      return new Promise((resolve) => {
        let maxLvl = 0;
        const unsub = this.audio.onMicLevel((l) => {
          if (l > maxLvl) maxLvl = l;
        });
        setTimeout(() => {
          unsub();
          this.pushLog('event', `Microphone test complete: peak level ${(maxLvl * 100).toFixed(1)}%`);
          resolve(maxLvl);
        }, 1200);
      });
    } catch (err: any) {
      this.pushLog('error', `Microphone test failed: ${err.message}`);
      return 0;
    }
  }

  async testVoice(): Promise<void> {
    this.pushLog('info', 'Testing voice output (Gemini Neural TTS)…');
    try {
      const res = await fetch('/api/sophia/test-voice', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ voice: controlLayer.voiceName }),
      });
      if (!res.ok) throw new Error(`test-voice:${res.status}`);
      const buf = await res.arrayBuffer();
      this.state.transition('speaking', { source: 'test' }, true);
      await this.audio.playEncoded(buf);
      this.state.transition('idle', { source: 'test' }, true);
      this.pushLog('event', 'Voice test playback complete.');
    } catch (err: any) {
      this.pushLog('error', `Voice test error: ${err.message}`);
      await this.speakText("G'day, voice test complete.");
    }
  }

  getDiagnostics(): DiagnosticsSnapshot {
    const liveProvider = this.providers['gemini-live'] as GeminiLiveProvider;
    return {
      mic: {
        status: this.audio.micStatus,
        level: this.audio.micLevel,
        error: this.audio.micErrorDetails,
      },
      live: {
        status: liveProvider.isConnected ? 'connected' : this.status === 'connecting' ? 'connecting' : this.status === 'error' ? 'error' : 'idle',
        provider: 'Gemini Live (Native Audio)',
        model: liveProvider.stats.modelName,
        voice: controlLayer.voiceName,
        packetsSent: liveProvider.stats.packetsSent,
        packetsReceived: liveProvider.stats.packetsReceived,
      },
      brain: {
        mode: controlLayer.brainMode,
        pureGemini: controlLayer.pureGeminiLive,
      },
      mouth: {
        engine: controlLayer.pureGeminiLive ? 'gemini' : controlLayer.mouthProvider,
        level: this.audio.playbackLevel,
      },
      visuals: {
        fps: this.fpsCounter,
        density: this.prefs.density,
        shape: this.director.currentForm,
      },
    };
  }

  deactivate(reason = 'user') {
    if (this.focusingTimer) clearTimeout(this.focusingTimer);
    if (this.postTurnTimer) clearTimeout(this.postTurnTimer);
    if (this.completeTimer) clearTimeout(this.completeTimer);
    const p = this.activeProvider;
    this.activeProvider = null;
    void p?.stop().catch(() => undefined);
    this.audio.interruptPlayback();
    this.audio.stopCapture();
    this.setStatus('idle');
    this.state.standDown(reason);
  }

  interrupt() {
    this.activeProvider?.interrupt();
    this.audio.interruptPlayback();
    this.state.handleVoiceEvent('interrupted', { source: 'ui' });
    if (this.state.is('listening')) this.armPostTurn();
  }

  async speakText(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;

    try {
      const res = await fetch('/api/sophia/mouth/speak', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: trimmed,
          provider: controlLayer.pureGeminiLive ? 'gemini' : controlLayer.mouthProvider,
          voice: controlLayer.voiceName,
          voiceId: controlLayer.elevenLabsVoiceId,
        }),
      });

      if (!res.ok) {
        throw new Error(`mouth-speak:${res.status}`);
      }

      const buf = await res.arrayBuffer();
      await this.audio.playEncoded(buf);
    } catch (err) {
      console.warn('[SophiaOS] Neural TTS speak fallback note:', err);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        await new Promise<void>((resolve) => {
          const u = new SpeechSynthesisUtterance(trimmed);
          u.onend = () => resolve();
          u.onerror = () => resolve();
          window.speechSynthesis.speak(u);
        });
      }
    }
  }

  async sendText(text: string): Promise<void> {
    const t = text.trim();
    if (!t) return;
    if (this.activeProvider?.isActive()) {
      this.activeProvider.sendText(t);
      this.armPostTurn();
      return;
    }

    // Direct turn execution with Sophia Brain and Mouth TTS
    controlLayer.addUserTurn(t, true);
    this.dispatchEvent(new CustomEvent('transcript', { detail: { role: 'user', text: t, final: true } }));

    if (controlLayer.tryDirectCommand(t)) {
      return;
    }

    this.setStatus('live');
    this.state.transition('thinking', { source: 'text' }, true);
    this.pushLog('event', 'brain: thinking…');

    try {
      const res = await fetch('/api/sophia/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lastUser: t,
          history: controlLayer.history.slice(-16),
          brainMode: controlLayer.pureGeminiLive ? 'gemini' : controlLayer.brainMode,
          ollamaModel: controlLayer.ollamaModel,
          ollamaUrl: controlLayer.ollamaUrl,
          lmStudioModel: controlLayer.lmStudioModel,
          lmStudioUrl: controlLayer.lmStudioUrl,
        }),
      });

      if (!res.ok) {
        throw new Error(`chat-endpoint:${res.status}`);
      }

      const out = (await res.json()) as {
        text: string;
        toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
      };

      for (const tc of out.toolCalls ?? []) {
        await controlLayer.execute(tc);
      }

      if (out.text) {
        controlLayer.addSophiaTurn(out.text, true);
        this.dispatchEvent(new CustomEvent('transcript', { detail: { role: 'sophia', text: out.text, final: true } }));
        this.state.transition('speaking', { source: 'text' }, true);
        this.pushLog('event', 'mouth: speaking response');
        await this.speakText(out.text);
      }

      this.state.transition('idle', { source: 'text' }, true);
      this.armPostTurn();
    } catch (err) {
      console.warn('[SophiaOS] Brain/mouth processing error:', err);
      this.pushLog('error', `processing error: ${(err as Error).message}`);
      controlLayer.addSophiaTurn("I am here and listening. How can I assist you?", true);
      this.state.transition('idle', { source: 'text' }, true);
    }
  }

  private armPostTurn() {
    if (this.postTurnTimer) clearTimeout(this.postTurnTimer);
    this.postTurnTimer = setTimeout(() => this.deactivate('post-turn-quiet'), 22000);
  }

  private maybeArmWake() {
    if (!this.prefs.wake || this.status === 'live') return;
    if (!this.spotter) {
      this.spotter = new WakeWordSpotter(() => {
        void this.enterSession('wake-word');
      });
    }
    this.spotter.start();
  }

  /* --------------------------- provider events -------------------------- */

  private wireProvider(p: VoiceProvider) {
    for (const type of VOICE_EVENTS) {
      p.addEventListener(type, (e) => {
        if (this.activeProvider !== p && type !== 'error') return;
        const detail = (e as CustomEvent<SophiaEventDetail>).detail ?? {};
        if (type !== 'error' && type !== 'listening') this.cancelFocusing();
        this.logVoiceEvent(p.id, type, detail);
        switch (type) {
          case 'speech_started':
            if (this.postTurnTimer) clearTimeout(this.postTurnTimer);
            if (this.completeTimer) clearTimeout(this.completeTimer);
            this.state.handleVoiceEvent(type, detail);
            break;
          case 'interrupted':
            this.audio.interruptPlayback();
            this.state.handleVoiceEvent(type, detail);
            this.armPostTurn();
            break;
          case 'response_finished':
            this.state.handleVoiceEvent(type, detail);
            this.armPostTurn();
            break;
          case 'error':
            if (this.activeProvider === p || !detail.code) {
              this.state.handleVoiceEvent(type, detail);
              if (detail.code === 'transport-closed' || detail.code === 'live-ws-error') {
                this.setStatus('offline');
                this.pushLog('info', 'Live link disconnected. Ready to reconnect.');
              }
            }
            break;
          default:
            this.state.handleVoiceEvent(type, detail);
        }
      });
    }
  }

  private cancelFocusing() {
    if (this.focusingTimer) {
      clearTimeout(this.focusingTimer);
      this.focusingTimer = null;
    }
  }

  private logVoiceEvent(id: string, type: SophiaEventType, detail: SophiaEventDetail) {
    switch (type) {
      case 'audio_chunk':
        return;
      case 'transcript':
        return;
      case 'thinking':
        this.pushLog('event', `${id}: thinking…`);
        return;
      case 'audio_started':
      case 'response_started':
        this.pushLog('event', `${id}: speaking`);
        return;
      case 'interrupted':
        this.pushLog('event', `${id}: interrupted — listening`);
        return;
      case 'response_finished':
        this.pushLog('event', `${id}: turn complete`);
        return;
      case 'error':
        this.pushLog('error', `${id}: ${detail.code ?? 'error'}${detail.message ? ' · ' + detail.message : ''}`);
        return;
      case 'speech_started':
        return;
      default:
        return;
    }
  }

  private handleTransform(shape: SophiaShape) {
    this.pushLog('cmd', `shape → ${shape}`);
    if (!this.renderer) {
      if (shape === 'circle') this.director.setForm('ring');
      if (shape === 'organic') this.director.setForm('sphere');
      return;
    }
    if (this.state.current === 'transforming') {
      this.director.requestTransform(shape, this.renderer);
      return;
    }
    if (!this.state.transition('transforming', { shape })) return;
    this.director.requestTransform(shape, this.renderer);
    if (shape === 'circle' || shape === 'organic') {
      const form: SophiaForm = shape === 'circle' ? 'ring' : 'sphere';
      if (this.prefs.form !== form) {
        this.prefs.form = form;
        try {
          localStorage.setItem(PREF_KEY, JSON.stringify(this.prefs));
        } catch {
          /* noop */
        }
        this.dispatchEvent(new CustomEvent('prefs', { detail: this.prefs }));
      }
    }
  }
}

let os: SophiaOS | null = null;
export function getSophiaOS(): SophiaOS {
  if (!os) {
    os = new SophiaOS();
    if (typeof window !== 'undefined') {
      (window as unknown as { __SOPHIA_OS__?: SophiaOS }).__SOPHIA_OS__ = os;
    }
  }
  return os;
}
