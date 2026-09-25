import { Point2D, BoundingBox, BezierCurve } from './geometry';
import { SemanticRegion, FeatureVisibility } from './subject';

/**
 * Origin provenance of an extracted vector path.
 */
export type GeometrySource =
  | 'face_landmark'
  | 'face_contour'
  | 'pose_landmark'
  | 'pose_connection'
  | 'deterministic_contour'
  | 'semantic_boundary'
  | 'silhouette'
  | 'edge_structure'
  | 'reconstructed_feature'
  | 'hair_mass'
  | 'hair_flow'
  | 'hair_strand'
  | 'tonal_shading'
  | 'neck_contour'
  | 'clothing_structure'
  | 'unknown';

/**
 * Structural hierarchy level for progressive drawing ordering and adaptive simplification.
 * - 0: LEVEL 0 — Primary outer silhouette
 * - 1: LEVEL 1 — Major structural contours (jawline, neck, shoulders, torso boundaries)
 * - 2: LEVEL 2 — Primary anatomical features (eyes, eyebrows, nose, mouth, ears)
 * - 3: LEVEL 3 — Semantic boundaries (hair volume, clothing seams, skin transitions)
 * - 4: LEVEL 4 — Fine detail accents (eyelid margins, iris/pupil, nostrils, hair wisps)
 */
export type PathHierarchyLevel = 0 | 1 | 2 | 3 | 4;

/**
 * Canonical vector path representation.
 * Resolution-independent, normalized [0.0, 1.0], carrying raw evidence,
 * simplified polyline, optional Bézier curves, and importance ranking.
 */
export interface VectorPath {
  readonly id: string;
  readonly source: GeometrySource;
  readonly region: SemanticRegion;
  readonly level: PathHierarchyLevel;
  /** Cleaned & simplified polyline vertices */
  readonly points: Point2D[];
  /** Preserved raw coordinates for non-destructive reference/debugging */
  readonly rawPoints?: Point2D[];
  /** Optional fitted cubic/quadratic Bézier curves */
  readonly curves?: BezierCurve[];
  readonly closed: boolean;
  /** Perceptual/detection confidence [0.0 - 1.0] */
  readonly confidence: number;
  /** Deterministic semantic importance score [0.0 - 1.0] */
  readonly importance: number;
  /** Normalized geometric arc length */
  readonly length: number;
  /** Normalized bounding box */
  readonly bounds: BoundingBox;
  readonly visibility?: FeatureVisibility;
  /** Multi-subject instance identifier for group isolation (e.g. BM-11) */
  readonly subjectId?: string;
}

/**
 * Diagnostic metrics capturing vectorization complexity and efficiency.
 */
export interface GeometryMetrics {
  readonly totalPaths: number;
  readonly totalRawPoints: number;
  readonly totalSimplifiedPoints: number;
  /** Ratio of removed points: (1 - totalSimplified / totalRaw) */
  readonly pointReductionRatio: number;
  readonly pathCountByLevel: Record<PathHierarchyLevel, number>;
  readonly pathCountByRegion: Partial<Record<SemanticRegion, number>>;
  readonly bounds: BoundingBox;
  readonly processingTimeMs: number;
}

/**
 * Universal VectorGeometry
 * The geometric intermediate representation between perception (SubjectModel)
 * and stroke synthesis (StrokeModel).
 */
export interface VectorGeometry {
  readonly version: string;
  readonly paths: VectorPath[];
  readonly bounds: BoundingBox;
  readonly metrics: GeometryMetrics;
  readonly timestamp: number;
}
