import { Point2D } from '@sketch-maker/shared-types';
import {
  VectorPath,
  StrokeSemanticRole,
  StrokeFilteredReason,
  StrokeGenerationConfig
} from './types';

export interface EligibilityResult {
  readonly drawable: boolean;
  readonly isBackground: boolean;
  readonly filteredReason?: StrokeFilteredReason;
}

/**
 * Evaluates candidate eligibility and drawability based on visibility,
 * confidence thresholds, length constraints, background policy, and geometric validity.
 */
export function evaluateStrokeEligibility(
  path: VectorPath,
  segmentPoints: readonly Point2D[],
  segmentLength: number,
  role: StrokeSemanticRole,
  config: StrokeGenerationConfig
): EligibilityResult {
  const isBackground = role === 'background' || path.region === 'background';
  const minConfidence = config.minConfidence ?? 0.15;
  const minLength = config.minLength ?? 0.003;
  const enableBackground = config.enableBackground ?? false;

  // 1. Geometry validity check
  if (!segmentPoints || segmentPoints.length === 0) {
    return { drawable: false, isBackground, filteredReason: 'invalid_geometry' };
  }

  for (const pt of segmentPoints) {
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
      return { drawable: false, isBackground, filteredReason: 'invalid_geometry' };
    }
  }

  // 2. Strict Profile & Pose Occlusion Enforcement (e.g. BM-02)
  if (path.visibility === 'occluded') {
    return { drawable: false, isBackground, filteredReason: 'occluded' };
  }

  if (path.visibility === 'not_detected') {
    return { drawable: false, isBackground, filteredReason: 'not_detected' };
  }

  // 3. Background Policy Check
  if (isBackground && !enableBackground) {
    return { drawable: false, isBackground, filteredReason: 'background' };
  }

  // 4. Detector Confidence Check
  if (path.confidence < minConfidence) {
    return { drawable: false, isBackground, filteredReason: 'low_confidence' };
  }

  // 5. Length Threshold Check (fine features and single points have lower thresholds)
  const isSinglePoint = segmentPoints.length === 1;
  const isFineFeature =
    role === 'eye' ||
    role === 'hatching' ||
    role === 'cross_hatching' ||
    role === 'hair_strand' ||
    role === 'tonal_stroke' ||
    role === 'highlight_accent' ||
    path.id.includes('tick') ||
    path.id.includes('lash') ||
    path.id.includes('nostril') ||
    path.id.includes('hatch') ||
    path.id.includes('strand');
  const effectiveMinLength = isFineFeature ? Math.min(minLength, 0.0006) : minLength;

  if (!isSinglePoint && segmentLength < effectiveMinLength) {
    return { drawable: false, isBackground, filteredReason: 'too_short' };
  }


  // All eligibility requirements met
  return {
    drawable: true,
    isBackground
  };
}
