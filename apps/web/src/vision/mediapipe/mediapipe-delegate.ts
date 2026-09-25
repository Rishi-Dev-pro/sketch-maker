/**
 * MediaPipe Web Runtime Delegate
 * TASK-103.7 & TASK-103.8 MediaPipe Integration
 *
 * Implements MediaPipeRuntimeDelegate from @sketch-maker/structural-analysis.
 * Lazily loads @mediapipe/tasks-vision, manages shared WASM fileset, and initializes
 * FaceLandmarker and PoseLandmarker models strictly on demand.
 */

import { VisionInput, MediaPipeRuntimeDelegate } from '@sketch-maker/structural-analysis';
import { SubjectModel, Dimensions } from '@sketch-maker/shared-types';
import {
  MediaPipeModelConfig,
  DEFAULT_MEDIAPIPE_CONFIG,
} from './model-config';
import {
  mapMediaPipeFacesToSubjectModels,
  MediaPipeLandmark3D,
} from './landmark-mapper';
import { enrichSubjectWithReconstruction } from '@sketch-maker/structural-analysis';
import {
  RawPoseLandmark,
} from './pose-mapper';
import {
  associateFacesAndPoses,
} from './face-pose-associator';
import {
  mapMediaPipeSegmenterResult,
  MappedSegmentationOutput,
} from './segmenter-mapper';
import {
  reconcileHybridSegmentation,
} from './segmentation-reconciler';

export type DelegateLifecycleState = 'uninitialized' | 'loading' | 'ready' | 'error';

export interface DelegateMetrics {
  coldStartDurationMs: number;
  faceColdStartDurationMs: number;
  poseColdStartDurationMs: number;
  segmenterColdStartDurationMs: number;
  lastWarmInferenceDurationMs: number;
  lastFaceInferenceDurationMs: number;
  lastPoseInferenceDurationMs: number;
  lastSegmenterInferenceDurationMs: number;
  totalInferences: number;
  errorCount: number;
  lastError?: string;
}

export class MediaPipeWebDelegate implements MediaPipeRuntimeDelegate {
  private state: DelegateLifecycleState = 'uninitialized';
  private config: MediaPipeModelConfig;

  // Model instances
  private faceLandmarkerInstance: any = null;
  private poseLandmarkerInstance: any = null;
  private segmenterInstance: any = null;

  // Shared WASM fileset
  private wasmFileset: any = null;
  private filesetPromise: Promise<any> | null = null;
  private faceInitPromise: Promise<void> | null = null;
  private poseInitPromise: Promise<void> | null = null;
  private segmenterInitPromise: Promise<void> | null = null;

  private metrics: DelegateMetrics = {
    coldStartDurationMs: 0,
    faceColdStartDurationMs: 0,
    poseColdStartDurationMs: 0,
    segmenterColdStartDurationMs: 0,
    lastWarmInferenceDurationMs: 0,
    lastFaceInferenceDurationMs: 0,
    lastPoseInferenceDurationMs: 0,
    lastSegmenterInferenceDurationMs: 0,
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
   * Determines whether the MediaPipe runtime is loaded and ready.
   */
  isReady(feature?: 'face' | 'pose' | 'segmenter'): boolean {
    if (feature === 'face') return this.faceLandmarkerInstance !== null;
    if (feature === 'pose') return this.poseLandmarkerInstance !== null;
    if (feature === 'segmenter') return this.segmenterInstance !== null;
    return (
      (this.state === 'ready' || this.faceLandmarkerInstance !== null) &&
      (this.faceLandmarkerInstance !== null ||
        this.poseLandmarkerInstance !== null ||
        this.segmenterInstance !== null)
    );
  }

  /**
   * Loads the shared MediaPipe WASM fileset (once per session).
   */
  private async getFileset(): Promise<any> {
    if (this.wasmFileset) return this.wasmFileset;
    if (this.filesetPromise) return this.filesetPromise;

    this.filesetPromise = (async () => {
      const visionModule = await import('@mediapipe/tasks-vision');
      const { FilesetResolver } = visionModule;
      this.wasmFileset = await FilesetResolver.forVisionTasks(this.config.wasmRootPath);
      return this.wasmFileset;
    })();

    return this.filesetPromise;
  }

  /**
   * Lazily loads and initializes FaceLandmarker.
   */
  async initializeFace(): Promise<void> {
    if (this.faceLandmarkerInstance) return;
    if (this.faceInitPromise) return this.faceInitPromise;

    this.state = 'loading';
    const t0 = performance.now();

    this.faceInitPromise = (async () => {
      try {
        const fileset = await this.getFileset();
        const { FaceLandmarker } = await import('@mediapipe/tasks-vision');

        this.faceLandmarkerInstance = await FaceLandmarker.createFromOptions(fileset, {
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
        this.metrics.faceColdStartDurationMs = performance.now() - t0;
        this.metrics.coldStartDurationMs += this.metrics.faceColdStartDurationMs;
      } catch (err: any) {
        this.state = 'error';
        this.metrics.errorCount++;
        this.metrics.lastError = err?.message ?? 'Failed to initialize FaceLandmarker';
        this.faceInitPromise = null;
        throw new Error(`MediaPipe Face initialization failed: ${this.metrics.lastError}`);
      }
    })();

    return this.faceInitPromise;
  }

  /**
   * Lazily loads and initializes PoseLandmarker.
   */
  async initializePose(): Promise<void> {
    if (this.poseLandmarkerInstance) return;
    if (this.poseInitPromise) return this.poseInitPromise;

    this.state = 'loading';
    const t0 = performance.now();

    this.poseInitPromise = (async () => {
      try {
        const fileset = await this.getFileset();
        const { PoseLandmarker } = await import('@mediapipe/tasks-vision');

        this.poseLandmarkerInstance = await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: this.config.poseModelAssetPath,
            delegate: this.config.delegate,
          },
          runningMode: 'IMAGE',
          numPoses: this.config.maxPoses,
          minPoseDetectionConfidence: this.config.minPoseDetectionConfidence,
          minPosePresenceConfidence: this.config.minPosePresenceConfidence,
          minTrackingConfidence: this.config.minPoseTrackingConfidence,
        });

        this.state = 'ready';
        this.metrics.poseColdStartDurationMs = performance.now() - t0;
        this.metrics.coldStartDurationMs += this.metrics.poseColdStartDurationMs;
      } catch (err: any) {
        this.state = 'error';
        this.metrics.errorCount++;
        this.metrics.lastError = err?.message ?? 'Failed to initialize PoseLandmarker';
        this.poseInitPromise = null;
        throw new Error(`MediaPipe Pose initialization failed: ${this.metrics.lastError}`);
      }
    })();

    return this.poseInitPromise;
  }

  /**
   * Lazily loads and initializes ImageSegmenter (Selfie Multiclass 256x256).
   */
  async initializeSegmenter(): Promise<void> {
    if (this.segmenterInstance) return;
    if (this.segmenterInitPromise) return this.segmenterInitPromise;

    this.state = 'loading';
    const t0 = performance.now();

    this.segmenterInitPromise = (async () => {
      try {
        const fileset = await this.getFileset();
        const { ImageSegmenter } = await import('@mediapipe/tasks-vision');

        this.segmenterInstance = await ImageSegmenter.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: this.config.segmenterModelAssetPath,
            delegate: this.config.delegate,
          },
          runningMode: 'IMAGE',
          outputCategoryMask: true,
          outputConfidenceMasks: true,
        });

        this.state = 'ready';
        this.metrics.segmenterColdStartDurationMs = performance.now() - t0;
        this.metrics.coldStartDurationMs += this.metrics.segmenterColdStartDurationMs;
      } catch (err: any) {
        this.state = 'error';
        this.metrics.errorCount++;
        this.metrics.lastError = err?.message ?? 'Failed to initialize ImageSegmenter';
        this.segmenterInitPromise = null;
        throw new Error(`MediaPipe Segmenter initialization failed: ${this.metrics.lastError}`);
      }
    })();

    return this.segmenterInitPromise;
  }

  /**
   * Initializes all models.
   */
  async initialize(): Promise<void> {
    await Promise.all([this.initializeFace(), this.initializePose(), this.initializeSegmenter()]);
  }

  /**
   * Performs semantic segmentation using MediaPipe ImageSegmenter.
   */
  async segmentImage(input: VisionInput): Promise<MappedSegmentationOutput | null> {
    if (!this.segmenterInstance) {
      await this.initializeSegmenter();
    }

    const { image } = input;
    const width = image.processingDimensions.width;
    const height = image.processingDimensions.height;
    const imageSource = this.createImageSource(image.rgba.data, width, height);

    const ts0 = performance.now();
    try {
      const rawResult = this.segmenterInstance.segment(imageSource);
      this.metrics.lastSegmenterInferenceDurationMs = performance.now() - ts0;
      return mapMediaPipeSegmenterResult(rawResult, width, height, this.config.minSegmentationConfidence);
    } catch (err: any) {
      this.metrics.errorCount++;
      this.metrics.lastError = err?.message ?? 'Image segmentation exception';
      return null;
    }
  }

  /**
   * Processes a preprocessed image buffer through MediaPipe Tasks Vision.
   */
  async process(input: VisionInput): Promise<{
    subjects: SubjectModel[];
    segmentation?: MappedSegmentationOutput | null;
    latencyMs: number;
  }> {
    const needFace = input.options?.includeFacialLandmarks !== false;
    const needPose = input.options?.includeBodyPose !== false;
    const needSegmenter = Boolean(
      (input.options as any)?.includeSegmentation ||
      input.options?.segmentationOptions
    );

    // Lazily load only the requested models
    const initTasks: Promise<void>[] = [];
    if (needFace && !this.faceLandmarkerInstance) initTasks.push(this.initializeFace());
    if (needPose && !this.poseLandmarkerInstance) initTasks.push(this.initializePose());
    if (needSegmenter && !this.segmenterInstance) initTasks.push(this.initializeSegmenter());
    if (initTasks.length > 0) {
      await Promise.all(initTasks);
    }

    const t0 = performance.now();
    const { image, sourceDimensions } = input;
    const width = image.processingDimensions.width;
    const height = image.processingDimensions.height;
    const dims: Dimensions = sourceDimensions
      ? { width: sourceDimensions.width, height: sourceDimensions.height }
      : { width, height };

    // Convert NormalizedImage RGBA buffer to browser-compatible Canvas or ImageData once
    const imageSource = this.createImageSource(image.rgba.data, width, height);

    let rawFaces: MediaPipeLandmark3D[][] = [];
    let rawPoses: RawPoseLandmark[][] = [];
    let segmentationOutput: MappedSegmentationOutput | null = null;

    // 1. Detect Face Landmarks if requested
    if (needFace && this.faceLandmarkerInstance) {
      const tf0 = performance.now();
      try {
        const faceRes = this.faceLandmarkerInstance.detect(imageSource);
        rawFaces = faceRes.faceLandmarks ?? [];
        this.metrics.lastFaceInferenceDurationMs = performance.now() - tf0;
      } catch (err: any) {
        this.metrics.errorCount++;
        this.metrics.lastError = err?.message ?? 'Face detection exception';
      }
    }

    // 2. Detect Pose Landmarks if requested
    if (needPose && this.poseLandmarkerInstance) {
      const tp0 = performance.now();
      try {
        const poseRes = this.poseLandmarkerInstance.detect(imageSource);
        rawPoses = poseRes.landmarks ?? [];
        this.metrics.lastPoseInferenceDurationMs = performance.now() - tp0;
      } catch (err: any) {
        this.metrics.errorCount++;
        this.metrics.lastError = err?.message ?? 'Pose detection exception';
      }
    }

    // 3. Segment image if requested
    if (needSegmenter && this.segmenterInstance) {
      const ts0 = performance.now();
      try {
        const segRes = this.segmenterInstance.segment(imageSource);
        this.metrics.lastSegmenterInferenceDurationMs = performance.now() - ts0;
        segmentationOutput = mapMediaPipeSegmenterResult(segRes, width, height, this.config.minSegmentationConfidence);
      } catch (err: any) {
        this.metrics.errorCount++;
        this.metrics.lastError = err?.message ?? 'Segmenter detection exception';
      }
    }

    const latencyMs = performance.now() - t0;
    this.metrics.lastWarmInferenceDurationMs = latencyMs;
    this.metrics.totalInferences++;

    // 4. Map faces and associate with poses (with photo luminance for tonal analysis)
    const faceSubjects = mapMediaPipeFacesToSubjectModels(rawFaces, dims, 0.92, input.image.luminance);
    let unifiedSubjects = associateFacesAndPoses(faceSubjects, rawPoses, dims);

    // Attach semantic segmentation if computed
    if (segmentationOutput && unifiedSubjects.length > 0) {
      unifiedSubjects = unifiedSubjects.map((sub, idx) => ({
        ...sub,
        semanticSegmentation: idx === 0 ? segmentationOutput!.semanticSegmentation : undefined,
      }));
    }

    return {
      subjects: unifiedSubjects,
      segmentation: segmentationOutput,
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

    if (typeof OffscreenCanvas !== 'undefined') {
      const offscreen = new OffscreenCanvas(width, height);
      const ctx = offscreen.getContext('2d') as any;
      if (ctx) {
        const imgData = new ImageData(new Uint8ClampedArray(rgba), width, height);
        ctx.putImageData(imgData, 0, 0);
        return offscreen;
      }
    }

    if (typeof ImageData !== 'undefined') {
      return new ImageData(new Uint8ClampedArray(rgba), width, height);
    }

    return { width, height, data: rgba };
  }

  /**
   * Releases allocated MediaPipe resources, WASM memory, and offscreen canvases.
   */
  dispose(): void {
    if (this.faceLandmarkerInstance && typeof this.faceLandmarkerInstance.close === 'function') {
      try {
        this.faceLandmarkerInstance.close();
      } catch {
        // Ignore disposal error
      }
    }
    if (this.poseLandmarkerInstance && typeof this.poseLandmarkerInstance.close === 'function') {
      try {
        this.poseLandmarkerInstance.close();
      } catch {
        // Ignore disposal error
      }
    }
    if (this.segmenterInstance && typeof this.segmenterInstance.close === 'function') {
      try {
        this.segmenterInstance.close();
      } catch {
        // Ignore disposal error
      }
    }
    this.faceLandmarkerInstance = null;
    this.poseLandmarkerInstance = null;
    this.segmenterInstance = null;
    this.offscreenCanvas = null;
    this.faceInitPromise = null;
    this.poseInitPromise = null;
    this.segmenterInitPromise = null;
    this.filesetPromise = null;
    this.wasmFileset = null;
    this.state = 'uninitialized';
  }
}

