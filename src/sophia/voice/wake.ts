/**
 * WakeWord — a real wake-phrase spotter for “Hey Sophia”.
 *
 * Uses the browser SpeechRecognition stream in a resilient loop. It never
 * fabricates a wake: it only fires when the recognizer actually hears
 * "sophia". If the engine is unavailable or permission is denied, the
 * spotter simply reports itself unavailable and the mic button remains
 * the manual activator. Keyboard is always the final fallback.
 */

type AnySpeech = {
  new (): SpeechRecognitionLike;
};

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export class WakeWordSpotter {
  private rec: SpeechRecognitionLike | null = null;
  private wantOn = false;
  private lastFire = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  available = false;
  blocked = false;

  constructor(private onWake: () => void) {}

  private create(): SpeechRecognitionLike | null {
    const w = window as unknown as Record<string, AnySpeech | undefined>;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return null;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.maxAlternatives = 2;
    rec.onresult = (e) => this.hear(e);
    rec.onerror = (e) => {
      const err = (e as { error?: string }).error;
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        this.blocked = true;
        this.wantOn = false;
      }
    };
    rec.onend = () => {
      if (this.wantOn && !this.blocked) {
        this.restartTimer = setTimeout(() => this.safeStart(), 480);
      }
    };
    return rec;
  }

  private hear(e: unknown) {
    const ev = e as {
      resultIndex: number;
      results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
    };
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      const text = (r[0]?.transcript ?? '').toLowerCase();
      const strong = r.isFinal || text.trim().split(/\s+/).length <= 4;
      if (strong && /(^|\b)(hey|hi|ok|okay)?\s*[,'\s]*sophia\b/.test(text)) {
        const now = performance.now();
        if (now - this.lastFire > 2600) {
          this.lastFire = now;
          this.onWake();
        }
        return;
      }
    }
  }

  private safeStart() {
    try {
      this.rec?.start();
    } catch {
      /* already running */
    }
  }

  start() {
    if (this.blocked) return;
    this.wantOn = true;
    if (!this.rec) {
      this.rec = this.create();
      this.available = Boolean(this.rec);
    }
    if (this.rec) this.safeStart();
  }

  suspend() {
    this.wantOn = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    try {
      this.rec?.stop();
    } catch {
      /* noop */
    }
  }

  stop() {
    this.suspend();
  }
}
