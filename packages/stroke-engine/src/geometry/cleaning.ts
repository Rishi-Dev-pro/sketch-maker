import { Point2D, BoundingBox } from '@sketch-maker/shared-types';
import { CleaningOptions, DEFAULT_CLEANING_OPTIONS } from './types';

/**
 * Computes the normalized bounding box enclosing a set of 2D points.
 */
export function computeBoundingBox(points: readonly Point2D[]): BoundingBox {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    x: Math.max(0, Math.min(1, minX)),
    y: Math.max(0, Math.min(1, minY)),
    width: Math.max(0, Math.min(1, maxX - minX)),
    height: Math.max(0, Math.min(1, maxY - minY))
  };
}

/**
 * Computes total normalized Euclidean arc length along a sequence of vertices.
 */
export function computeArcLength(points: readonly Point2D[]): number {
  if (points.length < 2) return 0;
  let totalLength = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    totalLength += Math.sqrt(dx * dx + dy * dy);
  }
  return totalLength;
}

/**
 * Clean a polyline by validating coordinates, removing duplicates/near-duplicates,
 * rejecting aberrant jumps, and pruning collinear redundancies.
 */
export function cleanPolyline(
  points: readonly Point2D[],
  options?: CleaningOptions
): Point2D[] {
  if (!points || points.length === 0) {
    return [];
  }

  const minPointDistance = options?.minPointDistance ?? DEFAULT_CLEANING_OPTIONS.minPointDistance;
  const maxJumpThreshold = options?.maxJumpThreshold ?? DEFAULT_CLEANING_OPTIONS.maxJumpThreshold;
  const collinearThreshold = options?.collinearThreshold ?? DEFAULT_CLEANING_OPTIONS.collinearThreshold;
  const minPoints = options?.minPoints ?? DEFAULT_CLEANING_OPTIONS.minPoints;

  // 1. First pass: Validate numbers and clamp strictly to [0.0, 1.0]
  const validPoints: Point2D[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      validPoints.push({
        x: Math.max(0.0, Math.min(1.0, p.x)),
        y: Math.max(0.0, Math.min(1.0, p.y))
      });
    }
  }

  if (validPoints.length === 0) {
    return [];
  }

  // 2. Second pass: Remove duplicate and near-duplicate consecutive points
  const deduped: Point2D[] = [validPoints[0]];
  for (let i = 1; i < validPoints.length; i++) {
    const prev = deduped[deduped.length - 1];
    const curr = validPoints[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const distSq = dx * dx + dy * dy;

    if (distSq >= minPointDistance * minPointDistance) {
      deduped.push(curr);
    }
  }

  if (deduped.length < minPoints) {
    return deduped.length > 0 ? deduped : [];
  }

  // 3. Third pass: Filter aberrant isolated spike jumps (point i jumps far and point i+1 jumps back)
  const deSpiked: Point2D[] = [];
  deSpiked.push(deduped[0]);

  for (let i = 1; i < deduped.length - 1; i++) {
    const prev = deSpiked[deSpiked.length - 1];
    const curr = deduped[i];
    const next = deduped[i + 1];

    const d1x = curr.x - prev.x;
    const d1y = curr.y - prev.y;
    const dist1 = Math.sqrt(d1x * d1x + d1y * d1y);

    const d2x = next.x - curr.x;
    const d2y = next.y - curr.y;
    const dist2 = Math.sqrt(d2x * d2x + d2y * d2y);

    const dBaselineX = next.x - prev.x;
    const dBaselineY = next.y - prev.y;
    const distBaseline = Math.sqrt(dBaselineX * dBaselineX + dBaselineY * dBaselineY);

    // If both jumps are huge and the baseline jump is normal, curr is an aberrant outlier spike
    if (dist1 > maxJumpThreshold && dist2 > maxJumpThreshold && distBaseline < maxJumpThreshold) {
      // Discard spike point
      continue;
    }


    deSpiked.push(curr);
  }

  // Always keep the last point
  if (deduped.length > 1) {
    deSpiked.push(deduped[deduped.length - 1]);
  }

  if (deSpiked.length < 3) {
    return deSpiked;
  }

  // 4. Fourth pass: Prune collinear points along straight lines
  const collinearPruned: Point2D[] = [deSpiked[0]];
  for (let i = 1; i < deSpiked.length - 1; i++) {
    const prev = collinearPruned[collinearPruned.length - 1];
    const curr = deSpiked[i];
    const next = deSpiked[i + 1];

    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;

    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);

    if (len1 > 1e-6 && len2 > 1e-6) {
      // Dot product normalized
      const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
      // If dot product is close to 1.0, points are collinear and point in same direction
      const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));
      if (angle < collinearThreshold) {
        // Skip curr since it lies along the straight line
        continue;
      }
    }

    collinearPruned.push(curr);
  }

  collinearPruned.push(deSpiked[deSpiked.length - 1]);
  return collinearPruned;
}
