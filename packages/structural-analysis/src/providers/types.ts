/**
 * Vision Provider Architecture Contracts
 * TASK-103.6 Provider Abstraction
 *
 * Establishes the decoupled interface between perception backends
 * (deterministic pure TypeScript vs. pretrained ML models) and downstream
 * procedural art generation engines.
 */

import {
  SubjectModel,
  Dimensions,
} from '@sketch-maker/shared-types';
import { NormalizedImage } from '@sketch-maker/image-processing';
import { SubjectAnalysisResult, SegmentationOptions } from '../types';

/**
 * High-level mode indicating how perception should be orchestrated.
 * - 'auto': Prefer ML enhancement if available and loaded; seamlessly fall back to deterministic.
 * - 'deterministic': Exclusively use the pure-TypeScript zero-dependency CV engine.
 * - 'ml': Exclusively use the pretrained ML backend (fails if unavailable).
 * - 'hybrid': Reconcile dense ML landmarks with deterministic ear pinna and boundary contours.
 */
export type VisionExecutionMode = 'auto' | 'deterministic' | 'ml' | 'hybrid';

/**
 * Backend execution technology category.
 */
export type VisionProviderType = 'deterministic' | 'ml' | 'hybrid';

/**
 * Deployment target platform where the provider can operate.
 */
export type VisionProviderPlatform = 'cross-platform' | 'browser' | 'native';

/**
 * Declared capabilities supported by a specific vision provider.
 */
export interface VisionProviderCapabilities {
  /** Can detect facial feature landmarks (eyes, brows, nose, lips) */
  readonly faceLandmarks: boolean;
  /** Density level of facial landmarks if supported */
  readonly faceMeshDensity?: 'sparse_structural' | 'dense_478';
  /** Can detect external ear pinna geometry (helix rim, conchal hollow) */
  readonly earPinna: boolean;
  /** Can extract outer facial oval and mandibular convergence */
  readonly jawlineContour: boolean;
  /** Can isolate scalp hair masses and visible hairline */
  readonly hairStructure: boolean;
  /** Can detect 3D full-body skeletal pose and limb vectors */
  readonly bodyPose: boolean;
  /** Can segment foreground subject from background */
  readonly foregroundSegmentation: boolean;
  /** Can classify semantic regions (hair, skin, clothes, background) */
  readonly multiclassSegmentation: boolean;
}

/**
 * Immutable metadata identifying a vision provider and its runtime characteristics.
 */
export interface VisionProviderMetadata {
  /** Unique machine-readable identifier (e.g., 'deterministic-ts', 'mediapipe-tasks-vision') */
  readonly id: string;
  /** Human-readable display name */
  readonly name: string;
  /** Provider implementation version */
  readonly version: string;
  /** Provider technology category */
  readonly type: VisionProviderType;
  /** Supported platform execution target */
  readonly platform: VisionProviderPlatform;
  /** Capabilities supported by this provider */
  readonly capabilities: VisionProviderCapabilities;
}

/**
 * Execution configuration options passed into a vision analysis request.
 */
export interface VisionAnalysisOptions {
  /** Desired orchestration mode (default: 'auto') */
  readonly mode?: VisionExecutionMode;
  /** Maximum number of subject instances to analyze (default: 4) */
  readonly maxSubjects?: number;
  /** Whether to extract facial feature landmarks (default: true) */
  readonly includeFacialLandmarks?: boolean;
  /** Whether to extract hair silhouette and hairline contours (default: true) */
  readonly includeHair?: boolean;
  /** Whether to extract body pose skeletal landmarks if supported (default: true) */
  readonly includeBodyPose?: boolean;
  /** Low-level segmentation tuning options for deterministic engine */
  readonly segmentationOptions?: SegmentationOptions;
}

/**
 * Standard input payload delivered to any vision provider.
 */
export interface VisionInput {
  /** Preprocessed normalized image (luminance buffer, RGBA, dimensions) */
  readonly image: NormalizedImage;
  /** Original unscaled image dimensions before downsampling */
  readonly sourceDimensions?: Dimensions;
  /** Optional per-request execution configuration */
  readonly options?: VisionAnalysisOptions;
}

/**
 * Provenance and execution audit trail embedded in the final analysis result.
 */
export interface VisionExecutionPlan {
  /** The execution mode requested by the caller */
  readonly requestedMode: VisionExecutionMode;
  /** ID of the provider that actually generated the perception data */
  readonly resolvedProviderId: string;
  /** Whether fallback from an unavailable or failed provider occurred */
  readonly fallbackOccurred: boolean;
  /** Human-readable rationale for fallback if applicable */
  readonly fallbackReason?: string;
  /** Total analysis execution latency in milliseconds */
  readonly executionDurationMs: number;
}

/**
 * Complete immutable output produced by a vision provider.
 * Extends the canonical SubjectAnalysisResult with provider provenance.
 */
export interface VisionResult extends SubjectAnalysisResult {
  /** Provider metadata of the engine that performed the analysis */
  readonly provider: VisionProviderMetadata;
  /** Audit trail documenting mode resolution and fallback behavior */
  readonly executionPlan: VisionExecutionPlan;
}

/**
 * Core contract implemented by all perception providers.
 * Decouples the procedural drawing pipeline from underlying CV/ML runtimes.
 */
export interface VisionProvider {
  /** Static provider identity and capability declaration */
  readonly metadata: VisionProviderMetadata;
  /**
   * Checks whether the provider's execution runtime is ready and operational
   * in the current environment (e.g. WASM loaded, WebGL context available, etc.).
   */
  isAvailable(): Promise<boolean> | boolean;
  /**
   * Analyzes an input image and emits canonical SubjectModels.
   */
  analyze(input: VisionInput): Promise<VisionResult>;
}
