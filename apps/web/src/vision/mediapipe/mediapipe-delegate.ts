/**
 * MediaPipe Web Runtime Delegate
 * TASK-103.7 MediaPipe Integration
 *
 * Implements MediaPipeRuntimeDelegate from @sketch-maker/structural-analysis.
 * Lazily loads @mediapipe/tasks-vision and its WebAssembly runtime strictly on demand.
 */

import { VisionInput } from '@sketch-maker/structural-analysis';
import { MediaPipeRuntimeDelegate } from '@sketch-maker/structural-analysis';
import { SubjectModel, Dimensions } from '@sketch-maker/shared-types';
import {
  MediaPipeModelConfig,
  DEFAULT_MEDIAPIPE_CONFIG,
} from './model-config';
import {
  mapMediaPipeFacesToSubjectModels,
  MediaPipeLandmark3D,
} from './landmark-mapper';

export type DelegateLifecycleState = 'uninitialized' | 'loading' | 'ready' | 'error';

export interface DelegateMetrics {
  coldStartDurationMs: number;
  lastWarmInferenceDurationMs: number;
  totalInferences: number;
  errorCount: number;
  lastError?: string;
}

export class MediaPipeWebDelegate implements MediaPipeRuntimeDelegate {
  private state: DelegateLifecycleState = 'uninitialized';
  private config: MediaPipeModelConfig;
  private landmarkerInstance: any = null;
  private initPromise: Promise<void> | null = null;
  private metrics: DelegateMetrics = {
    coldStartDurationMs: 0,
    lastWarmInferenceDurationMs: 0,
    totalInferences: 0,
    errorCount: 0,
  };

  // Reusable offscreen canvas for browser rasterization
  private offscreenCanvas: any = null;

  constructor(config: Partial<MediaPipeModelConfig> = {}) {
    this.config = { ...DEFAULT_MEDIAPIPE_CONFIG, ...config };
  }

  /**
   * Current lifecycle state of the MediaPipe runtime.
   */
  getState(): DelegateLifecycleState {
    return this.state;
  }

  /**
   * Diagnostic metrics capturing cold-start and warm inference latencies.
   */
  getMetrics(): DelegateMetrics {
    return { ...this.metrics };
  }

  /**
   * Determines whether the MediaPipe runtime is loaded, initialized, and ready.
   */
  isReady(): boolean {
    return this.state === 'ready' && this.landmarkerInstance !== null;
  }

  /**
   * Lazily loads the MediaPipe Tasks Vision WebAssembly bundle and FaceLandmarker model.
   * Multiple concurrent calls resolve against the same initialization promise.
   */
  async initialize(): Promise<void> {
    if (this.state === 'ready') return;
    if (this.initPromise) return this.initPromise;

    this.state = 'loading';
    const t0 = performance.now();

    this.initPromise = (async () => {
      try {
        // Dynamic import strictly isolates @mediapipe/tasks-vision from the initial bundle
        const visionModule = await import('@mediapipe/tasks-vision');
        const { FilesetResolver, FaceLandmarker } = visionModule;

        const fileset = await FilesetResolver.forVisionTasks(this.config.wasmRootPath);

        this.landmarkerInstance = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: this.config.modelAssetPath,
            delegate: this.config.delegate,
          },
          runningMode: 'IMAGE',
          numFaces: this.config.maxFaces,
          minFaceDetectionConfidence: this.config.minFaceDetectionConfidence,
          minFacePresenceConfidence: this.config.minFacePresenceConfidence,
          minTrackingConfidence: this.config.minTrackingConfidence,
          outputFaceBlendshapes: this.config.outputFaceBlendshapes,
          outputFacialTransformationMatrixes: this.config.outputFacialTransformationMatrixes,
        });

        this.state = 'ready';
        this.metrics.coldStartDurationMs = performance.now() - t0;
      } catch (err: any) {
        this.state = 'error';
        this.metrics.errorCount++;
        this.metrics.lastError = err?.message ?? 'Failed to initialize MediaPipe FaceLandmarker';
        this.initPromise = null;
        throw new Error(`MediaPipe initialization failed: ${this.metrics.lastError}`);
      }
    })();

    return this.initPromise;
  }

  /**
   * Processes a preprocessed image buffer through the MediaPipe Face Landmarker.
   */
  async process(input: VisionInput): Promise<{
    subjects: SubjectModel[];
    latencyMs: number;
  }> {
    if (!this.isReady()) {
      await this.initialize();
    }

    if (!this.landmarkerInstance) {
      throw new Error('MediaPipe FaceLandmarker instance is unavailable.');
    }

    const t0 = performance.now();
    const { image, sourceDimensions } = input;
    const width = image.processingDimensions.width;
    const height = image.processingDimensions.height;

    // Convert NormalizedImage RGBA buffer to browser-compatible Canvas or ImageData
    const imageSource = this.createImageSource(image.rgba.data, width, height);

    let result: any;
    try {
      result = this.landmarkerInstance.detect(imageSource);
    } catch (err: any) {
      this.metrics.errorCount++;
      this.metrics.lastError = err?.message ?? 'MediaPipe inference exception';
      throw new Error(`MediaPipe inference failed: ${this.metrics.lastError}`);
    }

    const latencyMs = performance.now() - t0;
    this.metrics.lastWarmInferenceDurationMs = latencyMs;
    this.metrics.totalInferences++;

    const rawFaces: MediaPipeLandmark3D[][] = result.faceLandmarks ?? [];
    const dims: Dimensions = sourceDimensions
      ? { width: sourceDimensions.width, height: sourceDimensions.height }
      : { width, height };

    const subjects = mapMediaPipeFacesToSubjectModels(rawFaces, dims, 0.92);

    return {
      subjects,
      latencyMs,
    };
  }

  /**
   * Prepares a Canvas or ImageData source from raw RGBA buffer.
   */
  private createImageSource(
    rgba: Uint8ClampedArray,
    width: number,
    height: number
  ): any {
    // In standard browser environment:
    if (typeof document !== 'undefined') {
      if (!this.offscreenCanvas) {
        this.offscreenCanvas = document.createElement('canvas');
      }
      this.offscreenCanvas.width = width;
      this.offscreenCanvas.height = height;

      const ctx = this.offscreenCanvas.getContext('2d');
      if (ctx) {
        const imgData = ctx.createImageData(width, height);
        imgData.data.set(rgba);
        ctx.putImageData(imgData, 0, 0);
        return this.offscreenCanvas;
      }
    }

    // In environments with OffscreenCanvas support (Workers):
    if (typeof OffscreenCanvas !== 'undefined') {
      const offscreen = new OffscreenCanvas(width, height);
      const ctx = offscreen.getContext('2d') as any;
      if (ctx) {
        const imgData = new ImageData(new Uint8ClampedArray(rgba), width, height);
        ctx.putImageData(imgData, 0, 0);
        return offscreen;
      }
    }

    // Fallback ImageData object:
    if (typeof ImageData !== 'undefined') {
      return new ImageData(new Uint8ClampedArray(rgba), width, height);
    }

    return { width, height, data: rgba };
  }

  /**
   * Releases allocated MediaPipe resources, WASM memory, and offscreen canvases.
   */
  dispose(): void {
    if (this.landmarkerInstance && typeof this.landmarkerInstance.close === 'function') {
      try {
        this.landmarkerInstance.close();
      } catch {
        // Ignore disposal error
      }
    }
    this.landmarkerInstance = null;
    this.offscreenCanvas = null;
    this.initPromise = null;
    this.state = 'uninitialized';
  }
}
