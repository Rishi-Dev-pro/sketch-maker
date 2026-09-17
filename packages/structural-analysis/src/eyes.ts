import {
  Point2D,
  EyeLandmarks,
  ContourPath,
  FeatureVisibility,
} from '@sketch-maker/shared-types';
import { NormalizedImage } from '@sketch-maker/image-processing';
import { FaceRegionEstimate, SubjectMask } from './types';
import { GradientField } from './gradient';

/**
 * Result container for detected eye landmarks on a single subject.
 */
export interface EyeDetectionResult {
  readonly leftEye?: EyeLandmarks;
  readonly rightEye?: EyeLandmarks;
}

/**
 * Configuration constants for eye and eyelid landmark detection.
 */
export const EYE_DETECTOR_CONFIG = {
  /** Relative vertical search range within face bounding box [min, max] */
  OCULAR_BAND_Y: [0.18, 0.48] as const,
  /** Horizontal ocular search range for frontal left eye [min, max] */
  FRONTAL_LEFT_X: [0.10, 0.48] as const,
  /** Horizontal ocular search range for frontal right eye [min, max] */
  FRONTAL_RIGHT_X: [0.52, 0.90] as const,
  /** Relative expected eye half-width fraction of face width */
  EYE_HALF_WIDTH_FRACTION: 0.11,
  /** Relative expected eye half-height fraction of face height */
  EYE_HALF_HEIGHT_FRACTION: 0.07,
  /** Minimum candidate score required to mark an eye as visible */
  MIN_VISIBLE_SCORE: 0.30,
  /** Minimum candidate score required to mark an eye as uncertain (below this is not_detected) */
  MIN_UNCERTAIN_SCORE: 0.16,
  /** Minimum sclera-to-iris contrast threshold for iris localization */
  MIN_IRIS_CONTRAST: 0.05,
  /** Minimum local darkness contrast for pupil resolution */
  MIN_PUPIL_CONTRAST: 0.07,
} as const;

interface CandidatePoint {
  readonly x: number;
  readonly y: number;
  readonly score: number;
  readonly contrast: number;
  readonly edgeEnergy: number;
}

/**
 * Finds the most probable eye center candidate within a localized search window
 * using luminance valleys, sclera-iris lateral contrast, and horizontal gradient margins.
 */
function findEyeCandidate(
  searchMinX: number,
  searchMaxX: number,
  searchMinY: number,
  searchMaxY: number,
  expectedY: number,
  expectedHalfH: number,
  expectedHalfW: number,
  lumData: Float32Array,
  gradMag: Float32Array,
  maskData: Uint8Array,
  imgW: number,
  imgH: number
): CandidatePoint | null {
  const clampXMin = Math.max(1, Math.min(imgW - 2, searchMinX));
  const clampXMax = Math.max(clampXMin, Math.min(imgW - 2, searchMaxX));
  const clampYMin = Math.max(1, Math.min(imgH - 2, searchMinY));
  const clampYMax = Math.max(clampYMin, Math.min(imgH - 2, searchMaxY));

  if (clampXMax - clampXMin < 4 || clampYMax - clampYMin < 4) {
    return null;
  }

  let bestCand: CandidatePoint | null = null;
  let maxScore = -Infinity;

  const sampleDeltaX = Math.max(2, Math.round(expectedHalfW * 0.65));
  // Permissive vertical prior: allows natural anatomical variance within ocular band
  const vertSigma = Math.max(6, expectedHalfH * 3.0);
  const vertSigmaSq = 2 * vertSigma * vertSigma;

  // Scan grid with small step for throughput
  const stepX = Math.max(1, Math.floor((clampXMax - clampXMin) / 36));
  const stepY = Math.max(1, Math.floor((clampYMax - clampYMin) / 24));

  for (let y = clampYMin; y <= clampYMax; y += stepY) {
    const rowOffset = y * imgW;
    const dy = y - expectedY;
    const vertPrior = Math.exp(-(dy * dy) / vertSigmaSq);

    for (let x = clampXMin; x <= clampXMax; x += stepX) {
      const idx = rowOffset + x;

      // Must be within segmented foreground subject
      if (maskData[idx] === 0) continue;

      const centerLum = lumData[idx];

      // Sample flanking lateral pixels (sclera)
      const xLeft = Math.max(0, x - sampleDeltaX);
      const xRight = Math.min(imgW - 1, x + sampleDeltaX);
      const leftLum = lumData[rowOffset + xLeft];
      const rightLum = lumData[rowOffset + xRight];

      // Luminance valley score: center is darker than both lateral flanks
      const contrastLeft = leftLum - centerLum;
      const contrastRight = rightLum - centerLum;
      const valleyContrast = (contrastLeft + contrastRight) * 0.5;

      // Average gradient magnitude in upper and lower orbital margin
      const yAbove = Math.max(0, y - Math.round(expectedHalfH * 0.8));
      const yBelow = Math.min(imgH - 1, y + Math.round(expectedHalfH * 0.8));
      const gradAbove = gradMag[yAbove * imgW + x];
      const gradBelow = gradMag[yBelow * imgW + x];
      const edgeFlank = gradAbove * 0.65 + gradBelow * 0.35;

      // Saliency score: local valley contrast + edge energy + darkness + vertical prior
      // Using local contrast rather than absolute darkness ensures robustness on low-light
      // and dark skin tones
      const rawScore =
        (Math.max(0, valleyContrast) * 0.45 +
         edgeFlank * 0.35 +
         (1.0 - centerLum) * 0.20) *
        vertPrior;

      if (rawScore > maxScore) {
        maxScore = rawScore;
        bestCand = {
          x,
          y,
          score: rawScore,
          contrast: valleyContrast,
          edgeEnergy: edgeFlank,
        };
      }
    }
  }

  return bestCand;
}

/**
 * Traces upper and lower eyelid margins across the palpebral fissure.
 */
function traceEyelids(
  candidate: CandidatePoint,
  halfW: number,
  halfH: number,
  lumData: Float32Array,
  gradMag: Float32Array,
  imgW: number,
  imgH: number,
  side: 'left' | 'right',
  visibility: FeatureVisibility,
  confidence: number
): { upperLid: ContourPath; lowerLid: ContourPath } {
  const cx = candidate.x;
  const cy = candidate.y;

  const startX = Math.max(1, cx - halfW);
  const endX = Math.min(imgW - 2, cx + halfW);
  const numCols = endX - startX + 1;

  if (numCols < 3) {
    const pCenter: Point2D = { x: cx / imgW, y: cy / imgH };
    const stubPath = (id: string): ContourPath => ({
      id,
      region: 'eyes',
      points: [pCenter],
      closed: false,
      confidence,
      visibility,
    });
    return {
      upperLid: stubPath(`${side}_upper_eyelid`),
      lowerLid: stubPath(`${side}_lower_eyelid`),
    };
  }

  const rawUpperY = new Float32Array(numCols);
  const rawLowerY = new Float32Array(numCols);

  const searchAbove = Math.max(2, Math.round(halfH * 1.3));
  const searchBelow = Math.max(2, Math.round(halfH * 1.1));

  for (let i = 0; i < numCols; i++) {
    const x = startX + i;
    const progress = i / (numCols - 1); // 0.0 to 1.0
    // Natural arch prior: eyelids bow upward/downward in the center and converge at corners
    const archFactor = Math.sin(progress * Math.PI);

    // 1. Upper eyelid: search in range [cy - searchAbove, cy]
    let bestUpperY = cy - 1;
    let maxUpperMetric = -Infinity;
    const yTop = Math.max(0, cy - searchAbove);
    const yMid = cy;

    for (let y = yTop; y <= yMid; y++) {
      const idx = y * imgW + x;
      const g = gradMag[idx];
      const invLum = 1.0 - lumData[idx];
      // Prefer convex arch: expected height is higher in center
      const expectedArchY = cy - searchAbove * 0.7 * archFactor;
      const distWeight = Math.exp(-Math.pow(y - expectedArchY, 2) / (2 * searchAbove * searchAbove));
      const metric = (g * 0.65 + invLum * 0.35) * distWeight;

      if (metric > maxUpperMetric) {
        maxUpperMetric = metric;
        bestUpperY = y;
      }
    }
    rawUpperY[i] = bestUpperY;

    // 2. Lower eyelid: search in range [cy, cy + searchBelow]
    let bestLowerY = cy + 1;
    let maxLowerMetric = -Infinity;
    const yBottom = Math.min(imgH - 1, cy + searchBelow);

    for (let y = yMid; y <= yBottom; y++) {
      const idx = y * imgW + x;
      const g = gradMag[idx];
      const invLum = 1.0 - lumData[idx];
      const expectedArchY = cy + searchBelow * 0.4 * archFactor;
      const distWeight = Math.exp(-Math.pow(y - expectedArchY, 2) / (2 * searchBelow * searchBelow));
      const metric = (g * 0.60 + invLum * 0.40) * distWeight;

      if (metric > maxLowerMetric) {
        maxLowerMetric = metric;
        bestLowerY = y;
      }
    }
    rawLowerY[i] = bestLowerY;
  }

  // Corner convergence: canthi meet at ends
  const leftCornerY = (rawUpperY[0] + rawLowerY[0]) * 0.5;
  const rightCornerY = (rawUpperY[numCols - 1] + rawLowerY[numCols - 1]) * 0.5;
  rawUpperY[0] = leftCornerY;
  rawLowerY[0] = leftCornerY;
  rawUpperY[numCols - 1] = rightCornerY;
  rawLowerY[numCols - 1] = rightCornerY;

  // Gentle 3-point box smoothing to eliminate single-pixel discretization noise
  const upperPoints: Point2D[] = [];
  const lowerPoints: Point2D[] = [];

  for (let i = 0; i < numCols; i++) {
    const xNorm = (startX + i) / imgW;

    const uPrev = i > 0 ? rawUpperY[i - 1] : rawUpperY[0];
    const uCurr = rawUpperY[i];
    const uNext = i < numCols - 1 ? rawUpperY[i + 1] : rawUpperY[numCols - 1];
    const smoothUY = (uPrev + 2 * uCurr + uNext) / 4.0;
    upperPoints.push({ x: xNorm, y: smoothUY / imgH });

    const lPrev = i > 0 ? rawLowerY[i - 1] : rawLowerY[0];
    const lCurr = rawLowerY[i];
    const lNext = i < numCols - 1 ? rawLowerY[i + 1] : rawLowerY[numCols - 1];
    const smoothLY = (lPrev + 2 * lCurr + lNext) / 4.0;
    lowerPoints.push({ x: xNorm, y: smoothLY / imgH });
  }

  return {
    upperLid: {
      id: `${side}_upper_eyelid`,
      region: 'eyes',
      points: upperPoints,
      closed: false,
      confidence,
      visibility,
    },
    lowerLid: {
      id: `${side}_lower_eyelid`,
      region: 'eyes',
      points: lowerPoints,
      closed: false,
      confidence: Number((confidence * 0.92).toFixed(3)),
      visibility,
    },
  };
}

/**
 * Resolves iris and pupil centers inside the palpebral aperture when supported by image contrast.
 */
function detectIrisAndPupil(
  candidate: CandidatePoint,
  halfW: number,
  halfH: number,
  lumData: Float32Array,
  imgW: number,
  imgH: number
): { iris?: Point2D; pupil?: Point2D } {
  const cx = candidate.x;
  const cy = candidate.y;

  // Search within the inner 60% of the eye opening
  const irisRadiusX = Math.max(2, Math.round(halfW * 0.55));
  const irisRadiusY = Math.max(2, Math.round(halfH * 0.65));

  let minLum = Infinity;
  let minX = cx;
  let minY = cy;

  const yStart = Math.max(0, cy - irisRadiusY);
  const yEnd = Math.min(imgH - 1, cy + irisRadiusY);
  const xStart = Math.max(0, cx - irisRadiusX);
  const xEnd = Math.min(imgW - 1, cx + irisRadiusX);

  for (let y = yStart; y <= yEnd; y++) {
    const rowOffset = y * imgW;
    for (let x = xStart; x <= xEnd; x++) {
      const l = lumData[rowOffset + x];
      if (l < minLum) {
        minLum = l;
        minX = x;
        minY = y;
      }
    }
  }

  // Verify that the minimum has surrounding contrast (sclera is brighter)
  const flankLeft = lumData[minY * imgW + Math.max(0, minX - irisRadiusX)];
  const flankRight = lumData[minY * imgW + Math.min(imgW - 1, minX + irisRadiusX)];
  const contrast = ((flankLeft - minLum) + (flankRight - minLum)) * 0.5;

  if (contrast < EYE_DETECTOR_CONFIG.MIN_IRIS_CONTRAST) {
    return { iris: undefined, pupil: undefined };
  }

  const iris: Point2D = {
    x: Number((minX / imgW).toFixed(4)),
    y: Number((minY / imgH).toFixed(4)),
  };

  // Pupil detection: requires high central contrast inside iris
  let pupil: Point2D | undefined = undefined;
  if (contrast >= EYE_DETECTOR_CONFIG.MIN_PUPIL_CONTRAST) {
    pupil = {
      x: Number((minX / imgW).toFixed(4)),
      y: Number((minY / imgH).toFixed(4)),
    };
  }

  return { iris, pupil };
}

/**
 * Creates an occluded eye landmark record for profile angles without hallucinating coordinates.
 */
function createOccludedEye(side: 'left' | 'right'): EyeLandmarks {
  return {
    visibility: 'occluded',
    confidence: 0,
    upperLid: {
      id: `${side}_upper_eyelid`,
      region: 'eyes',
      points: [],
      closed: false,
      confidence: 0,
      visibility: 'occluded',
    },
    lowerLid: {
      id: `${side}_lower_eyelid`,
      region: 'eyes',
      points: [],
      closed: false,
      confidence: 0,
      visibility: 'occluded',
    },
    iris: undefined,
    pupil: undefined,
  };
}

/**
 * Detects eye and eyelid landmarks for a single face region estimate.
 *
 * Consumes face bounding box, head pose orientation, and lateral visibility priors to
 * extract upper/lower eyelids and optional iris/pupil centers in normalized [0.0 - 1.0] coordinates.
 *
 * @param face FaceRegionEstimate from face region isolation
 * @param image NormalizedImage (RGBA, luminance, dimensions)
 * @param gradients GradientField (Sobel magnitude and direction)
 * @param mask SubjectMask (binary subject segmentation)
 * @returns EyeDetectionResult containing leftEye and rightEye landmarks
 */
export function detectEyeLandmarks(
  face: FaceRegionEstimate,
  image: NormalizedImage,
  gradients: GradientField,
  mask: SubjectMask
): EyeDetectionResult {
  const { width: imgW, height: imgH } = mask;
  const fBox = face.faceBoundingBox;

  // Convert normalized face box to integer pixel coordinates
  const fX = Math.round(fBox.x * imgW);
  const fY = Math.round(fBox.y * imgH);
  const fW = Math.round(fBox.width * imgW);
  const fH = Math.round(fBox.height * imgH);

  // Reject degenerate face regions
  if (fW < 12 || fH < 12) {
    return { leftEye: undefined, rightEye: undefined };
  }

  const lumData = image.luminance.floatData;
  const gradMag = gradients.magnitude;
  const maskData = mask.data;
  const pose = face.pose;
  const visibleSide = face.visibleSide;

  // Anthropometric ocular vertical search band
  const eyeBandMinY = fY + Math.floor(fH * EYE_DETECTOR_CONFIG.OCULAR_BAND_Y[0]);
  const eyeBandMaxY = fY + Math.floor(fH * EYE_DETECTOR_CONFIG.OCULAR_BAND_Y[1]);
  const expectedEyeY = fY + Math.floor(fH * 0.33);

  const halfEyeW = Math.max(4, Math.round(fW * EYE_DETECTOR_CONFIG.EYE_HALF_WIDTH_FRACTION));
  const halfEyeH = Math.max(3, Math.round(fH * EYE_DETECTOR_CONFIG.EYE_HALF_HEIGHT_FRACTION));

  let leftEye: EyeLandmarks | undefined = undefined;
  let rightEye: EyeLandmarks | undefined = undefined;

  // -------------------------------------------------------------------------
  // 1. Left Eye (Viewer's Left, x < centerX)
  // -------------------------------------------------------------------------
  if (visibleSide === 'right_only' || pose === 'right_profile') {
    // Left eye is physically occluded by head geometry
    leftEye = createOccludedEye('left');
  } else {
    // Determine horizontal search window by pose
    let leftXMin: number;
    let leftXMax: number;

    if (pose === 'left_profile') {
      leftXMin = fX + Math.floor(fW * 0.05);
      leftXMax = fX + Math.floor(fW * 0.52);
    } else if (pose === 'three_quarter_left') {
      leftXMin = fX + Math.floor(fW * 0.08);
      leftXMax = fX + Math.floor(fW * 0.44);
    } else if (pose === 'three_quarter_right') {
      leftXMin = fX + Math.floor(fW * 0.16);
      leftXMax = fX + Math.floor(fW * 0.48);
    } else {
      // Frontal
      leftXMin = fX + Math.floor(fW * EYE_DETECTOR_CONFIG.FRONTAL_LEFT_X[0]);
      leftXMax = fX + Math.floor(fW * EYE_DETECTOR_CONFIG.FRONTAL_LEFT_X[1]);
    }

    const candLeft = findEyeCandidate(
      leftXMin,
      leftXMax,
      eyeBandMinY,
      eyeBandMaxY,
      expectedEyeY,
      halfEyeH,
      halfEyeW,
      lumData,
      gradMag,
      maskData,
      imgW,
      imgH
    );

    if (candLeft && candLeft.score >= EYE_DETECTOR_CONFIG.MIN_UNCERTAIN_SCORE) {
      const isVisible = candLeft.score >= EYE_DETECTOR_CONFIG.MIN_VISIBLE_SCORE;
      const visibility: FeatureVisibility = isVisible ? 'visible' : 'uncertain';
      const conf = Math.max(0.15, Math.min(0.96, Number(candLeft.score.toFixed(3))));

      const lids = traceEyelids(
        candLeft,
        pose === 'left_profile' ? Math.round(halfEyeW * 0.75) : halfEyeW,
        halfEyeH,
        lumData,
        gradMag,
        imgW,
        imgH,
        'left',
        visibility,
        conf
      );

      const { iris, pupil } = isVisible
        ? detectIrisAndPupil(candLeft, halfEyeW, halfEyeH, lumData, imgW, imgH)
        : { iris: undefined, pupil: undefined };

      leftEye = {
        visibility,
        confidence: conf,
        upperLid: lids.upperLid,
        lowerLid: lids.lowerLid,
        iris,
        pupil,
      };
    } else {
      leftEye = {
        visibility: 'not_detected',
        confidence: candLeft ? Number(candLeft.score.toFixed(3)) : 0,
        upperLid: {
          id: 'left_upper_eyelid',
          region: 'eyes',
          points: [],
          closed: false,
          confidence: 0,
          visibility: 'not_detected',
        },
        lowerLid: {
          id: 'left_lower_eyelid',
          region: 'eyes',
          points: [],
          closed: false,
          confidence: 0,
          visibility: 'not_detected',
        },
        iris: undefined,
        pupil: undefined,
      };
    }
  }

  // -------------------------------------------------------------------------
  // 2. Right Eye (Viewer's Right, x > centerX)
  // -------------------------------------------------------------------------
  if (visibleSide === 'left_only' || pose === 'left_profile') {
    // Right eye is physically occluded by head geometry (e.g. BM-02)
    rightEye = createOccludedEye('right');
  } else {
    let rightXMin: number;
    let rightXMax: number;

    if (pose === 'right_profile') {
      rightXMin = fX + Math.floor(fW * 0.48);
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

    const candRight = findEyeCandidate(
      rightXMin,
      rightXMax,
      eyeBandMinY,
      eyeBandMaxY,
      expectedEyeY,
      halfEyeH,
      halfEyeW,
      lumData,
      gradMag,
      maskData,
      imgW,
      imgH
    );

    if (candRight && candRight.score >= EYE_DETECTOR_CONFIG.MIN_UNCERTAIN_SCORE) {
      const isVisible = candRight.score >= EYE_DETECTOR_CONFIG.MIN_VISIBLE_SCORE;
      const visibility: FeatureVisibility = isVisible ? 'visible' : 'uncertain';
      const conf = Math.max(0.15, Math.min(0.96, Number(candRight.score.toFixed(3))));

      const lids = traceEyelids(
        candRight,
        pose === 'right_profile' ? Math.round(halfEyeW * 0.75) : halfEyeW,
        halfEyeH,
        lumData,
        gradMag,
        imgW,
        imgH,
        'right',
        visibility,
        conf
      );

      const { iris, pupil } = isVisible
        ? detectIrisAndPupil(candRight, halfEyeW, halfEyeH, lumData, imgW, imgH)
        : { iris: undefined, pupil: undefined };

      rightEye = {
        visibility,
        confidence: conf,
        upperLid: lids.upperLid,
        lowerLid: lids.lowerLid,
        iris,
        pupil,
      };
    } else {
      rightEye = {
        visibility: 'not_detected',
        confidence: candRight ? Number(candRight.score.toFixed(3)) : 0,
        upperLid: {
          id: 'right_upper_eyelid',
          region: 'eyes',
          points: [],
          closed: false,
          confidence: 0,
          visibility: 'not_detected',
        },
        lowerLid: {
          id: 'right_lower_eyelid',
          region: 'eyes',
          points: [],
          closed: false,
          confidence: 0,
          visibility: 'not_detected',
        },
        iris: undefined,
        pupil: undefined,
      };
    }
  }

  return { leftEye, rightEye };
}
