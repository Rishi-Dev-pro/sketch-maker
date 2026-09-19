import { StrokeCandidate } from './types';

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: string[];
}

/**
 * Validates a single StrokeCandidate against strict numerical and structural bounds.
 * Ensures platform independence, zero NaNs, and resolution-independent [0.0, 1.0] coordinates.
 */
export function validateStrokeCandidate(candidate: StrokeCandidate): ValidationResult {
  const errors: string[] = [];

  if (!candidate.id || typeof candidate.id !== 'string') {
    errors.push('Candidate ID must be a non-empty string');
  }

  if (!candidate.subjectId || typeof candidate.subjectId !== 'string') {
    errors.push('Subject ID must be a non-empty string');
  }

  if (!candidate.sourcePathId || typeof candidate.sourcePathId !== 'string') {
    errors.push('Source path ID must be a non-empty string');
  }

  if (!candidate.points || candidate.points.length === 0) {
    errors.push('Candidate points must not be empty');
  } else {
    for (let i = 0; i < candidate.points.length; i++) {
      const p = candidate.points[i];
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        errors.push(`Point at index ${i} has non-finite coordinates (${p.x}, ${p.y})`);
        break;
      }
      if (p.x < -0.001 || p.x > 1.001 || p.y < -0.001 || p.y > 1.001) {
        errors.push(`Point at index ${i} is outside [0.0, 1.0] bounds (${p.x}, ${p.y})`);
        break;
      }
    }
  }

  if (!Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) {
    errors.push(`Confidence must be within [0.0, 1.0], received ${candidate.confidence}`);
  }

  if (!Number.isFinite(candidate.importance) || candidate.importance < 0 || candidate.importance > 1) {
    errors.push(`Importance must be within [0.0, 1.0], received ${candidate.importance}`);
  }

  if (!Number.isFinite(candidate.priorityScore) || candidate.priorityScore < 0 || candidate.priorityScore > 1) {
    errors.push(`PriorityScore must be within [0.0, 1.0], received ${candidate.priorityScore}`);
  }

  if (!Number.isFinite(candidate.width) || candidate.width <= 0) {
    errors.push(`Width must be a positive finite number, received ${candidate.width}`);
  }

  if (!Number.isFinite(candidate.density) || candidate.density <= 0 || candidate.density > 1) {
    errors.push(`Density must be within (0.0, 1.0], received ${candidate.density}`);
  }

  if (!Number.isFinite(candidate.length) || candidate.length < 0) {
    errors.push(`Length must be non-negative, received ${candidate.length}`);
  }

  if (candidate.bounds) {
    const b = candidate.bounds;
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.width) || !Number.isFinite(b.height)) {
      errors.push('Bounding box contains non-finite dimensions');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
