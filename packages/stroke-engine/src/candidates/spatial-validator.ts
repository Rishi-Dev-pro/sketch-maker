/**
 * Spatial Ownership Validation & Segmentation-Aware Stroke Clipping (TASK-114)
 *
 * Implements the Hard Stroke Validation Gate and Boundary Clipping:
 * 1. Validates that every stroke candidate remains within its subject's authoritative silhouette.
 * 2. Trims crossing strokes at the subject boundary (inside -> outside).
 * 3. Enforces multi-person isolation (BM-11): subject-1 strokes cannot appear in subject-2.
 * 4. Rejects stray diagonal lines and external waves outside anatomical boundaries.
 * 5. Captures comprehensive rejection and clipping telemetry.
 */

import { Point2D } from '@sketch-maker/shared-types';
import { StrokeSemanticRole, StrokeFilteredReason } from './types';

/**
 * Point-in-polygon test with distance-to-edge tolerance margin.
 * Ensures strokes directly on or touching the boundary are NOT rejected.
 */
export function isPointInPolygonWithMargin(
  pt: Point2D,
  poly: readonly Point2D[],
  margin = 0.035
): boolean {
  if (poly.length < 3) return true;
  let inside = false;
  const n = poly.length;
  let minDistSq = Infinity;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi + 1e-9) + xi);
    if (intersect) inside = !inside;

    // Segment distance
    const dx = xj - xi;
    const dy = yj - yi;
    const lenSq = dx * dx + dy * dy;
    if (lenSq > 0) {
      const u = Math.max(0, Math.min(1, ((pt.x - xi) * dx + (pt.y - yi) * dy) / lenSq));
      const px = xi + u * dx;
      const py = yi + u * dy;
      const dSq = (pt.x - px) * (pt.x - px) + (pt.y - py) * (pt.y - py);
      if (dSq < minDistSq) minDistSq = dSq;
    }
  }

  if (inside) return true;
  return minDistSq <= margin * margin;
}

/**
 * Finds the intersection point between segment (p0, p1) and polygon boundary using bisection.
 */
function findIntersectionWithPolygon(
  insidePt: Point2D,
  outsidePt: Point2D,
  poly: readonly Point2D[],
  margin: number
): Point2D {
  let low = insidePt;
  let high = outsidePt;

  for (let iter = 0; iter < 8; iter++) {
    const mid: Point2D = {
      x: (low.x + high.x) * 0.5,
      y: (low.y + high.y) * 0.5,
    };
    if (isPointInPolygonWithMargin(mid, poly, margin)) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return low;
}

export interface SpatialValidationResult {
  readonly valid: boolean;
  readonly points: Point2D[];
  readonly wasClipped: boolean;
  readonly filteredReason?: StrokeFilteredReason;
}

/**
 * Validates and clips a stroke candidate against its subject's authoritative silhouette
 * and regional boundaries.
 */
export function validateAndClipSpatialOwnership(
  rawPoints: readonly Point2D[],
  role: StrokeSemanticRole,
  subjectId: string,
  subjectSilhouettes: ReadonlyMap<string, readonly Point2D[]>,
  hairBoundaries?: ReadonlyMap<string, readonly Point2D[]>
): SpatialValidationResult {
  // Foundational silhouette strokes are valid by definition
  if (role === 'silhouette') {
    return { valid: true, points: [...rawPoints], wasClipped: false };
  }

  const silhouette = subjectSilhouettes.get(subjectId);
  if (!silhouette || silhouette.length < 3) {
    // If no silhouette exists for this subject, accept as valid without clipping
    return { valid: true, points: [...rawPoints], wasClipped: false };
  }

  const margin = 0.035;

  // 1. Check points against subject silhouette
  const insideStatus = rawPoints.map(p => isPointInPolygonWithMargin(p, silhouette, margin));
  const insideCount = insideStatus.filter(Boolean).length;

  // Completely outside subject boundary: reject
  if (insideCount === 0) {
    return {
      valid: false,
      points: [...rawPoints],
      wasClipped: false,
      filteredReason: 'outside_subject',
    };
  }

  // All points inside: check regional constraints (e.g. hair vs clothing)
  if (insideCount === rawPoints.length) {
    // For fine hair strands, if hair boundary is available, verify it's near hair
    if (role === 'hair_strand' && hairBoundaries) {
      const hairPoly = hairBoundaries.get(subjectId);
      if (hairPoly && hairPoly.length >= 4) {
        const nearHair = rawPoints.some(p => isPointInPolygonWithMargin(p, hairPoly, 0.04));
        if (!nearHair) {
          return {
            valid: false,
            points: [...rawPoints],
            wasClipped: false,
            filteredReason: 'wrong_semantic_region',
          };
        }
      }
    }

    return { valid: true, points: [...rawPoints], wasClipped: false };
  }

  // Partially inside, partially outside: Clip polyline at the boundary (Section 11)
  const clipped: Point2D[] = [];
  for (let i = 0; i < rawPoints.length; i++) {
    const curr = rawPoints[i];
    const isCurrIn = insideStatus[i];

    if (isCurrIn) {
      if (clipped.length === 0 && i > 0) {
        const entry = findIntersectionWithPolygon(curr, rawPoints[i - 1], silhouette, margin);
        clipped.push(entry);
      }
      clipped.push(curr);
    } else {
      if (clipped.length > 0) {
        const exit = findIntersectionWithPolygon(clipped[clipped.length - 1], curr, silhouette, margin);
        clipped.push(exit);
        break; // Stop at first exit
      }
    }
  }

  if (clipped.length >= 2) {
    return {
      valid: true,
      points: clipped,
      wasClipped: true,
    };
  }

  if (clipped.length === 1 && rawPoints.length === 1) {
    return {
      valid: true,
      points: clipped,
      wasClipped: true,
    };
  }

  // Clipped segment became degenerate: reject
  return {
    valid: false,
    points: [...rawPoints],
    wasClipped: false,
    filteredReason: 'outside_subject',
  };
}
