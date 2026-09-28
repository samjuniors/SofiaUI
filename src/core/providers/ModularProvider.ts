import { Emotion, VoiceConfig } from '../../types/sofia';

export class ModularProvider {
  private speechRecognition: any = null;
  private isListening = false;
  private onTranscriptCallback?: (text: string, isFinal: boolean) => void;

  constructor() {
    this.initSpeechRecognition();
  }

  private initSpeechRecognition() {
    if (typeof window === 'undefined') return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
      this.speechRecognition = new SpeechRecognition();
      this.speechRecognition.continuous = true;
      this.speechRecognition.interimResults = true;
      this.speechRecognition.lang = 'en-AU'; // Australian English

      this.speechRecognition.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }

        if (finalTranscript && this.onTranscriptCallback) {
          this.onTranscriptCallback(finalTranscript.trim(), true);
        } else if (interimTranscript && this.onTranscriptCallback) {
          this.onTranscriptCallback(interimTranscript.trim(), false);
        }
      };

      this.speechRecognition.onerror = (e: any) => {
        if (e.error !== 'no-speech' && e.error !== 'aborted') {
          console.debug('Modular speech recognition error:', e.error);
        }
      };

      this.speechRecognition.onend = () => {
        if (this.isListening) {
          try {
            this.speechRecognition.start();
          } catch (_e) {
            // Already started
          }
        }
      };
    } catch (_e) {
      console.warn('SpeechRecognition initialization error:', _e);
    }
  }

  startListening(onTranscript: (text: string, isFinal: boolean) => void) {
    this.onTranscriptCallback = onTranscript;
    this.isListening = true;
    if (this.speechRecognition) {
      try {
        this.speechRecognition.start();
      } catch (_e) {
        // Already started
      }
    }
  }

  stopListening() {
    this.isListening = false;
    if (this.speechRecognition) {
      try {
        this.speechRecognition.stop();
      } catch (_e) {
        // Ignored
      }
    }
  }

  /**
   * Generates conversation response from Gemini 3.8 Flash
   */
  async generateResponse(
    messages: { role: string; content: string }[],
    userText: string,
    emotion: Emotion
  ): Promise<string> {
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, userText, emotion })
      });
      if (!res.ok) {
        throw new Error(`Chat request failed: ${res.statusText}`);
      }
      const data = await res.json();
      return data.text || '';
    } catch (e: any) {
      console.warn('Error from /api/chat, falling back to conversational template:', e);
      // Fallback natural Australian response if backend is offline
      return "I'm right here with you! What's on your mind today?";
    }
  }

  /**
   * Synthesizes speech using server Gemini TTS or browser speech synthesis
   */
  async speak(
    text: string,
    voiceConfig: VoiceConfig,
    emotion: Emotion,
    onAudioPcmChunk?: (base64Pcm: string) => void
  ): Promise<void> {
    // 1. Try Gemini TTS API first if requested
    if (voiceConfig.provider === 'gemini-tts' && onAudioPcmChunk) {
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            voice: voiceConfig.geminiVoiceName,
            emotion
          })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.audio) {
            onAudioPcmChunk(data.audio);
            return;
          }
        }
      } catch (err) {
        console.warn('Gemini TTS failed, falling back to Web Speech Synthesis:', err);
      }
    }

    // 2. Web Speech Synthesis fallback (Australian voice selection)
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        resolve();
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = voiceConfig.speed || 1.0;
      utterance.pitch = voiceConfig.pitch || 1.0;

      // Locate Australian female voice if available
      const voices = window.speechSynthesis.getVoices();
      const auFemaleVoice = voices.find(
        (v) =>
          (v.lang === 'en-AU' || v.lang.startsWith('en_AU')) &&
          /karen|catherine|olivia|female|zira|samantha/i.test(v.name)
      ) || voices.find((v) => v.lang === 'en-AU' || v.lang.startsWith('en_AU'))
        || voices.find((v) => v.lang.startsWith('en') && /female|woman|karen/i.test(v.name));

      if (auFemaleVoice) {
        utterance.voice = auFemaleVoice;
      }

      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();

      window.speechSynthesis.speak(utterance);
    });
  }

  stopSpeaking() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }
}
