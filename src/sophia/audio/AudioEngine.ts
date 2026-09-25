/**
 * AudioEngine — real microphone capture + low-latency PCM playback.
 *
 * Capture: getUserMedia → AudioWorklet (with ScriptProcessor fallback) → 16 kHz PCM16 frames,
 * plus a smoothed RMS level stream that drives Sophia's listening ripples.
 *
 * Playback: 24 kHz PCM16 queue (Gemini Live native audio) with sample-accurate
 * scheduling and immediate interruption (flush + stop all sources).
 * Encoded audio (Deepgram/Gemini TTS mpeg/wav) is decoded via decodeAudioData.
 */

import { controlLayer } from '../control';

type PCMHandler = (pcm: ArrayBuffer) => void;
type LevelHandler = (level: number) => void;
type MicStatusHandler = (status: MicStatus, errorMsg?: string) => void;

export type MicStatus = 'idle' | 'requesting' | 'capturing' | 'denied' | 'error';

const CAPTURE_WORKLET = `
class SophiCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Int16Array(1024);
    this.len = 0;
    this.ratio = sampleRate / 16000;
    this.inputPos = 0;
    this.prevRms = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || ch.length === 0) return true;

    let sum = 0;
    let peak = 0;
    for (let i = 0; i < ch.length; i++) {
      const s = ch[i];
      sum += s * s;
      const abs = Math.abs(s);
      if (abs > peak) peak = abs;
    }
    const rms = Math.sqrt(sum / ch.length);
    this.port.postMessage({ type: 'level', rms, peak });

    if (peak > 0.55 && this.prevRms < 0.045 && peak / Math.max(rms, 0.001) > 5.5) {
      this.port.postMessage({ type: 'clap', peak, rms });
    }
    this.prevRms = this.prevRms * 0.6 + rms * 0.4;

    let idx = this.inputPos;
    while (idx < ch.length - 1) {
      const i0 = Math.floor(idx);
      const frac = idx - i0;
      const s0 = ch[i0];
      const s1 = ch[i0 + 1];
      const sample = s0 + (s1 - s0) * frac;
      const v = Math.max(-1, Math.min(1, sample));
      this.buf[this.len++] = v < 0 ? v * 0x8000 : v * 0x7fff;

      if (this.len >= 640) {
        const chunk = new Int16Array(this.buf.subarray(0, 640));
        this.port.postMessage({ type: 'pcm', buffer: chunk.buffer }, [chunk.buffer]);
        this.len = 0;
      }
      idx += this.ratio;
    }
    this.inputPos = idx - ch.length;
    return true;
  }
}
registerProcessor('sophia-capture', SophiCapture);
`;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private captureNode: AudioWorkletNode | ScriptProcessorNode | null = null;
  private pcmHandlers = new Set<PCMHandler>();
  private levelHandlers = new Set<LevelHandler>();
  private playbackLevelHandlers = new Set<LevelHandler>();
  private playbackHandlers = new Set<() => void>();
  private clapHandlers = new Set<() => void>();
  private micStatusHandlers = new Set<MicStatusHandler>();
  private lastClap = 0;
  private playCtx: AudioContext | null = null;
  private nextStart = 0;
  private active: AudioBufferSourceNode[] = [];
  private playRms = 0;
  
  capturing = false;
  micStatus: MicStatus = 'idle';
  micErrorDetails: string | null = null;

  onPCM(fn: PCMHandler): () => void {
    this.pcmHandlers.add(fn);
    return () => this.pcmHandlers.delete(fn);
  }
  onMicLevel(fn: LevelHandler): () => void {
    this.levelHandlers.add(fn);
    return () => this.levelHandlers.delete(fn);
  }
  onPlaybackLevel(fn: LevelHandler): () => void {
    this.playbackLevelHandlers.add(fn);
    return () => this.playbackLevelHandlers.delete(fn);
  }
  /** fires when the playback queue fully drains (natural end of utterance) */
  onPlaybackEnd(fn: () => void): () => void {
    this.playbackHandlers.add(fn);
    return () => this.playbackHandlers.delete(fn);
  }
  onClap(fn: () => void): () => void {
    this.clapHandlers.add(fn);
    return () => this.clapHandlers.delete(fn);
  }
  onMicStatus(fn: MicStatusHandler): () => void {
    this.micStatusHandlers.add(fn);
    return () => this.micStatusHandlers.delete(fn);
  }

  private setMicStatus(status: MicStatus, errorMsg?: string) {
    this.micStatus = status;
    this.micErrorDetails = errorMsg ?? null;
    this.micStatusHandlers.forEach((fn) => fn(status, errorMsg));
  }

  get micLevel(): number {
    return this._mic;
  }
  private _mic = 0;

  get playbackLevel(): number {
    return this.playRms;
  }

  async startCapture(): Promise<void> {
    if (this.capturing) return;
    this.setMicStatus('requesting');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const err = 'getUserMedia is not supported on this browser or origin';
      this.setMicStatus('error', err);
      throw new Error(err);
    }

    try {
      // Try high-quality voice constraints first, then basic audio
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (e) {
        console.warn('[AudioEngine] Advanced audio constraints failed, trying basic audio: true', e);
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      this.ctx = new AudioContext();
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }

      const src = this.ctx.createMediaStreamSource(this.stream);
      const silenceGain = this.ctx.createGain();
      silenceGain.gain.value = 0; // Mute local speaker feedback so echo cancellation does not suppress user voice

      // Attempt AudioWorklet first, then fallback to ScriptProcessor
      let workletReady = false;
      if (typeof this.ctx.audioWorklet !== 'undefined') {
        const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }));
        try {
          await this.ctx.audioWorklet.addModule(url);
          this.captureNode = new AudioWorkletNode(this.ctx, 'sophia-capture', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
          });
          this.captureNode.port.onmessage = (e: MessageEvent) => {
            const d = e.data;
            if (d.type === 'pcm') {
              const b: ArrayBuffer = d.buffer;
              this.pcmHandlers.forEach((fn) => fn(b));
            } else if (d.type === 'level') {
              this._mic = this._mic * 0.72 + Math.min(1, d.rms * 5.5) * 0.28;
              this.levelHandlers.forEach((fn) => fn(this._mic));
              if (controlLayer.asrInterruption && this.active.length > 0 && this._mic > 0.06) {
                this.interruptPlayback();
              }
            } else if (d.type === 'clap') {
              const now = performance.now();
              if (now - this.lastClap > 1400) {
                this.lastClap = now;
                this.clapHandlers.forEach((fn) => fn());
              }
            }
          };
          src.connect(this.captureNode);
          this.captureNode.connect(silenceGain);
          silenceGain.connect(this.ctx.destination);
          workletReady = true;
        } catch (err) {
          console.warn('[AudioEngine] AudioWorklet setup failed, falling back to ScriptProcessor:', err);
        } finally {
          URL.revokeObjectURL(url);
        }
      }

      if (!workletReady) {
        // Sample-accurate ScriptProcessorNode fallback
        const spNode = this.ctx.createScriptProcessor(4096, 1, 1);
        this.captureNode = spNode;
        const ratio = this.ctx.sampleRate / 16000;
        const pcmBuf = new Int16Array(1024);
        let pcmLen = 0;
        let inputPos = 0;
        let prevRms = 0;

        spNode.onaudioprocess = (e) => {
          const ch = e.inputBuffer.getChannelData(0);
          if (!ch || ch.length === 0) return;

          let sum = 0;
          let peak = 0;
          for (let i = 0; i < ch.length; i++) {
            const s = ch[i];
            sum += s * s;
            const abs = Math.abs(s);
            if (abs > peak) peak = abs;
          }
          const rms = Math.sqrt(sum / ch.length);
          this._mic = this._mic * 0.72 + Math.min(1, rms * 5.5) * 0.28;
          this.levelHandlers.forEach((fn) => fn(this._mic));
          if (controlLayer.asrInterruption && this.active.length > 0 && this._mic > 0.06) {
            this.interruptPlayback();
          }

          if (peak > 0.55 && prevRms < 0.045 && peak / Math.max(rms, 0.001) > 5.5) {
            const now = performance.now();
            if (now - this.lastClap > 1400) {
              this.lastClap = now;
              this.clapHandlers.forEach((fn) => fn());
            }
          }
          prevRms = prevRms * 0.6 + rms * 0.4;

          let idx = inputPos;
          while (idx < ch.length - 1) {
            const i0 = Math.floor(idx);
            const frac = idx - i0;
            const s0 = ch[i0];
            const s1 = ch[i0 + 1];
            const sample = s0 + (s1 - s0) * frac;
            const v = Math.max(-1, Math.min(1, sample));
            pcmBuf[pcmLen++] = v < 0 ? v * 0x8000 : v * 0x7fff;

            if (pcmLen >= 640) {
              const chunk = new Int16Array(pcmBuf.subarray(0, 640));
              this.pcmHandlers.forEach((fn) => fn(chunk.buffer));
              pcmLen = 0;
            }
            idx += ratio;
          }
          inputPos = idx - ch.length;
        };
        src.connect(spNode);
        spNode.connect(silenceGain);
        silenceGain.connect(this.ctx.destination);
      }

      this.capturing = true;
      this.setMicStatus('capturing');
    } catch (err: any) {
      const isDenied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || (err.message && err.message.toLowerCase().includes('permission denied'));
      if (isDenied) {
        console.warn('[AudioEngine] Microphone permission status: Permission denied');
      } else {
        console.error('[AudioEngine] Microphone error:', err);
      }
      const status: MicStatus = isDenied ? 'denied' : 'error';
      this.setMicStatus(status, isDenied ? 'Microphone permission denied by browser or user' : (err.message || 'Microphone access error'));
      this.stopCapture();
      throw err;
    }
  }

  stopCapture() {
    this.capturing = false;
    this.captureNode?.disconnect();
    this.captureNode = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this._mic = 0;
    if (this.micStatus !== 'denied' && this.micStatus !== 'error') {
      this.setMicStatus('idle');
    }
  }

  /* ------------------------------ playback ------------------------------ */

  private ensurePlayCtx(): AudioContext {
    if (!this.playCtx || this.playCtx.state === 'closed') this.playCtx = new AudioContext();
    if (this.playCtx.state === 'suspended') void this.playCtx.resume();
    return this.playCtx;
  }

  /** Queue a 24 kHz PCM16 chunk (Gemini Live native audio). Returns its RMS level. */
  playPCM24(input: ArrayBuffer | Uint8Array): number {
    const ctx = this.ensurePlayCtx();
    let u8: Uint8Array;
    if (input instanceof Uint8Array) {
      u8 = input;
    } else if (input instanceof ArrayBuffer) {
      u8 = new Uint8Array(input);
    } else {
      return 0;
    }

    const sampleCount = Math.floor(u8.length / 2);
    if (sampleCount === 0) return 0;

    // Use DataView for endian-safe 16-bit signed PCM conversion
    const view = new DataView(u8.buffer, u8.byteOffset, sampleCount * 2);
    const buf = ctx.createBuffer(1, sampleCount, 24000);
    const data = buf.getChannelData(0);
    let sum = 0;

    for (let i = 0; i < sampleCount; i++) {
      const sample16 = view.getInt16(i * 2, true); // Little endian
      const s = sample16 / 0x8000;
      data[i] = s;
      if ((i & 7) === 0) sum += s * s;
    }

    this.playRms = this.playRms * 0.55 + Math.min(1, Math.sqrt(sum / Math.max(1, sampleCount / 8)) * 3.2) * 0.45;
    this.playbackLevelHandlers.forEach((fn) => fn(this.playRms));
    this.schedule(buf);
    return this.playRms;
  }

  /** Play an encoded buffer (mpeg/wav…) — used by TTS fallback paths. */
  async playEncoded(data: ArrayBuffer): Promise<void> {
    const ctx = this.ensurePlayCtx();
    try {
      const buf = await ctx.decodeAudioData(data.slice(0));
      this.schedule(buf);
    } catch {
      /* undecodable chunk — skip silently */
    }
  }

  private schedule(buf: AudioBuffer) {
    const ctx = this.ensurePlayCtx();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);

    // Prevent latency drift or scheduling gaps
    if (this.nextStart < ctx.currentTime - 0.05) {
      this.nextStart = ctx.currentTime + 0.03;
    }
    const t = Math.max(ctx.currentTime + 0.03, this.nextStart);
    src.start(t);
    this.nextStart = t + buf.duration;
    this.active.push(src);

    src.onended = () => {
      this.active = this.active.filter((s) => s !== src);
      if (this.active.length === 0 && this.nextStart <= ctx.currentTime + 0.06) {
        this.playRms = 0;
        this.playbackHandlers.forEach((fn) => fn());
      }
    };
  }

  /** Barge-in: kill everything that is playing or queued. Immediately. */
  interruptPlayback() {
    this.active.forEach((s) => {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    });
    this.active = [];
    if (this.playCtx) this.nextStart = this.playCtx.currentTime;
    this.playRms = 0;
    this.playbackLevelHandlers.forEach((fn) => fn(0));
  }

  dispose() {
    this.stopCapture();
    this.interruptPlayback();
    void this.playCtx?.close().catch(() => undefined);
    this.playCtx = null;
  }
}
