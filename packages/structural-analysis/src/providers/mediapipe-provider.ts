/**
 * MediaPipe Vision Provider (Architectural Placeholder & Future Integration Boundary)
 * TASK-103.6 Provider Abstraction
 *
 * Defines the contract and integration boundary for Google MediaPipe Tasks Vision.
 *
 * NOTE: Per TASK-103.6 requirements, this provider serves as an architectural placeholder
 * without bundling production model binaries or introducing heavy npm dependencies.
 * In environments where the MediaPipe runtime has not been initialized or injected,
 * `isAvailable()` cleanly returns `false`, enabling seamless deterministic fallback.
 */

import {
  VisionProvider,
  VisionProviderMetadata,
  VisionInput,
  VisionResult,
} from './types';
import { SubjectModel } from '@sketch-maker/shared-types';

/**
 * Error raised when MediaPipe ML perception is requested but unavailable.
 */
export class MediaPipeUnavailableError extends Error {
  constructor(message = 'MediaPipe Tasks Vision runtime is not initialized or unavailable in this environment.') {
    super(message);
    this.name = 'MediaPipeUnavailableError';
  }
}

/**
 * Optional pluggable delegate interface allowing browser environments to inject
 * the actual `@mediapipe/tasks-vision` runtime when enabled and cached.
 */
export interface MediaPipeRuntimeDelegate {
  isReady(): boolean | Promise<boolean>;
  process(input: VisionInput): Promise<{
    subjects: SubjectModel[];
    latencyMs: number;
  }>;
}

export class MediaPipeVisionProvider implements VisionProvider {
  readonly metadata: VisionProviderMetadata = {
    id: 'mediapipe-tasks-vision',
    name: 'MediaPipe Tasks Vision Provider',
    version: '0.10.14-stub',
    type: 'ml',
    platform: 'browser',
    capabilities: {
      faceLandmarks: true,
      faceMeshDensity: 'dense_478',
      earPinna: false, // Architectural finding from TASK-103.5: FaceMesh omits ear pinna
      jawlineContour: true,
      hairStructure: true,
      bodyPose: true, // BlazePose 33-joint skeleton
      foregroundSegmentation: true,
      multiclassSegmentation: true,
    },
  };

  private delegate?: MediaPipeRuntimeDelegate;

  constructor(delegate?: MediaPipeRuntimeDelegate) {
    this.delegate = delegate;
  }

  /**
   * Sets or updates the underlying browser runtime delegate.
   */
  setDelegate(delegate: MediaPipeRuntimeDelegate): void {
    this.delegate = delegate;
  }

  /**
   * Determines whether the MediaPipe ML backend is currently operational.
   * Returns false by default unless an active runtime delegate is injected and ready.
   */
  async isAvailable(): Promise<boolean> {
    if (!this.delegate) {
      return false;
    }
    try {
      return await this.delegate.isReady();
    } catch {
      return false;
    }
  }

  /**
   * Analyzes an input image using MediaPipe Tasks Vision.
   * Throws MediaPipeUnavailableError if runtime delegate is missing or unready.
   */
  async analyze(input: VisionInput): Promise<VisionResult> {
    const isReady = await this.isAvailable();
    if (!isReady || !this.delegate) {
      throw new MediaPipeUnavailableError(
        'MediaPipe Tasks Vision is unavailable in the current runtime environment. ' +
        'Ensure WebAssembly and WebGL delegates are initialized, or use the deterministic provider.'
      );
    }

    const { subjects, latencyMs } = await this.delegate.process(input);
    const imgW = input.image.luminance.width;
    const imgH = input.image.luminance.height;
    const origW = input.sourceDimensions?.width ?? imgW;
    const origH = input.sourceDimensions?.height ?? imgH;

    const primarySubject: SubjectModel = subjects[0] ?? {
      id: 'subject-fallback',
      version: '1.0.0',
      sourceDimensions: input.sourceDimensions ?? {
        width: imgW,
        height: imgH,
        aspectRatio: '1:1',
        megapixels: 1.0,
      },
      boundingBox: { x: 0, y: 0, width: 1, height: 1 },
      silhouette: [],
      globalConfidence: 0.1,
      timestamp: Date.now(),
    };

    return {
      primarySubject,
      subjects,
      scale: {
        x: origW / imgW,
        y: origH / imgH,
      },
      metrics: {
        latencyMs,
        subjectCount: subjects.length,
        hasFace: subjects.some((s) => !!s.face),
        hasBody: subjects.some((s) => !!s.body),
      },
      provider: this.metadata,
      executionPlan: {
        requestedMode: input.options?.mode ?? 'ml',
        resolvedProviderId: this.metadata.id,
        fallbackOccurred: false,
        executionDurationMs: latencyMs,
      },
    };
  }
}
