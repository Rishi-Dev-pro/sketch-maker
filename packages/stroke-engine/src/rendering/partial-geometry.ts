import { Point2D, BezierCurve, StrokeCandidate, PartialStrokeGeometry } from '@sketch-maker/shared-types';
import {
  trimCubicBezier,
  approximateCubicBezierLength,
  evaluateCubicBezier
} from './bezier-subdivide';

/**
 * Pure, deterministic extraction of partial stroke geometry at any arbitrary progress in [0.0, 1.0].
 * Uses true arc-length traversal rather than point index slicing, ensuring uniform visual drawing speed
 * regardless of point density or curve curvature.
 *
 * Guarantees zero mutation of the input StrokeCandidate.
 */
export function getPartialStrokeGeometry(
  stroke: StrokeCandidate,
  rawProgress: number
): PartialStrokeGeometry {
  const progress = Math.min(1.0, Math.max(0.0, rawProgress));

  // 1. Zero progress: stroke has not begun
  if (progress <= 0.0) {
    return {
      points: [],
      curves: stroke.curves ? [] : undefined,
      tipPoint: undefined,
      tipTangent: undefined,
      progress: 0.0,
      isComplete: false
    };
  }

  // 2. Complete progress (100%): full stroke is visible
  if (progress >= 1.0) {
    let tipPoint: Point2D | undefined;
    let tipTangent: Point2D | undefined;

    if (stroke.curves && stroke.curves.length > 0) {
      const lastCurve = stroke.curves[stroke.curves.length - 1];
      tipPoint = { x: lastCurve.end.x, y: lastCurve.end.y };
      const dx = lastCurve.end.x - (lastCurve.cp2?.x ?? lastCurve.cp1.x);
      const dy = lastCurve.end.y - (lastCurve.cp2?.y ?? lastCurve.cp1.y);
      const len = Math.hypot(dx, dy);
      tipTangent = len > 1e-6 ? { x: dx / len, y: dy / len } : { x: 1.0, y: 0.0 };
    } else if (stroke.points.length > 0) {
      const lastPt = stroke.points[stroke.points.length - 1];
      tipPoint = { x: lastPt.x, y: lastPt.y };
      if (stroke.points.length >= 2) {
        const prevPt = stroke.points[stroke.points.length - 2];
        const dx = lastPt.x - prevPt.x;
        const dy = lastPt.y - prevPt.y;
        const len = Math.hypot(dx, dy);
        tipTangent = len > 1e-6 ? { x: dx / len, y: dy / len } : { x: 1.0, y: 0.0 };
      }
    }

    return {
      points: stroke.points.map(p => ({ x: p.x, y: p.y })),
      curves: stroke.curves ? stroke.curves.map(c => ({
        start: { x: c.start.x, y: c.start.y },
        cp1: { x: c.cp1.x, y: c.cp1.y },
        cp2: c.cp2 ? { x: c.cp2.x, y: c.cp2.y } : undefined,
        end: { x: c.end.x, y: c.end.y }
      })) : undefined,
      tipPoint,
      tipTangent,
      progress: 1.0,
      isComplete: true
    };
  }

  // 3. Single-point dot stroke
  if (stroke.points.length === 1 && (!stroke.curves || stroke.curves.length === 0)) {
    const pt = stroke.points[0];
    return {
      points: [{ x: pt.x, y: pt.y }],
      tipPoint: { x: pt.x, y: pt.y },
      tipTangent: { x: 1.0, y: 0.0 },
      progress,
      isComplete: progress >= 1.0
    };
  }

  // 4. Traversal over Catmull-Rom cubic Bézier curves (Primary representation)
  if (stroke.curves && stroke.curves.length > 0) {
    return extractPartialBezierGeometry(stroke.curves, progress);
  }

  // 5. Traversal over Polyline segments (Fallback representation)
  return extractPartialPolylineGeometry(stroke.points, progress);
}

/**
 * Extracts partial curves and corresponding sample points along cubic Bézier curves based on arc-length.
 */
function extractPartialBezierGeometry(
  curves: BezierCurve[],
  progress: number
): PartialStrokeGeometry {
  const curveLengths = curves.map(c => approximateCubicBezierLength(c));
  let totalLength = 0;
  for (let i = 0; i < curveLengths.length; i++) {
    totalLength += curveLengths[i];
  }

  if (totalLength < 1e-6) {
    const first = curves[0];
    return {
      points: [{ x: first.start.x, y: first.start.y }],
      curves: [{
        start: { x: first.start.x, y: first.start.y },
        cp1: { x: first.cp1.x, y: first.cp1.y },
        cp2: first.cp2 ? { x: first.cp2.x, y: first.cp2.y } : undefined,
        end: { x: first.end.x, y: first.end.y }
      }],
      tipPoint: { x: first.start.x, y: first.start.y },
      tipTangent: { x: 1.0, y: 0.0 },
      progress,
      isComplete: false
    };
  }

  const targetDist = progress * totalLength;
  let accumulated = 0;
  let activeCurveIdx = curves.length - 1;
  let localT = 1.0;

  for (let i = 0; i < curves.length; i++) {
    const cLen = curveLengths[i];
    if (accumulated + cLen >= targetDist || i === curves.length - 1) {
      activeCurveIdx = i;
      const remainingDist = Math.max(0, targetDist - accumulated);
      localT = cLen > 1e-6 ? Math.min(1.0, remainingDist / cLen) : 1.0;
      break;
    }
    accumulated += cLen;
  }

  const partialCurves: BezierCurve[] = [];
  const partialPoints: Point2D[] = [];

  // Completed curves prior to active curve
  for (let i = 0; i < activeCurveIdx; i++) {
    const c = curves[i];
    partialCurves.push({
      start: { x: c.start.x, y: c.start.y },
      cp1: { x: c.cp1.x, y: c.cp1.y },
      cp2: c.cp2 ? { x: c.cp2.x, y: c.cp2.y } : undefined,
      end: { x: c.end.x, y: c.end.y }
    });
    if (i === 0) {
      partialPoints.push({ x: c.start.x, y: c.start.y });
    }
    partialPoints.push({ x: c.end.x, y: c.end.y });
  }

  // Active curve trimmed via de Casteljau
  const activeCurve = curves[activeCurveIdx];
  const trimmed = trimCubicBezier(activeCurve, localT);
  partialCurves.push(trimmed.subCurve);

  if (partialPoints.length === 0) {
    partialPoints.push({ x: trimmed.subCurve.start.x, y: trimmed.subCurve.start.y });
  }
  partialPoints.push({ x: trimmed.tipPoint.x, y: trimmed.tipPoint.y });

  return {
    points: partialPoints,
    curves: partialCurves,
    tipPoint: trimmed.tipPoint,
    tipTangent: trimmed.tipTangent,
    progress,
    isComplete: false
  };
}

/**
 * Extracts partial polyline segments based on cumulative arc-length.
 */
function extractPartialPolylineGeometry(
  points: Point2D[],
  progress: number
): PartialStrokeGeometry {
  if (points.length === 0) {
    return {
      points: [],
      progress,
      isComplete: false
    };
  }

  if (points.length === 1) {
    const pt = points[0];
    return {
      points: [{ x: pt.x, y: pt.y }],
      tipPoint: { x: pt.x, y: pt.y },
      tipTangent: { x: 1.0, y: 0.0 },
      progress,
      isComplete: false
    };
  }

  // Compute segment lengths
  const segmentLengths: number[] = [];
  let totalLength = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    segmentLengths.push(len);
    totalLength += len;
  }

  if (totalLength < 1e-6) {
    return {
      points: points.map(p => ({ x: p.x, y: p.y })),
      tipPoint: { x: points[0].x, y: points[0].y },
      tipTangent: { x: 1.0, y: 0.0 },
      progress,
      isComplete: false
    };
  }

  const targetDist = progress * totalLength;
  let accumulated = 0;
  const partialPoints: Point2D[] = [{ x: points[0].x, y: points[0].y }];
  let tipPoint: Point2D = { x: points[0].x, y: points[0].y };
  let tipTangent: Point2D = { x: 1.0, y: 0.0 };

  for (let i = 0; i < segmentLengths.length; i++) {
    const sLen = segmentLengths[i];
    const pStart = points[i];
    const pEnd = points[i + 1];

    if (accumulated + sLen >= targetDist || i === segmentLengths.length - 1) {
      const remainingDist = Math.max(0, targetDist - accumulated);
      const t = sLen > 1e-6 ? Math.min(1.0, remainingDist / sLen) : 1.0;

      tipPoint = {
        x: pStart.x + t * (pEnd.x - pStart.x),
        y: pStart.y + t * (pEnd.y - pStart.y)
      };

      const dx = pEnd.x - pStart.x;
      const dy = pEnd.y - pStart.y;
      const len = Math.hypot(dx, dy);
      tipTangent = len > 1e-6 ? { x: dx / len, y: dy / len } : { x: 1.0, y: 0.0 };

      partialPoints.push(tipPoint);
      break;
    } else {
      accumulated += sLen;
      partialPoints.push({ x: pEnd.x, y: pEnd.y });
    }
  }

  return {
    points: partialPoints,
    tipPoint,
    tipTangent,
    progress,
    isComplete: false
  };
}
