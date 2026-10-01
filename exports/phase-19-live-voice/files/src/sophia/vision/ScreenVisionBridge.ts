/**
 * sophia/vision/ScreenVisionBridge.ts
 *
 * On-demand Screen Vision for Sofia (Phase 19: continuous video retired).
 * Holds the user's getDisplayMedia share (screen, window, or tab) and
 * serves SINGLE frames via captureOnce() — the observe tool's fallback
 * when the companion daemon is offline. The model's primary eyes are the
 * companion observe action (screenshot + UI tree); this bridge only fires
 * when asked, never on an interval.
 */

import { controlLayer } from '../control';

export interface VisionShot {
  b64: string;
  mime: string;
  width: number;
  height: number;
}

class ScreenVisionBridge extends EventTarget {
  private mediaStream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private isCapturing = false;

  public get active(): boolean {
    return this.isCapturing;
  }

  /**
   * Request display media from the browser (screen, window, or tab) and
   * hold the share so captureOnce() can peek on demand. Needs a user
   * gesture in most browsers — voice calls must never rely on this.
   */
  public async startCapture(): Promise<boolean> {
    if (this.isCapturing) return true;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      controlLayer.dispatchEvent(
        new CustomEvent('command:notification', {
          detail: {
            message: 'Screen capture is not supported in this browser.',
            level: 'error',
          },
        })
      );
      return false;
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
          frameRate: { ideal: 1, max: 2 },
        } as MediaTrackConstraints,
        audio: false,
      });

      // Handle user clicking "Stop Sharing" in browser chrome
      const track = this.mediaStream.getVideoTracks()[0];
      if (track) {
        track.onended = () => {
          this.stopCapture();
        };
      }

      this.videoEl = document.createElement('video');
      this.videoEl.autoplay = true;
      this.videoEl.muted = true;
      this.videoEl.playsInline = true;
      this.videoEl.srcObject = this.mediaStream;
      await this.videoEl.play();

      this.canvasEl = document.createElement('canvas');
      this.isCapturing = true;

      this.dispatchEvent(new CustomEvent('vision:state', { detail: { active: true } }));
      controlLayer.dispatchEvent(
        new CustomEvent('command:notification', {
          detail: {
            message: 'Screen share ready — Sofia will take a look only when she needs to.',
            level: 'success',
            duration: 3500,
          },
        })
      );
      return true;
    } catch (err: unknown) {
      console.warn('[ScreenVision] User cancelled or error:', err);
      this.stopCapture();
      return false;
    }
  }

  public stopCapture() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.srcObject = null;
      this.videoEl = null;
    }

    this.canvasEl = null;
    const wasCapturing = this.isCapturing;
    this.isCapturing = false;

    if (wasCapturing) {
      this.dispatchEvent(new CustomEvent('vision:state', { detail: { active: false } }));
      controlLayer.dispatchEvent(
        new CustomEvent('command:notification', {
          detail: {
            message: 'Screen Vision disabled.',
            level: 'info',
            duration: 2500,
          },
        })
      );
    }
  }

  public toggleCapture(): Promise<boolean> {
    if (this.isCapturing) {
      this.stopCapture();
      return Promise.resolve(false);
    }
    return this.startCapture();
  }

  /**
   * Sample ONE frame from the held share. Returns null unless a share is
   * active and the video has dimensions — never prompts, never throws.
   */
  public captureOnce(): Promise<VisionShot | null> {
    try {
      if (!this.isCapturing || !this.videoEl || !this.canvasEl) return Promise.resolve(null);
      if (this.videoEl.videoWidth === 0 || this.videoEl.videoHeight === 0) return Promise.resolve(null);

      // Scale down resolution to max 1024 to minimize bandwidth & latency
      const maxDimension = 1024;
      let width = this.videoEl.videoWidth;
      let height = this.videoEl.videoHeight;

      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      this.canvasEl.width = width;
      this.canvasEl.height = height;

      const ctx = this.canvasEl.getContext('2d');
      if (!ctx) return Promise.resolve(null);

      ctx.drawImage(this.videoEl, 0, 0, width, height);

      // Encode as high-compression JPEG
      const dataUrl = this.canvasEl.toDataURL('image/jpeg', 0.65);
      const b64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');

      this.dispatchEvent(
        new CustomEvent('vision:frame', {
          detail: { width, height, timestamp: Date.now() },
        })
      );
      return Promise.resolve({ b64, mime: 'image/jpeg', width, height });
    } catch {
      return Promise.resolve(null);
    }
  }
}

export const screenVisionBridge = new ScreenVisionBridge();
