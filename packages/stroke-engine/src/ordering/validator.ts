import {
  OrderedStrokeSequence,
  OrderedStroke
} from './types';
import { COMPOSITION_PHASES } from './phases';

export interface ValidationIssue {
  readonly severity: 'error' | 'warning';
  readonly field: string;
  readonly message: string;
  readonly strokeId?: string;
}

export interface SequenceValidationResult {
  readonly isValid: boolean;
  readonly issues: ValidationIssue[];
}

/**
 * Validates the structural, geometric, and integrity contracts of an OrderedStrokeSequence.
 */
export function validateOrderedStrokeSequence(
  sequence: OrderedStrokeSequence
): SequenceValidationResult {
  const issues: ValidationIssue[] = [];

  if (!sequence) {
    return {
      isValid: false,
      issues: [{ severity: 'error', field: 'sequence', message: 'Sequence object is null or undefined' }]
    };
  }

  const { strokes, filteredStrokes, metrics } = sequence;
  const seenIds = new Set<string>();

  // 1. Contiguous 0-based sequence indices
  for (let i = 0; i < strokes.length; i++) {
    const s = strokes[i];

    if (s.sequenceIndex !== i) {
      issues.push({
        severity: 'error',
        field: 'sequenceIndex',
        message: `Sequence index mismatch: expected ${i}, found ${s.sequenceIndex}`,
        strokeId: s.stroke.id
      });
    }

    // 2. Duplicate candidate check
    if (seenIds.has(s.stroke.id)) {
      issues.push({
        severity: 'error',
        field: 'strokeId',
        message: `Duplicate stroke ID in sequence: ${s.stroke.id}`,
        strokeId: s.stroke.id
      });
    }
    seenIds.add(s.stroke.id);

    // 3. Occlusion integrity
    if (s.stroke.visibility === 'occluded' || s.stroke.filteredReason === 'occluded') {
      issues.push({
        severity: 'error',
        field: 'visibility',
        message: `Occluded stroke candidate found in drawable sequence: ${s.stroke.id}`,
        strokeId: s.stroke.id
      });
    }

    if (!s.stroke.drawable) {
      issues.push({
        severity: 'error',
        field: 'drawable',
        message: `Non-drawable stroke found in drawable sequence: ${s.stroke.id}`,
        strokeId: s.stroke.id
      });
    }

    // 4. Subject integrity
    if (!s.stroke.subjectId) {
      issues.push({
        severity: 'error',
        field: 'subjectId',
        message: `Missing subjectId on stroke: ${s.stroke.id}`,
        strokeId: s.stroke.id
      });
    }

    // 5. Phase consistency
    const expectedMeta = COMPOSITION_PHASES[s.phase];
    if (!expectedMeta) {
      issues.push({
        severity: 'error',
        field: 'phase',
        message: `Invalid composition phase: ${s.phase}`,
        strokeId: s.stroke.id
      });
    } else if (s.phaseIndex !== expectedMeta.index) {
      issues.push({
        severity: 'error',
        field: 'phaseIndex',
        message: `Phase index mismatch: expected ${expectedMeta.index}, found ${s.phaseIndex}`,
        strokeId: s.stroke.id
      });
    }

    // 6. Geometry preservation
    if (!s.stroke.points || s.stroke.points.length === 0) {
      issues.push({
        severity: 'error',
        field: 'points',
        message: `Stroke contains empty points array`,
        strokeId: s.stroke.id
      });
    }
  }

  // 7. Metric counts consistency
  if (sequence.drawableStrokes !== strokes.length) {
    issues.push({
      severity: 'error',
      field: 'drawableStrokes',
      message: `drawableStrokes metric (${sequence.drawableStrokes}) does not match strokes.length (${strokes.length})`
    });
  }

  if (sequence.totalStrokes !== strokes.length + filteredStrokes.length) {
    issues.push({
      severity: 'error',
      field: 'totalStrokes',
      message: `totalStrokes (${sequence.totalStrokes}) does not equal strokes + filtered (${strokes.length + filteredStrokes.length})`
    });
  }

  return {
    isValid: issues.filter((i) => i.severity === 'error').length === 0,
    issues
  };
}
