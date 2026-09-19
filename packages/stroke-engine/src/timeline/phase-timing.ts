import {
  CompositionPhase,
  StrokeSemanticRole,
  TimelineConfig
} from './timeline-types';

/**
 * Role-specific duration multipliers reflecting fine motor drawing speeds.
 * Focal facial anatomy requires deliberate pen precision; background/texture is executed quickly.
 */
const ROLE_DURATION_MULTIPLIERS: Record<StrokeSemanticRole, number> = {
  eye: 1.15,
  mouth: 1.15,
  nose: 1.15,
  silhouette: 1.10,
  body_structure: 1.10,
  facial_contour: 1.10,
  eyebrow: 1.00,
  ear: 1.00,
  hair: 0.90,
  clothing_boundary: 0.90,
  semantic_boundary: 0.85,
  detail: 0.85,
  texture: 0.80,
  background: 0.75
};

/**
 * Returns the duration multiplier for a given composition phase.
 */
export function getPhaseDurationMultiplier(
  phase: CompositionPhase,
  config: TimelineConfig
): number {
  return config.phaseTimingMultipliers[phase] ?? 1.0;
}

/**
 * Returns the duration multiplier for a given semantic role.
 */
export function getRoleDurationMultiplier(role: StrokeSemanticRole): number {
  return ROLE_DURATION_MULTIPLIERS[role] ?? 1.0;
}

/**
 * Determines whether two consecutive strokes represent a major composition phase transition.
 */
export function isPhaseTransition(
  prevPhase: CompositionPhase,
  currPhase: CompositionPhase
): boolean {
  return prevPhase !== currPhase;
}

/**
 * Computes the allowable overlap ratio between the previous stroke and the current stroke.
 * Major phase transitions dampen overlap so that previous anatomical stages visually settle.
 */
export function getAllowableOverlapRatio(
  prevPhase: CompositionPhase,
  currPhase: CompositionPhase,
  config: TimelineConfig
): number {
  if (!config.allowOverlap) {
    return 0.0;
  }

  // Phase transition: dampen overlap to 10% to preserve phase readability
  if (isPhaseTransition(prevPhase, currPhase)) {
    return Math.min(config.overlapRatio * 0.3, 0.10);
  }

  // Refinement and texture strokes within the same phase can overlap more fluidly
  if (currPhase === 'texture_accent' || currPhase === 'refinement') {
    return Math.min(config.overlapRatio * 1.3, 0.50);
  }

  return config.overlapRatio;
}
