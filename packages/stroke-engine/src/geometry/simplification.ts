import { Point2D, PathHierarchyLevel, SemanticRegion } from '@sketch-maker/shared-types';
import { SimplificationTolerances, DEFAULT_SIMPLIFICATION_TOLERANCES } from './types';

/**
 * Computes perpendicular distance from point P to line segment P1-P2.
 */
export function perpendicularDistance(
  p: Point2D,
  p1: Point2D,
  p2: Point2D
): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lineLenSq = dx * dx + dy * dy;

  if (lineLenSq < 1e-12) {
    // P1 and P2 are identical; return Euclidean distance to P1
    const ex = p.x - p1.x;
    const ey = p.y - p1.y;
    return Math.sqrt(ex * ex + ey * ey);
  }

  // Standard 2D cross-product line distance formula: |(dy)x - (dx)y + p2.x*p1.y - p2.y*p1.x| / sqrt(dx^2 + dy^2)
  const numerator = Math.abs(dy * p.x - dx * p.y + p2.x * p1.y - p2.y * p1.x);
  return numerator / Math.sqrt(lineLenSq);
}

/**
 * Internal recursive Ramer-Douglas-Peucker simplification on a point slice [startIdx, endIdx].
 */
function rdpSlice(
  points: readonly Point2D[],
  startIdx: number,
  endIdx: number,
  epsilonSq: number,
  keep: boolean[]
): void {
  if (endIdx <= startIdx + 1) {
    return;
  }

  const p1 = points[startIdx];
  const p2 = points[endIdx];

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lineLenSq = dx * dx + dy * dy;

  let maxDistSq = 0;
  let maxIdx = startIdx;

  for (let i = startIdx + 1; i < endIdx; i++) {
    const p = points[i];
    let distSq: number;

    if (lineLenSq < 1e-12) {
      const ex = p.x - p1.x;
      const ey = p.y - p1.y;
      distSq = ex * ex + ey * ey;
    } else {
      const num = dy * p.x - dx * p.y + p2.x * p1.y - p2.y * p1.x;
      distSq = (num * num) / lineLenSq;
    }

    if (distSq > maxDistSq) {
      maxDistSq = distSq;
      maxIdx = i;
    }
  }

  if (maxDistSq > epsilonSq) {
    keep[maxIdx] = true;
    rdpSlice(points, startIdx, maxIdx, epsilonSq, keep);
    rdpSlice(points, maxIdx, endIdx, epsilonSq, keep);
  }
}

/**
 * Simplifies a sequence of 2D points using the deterministic Ramer-Douglas-Peucker (RDP) algorithm.
 * Preserves endpoints for open polylines and prevents loop collapse for closed polygons.
 *
 * @param points Raw polyline points.
 * @param epsilon Maximum perpendicular deviation distance allowed (normalized [0, 1]).
 * @param closed Whether the polyline is a closed loop.
 * @returns Cleaned and simplified point sequence.
 */
export function simplifyRDP(
  points: readonly Point2D[],
  epsilon: number,
  closed: boolean = false
): Point2D[] {
  if (!points || points.length <= 2) {
    return points ? [...points] : [];
  }

  const safeEpsilon = Math.max(0.0, epsilon);
  if (safeEpsilon <= 1e-8) {
    return [...points];
  }

  const epsilonSq = safeEpsilon * safeEpsilon;
  const n = points.length;

  if (closed) {
    // For closed loops, find the point farthest from points[0] to use as intermediate anchor
    // so we don't collapse a loop whose endpoints coincide.
    const p0 = points[0];
    let maxDistSq = 0;
    let farIdx = Math.floor(n / 2);

    for (let i = 1; i < n - 1; i++) {
      const dx = points[i].x - p0.x;
      const dy = points[i].y - p0.y;
      const dSq = dx * dx + dy * dy;
      if (dSq > maxDistSq) {
        maxDistSq = dSq;
        farIdx = i;
      }
    }

    // Mark anchor vertices
    const keep = new Array<boolean>(n).fill(false);
    keep[0] = true;
    keep[farIdx] = true;
    keep[n - 1] = true;

    // Simplify halves
    rdpSlice(points, 0, farIdx, epsilonSq, keep);
    rdpSlice(points, farIdx, n - 1, epsilonSq, keep);

    const result: Point2D[] = [];
    for (let i = 0; i < n; i++) {
      if (keep[i]) {
        result.push(points[i]);
      }
    }

    // Minimum 3 points for a closed polygon
    if (result.length < 3 && n >= 3) {
      return [points[0], points[farIdx], points[n - 1]];
    }

    return result;
  }

  // Open polyline
  const keep = new Array<boolean>(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;

  rdpSlice(points, 0, n - 1, epsilonSq, keep);

  const result: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) {
      result.push(points[i]);
    }
  }

  return result;
}

/**
 * Returns the adaptive simplification tolerance for a given structural hierarchy level.
 */
export function getToleranceForLevel(
  level: PathHierarchyLevel,
  custom?: Partial<SimplificationTolerances>
): number {
  const merged = { ...DEFAULT_SIMPLIFICATION_TOLERANCES, ...custom };
  switch (level) {
    case 0:
      return merged.level0_silhouette;
    case 1:
      return merged.level1_structure;
    case 2:
      return merged.level2_anatomy;
    case 3:
      return merged.level3_semantic;
    case 4:
      return merged.level4_fine;
    default:
      return merged.level2_anatomy;
  }
}

/**
 * Feature-specific RDP simplification tolerance (TASK-111).
 * High-value focal features (eyes, lips, nose, brows) are preserved with ultra-fine precision,
 * while large silhouettes and garments use wider tolerances to prevent visual noise.
 */
export function getFeatureSpecificTolerance(
  region: SemanticRegion | string,
  pathId?: string,
  level?: PathHierarchyLevel
): number {
  const reg = region ? String(region).toLowerCase() : '';
  const id = pathId?.toLowerCase() ?? '';

  // 1. Ultra-high precision: Eyes, iris, pupils, lashes, and oral fissure
  if (
    reg === 'eyes' ||
    reg === 'eye' ||
    id.includes('eye') ||
    id.includes('iris') ||
    id.includes('pupil') ||
    id.includes('lash') ||
    id.includes('fissure')
  ) {
    return 0.0004;
  }

  // 2. Very high precision: Lips, philtrum, vermilion borders, canthi
  if (
    reg === 'mouth' ||
    reg === 'lips' ||
    reg === 'lip' ||
    id.includes('lip') ||
    id.includes('philtrum') ||
    id.includes('corner') ||
    id.includes('canthus')
  ) {
    return 0.0005;
  }

  // 3. High precision: Nose, eyebrows, nostril apertures, alar wings
  if (
    reg === 'nose' ||
    reg === 'eyebrows' ||
    reg === 'eyebrow' ||
    id.includes('nose') ||
    id.includes('brow') ||
    id.includes('nostril') ||
    id.includes('ala') ||
    id.includes('columella')
  ) {
    return 0.0008;
  }

  // 4. Medium-high precision: Jawline, chin dome, cheek malar planes, shading hatch strokes
  if (
    reg === 'jawline' ||
    reg === 'face_contour' ||
    reg === 'silhouette' ||
    id.includes('jaw') ||
    id.includes('chin') ||
    id.includes('malar') ||
    id.includes('hatch') ||
    id.includes('shading')
  ) {
    return 0.0018;
  }

  // 5. Medium precision: Hair flow streamlines, masses, ears, neck
  if (
    reg === 'hair' ||
    reg === 'hair_boundary' ||
    reg === 'ears' ||
    reg === 'ear' ||
    id.includes('hair_flow') ||
    id.includes('hair_strand') ||
    id.includes('neck')
  ) {
    return 0.0022;
  }

  // 6. Lower precision: Hair silhouette, body outline, shoulders, clothing
  if (
    reg === 'body_outline' ||
    reg === 'body_structure' ||
    reg === 'body' ||
    reg === 'shoulders' ||
    reg === 'clothing' ||
    id.includes('silhouette')
  ) {
    return 0.0040;
  }

  // Default fallback based on hierarchy level if provided
  return level !== undefined ? getToleranceForLevel(level) : 0.0020;
}

