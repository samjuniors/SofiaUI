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
 *
 * Phase 22 split: leaf subsystems live in ./os/ (prefs, diagnostics,
 * speech) and this file keeps the runtime core — constructor wiring, the
 * stage, activation, session lifecycle, and provider events — plus thin
 * delegates. Public API unchanged.
 */

import { AudioEngine, type MicStatus } from './audio/AudioEngine';
import { controlLayer } from './control';
import { pulse, setHapticsEnabled } from './haptics';
import { stageLayout } from './layout';
import { ParticleRenderer } from './ParticleRenderer';
import type { SophiaForm } from './ShapeGenerator';
import { DEFAULT_TUNE, THEMES, type DensityTier, type ThemeId } from './VisualDirector';
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
import { GeminiLiveProvider, type LiveConnectionMetrics } from './voice/GeminiLiveProvider';
import { ElevenLabsVoiceProvider } from './voice/ElevenLabsVoiceProvider';
import { LocalVoiceProvider } from './voice/LocalVoiceProvider';
import { airplaneMode } from '../lib/airplane-mode';
import { loadVoiceMode } from '../lib/voice-router';
import type { VoiceProvider } from './voice/VoiceProvider';
import { VisualDirector } from './VisualDirector';
import { EmotionEngine } from '../core/EmotionEngine';
import { memoryStore } from '../core/MemoryStore';
import { soulStore } from '../core/Soul';
import { applyUiTheme } from '../lib/themes';
import { WakeWordDetection } from '../core/WakeWordDetection';
import { scoreEngine } from './audio/ScoreEngine';
import { userVoiceProfile } from '../core/UserVoiceProfile';
import { sophiaFetch } from '../lib/sophia-fetch.ts';
import { setTaskAnnouncer } from './voice/TaskNarrator';
import { DEFAULT_PREFS, PREF_KEY, loadPrefs, type Prefs } from './os/prefs';
import { buildDiagnostics, geminiLiveMetrics, liveMetrics, pingLiveProvider } from './os/diagnostics';
import { speakText as speakViaMouth, testMic as micSelfTest, testVoice as voiceSelfTest, type SpeechContext } from './os/speech';
import { WakeArmer } from './os/wake';

export type OSStatus = 'idle' | 'connecting' | 'live' | 'offline' | 'denied' | 'error';
// Prefs + diagnostics types live in ./os/; re-exported so importers don't move.
export type { ProviderPref, MotionPref, DensityPref } from './os/prefs';
export type { DiagnosticsSnapshot } from './os/diagnostics';

export interface LogLine {
  id: number;
  ts: number;
  level: 'info' | 'event' | 'cmd' | 'error';
  text: string;
}

const VOICE_EVENTS: SophiaEventType[] = [
  'listening',
  'speech_started',
  'transcript',
  'thinking',
  'rendering',
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
  readonly emotionEngine = new EmotionEngine();
  readonly prefs: Prefs;

  private renderer: ParticleRenderer | null = null;
  private providers: Record<VoiceProviderId, VoiceProvider>;
  private activeProvider: VoiceProvider | null = null;
  private wakeDetector: WakeWordDetection | null = null;
  private readonly wake: WakeArmer;
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
    this.prefs = loadPrefs();
    this.wake = new WakeArmer({
      prefs: this.prefs,
      getStatus: () => this.status,
      isMicDenied: () => this.micStatus === 'denied',
      stateIs: (...names) => this.state.is(...names),
      pushLog: (level, text) => this.pushLog(level, text),
      enterSession: (source) => this.enterSession(source),
    });
    applyUiTheme(this.prefs.theme);
    this.providers = {
      'gemini-live': new GeminiLiveProvider(this.audio),
      deepgram: new DeepgramVoiceProvider(this.audio),
      elevenlabs: new ElevenLabsVoiceProvider(this.audio),
      local: new LocalVoiceProvider(this.audio),
    };
    this.wireProvider(this.providers['gemini-live']);
    this.wireProvider(this.providers.deepgram);
    this.wireProvider(this.providers.elevenlabs);
    this.wireProvider(this.providers.local);

    // Phase 19: background tasks narrate through the live session while it
    // is connected (progress / approval questions / results). Otherwise the
    // TaskPanel carries the updates and the narrator stays silent.
    setTaskAnnouncer((line, kind) => {
      const live = this.providers['gemini-live'] as GeminiLiveProvider | undefined;
      if (!live?.isConnected) return;
      const prefix =
        kind === 'approval'
          ? '[Task approval — voice this question now, then wait for the answer]'
          : kind === 'result'
            ? '[Task finished — announce this briefly]'
            : '[Task update — say this briefly in one short sentence, no questions]';
      live.sendPrompt(`${prefix}: ${line}`);
    });

    this.audio.onMicLevel((l) => (this.micLvl = l));
    this.audio.onPlaybackLevel((l) => (this.playLvl = l));
    this.audio.onClap(() => this.handleClap());
    this.audio.onBargeIn(() => {
      this.pushLog('event', 'barge-in detected — interrupting Sophia');
      this.interrupt();
    });
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
    controlLayer.addEventListener('command:calibrate_voice', () => {
      userVoiceProfile.resetProfile();
      this.pushLog('cmd', 'user voice print calibration initiated');
      controlLayer.dispatchEvent(new CustomEvent('command:notification', {
        detail: { message: 'Voice calibration started: speak naturally to Sofia', level: 'info' }
      }));
      void this.speakText("I'm listening and calibrating your voice now. Speak to me naturally.");
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
      scoreEngine.syncToState(s);
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
        }, 1200);
      } else if (s === 'focusing') {
        if (this.focusingTimer) clearTimeout(this.focusingTimer);
        this.focusingTimer = setTimeout(() => {
          if (this.state.is('focusing')) {
            this.state.transition('listening', { reason: 'focus-complete' }, true);
            this.pushLog('event', 'focused — listening for speech');
          }
        }, 550);
      } else if ((s === 'ambient' || s === 'idle') && prev !== 'transforming') {
        this.wake.maybeArm();
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

    // Voice-driven music commands dispatched from App.tsx via controlLayer
    this.addEventListener('music:play', () => {
      scoreEngine.syncToState(this.state.current);
      this.pushLog('event', 'music: resumed by voice command');
    });
    this.addEventListener('music:stop', () => {
      scoreEngine.stopAll();
      this.pushLog('event', 'music: stopped by voice command');
    });
  }

  /* ------------------------------- prefs ------------------------------- */

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
    applyUiTheme(this.prefs.theme);
    if (patch.density) this.applyDensity();
    if (patch.form) {
      this.handleTransform(patch.form === 'ring' ? 'circle' : 'organic');
    }
    if (!this.prefs.wake) this.wake.stop();
    else this.wake.maybeArm();
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
          if (p.state === 'granted') this.wake.maybeArm();
          p.onchange = () => {
            if (p.state === 'granted') {
              this.wake.unblock();
              this.wake.maybeArm();
            }
          };
        })
        .catch(() => undefined);
      const once = async () => {
        window.removeEventListener('pointerdown', once);
        window.removeEventListener('keydown', once);
        if (navigator.mediaDevices?.getUserMedia) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach((t) => t.stop());
            this.wake.unblock();
          } catch {
            /* cancelled or prompt pending */
          }
        }
        this.wake.maybeArm();
      };
      window.addEventListener('pointerdown', once);
      window.addEventListener('keydown', once);
    }
  }

  detach() {
    cancelAnimationFrame(this.raf);
    this.wake.stop();
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
    scoreEngine.stopAll();
    const p = this.activeProvider;
    this.activeProvider = null;
    void p?.stop().catch(() => undefined);
    this.setStatus('idle');
    this.pushLog('event', 'paused — say hey sofia, clap, or tap the mic to wake');
    this.wake.maybeArm();
  }

  resume() {
    if (this.state.paused) {
      this.state.resume('user');
      scoreEngine.syncToState(this.state.current);
      this.pushLog('event', 'resumed');
    }
  }

  async enterSession(source: ActivationSource): Promise<void> {
    await this.audio.unlockAudio();
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
      this.wake.maybeArm();
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

  get isMicDisabledError(): boolean {
    return this.micStatus === 'denied' || this.micStatus === 'error';
  }

  resetMicError() {
    this.micStatus = 'idle';
    this.micErrorDetails = null;
    this.dispatchEvent(new CustomEvent('mic-status', { detail: { status: 'idle', err: null } }));
  }

  getGeminiLiveMetrics(): LiveConnectionMetrics {
    return geminiLiveMetrics(this.providers);
  }

  async activate(source: ActivationSource): Promise<void> {
    await this.audio.unlockAudio();
    if (this.state.paused) this.resume();

    if (this.state.is('speaking')) {
      this.interrupt();
      return;
    }
    if (this.status === 'live' && this.activeProvider?.isActive()) {
      this.state.transition('focusing', { source }, true);
      return;
    }
    this.wake.suspend();
    this.wakeDetector?.stopWakeWordRecognizer();
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

    // Determine provider selection: honor user's chosen Mouth TTS engine & transport.
    // Airplane mode forces the fully local transport; otherwise 'local' rides last
    // in the chain so a cloud outage falls back to on-device instead of silence (Phase 9).
    const forceLocal = airplaneMode.enabled || loadVoiceMode() === 'local';
    let primary: VoiceProviderId = 'gemini-live';
    if (forceLocal) {
      primary = 'local';
    } else if (!controlLayer.pureGeminiLive) {
      if (controlLayer.mouthProvider === 'elevenlabs') {
        primary = 'elevenlabs';
      } else if (controlLayer.mouthProvider === 'deepgram') {
        primary = 'deepgram';
      } else if (this.prefs.provider !== 'auto') {
        primary = this.prefs.provider;
      }
    }

    const order: VoiceProviderId[] = Array.from(
      new Set(forceLocal ? ['local' as VoiceProviderId] : [primary, 'gemini-live', 'elevenlabs', 'deepgram', 'local' as VoiceProviderId])
    );

    let started = false;
    for (const id of order) {
      const p = this.providers[id];
      if (!p) continue;
      try {
        this.pushLog('info', `connecting ${id}…`);
        this.activeProvider = p;
        await p.start();
        this.setStatus('live');
        this.pushLog('event', `${id} session live & listening`);
        started = true;
        this.state.transition('focusing', { source, transport: id }, true);
        this.dispatchEvent(new CustomEvent('entered', { detail: { source, transport: id } }));

        // Trigger immediate greeting so user hears Sofia's voice on boot/connect/wake
        if (source === 'boot' || source === 'mic-button' || source === 'wake-word') {
          setTimeout(() => {
            if (this.activeProvider && this.activeProvider.isActive()) {
              if (this.activeProvider instanceof GeminiLiveProvider) {
                this.activeProvider.sendPrompt(
                  source === 'wake-word'
                    ? "Your friend just said 'Hey Sofia' to wake you up. Greet them in one short, warm spoken sentence and ask how you can help."
                    : "Introduce yourself briefly in one friendly sentence and ask how you can help today."
                );
              } else {
                this.activeProvider.sendText(source === 'wake-word' ? "I'm listening!" : "Hello Sofia!");
              }
            }
          }, 350);
        }
        break;
      } catch (err) {
        this.activeProvider = null;
        this.pushLog('error', `${id} unavailable: ${(err as Error).message}`);
      }
    }

    if (!started) {
      // Fallback: active state with server neural brain/mouth
      const fallbackProvider = this.providers.elevenlabs;
      try {
        this.activeProvider = fallbackProvider;
        await fallbackProvider.start();
        this.setStatus('live');
        this.pushLog('info', 'Gemini Neural Mouth TTS & Brain active as conversational transport');
        this.state.transition('focusing', { source, transport: 'neural-fallback' }, true);
        this.dispatchEvent(new CustomEvent('entered', { detail: { source, transport: 'neural-fallback' } }));
        if (source === 'boot' || source === 'mic-button' || source === 'wake-word') {
          void fallbackProvider.sendText(source === 'wake-word' ? "I'm listening!" : "Hello Sofia!");
        }
      } catch {
        this.setStatus('live');
        this.state.transition('listening', { source }, true);
        if (source === 'boot' || source === 'mic-button' || source === 'wake-word') {
          void this.speakText(
            source === 'wake-word'
              ? "G'day! I'm right here with you, how can I help?"
              : "Hello! I'm Sofia. I'm right here with you. What's on your mind today?"
          );
        }
      }
    }
  }

  async applyVoiceSettings(): Promise<void> {
    const primaryVoice = controlLayer.voiceName || 'Aoede';
    const mouth = controlLayer.mouthProvider;
    this.pushLog('info', `Switched voice to: ${primaryVoice} (${mouth})`);

    if (this.activeProvider) {
      const p = this.activeProvider;
      this.activeProvider = null;
      try {
        await p.stop();
      } catch (err) {
        console.warn('[SophiaOS] Error stopping provider on voice change:', err);
      }
    }
    this.audio.interruptPlayback();

    if (this.status === 'live' || this.status === 'connecting') {
      this.setStatus('connecting');
      await this.activate('mic-button');
    }
  }

  async resetGeminiLiveSession(): Promise<void> {
    await this.applyVoiceSettings();
  }

  private speechContext(): SpeechContext {
    return {
      audio: this.audio,
      state: this.state,
      pushLog: (level, text) => this.pushLog(level, text),
      speakFallback: (text) => this.speakText(text),
    };
  }

  async testMic(): Promise<number> {
    return micSelfTest(this.speechContext());
  }

  async testVoice(): Promise<void> {
    return voiceSelfTest(this.speechContext());
  }

  getLiveMetrics(): LiveConnectionMetrics {
    return liveMetrics(this.providers);
  }

  async pingLive(): Promise<number> {
    return pingLiveProvider(this.providers);
  }

  getDiagnostics() {
    return buildDiagnostics({
      audio: this.audio,
      prefs: this.prefs,
      status: this.status,
      providers: this.providers,
      director: this.director,
      fps: this.fpsCounter,
    });
  }

  deactivate(reason = 'user') {
    if (this.focusingTimer) clearTimeout(this.focusingTimer);
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    if (this.postTurnTimer) clearTimeout(this.postTurnTimer);
    if (this.completeTimer) clearTimeout(this.completeTimer);
    const p = this.activeProvider;
    this.activeProvider = null;
    void p?.stop().catch(() => undefined);
    this.audio.interruptPlayback();
    this.audio.stopCapture();
    this.setStatus('idle');
    this.state.standDown(reason);
    this.wake.maybeArm();
  }

  interrupt() {
    this.activeProvider?.interrupt();
    this.audio.interruptPlayback();
    this.state.handleVoiceEvent('interrupted', { source: 'ui' });
    if (this.state.is('listening')) this.armPostTurn();
  }

  async speakText(text: string): Promise<void> {
    return speakViaMouth(this.speechContext(), text);
  }

  async sendText(text: string): Promise<void> {
    const t = text.trim();
    if (!t) return;

    if (controlLayer.tryDirectCommand(t)) {
      return;
    }

    // Auto-connect Gemini Live WebSocket session if not already connected
    if (!this.activeProvider || !this.activeProvider.isActive()) {
      try {
        this.pushLog('info', 'Opening Gemini Live WebSocket stream for text session…');
        await this.activate('chat');
      } catch (err: any) {
        console.warn('[SophiaOS] Gemini Live WebSocket session connect note:', err);
      }
    }

    // If Gemini Live WebSocket is active, send turn directly over WebSocket!
    if (this.activeProvider?.isActive()) {
      this.pushLog('event', 'gemini-live: streaming text turn over WebSocket…');
      this.activeProvider.sendText(t);
      this.armPostTurn();
      return;
    }

    // Secondary fallback to HTTP chat endpoint if WebSocket is unreachable
    controlLayer.addUserTurn(t, true);
    this.dispatchEvent(new CustomEvent('transcript', { detail: { role: 'user', text: t, final: true } }));

    this.setStatus('live');
    this.state.transition('thinking', { source: 'text' }, true);
    this.pushLog('event', 'brain: thinking…');

    try {
      // Phase 2 mind: persona + durable facts ride along so every brain
      // answers as *your* Sofia. Nulls when untouched (server falls back).
      let mindContext: { soul: unknown; memory: unknown } | undefined;
      try {
        mindContext = {
          soul: soulStore.isDefault() ? null : soulStore.snapshot(),
          memory: memoryStore.toPromptContext() || null,
        };
      } catch {
        mindContext = undefined;
      }
      const res = await sophiaFetch('/api/sophia/chat', {
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
          context: mindContext,
        }),
      });

      if (!res.ok) {
        throw new Error(`chat-endpoint:${res.status}`);
      }

      const out = (await res.json()) as {
        text: string;
        toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
        sources?: Array<{ title: string; url: string }>;
      };

      let generatedImg: { url: string; prompt: string } | undefined;

      for (const tc of out.toolCalls ?? []) {
        if (tc.name === 'generate_image') {
          this.state.transition('rendering', { source: 'tool' }, true);
          this.pushLog('event', 'visual: generating image via Imagen 3…');
        }
        const toolRes = await controlLayer.execute(tc);
        if (tc.name === 'generate_image' && toolRes.status === 'success' && typeof toolRes.url === 'string') {
          generatedImg = { url: toolRes.url, prompt: String(toolRes.prompt || '') };
          this.pushLog('event', 'visual: image generated successfully');
        }
      }

      if (out.text || generatedImg) {
        const spoken = out.text || (generatedImg ? "I've generated that image for you." : "");
        controlLayer.addSophiaTurn(spoken, true, {
          imageUrl: generatedImg?.url,
          imagePrompt: generatedImg?.prompt,
          sources: out.sources,
        });
        this.dispatchEvent(new CustomEvent('transcript', {
          detail: {
            role: 'sophia',
            text: spoken,
            final: true,
            imageUrl: generatedImg?.url,
            imagePrompt: generatedImg?.prompt,
            sources: out.sources,
          }
        }));
        this.state.transition('speaking', { source: 'text' }, true);
        this.pushLog('event', 'mouth: speaking response');
        await this.speakText(spoken);
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

  /**
   * Watchdog hook (called on an interval from the app): if wake is wanted,
   * the mic isn't hard-denied, no session is live, and the spotter somehow
   * lost its recognizer (tab throttle, transient errors), re-arm it.
   */
  ensureWakeArmed(): void {
    this.wake.ensureArmed();
  }

  /** Phrases that wake her (Phase 9: configurable, persisted). */
  getWakeWords(): string[] {
    return this.wake.getWords();
  }

  setWakeWords(words: string[]) {
    this.wake.setWords(words);
    this.dispatchEvent(new CustomEvent('prefs', { detail: this.prefs }));
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
          case 'transcript':
            if (detail.text) {
              const inferred = this.emotionEngine.inferEmotionFromText(detail.text);
              if (inferred !== this.emotionEngine.getEmotion()) {
                this.emotionEngine.setEmotion(inferred);
                this.dispatchEvent(new CustomEvent('emotion', { detail: inferred }));
              }
            }
            this.state.handleVoiceEvent(type, detail);
            break;
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
          case 'rendering':
            // Image generation tool invoked — show rendering state
            this.state.transition('rendering', { source: 'tool', reason: 'image-gen' }, true);
            this.pushLog('event', 'visual: creating image…');
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
      case 'rendering':
        this.pushLog('event', `${id}: rendering image…`);
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
