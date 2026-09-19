import { SemanticRegion, FeatureVisibility, PathHierarchyLevel } from '@sketch-maker/shared-types';

/**
 * Base semantic importance weights by anatomical/structural region.
 * Eyes and facial features take highest precedence; background is lowest.
 */
export const BASE_SEMANTIC_WEIGHTS: Record<SemanticRegion, number> = {
  eyes: 1.00,
  mouth: 0.92,
  nose: 0.88,
  eyebrows: 0.84,
  face_contour: 0.82,
  jawline: 0.80,
  ears: 0.72,
  hair_boundary: 0.68,
  hair: 0.65,
  shoulders: 0.60,
  body_outline: 0.58,
  clothing: 0.48,
  accessories: 0.40,
  texture: 0.30,
  background: 0.20,
  highlight: 0.15
};

/**
 * Structural hierarchy level base weights.
 */
export const HIERARCHY_LEVEL_WEIGHTS: Record<PathHierarchyLevel, number> = {
  0: 0.92, // LEVEL 0 — Silhouette
  1: 0.85, // LEVEL 1 — Major structure
  2: 0.95, // LEVEL 2 — Primary anatomy (facial landmarks)
  3: 0.60, // LEVEL 3 — Semantic boundaries
  4: 0.75  // LEVEL 4 — Fine details (pupil, iris, nostrils)
};

/**
 * Visibility multiplier.
 */
export function getVisibilityWeight(visibility?: FeatureVisibility): number {
  switch (visibility) {
    case 'visible':
      return 1.0;
    case 'uncertain':
      return 0.5;
    case 'occluded':
      return 0.0;
    case 'not_detected':
      return 0.0;
    default:
      return 0.9;
  }
}

/**
 * Computes a deterministic, explainable importance score in [0.0, 1.0] for a vector path.
 *
 * Formula:
 *   importance = clamp(
 *     w_semantic * 0.45 +
 *     confidence * 0.25 +
 *     w_visibility * 0.15 +
 *     structural_significance * 0.15,
 *     0.0, 1.0
 *   )
 */
export function calculatePathImportance(
  region: SemanticRegion,
  confidence: number,
  visibility: FeatureVisibility | undefined,
  length: number,
  level: PathHierarchyLevel
): number {
  const semanticWeight = BASE_SEMANTIC_WEIGHTS[region] ?? 0.50;
  const safeConfidence = Math.max(0.0, Math.min(1.0, confidence));
  const visibilityWeight = getVisibilityWeight(visibility);

  const levelWeight = HIERARCHY_LEVEL_WEIGHTS[level] ?? 0.70;
  const lengthBonus = Math.min(1.0, Math.max(0.0, length * 4.0));
  const structuralSignificance = levelWeight * 0.6 + lengthBonus * 0.4;

  const rawScore =
    semanticWeight * 0.45 +
    safeConfidence * 0.25 +
    visibilityWeight * 0.15 +
    structuralSignificance * 0.15;

  const clamped = Math.max(0.0, Math.min(1.0, rawScore));
  return Math.round(clamped * 10000) / 10000;
}
