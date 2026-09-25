import { Point2D, SemanticRegion } from '@sketch-maker/shared-types';

export interface SemanticBoundaryEligibility {
  readonly eligible: boolean;
  readonly region: SemanticRegion;
  readonly importanceScore: number;
  readonly filteredReason?: string;
}

export interface SemanticBoundaryFilterOptions {
  /** Minimum area in normalized coordinates to be structurally relevant (default: 0.004) */
  readonly minNormalizedArea?: number;
  /** Minimum vertex count (default: 6) */
  readonly minPointCount?: number;
  /** Maximum candidate boundary loops per category to prevent candidate explosion (default: 2) */
  readonly maxLoopsPerCategory?: number;
}

/**
 * Computes polygon area in normalized 2D space using surveyor's formula.
 */
function computePolygonArea(points: readonly Point2D[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) * 0.5;
}

/**
 * Evaluates whether a semantic segmentation mask boundary is artistically eligible
 * to become a vector path / stroke candidate.
 *
 * Implements the core principle:
 * "Perception evidence is not automatically artwork."
 */
export function evaluateSemanticBoundaryEligibility(
  loop: readonly Point2D[],
  category: string,
  categoryIndex: number,
  options?: SemanticBoundaryFilterOptions
): SemanticBoundaryEligibility {
  const minArea = options?.minNormalizedArea ?? 0.004;
  const minPoints = options?.minPointCount ?? 6;
  const maxLoops = options?.maxLoopsPerCategory ?? 2;

  // 1. Point count check
  if (!loop || loop.length < minPoints) {
    return {
      eligible: false,
      region: 'clothing',
      importanceScore: 0.0,
      filteredReason: 'too_few_points',
    };
  }

  // 2. Loop count throttle: prevent background/clothing loops from dominating stroke budget
  if (categoryIndex >= maxLoops) {
    return {
      eligible: false,
      region: 'clothing',
      importanceScore: 0.0,
      filteredReason: 'category_quota_exceeded',
    };
  }

  // 3. Normalized area check
  const area = computePolygonArea(loop);
  if (area < minArea) {
    return {
      eligible: false,
      region: 'clothing',
      importanceScore: 0.0,
      filteredReason: 'micro_speckle_noise',
    };
  }

  // 4. Category-specific relevance rules
  switch (category) {
    case 'hair':
      // Raw hair segmentation loops are redundant with reconstructed hair silhouette & masses
      return {
        eligible: false,
        region: 'hair',
        importanceScore: 0.2,
        filteredReason: 'superseded_by_hair_reconstruction',
      };

    case 'face_skin':
      // Face skin mask boundaries are redundant with jawline & hairline contours
      return {
        eligible: false,
        region: 'face_contour',
        importanceScore: 0.2,
        filteredReason: 'redundant_with_facial_contour',
      };

    case 'clothing':
      // Large clothing outer perimeter is structurally meaningful
      if (area >= 0.02) {
        return {
          eligible: true,
          region: 'clothing',
          importanceScore: 0.55,
        };
      }
      return {
        eligible: false,
        region: 'clothing',
        importanceScore: 0.25,
        filteredReason: 'internal_clothing_texture_clutter',
      };

    case 'body_skin':
      // Arms/legs/hands: only preserve major structural boundaries
      if (area >= 0.015) {
        return {
          eligible: true,
          region: 'body_outline',
          importanceScore: 0.50,
        };
      }
      return {
        eligible: false,
        region: 'body_outline',
        importanceScore: 0.2,
        filteredReason: 'small_body_skin_patch',
      };

    case 'accessories':
      return {
        eligible: area >= 0.005,
        region: 'accessories',
        importanceScore: 0.60,
        filteredReason: area < 0.005 ? 'micro_accessory_noise' : undefined,
      };

    case 'background':
    case 'unknown':
    default:
      return {
        eligible: false,
        region: 'background',
        importanceScore: 0.0,
        filteredReason: 'background_suppressed',
      };
  }
}
