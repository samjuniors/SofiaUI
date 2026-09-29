import {
  AudioMetrics,
  Emotion,
  SofiaMessage,
  SofiaState,
  VoiceConfig,
  WakeSettings
} from '../types/sofia';
import { AudioInput } from './AudioInput';
import { AudioOutput } from './AudioOutput';
import { EmotionEngine } from './EmotionEngine';
import { InterruptionManager } from './InterruptionManager';
import { PersonaEngine } from './PersonaEngine';
import { LiveApiProvider } from './providers/LiveApiProvider';
import { ModularProvider } from './providers/ModularProvider';
import { VoiceActivityDetection } from './VoiceActivityDetection';
import { WakeTrigger, WakeWordDetection } from './WakeWordDetection';
import { sophiaMemory } from './SophiaMemory';
import { airplaneMode } from '../lib/airplane-mode';

export interface ConversationManagerCallbacks {
  onStateChange: (state: SofiaState) => void;
  onEmotionChange: (emotion: Emotion) => void;
  onAudioMetrics: (metrics: AudioMetrics) => void;
  onMessageAdd: (message: SofiaMessage) => void;
  onWakeDetected: (trigger: WakeTrigger) => void;
  onError: (errorMsg: string) => void;
}

export class ConversationManager {
  private state: SofiaState = 'BOOT';
  private callbacks: ConversationManagerCallbacks;

  // Core subsystems
  private audioInput = new AudioInput();
  private audioOutput = new AudioOutput();
  private vad: VoiceActivityDetection;
  private wakeWordDetector: WakeWordDetection;
  private interruptionManager: InterruptionManager;
  private emotionEngine = new EmotionEngine();
  private personaEngine = new PersonaEngine();

  // Providers
  private liveApiProvider: LiveApiProvider;
  private modularProvider = new ModularProvider();

  // State & Settings
  private messages: SofiaMessage[] = [];
  private activeTranscript = '';
  private isAwake = false; // whether Sofia is in active dialogue vs waiting for wake gesture
  private conversationTopic = '';
  private voiceConfig: VoiceConfig = {
    name: 'Sofia (Australian)',
    accent: 'Australian',
    speed: 1.0,
    pitch: 1.0,
    provider: 'gemini-live',
    geminiVoiceName: 'Aoede'
  };

  private animationFrameId: number | null = null;
  private isProcessingTurn = false;

  constructor(callbacks: ConversationManagerCallbacks) {
    this.callbacks = callbacks;

    // 1. Audio Output setup
    this.audioOutput = new AudioOutput((isPlaying) => {
      if (isPlaying && this.state !== 'SPEAKING') {
        this.setState('SPEAKING');
      } else if (!isPlaying && this.state === 'SPEAKING' && !this.isProcessingTurn) {
        this.setState('IDLE');
      }
    });

    // 2. Interruption Manager
    this.interruptionManager = new InterruptionManager(this.audioOutput, {
      onInterrupt: () => {
        this.handleInterruption();
      }
    });

    // 3. VAD setup
    this.vad = new VoiceActivityDetection({
      onSpeechStart: () => {
        this.handleUserSpeechStart();
      },
      onSpeechEnd: (durationMs) => {
        this.handleUserSpeechEnd(durationMs);
      },
      onMetrics: (metrics) => {
        this.callbacks.onAudioMetrics(metrics);
        // Interruption checking while Sofia is speaking
        if (this.state === 'SPEAKING') {
          this.interruptionManager.handleUserSpeechDetected(metrics.isSpeech, metrics.rms);
        }
      },
      onTransientNoise: (type) => {
        console.debug('Environmental sound ignored:', type);
      }
    });

    // 4. Wake Word Detection
    this.wakeWordDetector = new WakeWordDetection({
      onWake: (trigger) => {
        this.handleWakeActivation(trigger);
      }
    });

    // 5. Live API Provider setup
    this.liveApiProvider = new LiveApiProvider({
      onReady: () => {
        console.log('Sofia Live API connected.');
      },
      onAudioChunk: (base64Pcm) => {
        if (this.state !== 'SPEAKING') {
          this.setState('SPEAKING');
          this.interruptionManager.setSofiaSpeaking(true);
        }
        this.audioOutput.queuePcmChunk(base64Pcm);
      },
      onTranscript: (text) => {
        this.activeTranscript += text;
        const inferred = this.emotionEngine.inferEmotionFromText(text);
        if (inferred !== this.emotionEngine.getEmotion()) {
          this.emotionEngine.setEmotion(inferred);
          this.callbacks.onEmotionChange(inferred);
        }
      },
      onInterrupted: () => {
        this.handleInterruption();
      },
      onTurnComplete: () => {
        this.isProcessingTurn = false;
        if (this.activeTranscript.trim()) {
          const cleanedText = this.personaEngine.cleanSpokenText(this.activeTranscript);
          const msg: SofiaMessage = {
            id: 'sofia-' + Date.now(),
            role: 'sofia',
            text: cleanedText,
            timestamp: Date.now(),
            emotion: this.emotionEngine.getEmotion()
          };
          this.messages.push(msg);
          this.callbacks.onMessageAdd(msg);

          // Track story memory if Sofia was telling a story or continuing one
          const currentStory = sophiaMemory.getStory();
          if (currentStory && currentStory.isOngoing) {
            sophiaMemory.updateStoryProgress(currentStory.currentScene || 'in progress', cleanedText);
          } else if (/once upon a time|there was a|long ago|the legend of|chapter|tale of/i.test(cleanedText)) {
            sophiaMemory.setStory({
              title: 'Ongoing Tale',
              summary: cleanedText.slice(0, 150),
              currentScene: 'Introduction',
              lastSpokenText: cleanedText,
              isOngoing: true,
            });
          }

          this.activeTranscript = '';
        }
        if (!this.audioOutput.getIsPlaying()) {
          this.setState('IDLE');
        }
      },
      onError: (err) => {
        console.warn('Live API Provider error:', err);
      },
      onClose: () => {
        console.log('Live API session closed.');
      }
    });
  }

  async boot(): Promise<boolean> {
    this.setState('BOOT');
    try {
      // Initialize audio output
      await this.audioOutput.init();

      // Initialize audio input with 16kHz PCM chunk streaming
      const micSuccess = await this.audioInput.init((pcm16Base64, rawFloat) => {
        // Send to Live API if connected and active
        if (this.liveApiProvider.getIsConnected() && this.isAwake) {
          this.liveApiProvider.sendAudioChunk(pcm16Base64);
        }
        // Also feed raw audio into physical clap detector
        this.wakeWordDetector.processFrameForClap(rawFloat);
      });

      if (!micSuccess) {
        this.setState('ERROR');
        this.callbacks.onError('Microphone access is required to talk with Sofia.');
        return false;
      }

      // Try connecting to Gemini Live API via WebSocket
      const liveConnected = await this.liveApiProvider.connect();
      if (!liveConnected) {
        console.info('Live WebSocket fallback to ModularProvider');
        this.voiceConfig.provider = 'gemini-tts';
      }

      // Start wake word detector
      this.wakeWordDetector.startWakeWordRecognizer();

      // Start audio analysis loop
      this.startAnalysisLoop();

      // Sofia is ready!
      this.isAwake = true;
      this.setState('IDLE');
      return true;
    } catch (err: any) {
      console.error('Boot sequence error:', err);
      this.setState('ERROR');
      this.callbacks.onError(err?.message || 'Failed to start voice system');
      return false;
    }
  }

  private startAnalysisLoop() {
    const inputAnalyser = this.audioInput.getAnalyserNode();
    const outputAnalyser = this.audioOutput.getAnalyserNode();
    if (!inputAnalyser) return;

    const timeData = new Float32Array(inputAnalyser.fftSize);
    const freqData = new Uint8Array(inputAnalyser.frequencyBinCount);

    const tick = () => {
      // When Sofia is speaking, visualize her output voice; otherwise visualize user mic input
      if (this.state === 'SPEAKING' && outputAnalyser) {
        outputAnalyser.getFloatTimeDomainData(timeData);
        outputAnalyser.getByteFrequencyData(freqData);

        let sum = 0;
        let peak = 0;
        for (let i = 0; i < timeData.length; i++) {
          const v = Math.abs(timeData[i]);
          if (v > peak) peak = v;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / timeData.length);

        // Real frequency band extraction for Sofia's output voice
        const binCount = freqData.length;
        const binWidth = (this.audioOutput.getAnalyserNode()?.context.sampleRate || 24000) / (2 * binCount);
        let lowSum = 0;
        let midSum = 0;
        let highSum = 0;
        let peakVal = 0;
        let peakIndex = 0;

        for (let i = 0; i < binCount; i++) {
          const val = freqData[i];
          const freq = i * binWidth;
          if (val > peakVal) {
            peakVal = val;
            peakIndex = i;
          }
          if (freq < 300) {
            lowSum += val;
          } else if (freq <= 2500) {
            midSum += val;
          } else {
            highSum += val;
          }
        }

        const dominantFreq = peakIndex * binWidth || 450;
        const lowEnergy = Math.min(1.0, (lowSum / (binCount * 0.25 * 255)) * 2.5);
        const midEnergy = Math.min(1.0, (midSum / (binCount * 0.5 * 255)) * 2.5);
        const highEnergy = Math.min(1.0, (highSum / (binCount * 0.25 * 255)) * 3.0);

        this.callbacks.onAudioMetrics({
          rms,
          peak,
          lowEnergy,
          midEnergy,
          highEnergy,
          speechScore: 0.95,
          isSpeech: true,
          dominantFrequency: dominantFreq,
          noiseFloor: 0.01,
          isClap: false
        });
      } else {
        inputAnalyser.getFloatTimeDomainData(timeData);
        inputAnalyser.getByteFrequencyData(freqData);
        this.vad.processFrame(timeData, freqData, 16000);
      }

      this.animationFrameId = requestAnimationFrame(tick);
    };

    this.animationFrameId = requestAnimationFrame(tick);
  }

  private handleUserSpeechStart() {
    if (this.state === 'SPEAKING') {
      // Natural interruption!
      this.handleInterruption();
      return;
    }

    if (this.state !== 'LISTENING') {
      this.setState('LISTENING');
    }
  }

  private async handleUserSpeechEnd(_durationMs: number) {
    if (this.state === 'SPEAKING') return;

    // Transition to thinking
    this.setState('THINKING');
    this.isProcessingTurn = true;

    // If using ModularProvider (fallback or configured)
    if (this.voiceConfig.provider !== 'gemini-live' || !this.liveApiProvider.getIsConnected()) {
      // In modular mode, speech recognition provides transcript
      // or we simulate context if speech recognition wasn't available
      const userText = this.activeTranscript || 'Hello Sofia!';
      this.activeTranscript = '';

      const userMsg: SofiaMessage = {
        id: 'user-' + Date.now(),
        role: 'user',
        text: userText,
        timestamp: Date.now()
      };
      this.messages.push(userMsg);
      this.callbacks.onMessageAdd(userMsg);

      // Infer emotion from user speech
      const userEmotion = this.emotionEngine.inferEmotionFromText(userText);
      this.emotionEngine.setEmotion(userEmotion);
      this.callbacks.onEmotionChange(userEmotion);

      // Generate response — cloud (Gemini Flash) first, with a fully-local
      // airplane-mode fallback so she never goes silent (Phase 9).
      const localFirst = airplaneMode.enabled;
      let handledLocally = false;

      try {
        if (localFirst) {
          handledLocally = await this.runLocalTurn(userText, userEmotion);
          if (!handledLocally) throw new Error('local voice unavailable');
        } else {
          const responseText = await this.modularProvider.generateResponse(
            this.messages.map((m) => ({ role: m.role, content: m.text })),
            userText,
            userEmotion
          );

          if (this.state === 'INTERRUPTED') return;

          const cleanText = this.personaEngine.cleanSpokenText(responseText);
          const sofiaMsg: SofiaMessage = {
            id: 'sofia-' + Date.now(),
            role: 'sofia',
            text: cleanText,
            timestamp: Date.now(),
            emotion: userEmotion
          };
          this.messages.push(sofiaMsg);
          this.callbacks.onMessageAdd(sofiaMsg);

          this.setState('SPEAKING');
          this.interruptionManager.setSofiaSpeaking(true);

          await this.modularProvider.speak(
            cleanText,
            this.voiceConfig,
            userEmotion,
            (pcmChunk) => {
              this.audioOutput.queuePcmChunk(pcmChunk);
            }
          );
        }
      } catch (err: any) {
        console.error('Modular turn error:', err);
        // Cloud failed → try the local loop before giving up.
        if (!handledLocally && !localFirst) {
          const recovered = await this.runLocalTurn(userText, userEmotion);
          if (!recovered) {
            this.setState('ERROR');
            setTimeout(() => this.setState('IDLE'), 2000);
          }
        } else {
          this.setState('ERROR');
          setTimeout(() => this.setState('IDLE'), 2000);
        }
      } finally {
        this.isProcessingTurn = false;
        if (!this.audioOutput.getIsPlaying() && this.state !== 'INTERRUPTED') {
          this.setState('IDLE');
        }
      }
    }
  }

  /**
   * Fully offline turn: local brain (Ollama) + local TTS via the companion.
   * Returns true if the turn completed locally. Never throws.
   */
  private async runLocalTurn(userText: string, userEmotion: Emotion): Promise<boolean> {
    try {
      const reply = await airplaneMode.askLocalBrain(userText);
      if (this.state === 'INTERRUPTED') return true;

      const cleanText = this.personaEngine.cleanSpokenText(reply);
      const sofiaMsg: SofiaMessage = {
        id: 'sofia-local-' + Date.now(),
        role: 'sofia',
        text: cleanText,
        timestamp: Date.now(),
        emotion: userEmotion
      };
      this.messages.push(sofiaMsg);
      this.callbacks.onMessageAdd(sofiaMsg);

      this.setState('SPEAKING');
      this.interruptionManager.setSofiaSpeaking(true);
      try {
        await airplaneMode.speakLocal(cleanText);
      } catch {
        // No local TTS engine — fall back to the browser voice so she still answers.
        try { window.speechSynthesis?.speak(new SpeechSynthesisUtterance(cleanText)); } catch { /* ignore */ }
      }
      return true;
    } catch (err) {
      console.warn('Local turn unavailable:', err);
      return false;
    }
  }

  handleInterruption() {
    this.audioOutput.stopImmediately();
    this.modularProvider.stopSpeaking();
    this.liveApiProvider.sendInterrupt();
    this.interruptionManager.setSofiaSpeaking(false);
    this.isProcessingTurn = false;

    // Flash interrupted state briefly then transition to listening
    this.setState('INTERRUPTED');
    setTimeout(() => {
      this.setState('LISTENING');
    }, 280);
  }

  handleWakeActivation(trigger: WakeTrigger) {
    this.isAwake = true;
    this.callbacks.onWakeDetected(trigger);

    // If Sofia is idle, give a brief, natural Australian acknowledgement
    if (this.state === 'IDLE') {
      this.setState('LISTENING');
    }
  }

  triggerTapActivation() {
    this.wakeWordDetector.triggerTapWake();
    if (this.state === 'SPEAKING') {
      this.handleInterruption();
    } else {
      this.isAwake = true;
      this.setState('LISTENING');
    }
  }

  // Voice & Persona customization
  setVoiceConfig(config: Partial<VoiceConfig>) {
    this.voiceConfig = { ...this.voiceConfig, ...config };
  }

  getVoiceConfig(): VoiceConfig {
    return { ...this.voiceConfig };
  }

  setWakeSettings(settings: Partial<WakeSettings>) {
    this.wakeWordDetector.updateSettings(settings);
  }

  getWakeSettings(): WakeSettings {
    return this.wakeWordDetector.getSettings();
  }

  getState(): SofiaState {
    return this.state;
  }

  getEmotion(): Emotion {
    return this.emotionEngine.getEmotion();
  }

  setEmotion(emotion: Emotion) {
    this.emotionEngine.setEmotion(emotion);
    this.callbacks.onEmotionChange(emotion);
  }

  getEmotionTheme() {
    return this.emotionEngine.getTheme();
  }

  getMessages(): SofiaMessage[] {
    return [...this.messages];
  }

  private setState(newState: SofiaState) {
    if (this.state !== newState) {
      this.state = newState;
      this.callbacks.onStateChange(newState);
    }
  }

  destroy() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.audioInput.destroy();
    this.audioOutput.destroy();
    this.wakeWordDetector.destroy();
    this.liveApiProvider.disconnect();
    this.modularProvider.stopListening();
  }
}
