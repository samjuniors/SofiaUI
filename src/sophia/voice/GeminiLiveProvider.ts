/**
 * GeminiLiveProvider — PRIMARY realtime conversational transport.
 *
 * Flow:
 *   1. POST /api/sophia/live/session → server mints a short-lived ephemeral token
 *      (API key never leaves the server).
 *   2. Client opens BidiGenerateContentConstrained with that token.
 *   3. 16 kHz PCM16 mic frames stream as realtimeInput.
 *   4. 24 kHz PCM16 model audio plays back; server VAD drives turns;
 *      interruptions flush playback instantly.
 *
 * Emits ONLY the normalized VoiceProvider events.
 */

import { AudioEngine } from '../audio/AudioEngine';
import { controlLayer } from '../control';
import type { FunctionCall } from '../control';
import type { VoiceProviderId } from '../types';
import { VoiceProvider, base64Decode, base64Encode } from './VoiceProvider';

interface LiveSessionTicket {
  token: string;
  model: string;
  wsUrl: string;
  voice?: string;
}

export class GeminiLiveProvider extends VoiceProvider {
  readonly id: VoiceProviderId = 'gemini-live';
  private ws: WebSocket | null = null;
  private detachPCM: (() => void) | null = null;
  private setupDone = false;
  private responseLive = false;
  private outBuf = '';
  private inBuf = '';

  // Live connection statistics
  public stats = {
    connectedAt: 0,
    packetsSent: 0,
    packetsReceived: 0,
    lastLatencyMs: 0,
    modelName: 'gemini-3.8-live',
    voiceName: 'Aoede',
  };

  constructor(private audio: AudioEngine) {
    super();
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.setupDone;
  }

  async start(): Promise<void> {
    await this.stop();

    const voice = controlLayer.voiceName || 'Aoede';
    const res = await fetch('/api/sophia/live/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voice }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`live-session:${res.status}${err.error ? ` (${err.error})` : ''}`);
    }
    const ticket = (await res.json()) as LiveSessionTicket;
    this.stats.modelName = ticket.model || 'gemini-3.8-live';
    this.stats.voiceName = ticket.voice || voice;

    await new Promise<void>((resolve, reject) => {
      const isAuthToken = ticket.token.startsWith('auth_tokens/');
      const param = isAuthToken ? 'access_token' : 'key';
      const wsUrl = `${ticket.wsUrl}?${param}=${encodeURIComponent(ticket.token)}`;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      let settled = false;

      const fail = (msg: string) => {
        if (!settled) {
          settled = true;
          if (this.ws) {
            try {
              this.ws.close();
            } catch {
              /* noop */
            }
          }
          reject(new Error(msg));
        }
      };

      ws.onopen = () => {
        const cfg = controlLayer.sessionConfig(ticket.model);
        const selectedVoice = ticket.voice || controlLayer.voiceName || 'Aoede';
        ws.send(
          JSON.stringify({
            setup: {
              model: cfg.model,
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: selectedVoice },
                  },
                },
              },
              systemInstruction: cfg.systemInstruction,
              tools: [{ functionDeclarations: cfg.functionDeclarations }],
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              realtimeInputConfig: {
                automaticActivityDetection: {
                  startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
                  endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
                  prefixPaddingMs: 160,
                  silenceDurationMs: 520,
                },
              },
            },
          }),
        );
      };

      ws.onerror = (e) => {
        console.warn('[GeminiLiveProvider] WS error:', e);
        fail('live-ws-error');
      };

      ws.onclose = (e) => {
        if (!this.setupDone) {
          fail(`live-closed:${e.code}`);
        } else {
          this.handleClosed();
        }
      };

      ws.onmessage = (ev) => {
        this.stats.packetsReceived++;
        void this.handleMessage(ev.data, () => {
          if (!settled) {
            settled = true;
            this.setupDone = true;
            this.active = true;
            this.stats.connectedAt = Date.now();
            resolve();
          }
        });
      };
    });
  }

  private async handleMessage(raw: string | Blob | ArrayBuffer, onSetup: () => void) {
    if (raw instanceof Blob) raw = await raw.text();
    else if (raw instanceof ArrayBuffer) raw = new TextDecoder().decode(raw);
    let msg: Record<string, any>;
    try {
      msg = JSON.parse(raw as string);
    } catch {
      return;
    }

    if (msg.setupComplete) {
      onSetup();
      this.attachMic();
      this.emit('listening', { source: this.id });
      return;
    }

    const sc = msg.serverContent;
    if (sc) {
      if (sc.interrupted) {
        this.audio.interruptPlayback();
        this.responseLive = false;
        this.flushTranscripts(true);
        this.emit('interrupted', { source: this.id });
        this.emit('listening', { source: this.id });
        return;
      }
      const parts = sc.modelTurn?.parts as Array<Record<string, any>> | undefined;
      if (parts) {
        for (const p of parts) {
          const inline = p.inlineData ?? p.inline_data;
          if (inline?.data && typeof inline.data === 'string') {
            if (!this.responseLive) {
              this.responseLive = true;
              this.emit('response_started', { source: this.id });
              this.emit('audio_started', { source: this.id });
            }
            const level = this.audio.playPCM24(base64Decode(inline.data));
            this.emit('audio_chunk', { level, source: this.id });
          }
          if (typeof p.text === 'string' && p.text.trim() && !p.thought) {
            this.outBuf += p.text;
            controlLayer.addSophiaTurn(this.outBuf, false);
            this.emit('transcript', { role: 'sophia', text: this.outBuf, final: false, source: this.id });
          }
        }
      }
      const it = sc.inputTranscription?.text;
      if (typeof it === 'string' && it) {
        this.inBuf += it;
        controlLayer.addUserTurn(this.inBuf, false);
        this.emit('transcript', { role: 'user', text: this.inBuf, final: false, source: this.id });
      }
      const ot = sc.outputTranscription?.text;
      if (typeof ot === 'string' && ot) {
        this.outBuf += ot;
        controlLayer.addSophiaTurn(this.outBuf, false);
        this.emit('transcript', { role: 'sophia', text: this.outBuf, final: false, source: this.id });
      }
      if (sc.turnComplete || sc.generationComplete) {
        this.flushTranscripts(true);
        this.responseLive = false;
        this.emit('response_finished', { source: this.id });
        this.emit('listening', { source: this.id });
      }
    }

    const toolCall = msg.toolCall;
    if (toolCall?.functionCalls) {
      this.emit('thinking', { source: this.id });
      const calls: FunctionCall[] = toolCall.functionCalls;
      const responses = await Promise.all(
        calls.map(async (c) => ({
          id: c.id,
          name: c.name,
          response: { result: await controlLayer.execute(c) },
        })),
      );
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
        this.stats.packetsSent++;
      }
    }

    if (msg.goAway) {
      this.emit('error', { code: 'go-away', message: 'Gemini live token expiring, renewing...', source: this.id });
    }
  }

  private flushTranscripts(final: boolean) {
    if (this.inBuf) {
      controlLayer.addUserTurn(this.inBuf, final);
      this.emit('transcript', { role: 'user', text: this.inBuf, final, source: this.id });
      this.inBuf = '';
    }
    if (this.outBuf) {
      controlLayer.addSophiaTurn(this.outBuf, final);
      this.emit('transcript', { role: 'sophia', text: this.outBuf, final, source: this.id });
      this.outBuf = '';
    }
  }

  private attachMic() {
    if (this.detachPCM) return;
    this.detachPCM = this.audio.onPCM((pcm) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.setupDone) return;
      const b64 = base64Encode(new Uint8Array(pcm));
      this.ws.send(
        JSON.stringify({
          realtimeInput: {
            mediaChunks: [
              {
                mimeType: 'audio/pcm;rate=16000',
                data: b64,
              },
            ],
          },
        }),
      );
      this.stats.packetsSent++;
    });
  }

  sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    controlLayer.addUserTurn(trimmed, true);
    this.emit('transcript', { role: 'user', text: trimmed, final: true, source: this.id });
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.setupDone) return;
    this.emit('thinking', { source: this.id });
    this.ws.send(
      JSON.stringify({
        clientContent: {
          turns: [
            {
              role: 'user',
              parts: [{ text: trimmed }],
            },
          ],
          turnComplete: true,
        },
      }),
    );
    this.stats.packetsSent++;
  }

  interrupt() {
    this.audio.interruptPlayback();
    this.responseLive = false;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      this.stats.packetsSent++;
    }
  }

  private handleClosed() {
    this.active = false;
    this.setupDone = false;
    this.detachPCM?.();
    this.detachPCM = null;
    this.ws = null;
    this.emit('error', { code: 'transport-closed', message: 'Live WebSocket link closed', source: this.id });
  }

  async stop(): Promise<void> {
    this.active = false;
    this.setupDone = false;
    const ws = this.ws;
    this.ws = null;
    this.detachPCM?.();
    this.detachPCM = null;
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* noop */
      }
    }
  }

  async reset(): Promise<void> {
    await this.stop();
    await this.start();
  }
}
