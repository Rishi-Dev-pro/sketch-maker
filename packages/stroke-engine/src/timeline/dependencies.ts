import {
  OrderedStroke,
  TimelineConfig
} from './timeline-types';

export interface ScheduledStrokeInfo {
  readonly stroke: OrderedStroke;
  readonly startTimeMs: number;
  readonly durationMs: number;
  readonly endTimeMs: number;
}

/**
 * Determines whether candidate 'parent' is a structural parent of 'child'.
 */
function isStructuralParent(parent: OrderedStroke, child: OrderedStroke): boolean {
  // Must belong to the same subject
  if (parent.stroke.subjectId !== child.stroke.subjectId) {
    return false;
  }

  // Iris/pupil depends specifically on eye contours
  if (
    child.stroke.hierarchyLevel === 4 &&
    child.stroke.semanticRole === 'eye' &&
    parent.stroke.semanticRole === 'eye' &&
    parent.stroke.hierarchyLevel < 4
  ) {
    return true;
  }

  // Facial features depend on head/jawline primary structure
  if (
    child.phase === 'expressive_features' &&
    parent.phase === 'primary_structure'
  ) {
    return true;
  }

  // Ears & secondary anatomy depend on head/jawline
  if (
    child.phase === 'secondary_anatomy' &&
    (parent.phase === 'primary_structure' || parent.phase === 'foundation')
  ) {
    return true;
  }

  // Refinement details depend on secondary anatomy or primary structure
  if (
    child.phase === 'refinement' &&
    (parent.phase === 'secondary_anatomy' || parent.phase === 'primary_structure')
  ) {
    return true;
  }

  // Texture and background accents depend on structural frames
  if (
    child.phase === 'texture_accent' &&
    parent.dependencyLevel === 0
  ) {
    return true;
  }

  // General hierarchy dependency: Level 1 depends on Level 0; Level 2 depends on Level 1
  if (child.dependencyLevel > parent.dependencyLevel) {
    return true;
  }

  return false;
}

/**
 * Evaluates dependency constraints for a candidate stroke against previously scheduled strokes.
 * Returns the earliest permissible start timestamp in milliseconds.
 */
export function calculateDependencyEarliestStart(
  child: OrderedStroke,
  scheduledStrokes: ScheduledStrokeInfo[],
  config: TimelineConfig
): { earliestStartMs: number; parentId?: string; delayMs: number } {
  let maxRequiredStart = 0;
  let constrainingParentId: string | undefined;

  // Search backward through scheduled strokes for the most relevant structural parent
  for (let i = scheduledStrokes.length - 1; i >= 0; i--) {
    const parentInfo = scheduledStrokes[i];
    if (isStructuralParent(parentInfo.stroke, child)) {
      const requiredStart = parentInfo.startTimeMs +
        Math.round(parentInfo.durationMs * config.minParentProgress);

      if (requiredStart > maxRequiredStart) {
        maxRequiredStart = requiredStart;
        constrainingParentId = parentInfo.stroke.stroke.id;
      }

      // If we find an immediate direct parent (e.g. eye contour for iris), that's sufficient
      if (
        child.stroke.semanticRole === 'eye' &&
        parentInfo.stroke.stroke.semanticRole === 'eye'
      ) {
        break;
      }
    }
  }

  return {
    earliestStartMs: maxRequiredStart,
    parentId: constrainingParentId,
    delayMs: 0
  };
}
