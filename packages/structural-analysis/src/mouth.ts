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

/**
 * Result container for detected mouth and lip landmarks on a single subject.
 */
export interface MouthDetectionResult {
  /** Overall visibility classification for the mouth */
  readonly visibility: FeatureVisibility;
  /** Overall mouth detection confidence [0.0 - 1.0] */
  readonly confidence: number;
  /** Upper lip vermilion boundary contour path */
  readonly upperLip?: ContourPath;
  /** Lower lip vermilion boundary contour path */
  readonly lowerLip?: ContourPath;
  /** Lip separation line / oral fissure contour path */
  readonly lipSeparation?: ContourPath;
  /** Left oral commissure (mouth corner) in normalized coordinates */
  readonly leftCorner?: Point2D;
  /** Right oral commissure (mouth corner) in normalized coordinates */
  readonly rightCorner?: Point2D;
}

/**
 * Configuration constants for mouth and lip landmark detection.
 */
export const MOUTH_DETECTOR_CONFIG = {
  /** Relative vertical search range for mouth within face bounding box [min, max] when nose is absent */
  DEFAULT_MOUTH_BAND_Y: [0.58, 0.92] as const,
  /** Expected stomion (oral fissure) vertical fraction of face height when no landmarks are detected */
  EXPECTED_STOMION_Y_FRACTION: 0.77,
  /** Relative expected mouth half-width fraction of face width */
  MOUTH_HALF_WIDTH_FRACTION: 0.25,
  /** Relative maximum lip thickness half-height fraction of face height */
  LIP_HALF_HEIGHT_FRACTION: 0.09,
  /** Minimum score required to mark mouth as visible */
  MIN_MOUTH_VISIBLE_SCORE: 0.12,
  /** Minimum score required to mark mouth as uncertain */
  MIN_MOUTH_UNCERTAIN_SCORE: 0.06,
  /** Minimum fissure score required to extract oral separation */
  MIN_FISSURE_SCORE: 0.05,
  /** Minimum vermilion border contrast */
  MIN_VERMILION_CONTRAST: 0.03,
} as const;

/**
 * Evaluates oral fissure (stomion seam) node saliency at pixel (x, y).
 * Combines vertical Sobel edge gradients, horizontal luminance valley contrast,
 * and a soft vertical Gaussian prior.
 */
function evaluateFissureNodeSaliency(
  x: number,
  y: number,
  expectedY: number,
  sigmaY: number,
  spanH: number,
  lumData: Uint8Array,
  gradMag: Float32Array,
  gradDir: Float32Array,
  maskData: Uint8Array,
  imgW: number,
  imgH: number
): number {
  if (x < 1 || x >= imgW - 1 || y < 2 || y >= imgH - 2) return 0;
  const idx = y * imgW + x;
  if (maskData[idx] === 0) return 0;

  const edge = gradMag[idx];
  const dir = gradDir[idx];

  // The oral fissure is predominantly horizontal, so the gradient across it is vertical.
  // |sin(dir)| close to 1 indicates vertical luminance variation across the horizontal seam.
  const verticalFactor = 0.4 + 0.6 * Math.abs(Math.sin(dir));
  const directedEdge = edge * verticalFactor;

  // Sample vertical neighbors across the seam scaled to facial scale
  const deltaY = Math.max(2, Math.min(6, Math.round(spanH * 0.05)));
  const yAbove = Math.max(0, y - deltaY);
  const yBelow = Math.min(imgH - 1, y + deltaY);
  const lumCenter = lumData[idx] / 255.0;
  const lumAbove = lumData[yAbove * imgW + x] / 255.0;
  const lumBelow = lumData[yBelow * imgW + x] / 255.0;

  // Bilateral valley contrast: oral fissure must be darker than BOTH upper and lower lip flesh.
  // Unidirectional step edges (such as mustache bottom or chin shadow) have near-zero bilateral valley.
  const upperContrast = lumAbove - lumCenter;
  const lowerContrast = lumBelow - lumCenter;
  const bilateralValley = Math.max(0, Math.min(upperContrast, lowerContrast));

  // Hair step edge suppression: if above is dark hair and below is much lighter skin/lip
  const isHairStepEdge = lumAbove < 0.30 && (lumBelow - lumAbove) > 0.25;
  const hairFactor = isHairStepEdge ? 0.20 : 1.0;

  const structuralEvidence = (directedEdge * 0.60 + bilateralValley * 0.40) * hairFactor;
  if (structuralEvidence < 0.02) return 0;

  // Soft vertical prior: guides search toward expected level without suppressing strong evidence
  const dy = y - expectedY;
  const normDist = Math.abs(dy) / sigmaY;
  const vertPrior = Math.max(0.35, Math.exp(-(normDist * normDist) * 0.5));

  return structuralEvidence * vertPrior;
}

/**
 * Traces the oral fissure (lip separation line) using horizontal dynamic programming.
 */
function traceOralFissure(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  expectedY: number,
  lumData: Uint8Array,
  gradMag: Float32Array,
  gradDir: Float32Array,
  maskData: Uint8Array,
  imgW: number,
  imgH: number
): { points: Point2D[]; meanScore: number; pixelPoints: { x: number; y: number; score: number }[] } {
  const spanW = xMax - xMin + 1;
  const spanH = yMax - yMin + 1;
  if (spanW < 8 || spanH < 4) {
    return { points: [], meanScore: 0, pixelPoints: [] };
  }

  const sigmaY = Math.max(4, spanH * 0.30);

  // Compute saliency grid: grid[xi][yi]
  const grid: number[][] = [];
  for (let xi = 0; xi < spanW; xi++) {
    const x = xMin + xi;
    const col: number[] = [];
    for (let yi = 0; yi < spanH; yi++) {
      const y = yMin + yi;
      const score = evaluateFissureNodeSaliency(
        x,
        y,
        expectedY,
        sigmaY,
        spanH,
        lumData,
        gradMag,
        gradDir,
        maskData,
        imgW,
        imgH
      );
      col.push(score);
    }
    grid.push(col);
  }

  // Dynamic programming: find horizontal path from xi = 0 to spanW - 1
  // with vertical jump constraint |yi - prevYi| <= 2
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

  // Recurrence across columns
  for (let xi = 1; xi < spanW; xi++) {
    for (let yi = 0; yi < spanH; yi++) {
      let maxPrev = -Infinity;
      let bestPrevYi = -1;
      const prevMinYi = Math.max(0, yi - 2);
      const prevMaxYi = Math.min(spanH - 1, yi + 2);

      for (let py = prevMinYi; py <= prevMaxYi; py++) {
        const val = dp[xi - 1][py];
        if (val > maxPrev) {
          maxPrev = val;
          bestPrevYi = py;
        }
      }

      if (maxPrev > -Infinity) {
        const stepPenalty = Math.abs(yi - bestPrevYi) * 0.03;
        dp[xi][yi] = maxPrev + grid[xi][yi] - stepPenalty;
        parent[xi][yi] = bestPrevYi;
      }
    }
  }

  // Find best endpoint in the rightmost columns
  let bestScore = -Infinity;
  let bestEndYi = -1;
  let bestEndXi = spanW - 1;

  for (let checkXi = spanW - 1; checkXi >= Math.max(0, spanW - 4); checkXi--) {
    for (let yi = 0; yi < spanH; yi++) {
      if (dp[checkXi][yi] > bestScore) {
        bestScore = dp[checkXi][yi];
        bestEndYi = yi;
        bestEndXi = checkXi;
      }
    }
  }

  if (bestScore <= 0 || bestEndYi < 0) {
    return { points: [], meanScore: 0, pixelPoints: [] };
  }

  // Backtrack
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
  if (rawPoints.length < 6) {
    return { points: [], meanScore: 0, pixelPoints: [] };
  }

  // Trim weak lateral tails (commissure boundaries)
  let validStart = 0;
  while (validStart < rawPoints.length && rawPoints[validStart].score < 0.04) {
    validStart++;
  }
  let validEnd = rawPoints.length - 1;
  while (validEnd > validStart && rawPoints[validEnd].score < 0.04) {
    validEnd--;
  }

  const activePoints = rawPoints.slice(validStart, validEnd + 1);
  if (activePoints.length < 6) {
    return { points: [], meanScore: 0, pixelPoints: [] };
  }

  const sumScore = activePoints.reduce((acc, p) => acc + p.score, 0);
  const meanScore = sumScore / activePoints.length;

  const normalizedPoints: Point2D[] = activePoints.map((p) => ({
    x: Number((p.x / imgW).toFixed(5)),
    y: Number((p.y / imgH).toFixed(5)),
  }));

  return { points: normalizedPoints, meanScore, pixelPoints: activePoints };
}

/**
 * Traces upper or lower lip vermilion boundary guided by the oral fissure.
 */
function traceLipVermilionBorder(
  mode: 'upper' | 'lower',
  fissurePixels: { x: number; y: number; score: number }[],
  maxOffset: number,
  lumData: Uint8Array,
  gradMag: Float32Array,
  maskData: Uint8Array,
  imgW: number,
  imgH: number
): { points: Point2D[]; meanScore: number } {
  if (fissurePixels.length < 6) {
    return { points: [], meanScore: 0 };
  }

  const vermilionPoints: { x: number; y: number; score: number }[] = [];
  let totalScore = 0;

  for (const fPt of fissurePixels) {
    const x = fPt.x;
    let bestY = fPt.y;
    let bestScore = -Infinity;

    const minSeparation = Math.max(2, Math.round(maxOffset * 0.20));
    const yStart = mode === 'upper' ? Math.max(1, fPt.y - maxOffset) : Math.min(imgH - 2, fPt.y + minSeparation);
    const yEnd = mode === 'upper' ? Math.max(1, fPt.y - minSeparation) : Math.min(imgH - 2, fPt.y + maxOffset);

    const step = mode === 'upper' ? -1 : 1;
    for (let y = (mode === 'upper' ? yEnd : yStart); mode === 'upper' ? y >= yStart : y <= yEnd; y += step) {
      const idx = y * imgW + x;
      if (maskData[idx] === 0) continue;

      const edge = gradMag[idx];
      const lum = lumData[idx] / 255.0;

      // Sample outside the lip (skin) vs inside the lip
      const deltaSkin = Math.max(2, Math.round(maxOffset * 0.25));
      const ySkin = mode === 'upper' ? Math.max(0, y - deltaSkin) : Math.min(imgH - 1, y + deltaSkin);
      const lumSkin = lumData[ySkin * imgW + x] / 255.0;
      const vermilionContrast = Math.abs(lumSkin - lum);

      // Distance prior: gentle falloff away from fissure
      const dist = Math.abs(y - fPt.y);
      const sigmaDist = Math.max(3, maxOffset * 0.40);
      const distWeight = Math.max(0.3, Math.exp(-Math.pow(dist - maxOffset * 0.45, 2) / (2 * sigmaDist * sigmaDist)));

      const score = (edge * 0.60 + vermilionContrast * 0.40) * distWeight;
      if (score > bestScore) {
        bestScore = score;
        bestY = y;
      }
    }

    if (bestScore > 0.025) {
      vermilionPoints.push({ x, y: bestY, score: bestScore });
      totalScore += bestScore;
    }
  }

  if (vermilionPoints.length < 6) {
    return { points: [], meanScore: 0 };
  }

  const meanScore = totalScore / vermilionPoints.length;
  const normalizedPoints: Point2D[] = vermilionPoints.map((p) => ({
    x: Number((p.x / imgW).toFixed(5)),
    y: Number((p.y / imgH).toFixed(5)),
  }));

  return { points: normalizedPoints, meanScore };
}

/**
 * Detects mouth and lip landmark structures (upper lip, lower lip, lip separation, and corners)
 * from a FaceRegionEstimate, segmented image, and previously detected facial features.
 *
 * Principles:
 * - Operates strictly in normalized [0, 1] coordinates.
 * - Mouth is NOT treated as a single dark blob; detects structural transitions (fissure seam + vermilion borders).
 * - Anchors search space beneath the detected nasal tip and inter-ocular midline.
 * - Facial hair and mustache robust: distinguishes mustache hairline from the oral fissure seam.
 * - Teeth/expression robust: tracks outer vermilion margins and stomion seam without requiring dark oral cavity.
 * - Profile poses strictly mark hidden-side geometry as 'occluded' without fabricating coordinates.
 *
 * @param face The isolated face region estimate from Step 1 / 1.1.
 * @param image The normalized preprocessed image.
 * @param gradients Sobel directional gradient field.
 * @param mask Segmented subject foreground mask.
 * @param detectedEyes Optional detected eye landmarks from Step 2A.
 * @param detectedNose Optional detected nose landmarks from Step 2C to anchor upper mouth boundary.
 */
export function detectMouth(
  face: FaceRegionEstimate,
  image: NormalizedImage,
  gradients: GradientField,
  mask: SubjectMask,
  detectedEyes?: EyeDetectionResult,
  detectedNose?: NoseDetectionResult
): MouthDetectionResult {
  const imgW = image.luminance.width;
  const imgH = image.luminance.height;
  const lumData = image.luminance.data;
  const gradMag = gradients.magnitude;
  const gradDir = gradients.direction;
  const maskData = mask.data;

  const { faceBoundingBox, pose, visibleSide } = face;

  const fX = Math.round(faceBoundingBox.x * imgW);
  const fY = Math.round(faceBoundingBox.y * imgH);
  const fW = Math.round(faceBoundingBox.width * imgW);
  const fH = Math.round(faceBoundingBox.height * imgH);

  if (fW < 10 || fH < 10) {
    return {
      visibility: 'not_detected',
      confidence: 0,
    };
  }

  // -------------------------------------------------------------------------
  // 1. Establish Midline, Width, and Vertical Search Bounds
  // -------------------------------------------------------------------------
  let expectedMidX = fX + Math.round(fW * 0.50);
  let mouthTopY = fY + Math.round(fH * MOUTH_DETECTOR_CONFIG.DEFAULT_MOUTH_BAND_Y[0]);
  const chinY = fY + fH;

  // Use nose tip or nostrils as precise upper anchor if detected
  let noseBottomY = 0;
  if (detectedNose) {
    if (detectedNose.tip && detectedNose.tip.points.length > 0) {
      for (const p of detectedNose.tip.points) {
        const py = Math.round(p.y * imgH);
        if (py > noseBottomY) noseBottomY = py;
      }
    }
    if (detectedNose.nostrils) {
      for (const n of detectedNose.nostrils) {
        for (const p of n.points) {
          const py = Math.round(p.y * imgH);
          if (py > noseBottomY) noseBottomY = py;
        }
      }
    }
  }

  // Centerline from eyes or pose
  const leftEye = detectedEyes?.leftEye;
  const rightEye = detectedEyes?.rightEye;

  let eyeMeanY = -1;
  if (
    leftEye &&
    rightEye &&
    leftEye.visibility === 'visible' &&
    rightEye.visibility === 'visible' &&
    leftEye.upperLid.points.length > 0 &&
    rightEye.upperLid.points.length > 0
  ) {
    const leftEyeMeanX =
      leftEye.upperLid.points.reduce((acc, p) => acc + p.x, 0) / leftEye.upperLid.points.length;
    const rightEyeMeanX =
      rightEye.upperLid.points.reduce((acc, p) => acc + p.x, 0) / rightEye.upperLid.points.length;
    expectedMidX = Math.round(((leftEyeMeanX + rightEyeMeanX) * 0.5) * imgW);

    const leftEyeY = leftEye.upperLid.points.reduce((acc, p) => acc + p.y, 0) / leftEye.upperLid.points.length;
    const rightEyeY = rightEye.upperLid.points.reduce((acc, p) => acc + p.y, 0) / rightEye.upperLid.points.length;
    eyeMeanY = ((leftEyeY + rightEyeY) * 0.5) * imgH;
  } else if (pose === 'left_profile') {
    expectedMidX = fX + Math.round(fW * 0.20);
  } else if (pose === 'right_profile') {
    expectedMidX = fX + Math.round(fW * 0.80);
  } else if (pose === 'three_quarter_left') {
    expectedMidX = fX + Math.round(fW * 0.38);
  } else if (pose === 'three_quarter_right') {
    expectedMidX = fX + Math.round(fW * 0.62);
  }

  // Dynamic stomion level: use nose bottom if present, else eyes, else face prior
  let expectedStomionY: number;
  if (noseBottomY > 0 && noseBottomY < chinY) {
    expectedStomionY = Math.round(noseBottomY + (chinY - noseBottomY) * 0.38);
    mouthTopY = Math.min(imgH - 10, noseBottomY + 4);
  } else if (eyeMeanY > 0 && eyeMeanY < chinY) {
    expectedStomionY = Math.round(eyeMeanY + (chinY - eyeMeanY) * 0.65);
    mouthTopY = Math.max(fY + Math.round(fH * MOUTH_DETECTOR_CONFIG.DEFAULT_MOUTH_BAND_Y[0]), Math.round(eyeMeanY + (chinY - eyeMeanY) * 0.40));
  } else {
    expectedStomionY = Math.round(
      fY + fH * MOUTH_DETECTOR_CONFIG.EXPECTED_STOMION_Y_FRACTION
    );
    mouthTopY = fY + Math.round(fH * MOUTH_DETECTOR_CONFIG.DEFAULT_MOUTH_BAND_Y[0]);
  }

  const mouthHalfW = Math.max(6, Math.round(fW * MOUTH_DETECTOR_CONFIG.MOUTH_HALF_WIDTH_FRACTION));
  const mouthHalfH = Math.max(4, Math.round(fH * MOUTH_DETECTOR_CONFIG.LIP_HALF_HEIGHT_FRACTION));

  let mouthXMin: number;
  let mouthXMax: number;

  if (pose === 'left_profile' || visibleSide === 'left_only') {
    mouthXMin = Math.max(1, fX + Math.round(fW * 0.05));
    mouthXMax = Math.min(imgW - 2, expectedMidX + Math.round(mouthHalfW * 0.4));
  } else if (pose === 'right_profile' || visibleSide === 'right_only') {
    mouthXMin = Math.max(1, expectedMidX - Math.round(mouthHalfW * 0.4));
    mouthXMax = Math.min(imgW - 2, fX + Math.round(fW * 0.95));
  } else {
    mouthXMin = Math.max(1, expectedMidX - mouthHalfW);
    mouthXMax = Math.min(imgW - 2, expectedMidX + mouthHalfW);
  }

  const mouthBottomY = Math.min(
    imgH - 2,
    fY + Math.floor(fH * MOUTH_DETECTOR_CONFIG.DEFAULT_MOUTH_BAND_Y[1])
  );

  // -------------------------------------------------------------------------
  // 2. Trace Oral Fissure / Lip Separation Seam
  // -------------------------------------------------------------------------
  const fissureTrace = traceOralFissure(
    mouthXMin,
    mouthXMax,
    mouthTopY,
    mouthBottomY,
    expectedStomionY,
    lumData,
    gradMag,
    gradDir,
    maskData,
    imgW,
    imgH
  );

  let lipSeparation: ContourPath | undefined;
  let leftCorner: Point2D | undefined;
  let rightCorner: Point2D | undefined;

  if (
    fissureTrace.points.length >= 6 &&
    fissureTrace.meanScore >= MOUTH_DETECTOR_CONFIG.MIN_FISSURE_SCORE
  ) {
    const isVisible = fissureTrace.meanScore >= MOUTH_DETECTOR_CONFIG.MIN_MOUTH_VISIBLE_SCORE;
    const conf = Math.max(0.12, Math.min(0.95, Number(fissureTrace.meanScore.toFixed(3))));

    lipSeparation = {
      id: 'lip_separation',
      region: 'mouth',
      points: fissureTrace.points,
      closed: false,
      confidence: conf,
      visibility: isVisible ? 'visible' : 'uncertain',
    };

    // Extract commissure corners
    if (pose !== 'right_profile' && visibleSide !== 'right_only') {
      leftCorner = fissureTrace.points[0];
    }
    if (pose !== 'left_profile' && visibleSide !== 'left_only') {
      rightCorner = fissureTrace.points[fissureTrace.points.length - 1];
    }
  }

  // -------------------------------------------------------------------------
  // 3. Trace Upper Lip & Lower Lip Vermilion Boundaries
  // -------------------------------------------------------------------------
  let upperLip: ContourPath | undefined;
  let lowerLip: ContourPath | undefined;

  const guidingPixels = lipSeparation && fissureTrace.pixelPoints.length >= 6 ? fissureTrace.pixelPoints : [];

  if (guidingPixels.length >= 6) {
    // Upper Lip
    const upperTrace = traceLipVermilionBorder(
      'upper',
      guidingPixels,
      mouthHalfH,
      lumData,
      gradMag,
      maskData,
      imgW,
      imgH
    );

    if (upperTrace.points.length >= 6 && upperTrace.meanScore >= MOUTH_DETECTOR_CONFIG.MIN_MOUTH_UNCERTAIN_SCORE) {
      const isVisible = upperTrace.meanScore >= MOUTH_DETECTOR_CONFIG.MIN_MOUTH_VISIBLE_SCORE;
      const conf = Math.max(0.12, Math.min(0.95, Number(upperTrace.meanScore.toFixed(3))));
      upperLip = {
        id: 'upper_lip',
        region: 'mouth',
        points: upperTrace.points,
        closed: false,
        confidence: conf,
        visibility: isVisible ? 'visible' : 'uncertain',
      };
    }

    // Lower Lip
    const lowerTrace = traceLipVermilionBorder(
      'lower',
      guidingPixels,
      mouthHalfH,
      lumData,
      gradMag,
      maskData,
      imgW,
      imgH
    );

    if (lowerTrace.points.length >= 6 && lowerTrace.meanScore >= MOUTH_DETECTOR_CONFIG.MIN_MOUTH_UNCERTAIN_SCORE) {
      const isVisible = lowerTrace.meanScore >= MOUTH_DETECTOR_CONFIG.MIN_MOUTH_VISIBLE_SCORE;
      const conf = Math.max(0.12, Math.min(0.95, Number(lowerTrace.meanScore.toFixed(3))));
      lowerLip = {
        id: 'lower_lip',
        region: 'mouth',
        points: lowerTrace.points,
        closed: false,
        confidence: conf,
        visibility: isVisible ? 'visible' : 'uncertain',
      };
    }
  }

  // -------------------------------------------------------------------------
  // 4. Aggregate Mouth Confidence & Visibility
  // -------------------------------------------------------------------------
  const confidences: number[] = [];
  if (lipSeparation) confidences.push(lipSeparation.confidence);
  if (upperLip) confidences.push(upperLip.confidence);
  if (lowerLip) confidences.push(lowerLip.confidence);

  const avgConf =
    confidences.length > 0
      ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(3))
      : 0;

  let visibility: FeatureVisibility = 'not_detected';
  if (
    (lipSeparation && lipSeparation.visibility === 'visible') ||
    (upperLip && upperLip.visibility === 'visible') ||
    (lowerLip && lowerLip.visibility === 'visible')
  ) {
    visibility = 'visible';
  } else if (
    (lipSeparation && lipSeparation.visibility === 'uncertain') ||
    (upperLip && upperLip.visibility === 'uncertain') ||
    (lowerLip && lowerLip.visibility === 'uncertain')
  ) {
    visibility = 'uncertain';
  }

  return {
    visibility,
    confidence: avgConf,
    upperLip,
    lowerLip,
    lipSeparation,
    leftCorner,
    rightCorner,
  };
}
