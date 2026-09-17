import {
  Point2D,
  ContourPath,
  FeatureVisibility,
} from '@sketch-maker/shared-types';
import { NormalizedImage } from '@sketch-maker/image-processing';
import { FaceRegionEstimate, SubjectMask } from './types';
import { GradientField } from './gradient';
import { EyeDetectionResult, EYE_DETECTOR_CONFIG } from './eyes';

/**
 * Result container for detected eyebrow landmarks on a single subject.
 */
export interface EyebrowDetectionResult {
  readonly leftEyebrow?: ContourPath;
  readonly rightEyebrow?: ContourPath;
}

/**
 * Configuration constants for eyebrow landmark detection.
 */
export const EYEBROW_DETECTOR_CONFIG = {
  /** Relative vertical search range within face bounding box [min, max] when eyes unavailable */
  SUPRAORBITAL_BAND_Y: [0.10, 0.36] as const,
  /** Horizontal search range for frontal left eyebrow [min, max] fraction of face width */
  FRONTAL_LEFT_X: [0.10, 0.48] as const,
  /** Horizontal search range for frontal right eyebrow [min, max] fraction of face width */
  FRONTAL_RIGHT_X: [0.52, 0.90] as const,
  /** Expected eyebrow half-width fraction of face width */
  BROW_HALF_WIDTH_FRACTION: 0.14,
  /** Expected eyebrow half-height fraction of face height */
  BROW_HALF_HEIGHT_FRACTION: 0.05,
  /** Minimum score required to mark an eyebrow as visible */
  MIN_VISIBLE_SCORE: 0.18,
  /** Minimum score required to mark an eyebrow as uncertain */
  MIN_UNCERTAIN_SCORE: 0.10,
  /** Minimum vertical separation in pixels between eyebrow and upper eyelid */
  MIN_EYELID_SEPARATION_PX: 2,
} as const;

/**
 * Creates an occluded eyebrow placeholder for hidden profile sides (e.g. BM-02).
 */
function createOccludedEyebrow(side: 'left' | 'right'): ContourPath {
  return {
    id: `${side}_eyebrow`,
    region: 'eyebrows',
    points: [],
    closed: false,
    confidence: 0,
    visibility: 'occluded',
  };
}

/**
 * Creates an undetected eyebrow placeholder when image evidence is insufficient.
 */
function createUndetectedEyebrow(side: 'left' | 'right', confidence = 0): ContourPath {
  return {
    id: `${side}_eyebrow`,
    region: 'eyebrows',
    points: [],
    closed: false,
    confidence: Number(confidence.toFixed(3)),
    visibility: 'not_detected',
  };
}

/**
 * Evaluates local eyebrow ridge saliency at a given pixel (x, y).
 * Uses directional edge gradients, vertical luminance valley contrast,
 * and penalizes overlap with eyelid / glasses margins.
 */
function evaluateBrowSaliency(
  x: number,
  y: number,
  minAllowedY: number,
  maxAllowedY: number,
  expectedY: number,
  forbiddenMaxY: number, // upper eyelid ceiling
  lumData: Uint8Array,
  gradMag: Float32Array,
  maskData: Uint8Array,
  imgW: number,
  imgH: number
): number {
  if (x < 1 || x >= imgW - 1 || y < 1 || y >= imgH - 1) return 0;
  const idx = y * imgW + x;
  if (maskData[idx] === 0) return 0;

  // Separation from upper eyelid: must be strictly above forbiddenMaxY
  if (forbiddenMaxY > 0 && y >= forbiddenMaxY - EYEBROW_DETECTOR_CONFIG.MIN_EYELID_SEPARATION_PX) {
    return 0;
  }

  const centerLum = lumData[idx] / 255.0;
  const edge = gradMag[idx];

  // Sample supra-brow (forehead skin) and infra-brow (supraorbital eyelid skin)
  const deltaY = 3;
  const yAbove = Math.max(0, y - deltaY);
  const yBelow = Math.min(imgH - 1, y + deltaY);
  const lumAbove = lumData[yAbove * imgW + x] / 255.0;
  const lumBelow = lumData[yBelow * imgW + x] / 255.0;

  // Eyebrow ridge contrast: center brow hair is darker or structurally distinct
  // from both supra-brow forehead and infra-brow eyelid skin
  const contrastAbove = lumAbove - centerLum;
  const contrastBelow = lumBelow - centerLum;
  const ridgeContrast = (contrastAbove + contrastBelow) * 0.5;

  // Vertical prior: gentle Gaussian falloff around expected brow level
  const dy = y - expectedY;
  const sigma = Math.max(5, (maxAllowedY - minAllowedY) * 0.35);
  const vertPrior = Math.exp(-(dy * dy) / (2 * sigma * sigma));

  // Multi-cue saliency: edge energy (50%) + ridge contrast (35%) + darkness (15%)
  const rawSaliency =
    edge * 0.50 +
    Math.max(0, ridgeContrast) * 0.35 +
    (1.0 - centerLum) * 0.15;

  return rawSaliency * vertPrior;
}

/**
 * Traces the supraorbital eyebrow ridge across the horizontal span [xMin, xMax].
 * Uses dynamic programming with continuity constraints to form a smooth raw path.
 */
function traceEyebrowRidge(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  expectedY: number,
  forbiddenMaxY: number,
  lumData: Uint8Array,
  gradMag: Float32Array,
  maskData: Uint8Array,
  imgW: number,
  imgH: number
): { points: Point2D[]; meanScore: number } {
  const spanW = xMax - xMin + 1;
  const spanH = yMax - yMin + 1;
  if (spanW < 4 || spanH < 4) {
    return { points: [], meanScore: 0 };
  }

  // Compute saliency grid for the search window
  const grid: number[][] = [];
  for (let xi = 0; xi < spanW; xi++) {
    const x = xMin + xi;
    const col: number[] = [];
    for (let yi = 0; yi < spanH; yi++) {
      const y = yMin + yi;
      const score = evaluateBrowSaliency(
        x,
        y,
        yMin,
        yMax,
        expectedY,
        forbiddenMaxY,
        lumData,
        gradMag,
        maskData,
        imgW,
        imgH
      );
      col.push(score);
    }
    grid.push(col);
  }

  // Dynamic programming: find path from xi = 0 to spanW - 1 maximizing cumulative score
  // with vertical jump constraint |yi - y_{i-1}| <= 2
  const dp: number[][] = [];
  const parent: number[][] = [];
  for (let xi = 0; xi < spanW; xi++) {
    dp.push(new Array(spanH).fill(-Infinity));
    parent.push(new Array(spanH).fill(-1));
  }

  // Base column
  for (let yi = 0; yi < spanH; yi++) {
    dp[0][yi] = grid[0][yi];
  }

  // Recurrence
  for (let xi = 1; xi < spanW; xi++) {
    for (let yi = 0; yi < spanH; yi++) {
      let maxPrev = -Infinity;
      let bestPrevY = -1;
      const prevMinY = Math.max(0, yi - 2);
      const prevMaxY = Math.min(spanH - 1, yi + 2);

      for (let py = prevMinY; py <= prevMaxY; py++) {
        const val = dp[xi - 1][py];
        if (val > maxPrev) {
          maxPrev = val;
          bestPrevY = py;
        }
      }

      if (maxPrev > -Infinity) {
        // Continuity bonus: penalize vertical curvature / abrupt steps
        const stepPenalty = Math.abs(yi - bestPrevY) * 0.04;
        dp[xi][yi] = maxPrev + grid[xi][yi] - stepPenalty;
        parent[xi][yi] = bestPrevY;
      }
    }
  }

  // Find best ending point in the final column (or within last 3 columns)
  let bestScore = -Infinity;
  let bestEndYi = -1;
  let bestEndXi = spanW - 1;

  for (let checkXi = spanW - 1; checkXi >= Math.max(0, spanW - 3); checkXi--) {
    for (let yi = 0; yi < spanH; yi++) {
      if (dp[checkXi][yi] > bestScore) {
        bestScore = dp[checkXi][yi];
        bestEndYi = yi;
        bestEndXi = checkXi;
      }
    }
  }

  if (bestScore <= 0 || bestEndYi < 0) {
    return { points: [], meanScore: 0 };
  }

  // Backtrack to extract the optimal raw ridge path
  const rawPoints: { x: number; y: number; score: number }[] = [];
  let currYi = bestEndYi;
  for (let xi = bestEndXi; xi >= 0; xi--) {
    const x = xMin + xi;
    const y = yMin + currYi;
    rawPoints.push({ x, y, score: grid[xi][currYi] });
    currYi = parent[xi][currYi];
    if (currYi < 0 && xi > 0) break;
  }

  rawPoints.reverse();
  if (rawPoints.length < 4) {
    return { points: [], meanScore: 0 };
  }

  // Filter out weak tail segments on the lateral or medial periphery
  let validStart = 0;
  while (validStart < rawPoints.length && rawPoints[validStart].score < 0.08) {
    validStart++;
  }
  let validEnd = rawPoints.length - 1;
  while (validEnd > validStart && rawPoints[validEnd].score < 0.08) {
    validEnd--;
  }

  const activePoints = rawPoints.slice(validStart, validEnd + 1);
  if (activePoints.length < 4) {
    return { points: [], meanScore: 0 };
  }

  const sumScore = activePoints.reduce((acc, p) => acc + p.score, 0);
  const meanScore = sumScore / activePoints.length;

  const normalizedPoints: Point2D[] = activePoints.map(p => ({
    x: Number((p.x / imgW).toFixed(5)),
    y: Number((p.y / imgH).toFixed(5)),
  }));

  return { points: normalizedPoints, meanScore };
}

/**
 * Detects left and right eyebrow landmarks from a FaceRegionEstimate and segmented image.
 *
 * Principle:
 * - Operates strictly in normalized [0, 1] coordinates.
 * - Respects head pose and lateral visibility (profile hidden side is strictly marked occluded).
 * - Multi-cue evidence model: directional gradients + supraorbital valley contrast.
 * - Robust against hair, beards, shadows, and glasses frames.
 *
 * @param face The isolated face region estimate from Step 1 / 1.1.
 * @param image The normalized preprocessed image.
 * @param gradients Sobel directional gradient field.
 * @param mask Segmented subject foreground mask.
 * @param detectedEyes Optional detected eye landmarks from Step 2A to refine supraorbital bounds.
 */
export function detectEyebrows(
  face: FaceRegionEstimate,
  image: NormalizedImage,
  gradients: GradientField,
  mask: SubjectMask,
  detectedEyes?: EyeDetectionResult
): EyebrowDetectionResult {
  const imgW = image.luminance.width;
  const imgH = image.luminance.height;
  const lumData = image.luminance.data;
  const gradMag = gradients.magnitude;
  const maskData = mask.data;

  const { faceBoundingBox, pose, visibleSide } = face;

  // Convert face bounding box from normalized to processing pixels
  const fX = Math.round(faceBoundingBox.x * imgW);
  const fY = Math.round(faceBoundingBox.y * imgH);
  const fW = Math.round(faceBoundingBox.width * imgW);
  const fH = Math.round(faceBoundingBox.height * imgH);

  if (fW < 10 || fH < 10) {
    return {
      leftEyebrow: createUndetectedEyebrow('left', 0),
      rightEyebrow: createUndetectedEyebrow('right', 0),
    };
  }

  const halfBrowW = Math.max(3, Math.round(fW * EYEBROW_DETECTOR_CONFIG.BROW_HALF_WIDTH_FRACTION));
  const halfBrowH = Math.max(3, Math.round(fH * EYEBROW_DETECTOR_CONFIG.BROW_HALF_HEIGHT_FRACTION));

  // Determine vertical supraorbital search band
  const defaultBrowBandMinY = fY + Math.floor(fH * EYEBROW_DETECTOR_CONFIG.SUPRAORBITAL_BAND_Y[0]);
  const defaultBrowBandMaxY = fY + Math.floor(fH * EYEBROW_DETECTOR_CONFIG.SUPRAORBITAL_BAND_Y[1]);

  let leftEyebrow: ContourPath;
  let rightEyebrow: ContourPath;

  // -------------------------------------------------------------------------
  // 1. Left Eyebrow (Viewer's Left, x < centerX)
  // -------------------------------------------------------------------------
  if (visibleSide === 'right_only' || pose === 'right_profile') {
    leftEyebrow = createOccludedEyebrow('left');
  } else {
    let leftXMin: number;
    let leftXMax: number;

    if (pose === 'left_profile') {
      leftXMin = fX + Math.floor(fW * 0.05);
      leftXMax = fX + Math.floor(fW * 0.46);
    } else if (pose === 'three_quarter_left') {
      leftXMin = fX + Math.floor(fW * 0.08);
      leftXMax = fX + Math.floor(fW * 0.44);
    } else if (pose === 'three_quarter_right') {
      leftXMin = fX + Math.floor(fW * 0.16);
      leftXMax = fX + Math.floor(fW * 0.48);
    } else {
      // Frontal
      leftXMin = fX + Math.floor(fW * EYEBROW_DETECTOR_CONFIG.FRONTAL_LEFT_X[0]);
      leftXMax = fX + Math.floor(fW * EYEBROW_DETECTOR_CONFIG.FRONTAL_LEFT_X[1]);
    }

    // Refine vertical search bounds if left eye was detected
    let browMinY = defaultBrowBandMinY;
    let browMaxY = defaultBrowBandMaxY;
    let expectedBrowY = Math.round((defaultBrowBandMinY + defaultBrowBandMaxY) * 0.5);
    let forbiddenMaxY = 0;

    const leftEye = detectedEyes?.leftEye;
    if (leftEye && leftEye.visibility === 'visible' && leftEye.upperLid.points.length > 0) {
      // Find top of upper eyelid in pixel coordinates
      let eyeTopY = imgH;
      for (const p of leftEye.upperLid.points) {
        const py = Math.round(p.y * imgH);
        if (py < eyeTopY) eyeTopY = py;
      }
      forbiddenMaxY = eyeTopY;
      browMaxY = Math.min(browMaxY, eyeTopY - EYEBROW_DETECTOR_CONFIG.MIN_EYELID_SEPARATION_PX);
      expectedBrowY = Math.max(browMinY + 2, eyeTopY - Math.round(halfBrowH * 2.2));
      browMinY = Math.max(fY + Math.floor(fH * 0.06), expectedBrowY - halfBrowH * 2);
    }

    browMinY = Math.max(1, Math.min(imgH - 2, browMinY));
    browMaxY = Math.max(browMinY + 4, Math.min(imgH - 2, browMaxY));

    const leftTrace = traceEyebrowRidge(
      Math.max(1, leftXMin),
      Math.min(imgW - 2, leftXMax),
      browMinY,
      browMaxY,
      expectedBrowY,
      forbiddenMaxY,
      lumData,
      gradMag,
      maskData,
      imgW,
      imgH
    );

    if (leftTrace.meanScore >= EYEBROW_DETECTOR_CONFIG.MIN_UNCERTAIN_SCORE && leftTrace.points.length >= 4) {
      const isVisible = leftTrace.meanScore >= EYEBROW_DETECTOR_CONFIG.MIN_VISIBLE_SCORE;
      const visibility: FeatureVisibility = isVisible ? 'visible' : 'uncertain';
      const conf = Math.max(0.16, Math.min(0.95, Number(leftTrace.meanScore.toFixed(3))));

      leftEyebrow = {
        id: 'left_eyebrow',
        region: 'eyebrows',
        points: leftTrace.points,
        closed: false,
        confidence: conf,
        visibility,
      };
    } else {
      leftEyebrow = createUndetectedEyebrow('left', leftTrace.meanScore);
    }
  }

  // -------------------------------------------------------------------------
  // 2. Right Eyebrow (Viewer's Right, x > centerX)
  // -------------------------------------------------------------------------
  if (visibleSide === 'left_only' || pose === 'left_profile') {
    rightEyebrow = createOccludedEyebrow('right');
  } else {
    let rightXMin: number;
    let rightXMax: number;

    if (pose === 'right_profile') {
      rightXMin = fX + Math.floor(fW * 0.54);
      rightXMax = fX + Math.floor(fW * 0.95);
    } else if (pose === 'three_quarter_right') {
      rightXMin = fX + Math.floor(fW * 0.56);
      rightXMax = fX + Math.floor(fW * 0.92);
    } else if (pose === 'three_quarter_left') {
      rightXMin = fX + Math.floor(fW * 0.52);
      rightXMax = fX + Math.floor(fW * 0.84);
    } else {
      // Frontal
      rightXMin = fX + Math.floor(fW * EYE_DETECTOR_CONFIG.FRONTAL_RIGHT_X[0]);
      rightXMax = fX + Math.floor(fW * EYE_DETECTOR_CONFIG.FRONTAL_RIGHT_X[1]);
    }

    // Refine vertical search bounds if right eye was detected
    let browMinY = defaultBrowBandMinY;
    let browMaxY = defaultBrowBandMaxY;
    let expectedBrowY = Math.round((defaultBrowBandMinY + defaultBrowBandMaxY) * 0.5);
    let forbiddenMaxY = 0;

    const rightEye = detectedEyes?.rightEye;
    if (rightEye && rightEye.visibility === 'visible' && rightEye.upperLid.points.length > 0) {
      // Find top of upper eyelid in pixel coordinates
      let eyeTopY = imgH;
      for (const p of rightEye.upperLid.points) {
        const py = Math.round(p.y * imgH);
        if (py < eyeTopY) eyeTopY = py;
      }
      forbiddenMaxY = eyeTopY;
      browMaxY = Math.min(browMaxY, eyeTopY - EYEBROW_DETECTOR_CONFIG.MIN_EYELID_SEPARATION_PX);
      expectedBrowY = Math.max(browMinY + 2, eyeTopY - Math.round(halfBrowH * 2.2));
      browMinY = Math.max(fY + Math.floor(fH * 0.06), expectedBrowY - halfBrowH * 2);
    }

    browMinY = Math.max(1, Math.min(imgH - 2, browMinY));
    browMaxY = Math.max(browMinY + 4, Math.min(imgH - 2, browMaxY));

    const rightTrace = traceEyebrowRidge(
      Math.max(1, rightXMin),
      Math.min(imgW - 2, rightXMax),
      browMinY,
      browMaxY,
      expectedBrowY,
      forbiddenMaxY,
      lumData,
      gradMag,
      maskData,
      imgW,
      imgH
    );

    if (rightTrace.meanScore >= EYEBROW_DETECTOR_CONFIG.MIN_UNCERTAIN_SCORE && rightTrace.points.length >= 4) {
      const isVisible = rightTrace.meanScore >= EYEBROW_DETECTOR_CONFIG.MIN_VISIBLE_SCORE;
      const visibility: FeatureVisibility = isVisible ? 'visible' : 'uncertain';
      const conf = Math.max(0.16, Math.min(0.95, Number(rightTrace.meanScore.toFixed(3))));

      rightEyebrow = {
        id: 'right_eyebrow',
        region: 'eyebrows',
        points: rightTrace.points,
        closed: false,
        confidence: conf,
        visibility,
      };
    } else {
      rightEyebrow = createUndetectedEyebrow('right', rightTrace.meanScore);
    }
  }

  return {
    leftEyebrow,
    rightEyebrow,
  };
}
