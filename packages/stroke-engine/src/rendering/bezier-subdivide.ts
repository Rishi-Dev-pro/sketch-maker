import { Point2D, BezierCurve } from '@sketch-maker/shared-types';

/**
 * Evaluates a cubic Bézier curve at parameter t in [0, 1].
 */
export function evaluateCubicBezier(curve: BezierCurve, t: number): Point2D {
  const clampedT = Math.min(1.0, Math.max(0.0, t));
  const u = 1.0 - clampedT;
  const tt = clampedT * clampedT;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * clampedT;

  const p0 = curve.start;
  const p1 = curve.cp1;
  const p2 = curve.cp2 ?? curve.cp1;
  const p3 = curve.end;

  return {
    x: uuu * p0.x + 3 * uu * clampedT * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * clampedT * p1.y + 3 * u * tt * p2.y + ttt * p3.y
  };
}

/**
 * Evaluates the first derivative (velocity / tangent) of a cubic Bézier curve at parameter t.
 */
export function evaluateCubicBezierDerivative(curve: BezierCurve, t: number): Point2D {
  const clampedT = Math.min(1.0, Math.max(0.0, t));
  const u = 1.0 - clampedT;

  const p0 = curve.start;
  const p1 = curve.cp1;
  const p2 = curve.cp2 ?? curve.cp1;
  const p3 = curve.end;

  // C'(t) = 3(1-t)^2(p1 - p0) + 6(1-t)t(p2 - p1) + 3t^2(p3 - p2)
  const a = 3 * u * u;
  const b = 6 * u * clampedT;
  const c = 3 * clampedT * clampedT;

  const dx = a * (p1.x - p0.x) + b * (p2.x - p1.x) + c * (p3.x - p2.x);
  const dy = a * (p1.y - p0.y) + b * (p2.y - p1.y) + c * (p3.y - p2.y);

  const len = Math.hypot(dx, dy);
  if (len > 1e-6) {
    return { x: dx / len, y: dy / len };
  }
  return { x: 1.0, y: 0.0 };
}

/**
 * Subdivides a cubic Bézier curve using the de Casteljau algorithm,
 * returning the sub-curve from t = 0 to t = paramT.
 */
export function trimCubicBezier(curve: BezierCurve, paramT: number): {
  subCurve: BezierCurve;
  tipPoint: Point2D;
  tipTangent: Point2D;
} {
  const t = Math.min(1.0, Math.max(0.0, paramT));

  const p0 = curve.start;
  const p1 = curve.cp1;
  const p2 = curve.cp2 ?? curve.cp1;
  const p3 = curve.end;

  if (t >= 0.9999) {
    const tipTangent = evaluateCubicBezierDerivative(curve, 1.0);
    return {
      subCurve: {
        start: { x: p0.x, y: p0.y },
        cp1: { x: p1.x, y: p1.y },
        cp2: { x: p2.x, y: p2.y },
        end: { x: p3.x, y: p3.y }
      },
      tipPoint: { x: p3.x, y: p3.y },
      tipTangent
    };
  }

  if (t <= 0.0001) {
    const tipTangent = evaluateCubicBezierDerivative(curve, 0.0);
    return {
      subCurve: {
        start: { x: p0.x, y: p0.y },
        cp1: { x: p0.x, y: p0.y },
        cp2: { x: p0.x, y: p0.y },
        end: { x: p0.x, y: p0.y }
      },
      tipPoint: { x: p0.x, y: p0.y },
      tipTangent
    };
  }

  const u = 1.0 - t;

  // Level 1 de Casteljau
  const p01 = { x: u * p0.x + t * p1.x, y: u * p0.y + t * p1.y };
  const p12 = { x: u * p1.x + t * p2.x, y: u * p1.y + t * p2.y };
  const p23 = { x: u * p2.x + t * p3.x, y: u * p2.y + t * p3.y };

  // Level 2 de Casteljau
  const p012 = { x: u * p01.x + t * p12.x, y: u * p01.y + t * p12.y };
  const p123 = { x: u * p12.x + t * p23.x, y: u * p12.y + t * p23.y };

  // Level 3 de Casteljau (point on curve at t)
  const p0123 = { x: u * p012.x + t * p123.x, y: u * p012.y + t * p123.y };

  // Tangent at t is parallel to p123 - p012
  const tdx = p123.x - p012.x;
  const tdy = p123.y - p012.y;
  const tlen = Math.hypot(tdx, tdy);
  const tipTangent: Point2D = tlen > 1e-6
    ? { x: tdx / tlen, y: tdy / tlen }
    : evaluateCubicBezierDerivative(curve, t);

  return {
    subCurve: {
      start: { x: p0.x, y: p0.y },
      cp1: p01,
      cp2: p012,
      end: p0123
    },
    tipPoint: p0123,
    tipTangent
  };
}

/**
 * Calculates accurate arc length of a cubic Bézier curve using 4-segment chord approximation.
 */
export function approximateCubicBezierLength(curve: BezierCurve): number {
  const p0 = curve.start;
  const p1 = curve.cp1;
  const p2 = curve.cp2 ?? curve.cp1;
  const p3 = curve.end;

  // If curve is very flat, chord is accurate
  const chordLen = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const polyLen = Math.hypot(p1.x - p0.x, p1.y - p0.y) +
                  Math.hypot(p2.x - p1.x, p2.y - p1.y) +
                  Math.hypot(p3.x - p2.x, p3.y - p2.y);

  if (Math.abs(polyLen - chordLen) < 1e-4) {
    return (2 * chordLen + polyLen) / 3.0;
  }

  // 4-step piecewise chord sampling
  let totalLength = 0;
  let prev = p0;
  const steps = 4;
  for (let i = 1; i <= steps; i++) {
    const curr = evaluateCubicBezier(curve, i / steps);
    totalLength += Math.hypot(curr.x - prev.x, curr.y - prev.y);
    prev = curr;
  }

  return totalLength;
}
