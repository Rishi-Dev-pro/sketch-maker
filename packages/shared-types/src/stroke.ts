import { Point2D, BoundingBox, BezierCurve } from './geometry';
import { SemanticRegion, FeatureVisibility } from './subject';
import { GeometrySource, PathHierarchyLevel } from './vector';

export interface StrokePoint extends Point2D {
  readonly pressure?: number; // Normalized pen pressure [0.0 - 1.0]
  readonly widthMultiplier?: number;
  readonly tangent?: Point2D;
}

/**
 * Universal Stroke representation.
 * Represents an individual procedural vector stroke with final timeline sequence.
 */
export interface Stroke {
  readonly id: string;
  readonly startPoint: StrokePoint;
  readonly endPoint: StrokePoint;
  readonly controlPoints: StrokePoint[];
  readonly region: SemanticRegion;
  readonly importance: number; // Normalized [0.0 - 1.0]
  readonly length: number;     // Normalized geometric arc length
  readonly order: number;      // Sequence index in progressive timeline
  readonly styleMetadata?: Record<string, unknown>;
}

/**
 * Universal StrokeModel
 * Cached intermediate representation containing all synthesized strokes
 * and their drawing sequence.
 */
export interface StrokeModel {
  readonly id: string;
  readonly subjectModelId: string;
  readonly strokes: Stroke[];
  readonly totalStrokes: number;
  readonly totalLength: number;
  readonly drawingOrder: number[]; // Array of stroke indices in progressive order
  readonly timestamp: number;
}

/**
 * High-level artistic/anatomical semantic role for stroke candidates.
 */
export type StrokeSemanticRole =
  | 'silhouette'
  | 'facial_contour'
  | 'eye'
  | 'eyebrow'
  | 'nose'
  | 'mouth'
  | 'ear'
  | 'hair'
  | 'body_structure'
  | 'clothing_boundary'
  | 'semantic_boundary'
  | 'texture'
  | 'detail'
  | 'background'
  | 'contour'
  | 'hatching'
  | 'cross_hatching'
  | 'hair_strand'
  | 'tonal_stroke'
  | 'shadow_stroke'
  | 'highlight_accent';

/**
 * Diagnosable reasons why a stroke candidate might be filtered or marked non-drawable.
 */
export type StrokeFilteredReason =
  | 'occluded'
  | 'not_detected'
  | 'low_confidence'
  | 'too_short'
  | 'invalid_geometry'
  | 'background'
  | 'filtered_noise'
  | 'density_pruned';

/**
 * Procedural Stroke Candidate (TASK-105).
 * Represents a potential drawing action derived from VectorGeometry prior to final
 * timeline ordering and progressive canvas rendering.
 *
 * Distinct from VectorPath (pure geometry) and final Stroke (ordered timeline element).
 */
export interface StrokeCandidate {
  readonly id: string;
  readonly subjectId: string;
  readonly sourcePathId: string;
  readonly source: GeometrySource;
  /** Simplified polyline points for the stroke gesture */
  readonly points: Point2D[];
  /** Optional fitted Bézier curves */
  readonly curves?: BezierCurve[];
  readonly closed: boolean;
  /** Perceptual confidence [0.0, 1.0] */
  readonly confidence: number;
  /** Importance score [0.0, 1.0] refined for stroke-level salience */
  readonly importance: number;
  /** Relative priority score for future timeline scheduling [0.0, 1.0] */
  readonly priorityScore: number;
  readonly semanticRole: StrokeSemanticRole;
  readonly hierarchyLevel: PathHierarchyLevel;
  /** Relative line weight multiplier (1.0 = standard stroke) */
  readonly width: number;
  /** Detail density score [0.0, 1.0] indicating region detail allocation */
  readonly density: number;
  /** Normalized geometric arc length */
  readonly length: number;
  readonly bounds: BoundingBox;
  readonly visibility?: FeatureVisibility;
  /** Whether the stroke candidate is qualified for actual drawing */
  readonly drawable: boolean;
  /** Whether this stroke represents background context */
  readonly isBackground: boolean;
  /** Whether this stroke is a structural skeletal gesture */
  readonly isSkeletal?: boolean;
  /** Reason if filtered or non-drawable */
  readonly filteredReason?: StrokeFilteredReason;
  /** Extensible style & debug metadata */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Diagnostic metrics capturing stroke candidate generation complexity and efficiency.
 */
export interface StrokeMetrics {
  readonly totalCandidates: number;
  readonly drawableCandidates: number;
  readonly filteredCandidates: number;
  readonly totalLength: number;
  readonly averageLength: number;
  readonly averageConfidence: number;
  readonly averageImportance: number;
  readonly averageWidth: number;
  readonly strokesBySemanticRole: Partial<Record<StrokeSemanticRole, number>>;
  readonly strokesByHierarchy: Partial<Record<PathHierarchyLevel, number>>;
  readonly strokesBySubject: Record<string, number>;
  readonly generationLatencyMs: number;
}

/**
 * Container collection for generated stroke candidates.
 */
export interface StrokeCandidateSet {
  readonly version: string;
  readonly candidates: StrokeCandidate[];
  readonly bounds: BoundingBox;
  readonly metrics: StrokeMetrics;
  readonly timestamp: number;
}

/**
 * High-level artistic sequence stage in progressive procedural drawing.
 * Governs the macro-level composition order from foundational structure to fine texture.
 */
export type CompositionPhase =
  | 'foundation'          // Phase 0: Overall boundary / silhouette & structural anchor
  | 'primary_structure'    // Phase 1: Core anatomical architecture (jawline, body skeleton)
  | 'expressive_features' // Phase 2: Focal facial landmarks (eyes, eyebrows, nose, mouth)
  | 'secondary_anatomy'   // Phase 3: Secondary structures (ears, hair volume, clothing boundaries)
  | 'refinement'          // Phase 4: Structural details, inner folds, secondary contours
  | 'texture_accent';     // Phase 5: Surface texture, hatching, hair strands, background accents

/**
 * Ordered Procedural Stroke (TASK-106).
 * Non-destructive wrapper around StrokeCandidate with sequence index, composition phase,
 * and dependency metadata.
 */
export interface OrderedStroke {
  /** Complete, unmodified source StrokeCandidate */
  readonly stroke: StrokeCandidate;
  /** 0-indexed contiguous position in the final drawing sequence */
  readonly sequenceIndex: number;
  /** Composition phase categorization */
  readonly phase: CompositionPhase;
  /** Numeric phase index [0..5] for convenient sorting and filtering */
  readonly phaseIndex: number;
  /** Human-readable phase name */
  readonly phaseName: string;
  /** Structural dependency level (0 = root/parent, 1 = direct child, 2 = nested detail) */
  readonly dependencyLevel: number;
  /** Explanatory rationale for the assigned sequence priority */
  readonly orderingReason: string;
}

/**
 * Diagnostic metrics capturing stroke ordering performance, phase breakdown, and dependency depth.
 */
export interface StrokeOrderingMetrics {
  readonly totalCandidates: number;
  readonly drawableCandidates: number;
  readonly orderedCount: number;
  readonly filteredCount: number;
  readonly phaseCounts: Record<CompositionPhase, number>;
  readonly subjectCounts: Record<string, number>;
  readonly dependencyCount: number;
  readonly maxDependencyDepth: number;
  readonly orderingLatencyMs: number;
}

/**
 * Complete ordered stroke sequence ready for progressive timeline animation (TASK-107).
 */
export interface OrderedStrokeSequence {
  readonly version: string;
  /** Ordered drawable strokes strictly ready for progressive drawing */
  readonly strokes: OrderedStroke[];
  readonly totalStrokes: number;
  readonly drawableStrokes: number;
  /** Filtered non-drawable candidates preserved strictly for auditing/diagnostics */
  readonly filteredStrokes: StrokeCandidate[];
  readonly bounds: BoundingBox;
  readonly metrics: StrokeOrderingMetrics;
  readonly timestamp: number;
}

