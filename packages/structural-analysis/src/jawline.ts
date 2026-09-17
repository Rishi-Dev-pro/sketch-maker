import {
  Point2D,
  ContourPath,
  FeatureVisibility,
  HeadPose,
} from '@sketch-maker/shared-types';
import { NormalizedImage } from '@sketch-maker/image-processing';
import { FaceRegionEstimate, SubjectMask } from './types';
import { GradientField } from './gradient';
import { EyeDetectionResult } from './eyes';
import { NoseDetectionResult } from './nose';
import { MouthDetectionResult } from './mouth';

/**
 * Result container for detected jawline and facial outer contour landmarks.
 */
export interface JawlineDetectionResult {
  /** Overall visibility classification for the jawline / facial contour */
  readonly visibility: FeatureVisibility;
  /** Overall jawline detection confidence [0.0 - 1.0] */
  readonly confidence: number;
  /** Full continuous jawline contour path (left cheek -> chin -> right cheek) */
  readonly jawline?: ContourPath;
  /** Specific chin contour path / arc */
  readonly chin?: ContourPath;
  /** Left mandibular boundary path (visible side on frontal / 3/4 / left profile) */
  readonly leftJaw?: ContourPath;
  /** Right mandibular boundary path (visible side on frontal / 3/4 / right profile) */
  readonly rightJaw?: ContourPath;
  /** Chin tip (gnathion / pogonion) in normalized coordinates */
  readonly chinTip?: Point2D;
}

/**
 * Configuration constants for jawline and facial outer contour detection.
 */
export const JAWLINE_CONFIG = {
  /** Relative vertical start fraction within face bounding box (below eyes/cheeks) */
  START_Y_FRACTION: 0.45,
  /** Maximum vertical search fraction within face bounding box for chin apex */
  MAX_CHIN_Y_FRACTION: 1.05,
  /** Minimum search width margin fraction of face width */
  HORIZONTAL_MARGIN_FRACTION: 0.15,
  /** Shoulder expansion threshold ratio that signals transition from chin/jaw to neck/torso */
  SHOULDER_EXPANSION_RATIO: 1.20,
  /** Minimum score required to mark jawline as visible */
  MIN_JAWLINE_VISIBLE_SCORE: 0.14,
  /** Minimum score required to mark jawline as uncertain */
  MIN_JAWLINE_UNCERTAIN_SCORE: 0.07,
} as const;

/**
 * Locates the subject boundary edge along a horizontal row within [xMin, xMax].
 * Direction 'left_to_right' searches for the first foreground pixel (left silhouette boundary).
 * Direction 'right_to_left' searches for the last foreground pixel (right silhouette boundary).
 */
function findMaskBoundary(
  y: number,
  xMin: number,
  xMax: number,
  direction: 'left_to_right' | 'right_to_left',
  maskData: Uint8Array,
  gradMag: Float32Array,
  imgW: number
): { x: number; score: number } | null {
  const rowOffset = y * imgW;
  let boundaryX = -1;

  if (direction === 'left_to_right') {
    for (let x = xMin; x <= xMax; x++) {
      if (maskData[rowOffset + x] > 0) {
        boundaryX = x;
        break;
      }
    }
  } else {
    for (let x = xMax; x >= xMin; x--) {
      if (maskData[rowOffset + x] > 0) {
        boundaryX = x;
        break;
      }
    }
  }

  if (boundaryX === -1) return null;

  // Search in a local window of +/- 4px around the mask boundary for the peak Sobel gradient edge
  const searchRadius = 4;
  const wStart = Math.max(xMin, boundaryX - searchRadius);
  const wEnd = Math.min(xMax, boundaryX + searchRadius);

  let bestX = boundaryX;
  let maxEdge = gradMag[rowOffset + boundaryX];

  for (let x = wStart; x <= wEnd; x++) {
    const edge = gradMag[rowOffset + x];
    if (edge > maxEdge) {
      maxEdge = edge;
      bestX = x;
    }
  }

  const score = Math.min(1.0, maxEdge * 0.70 + 0.30);
  return { x: bestX, score };
}

/**
 * Detects the jawline, chin contour, and outer facial boundary from a FaceRegionEstimate,
 * segmented subject mask, gradient field, and internal facial landmarks.
 *
 * Principles:
 * - Operates strictly in normalized [0, 1] coordinates.
 * - Primary evidence is the anatomical SUBJECT SILHOUETTE + LOCAL FACE GEOMETRY.
 * - Profile faces (`left_profile`, `right_profile`): strictly preserves the visible anterior
 *   facial contour (glabella/nose/lips/chin/jaw) and suppresses the occluded hidden side without mirroring.
 * - Facial hair / beard robustness (`BM-04`): traces visible lower boundary without hallucinating
 *   invisible bone beneath dense beard hair.
 * - Hair / cranium robustness (`BM-05`): upper cranium hair is strictly excluded by anchoring below cheeks.
 * - Neck / clothing avoidance (`BM-09`, `BM-10`): inward mandibular convergence and neck width
 *   inflection isolate the chin apex and prevent tracing down into collars/shoulders.
 * - Preserves raw ordered path points without lossy simplification or artificial smoothing.
 *
 * @param face The isolated face region estimate from Step 1 / 1.1.
 * @param image The normalized preprocessed image.
 * @param gradients Sobel directional gradient field.
 * @param mask Segmented subject foreground mask.
 * @param detectedEyes Optional detected eye landmarks from Step 2A.
 * @param detectedNose Optional detected nose landmarks from Step 2C.
 * @param detectedMouth Optional detected mouth landmarks from Step 2D.
 */
export function detectJawline(
  face: FaceRegionEstimate,
  image: NormalizedImage,
  gradients: GradientField,
  mask: SubjectMask,
  detectedEyes?: EyeDetectionResult,
  detectedNose?: NoseDetectionResult,
  detectedMouth?: MouthDetectionResult
): JawlineDetectionResult {
  const imgW = image.luminance.width;
  const imgH = image.luminance.height;
  const maskData = mask.data;
  const gradMag = gradients.magnitude;

  const { faceBoundingBox, pose, visibleSide } = face;

  const fX = Math.round(faceBoundingBox.x * imgW);
  const fY = Math.round(faceBoundingBox.y * imgH);
  const fW = Math.round(faceBoundingBox.width * imgW);
  const fH = Math.round(faceBoundingBox.height * imgH);

  if (fW < 12 || fH < 12) {
    return {
      visibility: 'not_detected',
      confidence: 0,
    };
  }

  // -------------------------------------------------------------------------
  // 1. Establish Vertical Search Range
  // -------------------------------------------------------------------------
  // Start jawline search below eye sockets / mid-face
  let startY = fY + Math.round(fH * JAWLINE_CONFIG.START_Y_FRACTION);

  if (detectedNose?.bridge && detectedNose.bridge.points.length > 0) {
    // Start roughly around nose mid-bridge level
    const bridgeStartY = Math.round(detectedNose.bridge.points[0].y * imgH);
    startY = Math.max(fY + 6, bridgeStartY);
  } else if (detectedEyes) {
    let eyeY = 0;
    let eyeCount = 0;
    if (detectedEyes.leftEye?.upperLid.points.length) {
      eyeY += detectedEyes.leftEye.upperLid.points[0].y * imgH;
      eyeCount++;
    }
    if (detectedEyes.rightEye?.upperLid.points.length) {
      eyeY += detectedEyes.rightEye.upperLid.points[0].y * imgH;
      eyeCount++;
    }
    if (eyeCount > 0) {
      startY = Math.round(eyeY / eyeCount + fH * 0.15);
    }
  }

  // Mouth position provides a lower-bound anchor for the chin
  let mouthBottomY = -1;
  if (detectedMouth?.lowerLip?.points.length) {
    for (const p of detectedMouth.lowerLip.points) {
      const py = Math.round(p.y * imgH);
      if (py > mouthBottomY) mouthBottomY = py;
    }
  } else if (detectedMouth?.lipSeparation?.points.length) {
    for (const p of detectedMouth.lipSeparation.points) {
      const py = Math.round(p.y * imgH);
      if (py > mouthBottomY) mouthBottomY = py;
    }
  }

  // Horizontal bounds around the face region with slight margin
  const hMargin = Math.round(fW * JAWLINE_CONFIG.HORIZONTAL_MARGIN_FRACTION);
  const xMin = Math.max(1, fX - hMargin);
  const xMax = Math.min(imgW - 2, fX + fW + hMargin);
  const midX = fX + Math.round(fW * 0.5);

  const searchMaxY = Math.min(imgH - 2, fY + Math.round(fH * JAWLINE_CONFIG.MAX_CHIN_Y_FRACTION));

  // -------------------------------------------------------------------------
  // 2. Profile Pose Handling (BM-02)
  // -------------------------------------------------------------------------
  if (pose === 'left_profile' || visibleSide === 'left_only') {
    return extractProfileJawline(
      'left',
      fX,
      fW,
      startY,
      mouthBottomY,
      searchMaxY,
      maskData,
      gradMag,
      imgW,
      imgH
    );
  }

  if (pose === 'right_profile' || visibleSide === 'right_only') {
    return extractProfileJawline(
      'right',
      fX,
      fW,
      startY,
      mouthBottomY,
      searchMaxY,
      maskData,
      gradMag,
      imgW,
      imgH
    );
  }

  // -------------------------------------------------------------------------
  // 3. Frontal and Three-Quarter Jawline Extraction
  // -------------------------------------------------------------------------
  const rawLeftPoints: { x: number; y: number; score: number }[] = [];
  const rawRightPoints: { x: number; y: number; score: number }[] = [];

  let chinFoundY = searchMaxY;
  let minJawWidth = Infinity;
  let prevWidth = Infinity;

  // Scan downwards from cheek level to detect mandibular boundaries and chin convergence
  for (let y = startY; y <= searchMaxY; y++) {
    // Left boundary (search from left margin toward midline)
    const leftRes = findMaskBoundary(y, xMin, midX - 2, 'left_to_right', maskData, gradMag, imgW);
    // Right boundary (search from right margin toward midline)
    const rightRes = findMaskBoundary(y, midX + 2, xMax, 'right_to_left', maskData, gradMag, imgW);

    if (leftRes && rightRes) {
      const width = rightRes.x - leftRes.x;

      // Check for chin apex inflection:
      // Below the mouth, the jaw width tapers inward toward the chin.
      // When the width inflects and begins expanding (shoulders/collar), the chin has ended.
      if (mouthBottomY > 0 && y > mouthBottomY + 4) {
        if (width < minJawWidth) {
          minJawWidth = width;
        } else if (width > minJawWidth * JAWLINE_CONFIG.SHOULDER_EXPANSION_RATIO && (y - mouthBottomY) >= 8) {
          // Shoulder/collar expansion detected below chin
          chinFoundY = y - 1;
          break;
        }
      }

      rawLeftPoints.push({ x: leftRes.x, y, score: leftRes.score });
      rawRightPoints.push({ x: rightRes.x, y, score: rightRes.score });
      prevWidth = width;
    } else if (leftRes && !rightRes) {
      rawLeftPoints.push({ x: leftRes.x, y, score: leftRes.score });
    } else if (!leftRes && rightRes) {
      rawRightPoints.push({ x: rightRes.x, y, score: rightRes.score });
    }
  }

  if (rawLeftPoints.length < 5 && rawRightPoints.length < 5) {
    return {
      visibility: 'not_detected',
      confidence: 0,
    };
  }

  // Determine chin tip: lowest point with narrowest mandibular apex
  const lowestY = Math.min(
    chinFoundY,
    Math.max(
      rawLeftPoints.length > 0 ? rawLeftPoints[rawLeftPoints.length - 1].y : 0,
      rawRightPoints.length > 0 ? rawRightPoints[rawRightPoints.length - 1].y : 0
    )
  );

  let chinTipX = midX;
  let chinConverged = true;
  if (rawLeftPoints.length > 0 && rawRightPoints.length > 0) {
    const lastL = rawLeftPoints[rawLeftPoints.length - 1];
    const lastR = rawRightPoints[rawRightPoints.length - 1];
    chinTipX = Math.round((lastL.x + lastR.x) * 0.5);
    const bottomWidth = lastR.x - lastL.x;
    // If the lowest detected width is nearly as wide as the upper face (> 0.65 * fW),
    // the mandibular contour never tapered toward a chin apex (evidence is incomplete or truncated)
    if (bottomWidth > fW * 0.65) {
      chinConverged = false;
    }
  } else if (rawLeftPoints.length > 0) {
    chinTipX = rawLeftPoints[rawLeftPoints.length - 1].x;
  } else if (rawRightPoints.length > 0) {
    chinTipX = rawRightPoints[rawRightPoints.length - 1].x;
  }

  const chinTip: Point2D = {
    x: Number((chinTipX / imgW).toFixed(5)),
    y: Number((lowestY / imgH).toFixed(5)),
  };

  // Vertical coverage metric: jawline must cover an adequate vertical span down to the chin
  const expectedSpan = Math.max(12, Math.round(fH * 0.22));
  const actualSpan = Math.max(0, lowestY - startY);
  const coverageFraction = Math.min(1.0, actualSpan / expectedSpan);

  const scores = [...rawLeftPoints.map((p) => p.score), ...rawRightPoints.map((p) => p.score)];
  const rawMeanConf = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const meanConf = rawMeanConf * coverageFraction * (chinConverged ? 1.0 : 0.4);
  const clampedConf = Number(Math.max(0.12, Math.min(0.95, meanConf)).toFixed(3));

  const isVisible = clampedConf >= JAWLINE_CONFIG.MIN_JAWLINE_VISIBLE_SCORE && coverageFraction >= 0.70 && chinConverged;
  const visibility: FeatureVisibility = isVisible ? 'visible' : 'uncertain';

  // Build Left Jaw contour path (top to bottom)
  let leftJaw: ContourPath | undefined;
  if (rawLeftPoints.length >= 5) {
    const rawConf = rawLeftPoints.reduce((acc, p) => acc + p.score, 0) / rawLeftPoints.length;
    const lSpan = rawLeftPoints[rawLeftPoints.length - 1].y - rawLeftPoints[0].y;
    const lCov = Math.min(1.0, lSpan / expectedSpan);
    const conf = rawConf * lCov;
    leftJaw = {
      id: 'left_jaw',
      region: 'jawline',
      points: rawLeftPoints.map((p) => ({
        x: Number((p.x / imgW).toFixed(5)),
        y: Number((p.y / imgH).toFixed(5)),
      })),
      closed: false,
      confidence: Number(conf.toFixed(3)),
      visibility: (conf >= JAWLINE_CONFIG.MIN_JAWLINE_VISIBLE_SCORE && lCov >= 0.70) ? 'visible' : 'uncertain',
    };
  }

  // Build Right Jaw contour path (top to bottom)
  let rightJaw: ContourPath | undefined;
  if (rawRightPoints.length >= 5) {
    const rawConf = rawRightPoints.reduce((acc, p) => acc + p.score, 0) / rawRightPoints.length;
    const rSpan = rawRightPoints[rawRightPoints.length - 1].y - rawRightPoints[0].y;
    const rCov = Math.min(1.0, rSpan / expectedSpan);
    const conf = rawConf * rCov;
    rightJaw = {
      id: 'right_jaw',
      region: 'jawline',
      points: rawRightPoints.map((p) => ({
        x: Number((p.x / imgW).toFixed(5)),
        y: Number((p.y / imgH).toFixed(5)),
      })),
      closed: false,
      confidence: Number(conf.toFixed(3)),
      visibility: (conf >= JAWLINE_CONFIG.MIN_JAWLINE_VISIBLE_SCORE && rCov >= 0.70) ? 'visible' : 'uncertain',
    };
  }

  // Build Chin arc: lowest 25% of the mandibular path connecting left to right
  let chin: ContourPath | undefined;
  const chinPts: Point2D[] = [];
  const chinCutoffY = mouthBottomY > 0 ? mouthBottomY : lowestY - Math.round(fH * 0.12);

  const chinLeft = rawLeftPoints.filter((p) => p.y >= chinCutoffY);
  const chinRight = rawRightPoints.filter((p) => p.y >= chinCutoffY);

  if ((chinLeft.length >= 2 || chinRight.length >= 2) && coverageFraction >= 0.70) {
    for (const p of chinLeft) {
      chinPts.push({ x: Number((p.x / imgW).toFixed(5)), y: Number((p.y / imgH).toFixed(5)) });
    }
    chinPts.push(chinTip);
    for (let i = chinRight.length - 1; i >= 0; i--) {
      const p = chinRight[i];
      chinPts.push({ x: Number((p.x / imgW).toFixed(5)), y: Number((p.y / imgH).toFixed(5)) });
    }

    const chinConf = Number((clampedConf * 0.9).toFixed(3));
    chin = {
      id: 'chin',
      region: 'jawline',
      points: chinPts,
      closed: false,
      confidence: chinConf,
      visibility: isVisible ? 'visible' : 'uncertain',
    };
  }

  // Assemble full unified Jawline path (left cheek -> chin -> right cheek)
  const fullPoints: Point2D[] = [];
  if (rawLeftPoints.length > 0) {
    for (const p of rawLeftPoints) {
      fullPoints.push({ x: Number((p.x / imgW).toFixed(5)), y: Number((p.y / imgH).toFixed(5)) });
    }
  }
  fullPoints.push(chinTip);
  if (rawRightPoints.length > 0) {
    for (let i = rawRightPoints.length - 1; i >= 0; i--) {
      const p = rawRightPoints[i];
      fullPoints.push({ x: Number((p.x / imgW).toFixed(5)), y: Number((p.y / imgH).toFixed(5)) });
    }
  }

  const jawline: ContourPath = {
    id: 'jawline',
    region: 'jawline',
    points: fullPoints,
    closed: false,
    confidence: clampedConf,
    visibility,
  };

  return {
    visibility,
    confidence: clampedConf,
    jawline,
    chin,
    leftJaw,
    rightJaw,
    chinTip,
  };
}

/**
 * Extracts outer facial contour for pure side-profile faces (e.g. BM-02).
 * Traces the visible anterior-inferior profile edge (glabella/nose/mouth/chin/mandible)
 * and strictly suppresses the occluded hidden side.
 */
function extractProfileJawline(
  side: 'left' | 'right',
  fX: number,
  fW: number,
  startY: number,
  mouthBottomY: number,
  searchMaxY: number,
  maskData: Uint8Array,
  gradMag: Float32Array,
  imgW: number,
  imgH: number
): JawlineDetectionResult {
  const isLeft = side === 'left';
  const profilePoints: { x: number; y: number; score: number }[] = [];

  // For left profile, search around left margin of face bounding box
  // For right profile, search around right margin
  const xMin = isLeft ? Math.max(1, fX - Math.round(fW * 0.15)) : fX + Math.round(fW * 0.60);
  const xMax = isLeft ? fX + Math.round(fW * 0.40) : Math.min(imgW - 2, fX + fW + Math.round(fW * 0.15));

  let minApexX = isLeft ? Infinity : -Infinity;
  let apexY = searchMaxY;

  for (let y = startY; y <= searchMaxY; y++) {
    const dir = isLeft ? 'left_to_right' : 'right_to_left';
    const res = findMaskBoundary(y, xMin, xMax, dir, maskData, gradMag, imgW);
    if (res) {
      profilePoints.push({ x: res.x, y, score: res.score });

      // Track most prominent anterior protrusion in lower half of face (pogonion / chin)
      if (mouthBottomY > 0 && y >= mouthBottomY) {
        if (isLeft && res.x < minApexX) {
          minApexX = res.x;
          apexY = y;
        } else if (!isLeft && res.x > minApexX) {
          minApexX = res.x;
          apexY = y;
        }
      }
    }
  }

  if (profilePoints.length < 6) {
    return {
      visibility: 'not_detected',
      confidence: 0,
    };
  }

  const scores = profilePoints.map((p) => p.score);
  const meanConf = scores.reduce((a, b) => a + b, 0) / scores.length;
  const clampedConf = Number(Math.max(0.15, Math.min(0.95, meanConf)).toFixed(3));

  const normPoints: Point2D[] = profilePoints.map((p) => ({
    x: Number((p.x / imgW).toFixed(5)),
    y: Number((p.y / imgH).toFixed(5)),
  }));

  const visibleJawPath: ContourPath = {
    id: isLeft ? 'left_jaw' : 'right_jaw',
    region: 'jawline',
    points: normPoints,
    closed: false,
    confidence: clampedConf,
    visibility: 'visible',
  };

  const chinTip: Point2D = {
    x: Number(((isLeft ? minApexX : minApexX) / imgW).toFixed(5)),
    y: Number((apexY / imgH).toFixed(5)),
  };

  // In profile, the chin is the lower curved portion of the visible silhouette
  const chinCutoffY = mouthBottomY > 0 ? mouthBottomY : apexY - 10;
  const chinPts = profilePoints
    .filter((p) => p.y >= chinCutoffY)
    .map((p) => ({ x: Number((p.x / imgW).toFixed(5)), y: Number((p.y / imgH).toFixed(5)) }));

  const chin: ContourPath = {
    id: 'chin',
    region: 'jawline',
    points: chinPts.length >= 3 ? chinPts : [chinTip],
    closed: false,
    confidence: clampedConf,
    visibility: 'visible',
  };

  return {
    visibility: 'visible',
    confidence: clampedConf,
    jawline: visibleJawPath,
    chin,
    leftJaw: isLeft ? visibleJawPath : undefined,
    rightJaw: isLeft ? undefined : visibleJawPath,
    chinTip,
  };
}
