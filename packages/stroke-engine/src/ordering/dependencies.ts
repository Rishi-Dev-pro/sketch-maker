import {
  StrokeCandidate,
  CompositionPhase
} from './types';

export interface DependencyAnalysisResult {
  readonly dependencyLevels: Map<string, number>;
  readonly totalEdges: number;
  readonly maxDepth: number;
}

/**
 * Deterministically computes the structural dependency level of a stroke candidate.
 * - Level 0: Root structural feature with no upstream parent.
 * - Level 1: Primary anatomical feature depending on a Level 0 container.
 * - Level 2: Nested refinement or texture accent depending on a Level 1 feature.
 */
export function computeDependencyLevel(
  candidate: StrokeCandidate,
  phase: CompositionPhase
): number {
  const { semanticRole, hierarchyLevel } = candidate;

  // Foundation & Primary Structure are always Level 0 (Roots)
  if (phase === 'foundation') {
    return 0;
  }

  if (phase === 'primary_structure') {
    return 0;
  }

  // Phase 2: Expressive Features depend on Phase 1 (Level 1)
  if (phase === 'expressive_features') {
    return hierarchyLevel === 4 ? 2 : 1;
  }

  // Phase 3: Secondary Anatomy (hair volume, ears, clothing boundaries) depend on frame (Level 1)
  if (phase === 'secondary_anatomy') {
    return 1;
  }

  // Phase 4: Refinement details depend on primary/secondary features (Level 2)
  if (phase === 'refinement') {
    return 2;
  }

  // Phase 5: Textures & background accents (Level 2)
  if (phase === 'texture_accent') {
    return 2;
  }

  return 0;
}

/**
 * Analyzes the global dependency graph across all stroke candidates.
 * Identifies relationships between container paths and nested detail paths.
 */
export function analyzeDependencies(
  candidates: StrokeCandidate[],
  phaseAssignments: Map<string, CompositionPhase>
): DependencyAnalysisResult {
  const dependencyLevels = new Map<string, number>();
  let totalEdges = 0;
  let maxDepth = 0;

  // Group candidates by subject and phase
  const rootIds = new Set<string>();

  for (const c of candidates) {
    const phase = phaseAssignments.get(c.id) || 'refinement';
    const level = computeDependencyLevel(c, phase);
    dependencyLevels.set(c.id, level);

    if (level === 0) {
      rootIds.add(c.id);
    } else {
      // Each dependent stroke links conceptually to upstream structural anchors
      totalEdges += 1;
    }

    if (level > maxDepth) {
      maxDepth = level;
    }
  }

  return {
    dependencyLevels,
    totalEdges,
    maxDepth
  };
}
