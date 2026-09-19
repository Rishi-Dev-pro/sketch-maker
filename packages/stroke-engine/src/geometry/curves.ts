import { Point2D, BezierCurve } from '@sketch-maker/shared-types';
import { CurveFittingOptions } from './types';

/**
 * Fits smooth cubic Bézier curve segments to a polyline vertex sequence
 * using centripetal/Catmull-Rom tangent derivation and overshoot suppression.
 *
 * @param points Polyline vertices.
 * @param closed Whether the curve forms a closed loop.
 * @param options Curve fitting configuration.
 * @returns Array of contiguous BezierCurve segments.
 */
export function fitCubicBezier(
  points: readonly Point2D[],
  closed: boolean = false,
  options?: CurveFittingOptions
): BezierCurve[] {
  if (!points || points.length < 2) {
    return [];
  }

  const maxTension = options?.maxTension ?? 0.45;
  const n = points.length;

  // 2 points: exact straight line represented as cubic Bézier
  if (n === 2) {
    const p0 = points[0];
    const p1 = points[1];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;

    return [
      {
        start: p0,
        cp1: {
          x: Math.max(0.0, Math.min(1.0, p0.x + dx / 3)),
          y: Math.max(0.0, Math.min(1.0, p0.y + dy / 3))
        },
        cp2: {
          x: Math.max(0.0, Math.min(1.0, p1.x - dx / 3)),
          y: Math.max(0.0, Math.min(1.0, p1.y - dy / 3))
        },
        end: p1
      }
    ];
  }

  // Compute tangent vectors for all vertices
  const tangents: Point2D[] = new Array(n);

  if (closed) {
    // Wrapped tangents
    for (let i = 0; i < n; i++) {
      const prevIdx = (i - 1 + n) % n;
      const nextIdx = (i + 1) % n;
      tangents[i] = {
        x: (points[nextIdx].x - points[prevIdx].x) * 0.5,
        y: (points[nextIdx].y - points[prevIdx].y) * 0.5
      };
    }
  } else {
    // Open path tangents
    tangents[0] = {
      x: points[1].x - points[0].x,
      y: points[1].y - points[0].y
    };

    for (let i = 1; i < n - 1; i++) {
      tangents[i] = {
        x: (points[i + 1].x - points[i - 1].x) * 0.5,
        y: (points[i + 1].y - points[i - 1].y) * 0.5
      };
    }

    tangents[n - 1] = {
      x: points[n - 1].x - points[n - 2].x,
      y: points[n - 1].y - points[n - 2].y
    };
  }

  const curves: BezierCurve[] = [];
  const segmentCount = closed ? n : n - 1;

  for (let i = 0; i < segmentCount; i++) {
    const pStart = points[i];
    const nextIdx = (i + 1) % n;
    const pEnd = points[nextIdx];

    const chordDx = pEnd.x - pStart.x;
    const chordDy = pEnd.y - pStart.y;
    const chordLen = Math.sqrt(chordDx * chordDx + chordDy * chordDy);

    // Initial control point displacements (1/3 of tangent vector)
    let cp1Dx = tangents[i].x / 3;
    let cp1Dy = tangents[i].y / 3;
    let cp2Dx = tangents[nextIdx].x / 3;
    let cp2Dy = tangents[nextIdx].y / 3;

    // Suppress overshooting: cap control point displacement to maxTension * chordLen
    if (chordLen > 1e-6) {
      const maxDisplacement = chordLen * maxTension;

      const cp1Dist = Math.sqrt(cp1Dx * cp1Dx + cp1Dy * cp1Dy);
      if (cp1Dist > maxDisplacement) {
        const factor = maxDisplacement / cp1Dist;
        cp1Dx *= factor;
        cp1Dy *= factor;
      }

      const cp2Dist = Math.sqrt(cp2Dx * cp2Dx + cp2Dy * cp2Dy);
      if (cp2Dist > maxDisplacement) {
        const factor = maxDisplacement / cp2Dist;
        cp2Dx *= factor;
        cp2Dy *= factor;
      }
    }

    const cp1: Point2D = {
      x: Math.max(0.0, Math.min(1.0, pStart.x + cp1Dx)),
      y: Math.max(0.0, Math.min(1.0, pStart.y + cp1Dy))
    };

    const cp2: Point2D = {
      x: Math.max(0.0, Math.min(1.0, pEnd.x - cp2Dx)),
      y: Math.max(0.0, Math.min(1.0, pEnd.y - cp2Dy))
    };

    curves.push({
      start: pStart,
      cp1,
      cp2,
      end: pEnd
    });
  }

  return curves;
}
