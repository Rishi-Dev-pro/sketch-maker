/**
 * MediaPipe Face Landmarker Configuration
 * TASK-103.7 MediaPipe Integration
 *
 * Configurable parameters for Google MediaPipe Tasks Vision Face Landmarker.
 * Decouples model source URLs and WASM binaries from hardcoded implementation details.
 */

export interface MediaPipeModelConfig {
  /** URL or relative path to face_landmarker.task model binary */
  readonly modelAssetPath: string;
  /** Root URL or relative path for MediaPipe WASM artifacts */
  readonly wasmRootPath: string;
  /** Execution delegate: 'GPU' (WebGL/WebGPU) or 'CPU' */
  readonly delegate: 'GPU' | 'CPU';
  /** Maximum number of faces to detect concurrently (default: 4) */
  readonly maxFaces: number;
  /** Minimum detection confidence threshold [0.0 - 1.0] */
  readonly minFaceDetectionConfidence: number;
  /** Minimum presence confidence threshold [0.0 - 1.0] */
  readonly minFacePresenceConfidence: number;
  /** Minimum tracking confidence threshold [0.0 - 1.0] */
  readonly minTrackingConfidence: number;
  /** Whether to extract facial expression blendshape scores */
  readonly outputFaceBlendshapes: boolean;
  /** Whether to compute facial transformation matrices */
  readonly outputFacialTransformationMatrixes: boolean;
}

/**
 * Production default configuration pointing to verified official CDN assets.
 * Allows local asset overrides without code changes.
 */
export const DEFAULT_MEDIAPIPE_CONFIG: MediaPipeModelConfig = {
  modelAssetPath:
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  wasmRootPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
  delegate: 'GPU',
  maxFaces: 4,
  minFaceDetectionConfidence: 0.5,
  minFacePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
  outputFaceBlendshapes: true,
  outputFacialTransformationMatrixes: true,
};
