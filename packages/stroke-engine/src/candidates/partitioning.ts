import { Point2D, BezierCurve } from '@sketch-maker/shared-types';
import { VectorPath, StrokeGenerationConfig } from './types';
import { computeArcLength } from '../geometry/cleaning';
import { fitCubicBezier } from '../geometry/curves';

export interface PartitionedStrokeSegment {
  readonly points: Point2D[];
  readonly curves?: BezierCurve[];
  readonly closed: boolean;
  readonly length: number;
}

/**
 * Computes angular deflection between incoming vector (pPrev -> pCurr)
 * and outgoing vector (pCurr -> pNext) in radians [0, PI].
 */
function computeTurnAngle(pPrev: Point2D, pCurr: Point2D, pNext: Point2D): number {
  const uX = pCurr.x - pPrev.x;
  const uY = pCurr.y - pPrev.y;
  const vX = pNext.x - pCurr.x;
  const vY = pNext.y - pCurr.y;
  const lenU = Math.hypot(uX, uY);
  const lenV = Math.hypot(vX, vY);
  if (lenU < 1e-6 || lenV < 1e-6) return 0;
  const dot = (uX * vX + uY * vY) / (lenU * lenV);
  const clampedDot = Math.max(-1.0, Math.min(1.0, dot));
  return Math.acos(clampedDot);
}

/**
 * Partitions a VectorPath into artistic drawing gesture segments.
 *
 * Rules:
 * 1. Delicate structural facial features (eyes, nose, mouth, eyebrows, ears) are NEVER fragmented.
 * 2. Short paths (length <= maxStrokeLength without sharp corners) are preserved intact.
 * 3. Long continuous paths (e.g. outer silhouette, clothing seams) are partitioned at sharp corners
 *    (turn angle > threshold) and length intervals (<= maxStrokeLength) into natural stroke gestures.
 * 4. Closed loops are opened into complementary gesture arcs.
 * 5. Hard limit maxCandidatesPerPath prevents pathological stroke explosion.
 */
export function partitionVectorPath(
  path: VectorPath,
  config: StrokeGenerationConfig
): PartitionedStrokeSegment[] {
  const points = path.points;
  if (!points || points.length === 0) {
    return [];
  }

  // Single-point features (e.g. iris center)
  if (points.length === 1) {
    return [
      {
        points: [...points],
        curves: path.curves,
        closed: false,
        length: 0
      }
    ];
  }

  const maxStrokeLength = config.maxStrokeLength ?? 0.35;
  const splitOnSharpCorners = config.splitOnSharpCorners ?? true;
  const cornerThreshold = config.sharpCornerAngleThreshold ?? 1.30; // ~75 deg
  const maxCandidates = config.maxCandidatesPerPath ?? 8;
  const minLength = config.minLength ?? 0.003;

  // Protected structural features: never fragment
  const protectedRegions = new Set(['eyes', 'eyebrows', 'nose', 'mouth', 'ears']);
  if (protectedRegions.has(path.region) || path.level === 4) {
    return [
      {
        points: [...points],
        curves: path.curves,
        closed: path.closed,
        length: path.length
      }
    ];
  }

  // Check if unpartitioned path is already small and smooth
  const totalLength = path.length || computeArcLength(points);
  if (totalLength <= maxStrokeLength && !path.closed && !splitOnSharpCorners) {
    return [
      {
        points: [...points],
        curves: path.curves,
        closed: path.closed,
        length: totalLength
      }
    ];
  }

  const n = points.length;
  const splitIndices = new Set<number>();
  splitIndices.add(0);
  splitIndices.add(n - 1);

  // 1. Detect sharp corners if enabled
  if (splitOnSharpCorners && n >= 3) {
    for (let i = 1; i < n - 1; i++) {
      const angle = computeTurnAngle(points[i - 1], points[i], points[i + 1]);
      if (angle >= cornerThreshold) {
        splitIndices.add(i);
      }
    }
  }

  // 2. For closed loops without corners, ensure at least 2-3 split points so it's not a single loop
  if (path.closed && splitIndices.size <= 2) {
    if (n >= 6) {
      splitIndices.add(Math.floor(n / 3));
      splitIndices.add(Math.floor((2 * n) / 3));
    } else if (n >= 4) {
      splitIndices.add(Math.floor(n / 2));
    }
  }

  // 3. Check distance intervals between consecutive split indices
  const sortedSplits = Array.from(splitIndices).sort((a, b) => a - b);
  const refinedSplits = new Set<number>();

  for (let s = 0; s < sortedSplits.length - 1; s++) {
    const startIdx = sortedSplits[s];
    const endIdx = sortedSplits[s + 1];
    refinedSplits.add(startIdx);

    // Compute segment length
    let subLength = 0;
    let lastSplitIdx = startIdx;
    for (let i = startIdx; i < endIdx; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      subLength += d;

      if (subLength >= maxStrokeLength && i > lastSplitIdx && i < endIdx) {
        refinedSplits.add(i);
        subLength = 0;
        lastSplitIdx = i;
      }
    }
  }
  refinedSplits.add(n - 1);

  const finalSplits = Array.from(refinedSplits).sort((a, b) => a - b);

  // If no splits occurred beyond start/end and not closed, return original
  if (finalSplits.length <= 2 && !path.closed && totalLength <= maxStrokeLength) {
    return [
      {
        points: [...points],
        curves: path.curves,
        closed: path.closed,
        length: totalLength
      }
    ];
  }

  // Generate segments from splits
  const segments: PartitionedStrokeSegment[] = [];

  for (let i = 0; i < finalSplits.length - 1; i++) {
    if (segments.length >= maxCandidates) break;

    const startIdx = finalSplits[i];
    const endIdx = finalSplits[i + 1];

    if (endIdx <= startIdx) continue;

    const segPoints = points.slice(startIdx, endIdx + 1);
    if (segPoints.length < 2) continue;

    const segLength = computeArcLength(segPoints);
    if (segLength < minLength && segPoints.length < 3) continue;

    const segCurves = fitCubicBezier(segPoints, false);

    segments.push({
      points: segPoints,
      curves: segCurves,
      closed: false,
      length: Math.round(segLength * 10000) / 10000
    });
  }

  // For closed loops, connect the wrap segment if needed and if under limit
  if (path.closed && segments.length < maxCandidates && finalSplits[finalSplits.length - 1] === n - 1 && finalSplits[0] === 0) {
    const wrapPoints = [points[n - 1], points[0]];
    const wrapLen = Math.hypot(points[0].x - points[n - 1].x, points[0].y - points[n - 1].y);
    if (wrapLen >= minLength) {
      segments.push({
        points: wrapPoints,
        curves: fitCubicBezier(wrapPoints, false),
        closed: false,
        length: Math.round(wrapLen * 10000) / 10000
      });
    }
  }

  return segments.length > 0
    ? segments
    : [
        {
          points: [...points],
          curves: path.curves,
          closed: path.closed,
          length: totalLength
        }
      ];
}
