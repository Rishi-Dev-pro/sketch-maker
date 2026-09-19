import {
  StrokeCandidate,
  StrokeSemanticRole,
  StrokeOrderingConfig
} from './types';

export interface SortableStrokeItem {
  readonly candidate: StrokeCandidate;
  readonly phaseIndex: number;
  readonly dependencyLevel: number;
}

/**
 * Returns numeric precedence for semantic roles within expressive features.
 * Default: eye (0) -> eyebrow (1) -> nose (2) -> mouth (3).
 */
function getRolePrecedence(
  role: StrokeSemanticRole,
  expressiveOrder: StrokeSemanticRole[]
): number {
  const idx = expressiveOrder.indexOf(role);
  if (idx !== -1) {
    return idx;
  }

  switch (role) {
    case 'facial_contour':
      return 10;
    case 'body_structure':
      return 11;
    case 'hair':
      return 20;
    case 'ear':
      return 21;
    case 'clothing_boundary':
      return 22;
    case 'semantic_boundary':
      return 23;
    case 'detail':
      return 30;
    case 'texture':
      return 40;
    case 'background':
      return 50;
    default:
      return 99;
  }
}

/**
 * Deterministic multi-factor comparator for ordering stroke candidates.
 *
 * Evaluation Hierarchy:
 * 1. Composition Phase Index (ASC: Foundation -> Primary Structure -> Expressive Features -> Secondary Anatomy -> Refinement -> Texture)
 * 2. Subject ID (ASC: Strict multi-subject isolation & deterministic grouping)
 * 3. Dependency Level (ASC: Containers / Parent anchors before dependent children)
 * 4. Semantic Role Precedence (ASC: e.g. eyes before brows before nose before mouth)
 * 5. Spatial Flow (ASC: Vertical top-to-bottom minY in 0.05 normalized bands)
 * 6. Importance Score (DESC: Highly salient strokes first within sub-category)
 * 7. Arc Length (DESC: Major gesture spans before micro-segments)
 * 8. Source Path ID (ASC: Groups split segments of the same parent path)
 * 9. Candidate ID String Comparison (Deterministic tie-breaker)
 */
export function createStrokeComparator(
  config: Required<StrokeOrderingConfig>
): (a: SortableStrokeItem, b: SortableStrokeItem) => number {
  const expressiveOrder = config.expressiveRoleOrder;
  const spatialFlow = config.spatialFlow;

  return (a: SortableStrokeItem, b: SortableStrokeItem): number => {
    // 1. Composition Phase
    if (a.phaseIndex !== b.phaseIndex) {
      return a.phaseIndex - b.phaseIndex;
    }

    // 2. Subject ID (Group strokes by subject within the phase)
    if (a.candidate.subjectId !== b.candidate.subjectId) {
      return a.candidate.subjectId.localeCompare(b.candidate.subjectId);
    }

    // 3. Dependency Level
    if (a.dependencyLevel !== b.dependencyLevel) {
      return a.dependencyLevel - b.dependencyLevel;
    }

    // 4. Semantic Role Precedence
    const roleA = getRolePrecedence(a.candidate.semanticRole, expressiveOrder);
    const roleB = getRolePrecedence(b.candidate.semanticRole, expressiveOrder);
    if (roleA !== roleB) {
      return roleA - roleB;
    }

    // 5. Spatial Flow (Band-quantized to 0.05 to avoid minor noise dominating importance)
    if (spatialFlow === 'top_to_bottom') {
      const topA = a.candidate.bounds?.y ?? 0;
      const topB = b.candidate.bounds?.y ?? 0;
      const bandA = Math.floor(topA * 20);
      const bandB = Math.floor(topB * 20);
      if (bandA !== bandB) {
        return bandA - bandB;
      }
    } else if (spatialFlow === 'center_outward') {
      const bA = a.candidate.bounds;
      const centerAY = (bA.y + bA.height / 2) - 0.5;
      const centerAX = (bA.x + bA.width / 2) - 0.5;
      const distA = centerAX * centerAX + centerAY * centerAY;

      const bB = b.candidate.bounds;
      const centerBY = (bB.y + bB.height / 2) - 0.5;
      const centerBX = (bB.x + bB.width / 2) - 0.5;
      const distB = centerBX * centerBX + centerBY * centerBY;

      if (Math.abs(distA - distB) > 0.01) {
        return distA - distB;
      }
    }

    // 6. Importance Score (DESC)
    if (Math.abs(a.candidate.importance - b.candidate.importance) > 0.005) {
      return b.candidate.importance - a.candidate.importance;
    }

    // 7. Arc Length (DESC)
    if (Math.abs(a.candidate.length - b.candidate.length) > 0.005) {
      return b.candidate.length - a.candidate.length;
    }

    // 8. Source Path ID (ASC)
    if (a.candidate.sourcePathId !== b.candidate.sourcePathId) {
      return a.candidate.sourcePathId.localeCompare(b.candidate.sourcePathId);
    }

    // 9. Deterministic Candidate ID Tie-Breaker (ASC)
    return a.candidate.id.localeCompare(b.candidate.id);
  };
}
