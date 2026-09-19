import { StrokeTimeline } from './timeline-types';

export interface TimelineValidationResult {
  readonly valid: boolean;
  readonly errors: string[];
  readonly warnings: string[];
}

/**
 * Validates the mathematical and structural integrity of a StrokeTimeline.
 * Asserts temporal consistency, non-negativity, contiguous indexing, and occlusion guarantees.
 */
export function validateStrokeTimeline(timeline: StrokeTimeline): TimelineValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { strokes, totalDurationMs } = timeline;

  if (totalDurationMs < 0 || !Number.isFinite(totalDurationMs)) {
    errors.push(`Invalid totalDurationMs: ${totalDurationMs}`);
  }

  for (let i = 0; i < strokes.length; i++) {
    const s = strokes[i];

    // Contiguous 0-based indexing check
    if (s.timelineIndex !== i) {
      errors.push(`Stroke at index ${i} has timelineIndex ${s.timelineIndex}`);
    }

    // Sequence index match check
    if (s.stroke.sequenceIndex !== i) {
      errors.push(`Stroke at index ${i} has mismatched sequenceIndex ${s.stroke.sequenceIndex}`);
    }

    // Non-negativity & finite check
    if (s.startTimeMs < 0 || !Number.isFinite(s.startTimeMs)) {
      errors.push(`Stroke ${s.stroke.stroke.id} has invalid startTimeMs: ${s.startTimeMs}`);
    }

    if (s.durationMs <= 0 || !Number.isFinite(s.durationMs)) {
      errors.push(`Stroke ${s.stroke.stroke.id} has invalid durationMs: ${s.durationMs}`);
    }

    if (s.endTimeMs !== s.startTimeMs + s.durationMs) {
      errors.push(`Stroke ${s.stroke.stroke.id} endTimeMs (${s.endTimeMs}) !== startTimeMs + durationMs (${s.startTimeMs + s.durationMs})`);
    }

    if (s.endTimeMs > totalDurationMs) {
      errors.push(`Stroke ${s.stroke.stroke.id} endTimeMs (${s.endTimeMs}) exceeds totalDurationMs (${totalDurationMs})`);
    }

    // Progress bounds
    if (s.startProgress < 0 || s.startProgress > 1 || !Number.isFinite(s.startProgress)) {
      errors.push(`Stroke ${s.stroke.stroke.id} has out-of-bounds startProgress: ${s.startProgress}`);
    }

    if (s.endProgress < 0 || s.endProgress > 1 || !Number.isFinite(s.endProgress)) {
      errors.push(`Stroke ${s.stroke.stroke.id} has out-of-bounds endProgress: ${s.endProgress}`);
    }

    if (s.startProgress > s.endProgress) {
      errors.push(`Stroke ${s.stroke.stroke.id} startProgress (${s.startProgress}) > endProgress (${s.endProgress})`);
    }

    // Profile Occlusion Check: Occluded features must never produce timeline strokes
    if (s.stroke.stroke.visibility === 'occluded' || s.stroke.stroke.drawable === false) {
      errors.push(`Occluded or non-drawable stroke ${s.stroke.stroke.id} found in timeline`);
    }

    // Geometry integrity check
    if (!s.stroke.stroke.points || s.stroke.stroke.points.length === 0) {
      errors.push(`Stroke ${s.stroke.stroke.id} has empty points array`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
