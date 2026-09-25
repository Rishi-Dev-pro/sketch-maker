/**
 * Authoritative Subject Silhouette Extraction & Smoothing (TASK-114)
 *
 * Extracts the primary structural outer boundary from cleaned segmentation:
 * Clean subject mask
 *   ↓
 * Moore-neighborhood boundary tracing
 *   ↓
 * Gaussian / 3-point polyline smoothing
 *   ↓
 * Adaptive Ramer-Douglas-Peucker simplification
 *   ↓
 * Authoritative Subject Silhouette ContourPath
 */

import { Point2D, ContourPath, SemanticMask } from '@sketch-maker/shared-types';

function clamp(val: number): number {
  return Math.max(0.0, Math.min(1.0, Number(val.toFixed(5))));
}

/**
 * 8-directional neighbor offsets (clockwise from East: E, SE, S, SW, W, NW, N, NE).
 */
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

/**
 * Traces the outer boundary of the primary connected foreground region in binary mask.
 */
export function traceOuterBoundary(
  mask: Uint8Array,
  width: number,
  height: number
): Point2D[] {
  // 1. Locate starting pixel (top-most, left-most foreground pixel)
  let startX = -1;
  let startY = -1;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      if (mask[rowOffset + x] > 0) {
        startX = x;
        startY = y;
        break;
      }
    }
    if (startX !== -1) break;
  }

  if (startX === -1) {
    return [];
  }

  // 2. Moore-neighborhood boundary tracing
  const boundaryPixels: Point2D[] = [];
  let currX = startX;
  let currY = startY;
  // Starting search direction (from West / direction 4)
  let backtrackDir = 4;

  const maxSteps = width * height;
  let step = 0;

  do {
    boundaryPixels.push({
      x: clamp((currX + 0.5) / width),
      y: clamp((currY + 0.5) / height),
    });

    let foundNext = false;
    // Search 8 neighbors starting from (backtrackDir + 1) % 8
    const startDir = (backtrackDir + 1) % 8;

    for (let i = 0; i < 8; i++) {
      const dir = (startDir + i) % 8;
      const nx = currX + DX[dir];
      const ny = currY + DY[dir];

      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        if (mask[ny * width + nx] > 0) {
          currX = nx;
          currY = ny;
          // New backtrack direction points back to the previous pixel (dir + 4) % 8
          backtrackDir = (dir + 4) % 8;
          foundNext = true;
          break;
        }
      }
    }

    if (!foundNext) {
      break;
    }

    step++;
    // Terminate when returned to start pixel and start direction
  } while (!(currX === startX && currY === startY) && step < maxSteps);

  return boundaryPixels;
}

/**
 * Applies deterministic 3-point Gaussian smoothing to a closed polyline.
 * p_i = 0.22 * p_{i-1} + 0.56 * p_i + 0.22 * p_{i+1}
 */
export function smoothClosedPolyline(
  points: readonly Point2D[],
  iterations = 2
): Point2D[] {
  if (points.length < 4) return [...points];
  let current: Point2D[] = points.map(p => ({ x: p.x, y: p.y }));

  for (let iter = 0; iter < iterations; iter++) {
    const n = current.length;
    const next: Point2D[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const prev = current[(i - 1 + n) % n];
      const curr = current[i];
      const nxt = current[(i + 1) % n];

      next[i] = {
        x: clamp(prev.x * 0.22 + curr.x * 0.56 + nxt.x * 0.22),
        y: clamp(prev.y * 0.22 + curr.y * 0.56 + nxt.y * 0.22),
      };
    }
    current = next;
  }

  return current;
}

/**
 * Calculates perpendicular distance from point p to line segment (a, b).
 */
function perpendicularDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const magSq = dx * dx + dy * dy;
  if (magSq === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  const num = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x);
  return num / Math.sqrt(magSq);
}

/**
 * Ramer-Douglas-Peucker (RDP) polyline simplification for closed or open curves.
 */
export function simplifyPolylineRDP(
  points: readonly Point2D[],
  tolerance: number,
  closed = true
): Point2D[] {
  if (points.length <= 3) return [...points];

  // For closed polygons, find the point farthest from point 0 to split into two open chains
  if (closed) {
    let maxDist = 0;
    let splitIdx = Math.floor(points.length / 2);
    for (let i = 1; i < points.length; i++) {
      const d = Math.hypot(points[i].x - points[0].x, points[i].y - points[0].y);
      if (d > maxDist) {
        maxDist = d;
        splitIdx = i;
      }
    }

    const chain1 = points.slice(0, splitIdx + 1);
    const chain2 = [...points.slice(splitIdx), points[0]];

    const simp1 = simplifyOpenRDP(chain1, tolerance);
    const simp2 = simplifyOpenRDP(chain2, tolerance);

    return [...simp1.slice(0, -1), ...simp2.slice(0, -1)];
  }

  return simplifyOpenRDP(points, tolerance);
}

function simplifyOpenRDP(points: readonly Point2D[], tolerance: number): Point2D[] {
  if (points.length <= 2) return [...points];

  let maxDist = 0;
  let maxIdx = 0;
  const a = points[0];
  const b = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], a, b);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > tolerance) {
    const left = simplifyOpenRDP(points.slice(0, maxIdx + 1), tolerance);
    const right = simplifyOpenRDP(points.slice(maxIdx), tolerance);
    return [...left.slice(0, -1), ...right];
  }

  return [a, b];
}

export interface SilhouetteExtractionOptions {
  /** RDP simplification tolerance (default: 0.0018) */
  readonly simplificationTolerance?: number;
  /** Number of Gaussian smoothing passes (default: 2) */
  readonly smoothingPasses?: number;
}

/**
 * Extracts a clean, smoothed, adaptive Authoritative Subject Silhouette
 * from cleaned segmentation mask data.
 */
export function extractAuthoritativeSilhouette(
  cleanMask: Uint8Array,
  width: number,
  height: number,
  subjectId: string,
  options?: SilhouetteExtractionOptions,
  categoryMasks?: readonly SemanticMask[]
): {
  authoritativeSilhouette: ContourPath;
  hairBoundary?: ContourPath;
  clothingBoundary?: ContourPath;
} {
  const tolerance = options?.simplificationTolerance ?? 0.0018;
  const smoothingPasses = options?.smoothingPasses ?? 2;

  // 1. Trace outer boundary
  const rawBoundary = traceOuterBoundary(cleanMask, width, height);

  if (rawBoundary.length < 4) {
    const fallbackBox = [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 },
    ];
    return {
      authoritativeSilhouette: {
        id: `${subjectId}_authoritative_silhouette`,
        region: 'body_outline',
        points: fallbackBox,
        closed: true,
        confidence: 0.5,
        visibility: 'visible',
      },
    };
  }

  // 2. Smooth polyline
  const smoothed = smoothClosedPolyline(rawBoundary, smoothingPasses);

  // 3. Adaptive RDP simplification
  const simplified = simplifyPolylineRDP(smoothed, tolerance, true);

  const authoritativeSilhouette: ContourPath = {
    id: `${subjectId}_authoritative_silhouette`,
    region: 'body_outline',
    points: simplified.length >= 4 ? simplified : smoothed,
    closed: true,
    confidence: 0.96,
    visibility: 'visible',
  };

  // 4. Optionally extract clean hair and clothing sub-boundaries if category masks exist
  let hairBoundary: ContourPath | undefined;
  let clothingBoundary: ContourPath | undefined;

  if (categoryMasks && categoryMasks.length > 0) {
    const hairMask = categoryMasks.find(m => m.category === 'hair');
    if (hairMask && hairMask.pixelArea > 100) {
      const rawHairBoundary = traceOuterBoundary(hairMask.data, hairMask.width, hairMask.height);
      if (rawHairBoundary.length >= 6) {
        const smoothedHair = smoothClosedPolyline(rawHairBoundary, 2);
        const simplifiedHair = simplifyPolylineRDP(smoothedHair, 0.0012, true);
        hairBoundary = {
          id: `${subjectId}_hair_outer_boundary`,
          region: 'hair',
          points: simplifiedHair,
          closed: true,
          confidence: hairMask.confidence ?? 0.92,
          visibility: 'visible',
        };
      }
    }

    const clothingMask = categoryMasks.find(m => m.category === 'clothing');
    if (clothingMask && clothingMask.pixelArea > 200) {
      const rawClothBoundary = traceOuterBoundary(clothingMask.data, clothingMask.width, clothingMask.height);
      if (rawClothBoundary.length >= 6) {
        const smoothedCloth = smoothClosedPolyline(rawClothBoundary, 2);
        const simplifiedCloth = simplifyPolylineRDP(smoothedCloth, 0.0022, true);
        clothingBoundary = {
          id: `${subjectId}_clothing_outer_boundary`,
          region: 'clothing',
          points: simplifiedCloth,
          closed: true,
          confidence: clothingMask.confidence ?? 0.90,
          visibility: 'visible',
        };
      }
    }
  }

  return {
    authoritativeSilhouette,
    hairBoundary,
    clothingBoundary,
  };
}
