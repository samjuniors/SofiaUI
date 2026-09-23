/**
 * AudioEngine — real microphone capture + low-latency PCM playback.
 *
 * Capture: getUserMedia → AudioWorklet → 16 kHz PCM16 frames (20 ms),
 * plus a smoothed RMS level stream that drives Sophia's listening ripples.
 *
 * Playback: 24 kHz PCM16 queue (Gemini Live native audio) with sample-accurate
 * scheduling and *immediate* interruption (flush + stop all sources).
 * Encoded audio (Deepgram mpeg) is decoded via decodeAudioData.
 *
 * The worklet source is embedded and loaded through a Blob URL so the
 * single-file build never depends on external assets.
 */

type PCMHandler = (pcm: ArrayBuffer) => void;
type LevelHandler = (level: number) => void;

const CAPTURE_WORKLET = `
class SophiCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(4096);
    this.len = 0;
    this.ratio = sampleRate / 16000;
    this.pos = 0;
    this.frames = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || ch.length === 0) return true;
    // RMS for the visual layer
    let sum = 0;
    for (let i = 0; i < ch.length; i += 4) { const s = ch[i]; sum += s * s; }
    const rms = Math.sqrt(sum / Math.max(1, ch.length / 4));
    if ((this.frames++ & 3) === 0) this.port.postMessage({ type: 'level', rms });
    // downsample to 16k
    const nOut = Math.floor(ch.length / this.ratio);
    for (let i = 0; i < nOut; i++) {
      const idx = this.pos + i * this.ratio;
      const i0 = Math.floor(idx);
      const f = idx - i0;
      const s0 = ch[Math.min(i0, ch.length - 1)];
      const s1 = ch[Math.min(i0 + 1, ch.length - 1)];
      this.buf[this.len++] = s0 + (s1 - s0) * f;
      if (this.len >= 320 * 4) {
        const pcm = new Int16Array(this.len);
        for (let j = 0; j < this.len; j++) {
          const v = Math.max(-1, Math.min(1, this.buf[j]));
          pcm[j] = v < 0 ? v * 0x8000 : v * 0x7fff;
        }
        this.port.postMessage({ type: 'pcm', buffer: pcm.buffer }, [pcm.buffer]);
        this.len = 0;
      }
    }
    return true;
  }
}
registerProcessor('sophia-capture', SophiCapture);
`;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private captureNode: AudioWorkletNode | null = null;
  private pcmHandlers = new Set<PCMHandler>();
  private levelHandlers = new Set<LevelHandler>();
  private playbackLevelHandlers = new Set<LevelHandler>();
  private playbackHandlers = new Set<() => void>();
  private playCtx: AudioContext | null = null;
  private nextStart = 0;
  private active: AudioBufferSourceNode[] = [];
  private playRms = 0;
  capturing = false;

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

  get micLevel(): number {
    return this._mic;
  }
  private _mic = 0;

  async startCapture(): Promise<void> {
    if (this.capturing) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }));
    try {
      await this.ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const src = this.ctx.createMediaStreamSource(this.stream);
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
      }
    };
    src.connect(this.captureNode);
    // the worklet never writes output, so connecting to destination emits
    // pure silence while keeping the processor guaranteed-active everywhere
    this.captureNode.connect(this.ctx.destination);
    this.capturing = true;
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
  }

  /* ------------------------------ playback ------------------------------ */

  private ensurePlayCtx(): AudioContext {
    if (!this.playCtx || this.playCtx.state === 'closed') this.playCtx = new AudioContext();
    if (this.playCtx.state === 'suspended') void this.playCtx.resume();
    return this.playCtx;
  }

  /** Queue a 24 kHz PCM16 chunk (Gemini Live format). Returns its RMS level. */
  playPCM24(input: ArrayBuffer): number {
    const ctx = this.ensurePlayCtx();
    const pcm = new Int16Array(input.slice(0));
    const len = pcm.length;
    if (len === 0) return 0;
    const buf = ctx.createBuffer(1, len, 24000);
    const data = buf.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < len; i++) {
      const s = pcm[i] / 0x8000;
      data[i] = s;
      if ((i & 7) === 0) sum += s * s;
    }
    this.playRms = this.playRms * 0.55 + Math.min(1, Math.sqrt(sum / Math.max(1, len / 8)) * 3.2) * 0.45;
    this.playbackLevelHandlers.forEach((fn) => fn(this.playRms));
    this.schedule(buf);
    return this.playRms;
  }

  /** Play an encoded buffer (mpeg/wav…) — used by the Deepgram fallback path. */
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
    const t = Math.max(ctx.currentTime + 0.04, this.nextStart);
    src.start(t);
    this.nextStart = t + buf.duration;
    this.active.push(src);
    src.onended = () => {
      this.active = this.active.filter((s) => s !== src);
      if (this.active.length === 0 && this.nextStart <= ctx.currentTime + 0.05) {
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
