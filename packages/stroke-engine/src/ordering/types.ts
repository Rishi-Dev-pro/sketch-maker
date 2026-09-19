import {
  StrokeCandidate,
  StrokeCandidateSet,
  StrokeSemanticRole,
  PathHierarchyLevel,
  CompositionPhase,
  OrderedStroke,
  StrokeOrderingMetrics,
  OrderedStrokeSequence,
  BoundingBox
} from '@sketch-maker/shared-types';

export type {
  StrokeCandidate,
  StrokeCandidateSet,
  StrokeSemanticRole,
  PathHierarchyLevel,
  CompositionPhase,
  OrderedStroke,
  StrokeOrderingMetrics,
  OrderedStrokeSequence,
  BoundingBox
};

/**
 * Strategy for sequencing strokes when multiple subjects are present (BM-11).
 */
export type MultiSubjectStrategy =
  | 'harmonized_phase'    // Both subjects progress through composition phases together (Recommended)
  | 'sequential_subject';  // Primary subject is fully rendered before secondary subject begins

/**
 * Directional spatial flow preference within a composition phase.
 */
export type SpatialFlowStrategy =
  | 'top_to_bottom'       // Natural artist gesture: upper anatomical structures before lower (minY ASC)
  | 'center_outward'      // Focal center outward to perimeter
  | 'none';               // Rely purely on role precedence and importance

/**
 * Configuration options for procedural stroke ordering and composition.
 */
export interface StrokeOrderingConfig {
  /** Multi-subject composition strategy (default: 'harmonized_phase') */
  readonly multiSubjectStrategy?: MultiSubjectStrategy;
  /** Spatial flow strategy within each phase (default: 'top_to_bottom') */
  readonly spatialFlow?: SpatialFlowStrategy;
  /** Custom role precedence within the expressive_features phase */
  readonly expressiveRoleOrder?: StrokeSemanticRole[];
  /** Whether to evaluate structural parent/child dependencies (default: true) */
  readonly enableDependencies?: boolean;
}

export const DEFAULT_STROKE_ORDERING_CONFIG: Required<StrokeOrderingConfig> = {
  multiSubjectStrategy: 'harmonized_phase',
  spatialFlow: 'top_to_bottom',
  expressiveRoleOrder: ['eye', 'eyebrow', 'nose', 'mouth'],
  enableDependencies: true
};
