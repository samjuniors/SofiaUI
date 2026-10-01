/**
 * lib/live-turn-latency.ts — Phase 19: server-side per-turn voice-to-voice measurement.
 *
 * The Live relay sees both sides of every turn (mic audio in, model audio
 * out), so it measures end-of-utterance → first-audio directly: t0 is the
 * last mic packet before the model starts answering, t1 is the first model
 * audio chunk forwarded to the client. Unprompted model speech (no recent
 * input) yields no sample — never a bogus zero.
 *
 * Pure + injectable clock; the relay logs every sample and raises
 * `latency_alert` past LIVE_LATENCY_ALERT_MS.
 */

export const LIVE_LATENCY_ALERT_MS = 1000;
/** Input older than this can't plausibly have caused the current audio. */
const INPUT_STALE_MS = 30_000;

export interface LiveLatencySample {
  turn: number;
  ms: number;
}

export class LiveTurnLatency {
  private readonly now: () => number;
  private turn = 0;
  private lastAudioInAt = 0;
  private awaitingFirstAudio = true;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** A mic audio packet arrived from the client. */
  noteAudioIn(): void {
    this.lastAudioInAt = this.now();
  }

  /** A turn boundary passed (turnComplete / interrupted) — arm for next audio. */
  noteTurnBoundary(): void {
    this.awaitingFirstAudio = true;
  }

  /**
   * A model audio chunk is about to be forwarded. Returns the completed
   * sample exactly once per turn, or null for mid-turn chunks and for
   * model speech with no recent user input.
   */
  noteModelAudio(): LiveLatencySample | null {
    if (!this.awaitingFirstAudio) return null;
    this.awaitingFirstAudio = false;
    const t = this.now();
    if (this.lastAudioInAt <= 0 || t - this.lastAudioInAt > INPUT_STALE_MS) return null;
    this.turn += 1;
    return { turn: this.turn, ms: Math.max(0, t - this.lastAudioInAt) };
  }
}
