import {
  Point2D,
  ContourPath,
  ReconstructedBody,
  HeadPose,
  BoundingBox,
  BodyFeatures,
} from '@sketch-maker/shared-types';

function clamp(val: number): number {
  return Math.max(0.0, Math.min(1.0, Number(val.toFixed(5))));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothPolyline(points: readonly Point2D[], closed: boolean): Point2D[] {
  if (points.length < 3) return [...points];
  const n = points.length;
  const smoothed: Point2D[] = [];

  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) {
      smoothed.push({ ...points[i] });
      continue;
    }
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    smoothed.push({
      x: clamp(prev.x * 0.25 + curr.x * 0.50 + next.x * 0.25),
      y: clamp(prev.y * 0.25 + curr.y * 0.50 + next.y * 0.25),
    });
  }
  return smoothed;
}

/**
 * Reconstructs realistic anatomical neck, shoulders, and clothing:
 * 1. Uses real BlazePose shoulder keypoints when available
 * 2. Natural bilateral neck contours flowing from behind the jaw
 * 3. Graceful downward-sloping shoulder curves
 * 4. Classic crew-neck collar arc (open curve matching crewneck sweater)
 * ZERO closed polygons across the bottom of the photo, ZERO horizontal chest triangles.
 */
export function reconstructBody(
  body: BodyFeatures | undefined,
  faceBox: BoundingBox | undefined,
  chinPoint: Point2D | undefined,
  pose: HeadPose,
  confidence: number,
  subjectId: string,
  clothingLoops?: readonly (readonly Point2D[])[]
): ReconstructedBody {
  const neckLines: ContourPath[] = [];
  const shoulderLines: ContourPath[] = [];
  const collarLines: ContourPath[] = [];
  const clothingContours: ContourPath[] = [];

  const fBox = faceBox ?? { x: 0.3, y: 0.2, width: 0.4, height: 0.4 };
  const fCenterX = fBox.x + fBox.width * 0.5;
  const chinY = chinPoint ? chinPoint.y : fBox.y + fBox.height;

  // 1. Reconstruct Neck Lines
  const neckTopY = clamp(chinY + 0.008);
  const neckBottomY = clamp(chinY + fBox.height * 0.32);
  const neckHalfWidthTop = fBox.width * 0.26;
  const neckHalfWidthBottom = fBox.width * 0.35;

  // Left neck contour
  if (pose !== 'right_profile') {
    neckLines.push({
      id: `${subjectId}_neck_left`,
      region: 'shoulders',
      points: [
        { x: clamp(fCenterX - neckHalfWidthTop), y: neckTopY },
        { x: clamp(fCenterX - (neckHalfWidthTop + neckHalfWidthBottom) * 0.5), y: lerp(neckTopY, neckBottomY, 0.5) },
        { x: clamp(fCenterX - neckHalfWidthBottom), y: neckBottomY },
      ],
      closed: false,
      confidence: confidence * 0.88,
      visibility: 'visible',
    });
  }

  // Right neck contour
  if (pose !== 'left_profile') {
    neckLines.push({
      id: `${subjectId}_neck_right`,
      region: 'shoulders',
      points: [
        { x: clamp(fCenterX + neckHalfWidthTop), y: neckTopY },
        { x: clamp(fCenterX + (neckHalfWidthTop + neckHalfWidthBottom) * 0.5), y: lerp(neckTopY, neckBottomY, 0.5) },
        { x: clamp(fCenterX + neckHalfWidthBottom), y: neckBottomY },
      ],
      closed: false,
      confidence: confidence * 0.88,
      visibility: 'visible',
    });
  }

  // 2. Reconstruct Shoulders (Organic downward-sloping curves)
  const lShoulderLandmark = body?.pose?.leftShoulder?.point;
  const rShoulderLandmark = body?.pose?.rightShoulder?.point;

  const lShoulderAnchor: Point2D = lShoulderLandmark ?? {
    x: clamp(fCenterX - fBox.width * 0.95),
    y: clamp(neckBottomY + fBox.height * 0.16),
  };
  const lNeckBase: Point2D = { x: clamp(fCenterX - neckHalfWidthBottom), y: neckBottomY };

  shoulderLines.push({
    id: `${subjectId}_shoulder_left`,
    region: 'shoulders',
    points: [
      lNeckBase,
      { x: clamp(lerp(lNeckBase.x, lShoulderAnchor.x, 0.5)), y: clamp(lerp(lNeckBase.y, lShoulderAnchor.y, 0.35) - 0.003) },
      lShoulderAnchor,
    ],
    closed: false,
    confidence: confidence * 0.85,
    visibility: 'visible',
  });

  const rShoulderAnchor: Point2D = rShoulderLandmark ?? {
    x: clamp(fCenterX + fBox.width * 0.95),
    y: clamp(neckBottomY + fBox.height * 0.16),
  };
  const rNeckBase: Point2D = { x: clamp(fCenterX + neckHalfWidthBottom), y: neckBottomY };

  shoulderLines.push({
    id: `${subjectId}_shoulder_right`,
    region: 'shoulders',
    points: [
      rNeckBase,
      { x: clamp(lerp(rNeckBase.x, rShoulderAnchor.x, 0.5)), y: clamp(lerp(rNeckBase.y, rShoulderAnchor.y, 0.35) - 0.003) },
      rShoulderAnchor,
    ],
    closed: false,
    confidence: confidence * 0.85,
    visibility: 'visible',
  });

  // 3. Crew-neck Collar curve (classic sweater neckline)
  const collarDipY = clamp(neckBottomY + 0.032);
  collarLines.push({
    id: `${subjectId}_clothing_collar`,
    region: 'clothing',
    points: [
      lNeckBase,
      { x: clamp(lerp(lNeckBase.x, fCenterX, 0.5)), y: clamp(collarDipY - 0.006) },
      { x: fCenterX, y: collarDipY },
      { x: clamp(lerp(fCenterX, rNeckBase.x, 0.5)), y: clamp(collarDipY - 0.006) },
      rNeckBase,
    ],
    closed: false,
    confidence: confidence * 0.84,
    visibility: 'visible',
  });

  return {
    confidence,
    neckLines,
    shoulderLines,
    collarLines,
    clothingContours,
  };
}
