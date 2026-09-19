import {
  StrokeCandidate,
  StrokeSemanticRole,
  StrokeFilteredReason,
  StrokeMetrics,
  StrokeCandidateSet,
  PathHierarchyLevel,
  SemanticRegion,
  VectorPath,
  VectorGeometry
} from '@sketch-maker/shared-types';

export type {
  StrokeCandidate,
  StrokeSemanticRole,
  StrokeFilteredReason,
  StrokeMetrics,
  StrokeCandidateSet,
  PathHierarchyLevel,
  SemanticRegion,
  VectorPath,
  VectorGeometry
};

/**
 * Configuration options for procedural stroke candidate generation.
 */
export interface StrokeGenerationConfig {
  /** Minimum detector confidence for a stroke candidate to be marked drawable (default: 0.15) */
  readonly minConfidence?: number;
  /** Minimum normalized arc length for a stroke candidate to be retained (default: 0.003) */
  readonly minLength?: number;
  /** Whether to enable drawing of background strokes (default: false — subject-centric) */
  readonly enableBackground?: boolean;
  /** Base line weight multiplier for structural paths (silhouette, jawline, pose) (default: 2.2) */
  readonly baseStructuralWidth?: number;
  /** Base line weight multiplier for primary expressive details (eyes, nose, mouth) (default: 1.6) */
  readonly baseDetailWidth?: number;
  /** Base line weight multiplier for secondary texture & hatching (default: 0.9) */
  readonly baseTextureWidth?: number;
  /** Global multiplier for detail density (default: 1.0) */
  readonly densityScale?: number;
  /** Maximum arc length before splitting a continuous path into gesture strokes (default: 0.35) */
  readonly maxStrokeLength?: number;
  /** Whether to split long paths at sharp angular inflection corners (default: true) */
  readonly splitOnSharpCorners?: boolean;
  /** Threshold in radians for sharp corner splitting (default: 1.30 rad ~ 75 deg) */
  readonly sharpCornerAngleThreshold?: number;
  /** Maximum number of stroke segments derived from any single VectorPath (default: 8) */
  readonly maxCandidatesPerPath?: number;
}

export const DEFAULT_STROKE_GENERATION_CONFIG: Required<StrokeGenerationConfig> = {
  minConfidence: 0.15,
  minLength: 0.003,
  enableBackground: false,
  baseStructuralWidth: 2.2,
  baseDetailWidth: 1.6,
  baseTextureWidth: 0.9,
  densityScale: 1.0,
  maxStrokeLength: 0.35,
  splitOnSharpCorners: true,
  sharpCornerAngleThreshold: 1.30,
  maxCandidatesPerPath: 8
};
