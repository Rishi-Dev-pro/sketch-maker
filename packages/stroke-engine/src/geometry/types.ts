import {
  PathHierarchyLevel,
  SemanticRegion,
  VectorPath,
  VectorGeometry,
  GeometryMetrics
} from '@sketch-maker/shared-types';

export type {
  PathHierarchyLevel,
  SemanticRegion,
  VectorPath,
  VectorGeometry,
  GeometryMetrics
};


/**
 * Options for polyline cleaning and validation.
 */
export interface CleaningOptions {
  /** Minimum distance between consecutive points to avoid zero/near-zero segments (default: 0.0001) */
  readonly minPointDistance?: number;
  /** Maximum allowable single-step coordinate delta to filter impossible jumps/spikes (default: 0.35) */
  readonly maxJumpThreshold?: number;
  /** Collinear angle threshold in radians to eliminate redundant straight-line points (default: 0.02 rad ~ 1.1 deg) */
  readonly collinearThreshold?: number;
  /** Minimum number of points required for a valid polyline (default: 2 for lines, 3 for closed) */
  readonly minPoints?: number;
}

/**
 * Tolerances for Ramer-Douglas-Peucker polyline simplification by hierarchy level.
 */
export interface SimplificationTolerances {
  /** LEVEL 0: Silhouette outline (default: 0.0050) */
  readonly level0_silhouette: number;
  /** LEVEL 1: Major structural contours (default: 0.0035) */
  readonly level1_structure: number;
  /** LEVEL 2: Anatomical features (default: 0.0020) */
  readonly level2_anatomy: number;
  /** LEVEL 3: Semantic boundaries (default: 0.0040) */
  readonly level3_semantic: number;
  /** LEVEL 4: Fine details and accents (default: 0.0010) */
  readonly level4_fine: number;
}

/**
 * Options for cubic Bézier curve fitting.
 */
export interface CurveFittingOptions {
  /** Whether to generate Bézier curves in addition to simplified polylines (default: true) */
  readonly enabled?: boolean;
  /** Maximum control point displacement factor relative to chord length (default: 0.5 to prevent loops) */
  readonly maxTension?: number;
}

/**
 * Configuration options for the complete vector geometry extraction pipeline.
 */
export interface VectorExtractionOptions {
  /** Cleaning settings */
  readonly cleaning?: CleaningOptions;
  /** Simplification tolerances per hierarchy level */
  readonly tolerances?: Partial<SimplificationTolerances>;
  /** Curve fitting settings */
  readonly curves?: CurveFittingOptions;
  /** Minimum confidence threshold to include a contour path (default: 0.05) */
  readonly minConfidence?: number;
  /** Minimum normalized arc length to retain a path (default: 0.005, unless landmark point) */
  readonly minPathLength?: number;
  /** Whether to extract raster boundaries from semantic masks (default: true) */
  readonly extractSemanticMaskContours?: boolean;
  /** Downsample factor when tracing mask boundaries for speed and noise reduction (default: 2) */
  readonly maskContourStep?: number;
  /** Minimum pixel area for semantic mask component to be vectorized (default: 50 px) */
  readonly minSemanticArea?: number;
  /** Whether to include pose connection skeleton vectors (default: true) */
  readonly includePoseConnections?: boolean;
}

export const DEFAULT_SIMPLIFICATION_TOLERANCES: SimplificationTolerances = {
  level0_silhouette: 0.0050,
  level1_structure: 0.0035,
  level2_anatomy: 0.0020,
  level3_semantic: 0.0040,
  level4_fine: 0.0010
};

export const DEFAULT_CLEANING_OPTIONS: Required<CleaningOptions> = {
  minPointDistance: 0.0001,
  maxJumpThreshold: 0.35,
  collinearThreshold: 0.02,
  minPoints: 2
};
