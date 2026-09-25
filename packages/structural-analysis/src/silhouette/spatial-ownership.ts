/**
 * Semantic Spatial Ownership & Segmentation-Aware Clipping (TASK-114)
 *
 * Enforces spatial ownership rules:
 * - Every stroke must lie within its subject's authoritative boundary.
 * - Every semantic feature must lie within its designated region mask.
 * - Strokes that approach or cross a boundary are clipped cleanly at the boundary.
 * - Telemetry on valid, rejected, and clipped candidates is captured.
 */

import { Point2D, BoundingBox } from '@sketch-maker/shared-types';

/**
 * Checks if a normalized point [0.0, 1.0] lies inside a binary mask.
 * Optional tolerancePx allows strokes on or touching the boundary to remain valid.
 */
export function isPointInMask(
  point: Point2D,
  mask: Uint8Array,
  width: number,
  height: number,
  tolerancePx = 2
): boolean {
  const px = Math.floor(point.x * width);
  const py = Math.floor(point.y * height);

  if (px >= 0 && px < width && py >= 0 && py < height) {
    if (mask[py * width + px] > 0) return true;
  }

  if (tolerancePx <= 0) return false;

  // Check neighborhood within tolerancePx
  const rMin = Math.max(0, py - tolerancePx);
  const rMax = Math.min(height - 1, py + tolerancePx);
  const cMin = Math.max(0, px - tolerancePx);
  const cMax = Math.min(width - 1, px + tolerancePx);

  for (let ny = rMin; ny <= rMax; ny++) {
    const row = ny * width;
    for (let nx = cMin; nx <= cMax; nx++) {
      if (mask[row + nx] > 0) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Clips a line segment (p0, p1) against a binary mask using bisection search.
 * Returns the clipped endpoint at the boundary intersection.
 */
function findBoundaryIntersection(
  insidePt: Point2D,
  outsidePt: Point2D,
  mask: Uint8Array,
  width: number,
  height: number
): Point2D {
  let low = insidePt;
  let high = outsidePt;

  for (let iter = 0; iter < 8; iter++) {
    const mid: Point2D = {
      x: (low.x + high.x) * 0.5,
      y: (low.y + high.y) * 0.5,
    };
    if (isPointInMask(mid, mask, width, height, 0)) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return low;
}

/**
 * Clips an arbitrary polyline against a binary mask.
 * Splits into continuous inside segments; trims segments exiting the mask at the boundary.
 */
export function clipPolylineToMask(
  points: readonly Point2D[],
  mask: Uint8Array,
  width: number,
  height: number,
  tolerancePx = 2
): Point2D[][] {
  if (points.length < 2) {
    if (points.length === 1 && isPointInMask(points[0], mask, width, height, tolerancePx)) {
      return [[points[0]]];
    }
    return [];
  }

  const resultSegments: Point2D[][] = [];
  let currentSegment: Point2D[] = [];

  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    const isInside = isPointInMask(curr, mask, width, height, tolerancePx);

    if (isInside) {
      if (currentSegment.length === 0 && i > 0) {
        // Line segment entered the mask from outside: find entry intersection
        const entry = findBoundaryIntersection(curr, points[i - 1], mask, width, height);
        currentSegment.push(entry);
      }
      currentSegment.push(curr);
    } else {
      if (currentSegment.length > 0) {
        // Line segment exited the mask to outside: find exit intersection
        const exit = findBoundaryIntersection(currentSegment[currentSegment.length - 1], curr, mask, width, height);
        currentSegment.push(exit);
        if (currentSegment.length >= 2) {
          resultSegments.push(currentSegment);
        }
        currentSegment = [];
      }
    }
  }

  if (currentSegment.length >= 2) {
    resultSegments.push(currentSegment);
  } else if (currentSegment.length === 1 && points.length === 1) {
    resultSegments.push(currentSegment);
  }

  return resultSegments;
}

/**
 * Checks if a point lies inside a normalized bounding box with optional padding.
 */
export function isPointInBox(point: Point2D, box: BoundingBox, padding = 0.02): boolean {
  return (
    point.x >= box.x - padding &&
    point.x <= box.x + box.width + padding &&
    point.y >= box.y - padding &&
    point.y <= box.y + box.height + padding
  );
}
