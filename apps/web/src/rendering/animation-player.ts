import { StrokeTimeline } from '@sketch-maker/shared-types';

export interface PlayerState {
  readonly timeMs: number;
  readonly progress: number;
  readonly isPlaying: boolean;
  readonly isComplete: boolean;
}

export type PlayerUpdateListener = (state: PlayerState) => void;

/**
 * High-precision elapsed wall-clock animation player.
 * Drives the progressive drawing loop using requestAnimationFrame and performance.now(),
 * guaranteeing that frame rates (60fps, 120fps, dropped frames) never alter drawing speed.
 *
 * Implements strict lifecycle control: Play, Pause, Reset, Replay, and Scrub Seeking,
 * with guaranteed zero duplicate RAF loops or dangling timers.
 */
export class AnimationPlayer {
  private timeline: StrokeTimeline | null = null;
  private currentTimeMs: number = 0;
  private isPlaying: boolean = false;
  private playbackSpeed: number = 1.0;
  private rafId: number | null = null;
  private lastWallTime: number = 0;
  private listeners: Set<PlayerUpdateListener> = new Set();

  constructor(timeline?: StrokeTimeline) {
    if (timeline) {
      this.setTimeline(timeline);
    }
  }

  public setTimeline(timeline: StrokeTimeline): void {
    this.timeline = timeline;
    this.currentTimeMs = Math.min(this.currentTimeMs, timeline.totalDurationMs);
    this.notifyListeners();
  }

  public getTimeline(): StrokeTimeline | null {
    return this.timeline;
  }

  public getCurrentTimeMs(): number {
    return this.currentTimeMs;
  }

  public getProgress(): number {
    if (!this.timeline || this.timeline.totalDurationMs <= 0) return 0;
    return Math.min(1.0, Math.max(0.0, this.currentTimeMs / this.timeline.totalDurationMs));
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public getIsComplete(): boolean {
    if (!this.timeline) return false;
    return this.currentTimeMs >= this.timeline.totalDurationMs;
  }

  public getState(): PlayerState {
    return {
      timeMs: this.currentTimeMs,
      progress: this.getProgress(),
      isPlaying: this.isPlaying,
      isComplete: this.getIsComplete()
    };
  }

  public play(): void {
    if (this.isPlaying || !this.timeline) return;

    // If already at completion, wrap around to start
    if (this.getIsComplete()) {
      this.currentTimeMs = 0;
    }

    this.isPlaying = true;
    this.lastWallTime = performance.now();
    this.scheduleFrame();
    this.notifyListeners();
  }

  public pause(): void {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.cancelFrame();
    this.notifyListeners();
  }

  public reset(): void {
    this.pause();
    this.currentTimeMs = 0;
    this.notifyListeners();
  }

  public replay(): void {
    this.pause();
    this.currentTimeMs = 0;
    this.play();
  }

  public seek(targetTimeMs: number): void {
    const total = this.timeline ? this.timeline.totalDurationMs : 0;
    this.currentTimeMs = Math.min(total, Math.max(0, targetTimeMs));
    this.notifyListeners();
  }

  public seekProgress(targetProgress: number): void {
    const total = this.timeline ? this.timeline.totalDurationMs : 0;
    const clampedProgress = Math.min(1.0, Math.max(0.0, targetProgress));
    this.seek(clampedProgress * total);
  }

  public setSpeed(speed: number): void {
    this.playbackSpeed = Math.max(0.1, Math.min(5.0, speed));
  }

  public subscribe(listener: PlayerUpdateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  private scheduleFrame(): void {
    this.cancelFrame();
    this.rafId = requestAnimationFrame(this.onFrame);
  }

  private cancelFrame(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private onFrame = (now: number): void => {
    if (!this.isPlaying || !this.timeline) {
      this.cancelFrame();
      return;
    }

    const deltaWallMs = now - this.lastWallTime;
    this.lastWallTime = now;

    // Advance timeline by elapsed wall-clock time scaled by playback speed
    const deltaTimelineMs = deltaWallMs * this.playbackSpeed;
    this.currentTimeMs = Math.min(
      this.timeline.totalDurationMs,
      this.currentTimeMs + deltaTimelineMs
    );

    this.notifyListeners();

    if (this.currentTimeMs >= this.timeline.totalDurationMs) {
      // Completed playback
      this.isPlaying = false;
      this.cancelFrame();
      this.notifyListeners();
      return;
    }

    this.rafId = requestAnimationFrame(this.onFrame);
  };

  public dispose(): void {
    this.pause();
    this.cancelFrame();
    this.listeners.clear();
    this.timeline = null;
  }
}
