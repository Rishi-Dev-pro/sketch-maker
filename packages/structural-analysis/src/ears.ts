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
import { EyebrowDetectionResult } from './eyebrows';
import { NoseDetectionResult } from './nose';
import { MouthDetectionResult } from './mouth';
import { JawlineDetectionResult } from './jawline';

/**
 * Result container for detected ear structural landmarks.
 */
export interface EarDetectionResult {
  /** Overall visibility classification for ear structures */
  readonly visibility: FeatureVisibility;
  /** Overall ear detection confidence [0.0 - 1.0] */
  readonly confidence: number;
  /** Subject's anatomical left ear (camera right in frontal, visible in left_profile) */
  readonly leftEar?: ContourPath;
  /** Subject's anatomical right ear (camera left in frontal, visible in right_profile) */
  readonly rightEar?: ContourPath;
  /** Detailed visibility of subject's left ear */
  readonly leftVisibility: FeatureVisibility;
  /** Detailed visibility of subject's right ear */
  readonly rightVisibility: FeatureVisibility;
}

/**
 * Configuration parameters for ear detection.
 */
export const EAR_CONFIG = {
  /** Expected vertical start fraction of face bounding box for ear helix root (brow/eye level) */
  DEFAULT_TOP_Y_FRACTION: 0.18,
  /** Expected vertical bottom fraction of face bounding box for ear lobule (nose/mouth level) */
  DEFAULT_BOTTOM_Y_FRACTION: 0.72,
  /** Maximum lateral search reach as fraction of face width */
  LATERAL_REACH_FRACTION: 0.28,
  /** Minimum vertical span of ear contour in pixels */
  MIN_EAR_HEIGHT_PX: 10,
  /** Minimum score required to classify ear as visible */
  MIN_EAR_VISIBLE_SCORE: 0.24,
  /** Minimum score required to classify ear as uncertain */
  MIN_EAR_UNCERTAIN_SCORE: 0.11,
  /** Darkness threshold below which a region is considered dense hair rather than skin */
  MAX_HAIR_LUMINANCE: 0.15,
  /** Minimum conchal hollow to helix rim contrast required for high confidence */
  MIN_CONCHA_CONTRAST: 0.035,
} as const;

/**
 * Evaluates candidate ear contour for one lateral side of the head in frontal / three-quarter pose.
 */
function extractFrontalEarContour(
  side: 'left' | 'right',
  yTop: number,
  yBottom: number,
  fX: number,
  fY: number,
  fW: number,
  fH: number,
  maskData: Uint8Array,
  gradMag: Float32Array,
  luminance: Float32Array,
  imgW: number,
  imgH: number
): { path?: ContourPath; visibility: FeatureVisibility; confidence: number } {
  const isLeft = side === 'left'; // Subject's left = camera's right
  const rawPoints: { x: number; y: number; protrusion: number; score: number }[] = [];

  // Lateral search boundaries
  let xInnerBase: number;
  let xOuterLimit: number;

  if (isLeft) {
    // Subject's left ear: search to the right of face box
    xInnerBase = Math.min(imgW - 1, fX + fW - Math.round(fW * 0.02));
    xOuterLimit = Math.min(imgW - 1, fX + fW + Math.round(fW * EAR_CONFIG.LATERAL_REACH_FRACTION));
  } else {
    // Subject's right ear: search to the left of face box
    xInnerBase = Math.max(0, fX + Math.round(fW * 0.02));
    xOuterLimit = Math.max(0, fX - Math.round(fW * EAR_CONFIG.LATERAL_REACH_FRACTION));
  }

  const expectedHeight = Math.max(EAR_CONFIG.MIN_EAR_HEIGHT_PX, yBottom - yTop);
  let maxProtrusion = 0;
  let darkHairPixelCount = 0;
  let foregroundSampledPixels = 0;

  const xMin = Math.min(xInnerBase, xOuterLimit);
  const xMax = Math.max(xInnerBase, xOuterLimit);

  // Scan row by row within the vertical ear bracket
  for (let y = yTop; y <= yBottom; y++) {
    const rowOffset = y * imgW;
    let bestX = -1;
    let maxEdge = 0;

    if (isLeft) {
      // Find outermost foreground boundary and gradient peak
      for (let x = xMax; x >= xMin; x--) {
        if (maskData[rowOffset + x] > 0) {
          foregroundSampledPixels++;
          const lum = luminance[rowOffset + x];
          if (lum < EAR_CONFIG.MAX_HAIR_LUMINANCE) {
            darkHairPixelCount++;
          }

          const edge = gradMag[rowOffset + x];
          if (edge > maxEdge) {
            maxEdge = edge;
            bestX = x;
          }
          if (bestX === -1) bestX = x;
        }
      }
    } else {
      // Search to the left for right ear
      for (let x = xMin; x <= xMax; x++) {
        if (maskData[rowOffset + x] > 0) {
          foregroundSampledPixels++;
          const lum = luminance[rowOffset + x];
          if (lum < EAR_CONFIG.MAX_HAIR_LUMINANCE) {
            darkHairPixelCount++;
          }

          const edge = gradMag[rowOffset + x];
          if (edge > maxEdge) {
            maxEdge = edge;
            bestX = x;
          }
          if (bestX === -1) bestX = x;
        }
      }
    }

    if (bestX !== -1) {
      const protrusion = isLeft ? Math.max(0, bestX - xInnerBase) : Math.max(0, xInnerBase - bestX);
      if (protrusion > maxProtrusion) {
        maxProtrusion = protrusion;
      }
      const score = Math.min(1.0, maxEdge * 0.70 + 0.30);
      rawPoints.push({ x: bestX, y, protrusion, score });
    }
  }

  // Verification 1: Minimum vertical count and span
  if (rawPoints.length < 5) {
    return { visibility: 'not_detected', confidence: 0 };
  }

  const verticalSpan = rawPoints[rawPoints.length - 1].y - rawPoints[0].y;
  if (verticalSpan < EAR_CONFIG.MIN_EAR_HEIGHT_PX) {
    return { visibility: 'not_detected', confidence: 0 };
  }

  // Verification 2: Lateral protrusion check
  // Ear must project beyond the preauricular base by at least ~4px or 0.035 * fW
  const minRequiredProtrusion = Math.max(4, Math.round(fW * 0.035));
  if (maxProtrusion < minRequiredProtrusion) {
    // Flush with cheek, no protruding pinna
    return { visibility: 'not_detected', confidence: 0 };
  }

  // Verification 3: Hair dominance check
  // If >60% of foreground pixels in the candidate region are dark hair, this is hair mass/curls, not an exposed ear
  const hairFraction = foregroundSampledPixels > 0 ? darkHairPixelCount / foregroundSampledPixels : 0;
  if (hairFraction > 0.60) {
    return { visibility: 'not_detected', confidence: 0 };
  }

  // Verification 4: Glasses temple rejection & arc sustained protrusion
  // A glasses temple has protrusion concentrated at 1-3 rows; average protrusion / maxProtrusion is tiny (<0.20)
  const sumProtrusion = rawPoints.reduce((acc, p) => acc + p.protrusion, 0);
  const avgProtrusion = sumProtrusion / rawPoints.length;
  const protrusionRatio = maxProtrusion > 0 ? avgProtrusion / maxProtrusion : 0;

  // Fraction of rows with significant protrusion (at least 30% of maxProtrusion)
  const protrudingRowCount = rawPoints.filter((p) => p.protrusion >= maxProtrusion * 0.35 && p.protrusion >= 3).length;
  const protrudingFraction = protrudingRowCount / rawPoints.length;

  if (protrusionRatio < 0.25 || protrudingFraction < 0.30) {
    // Isolated horizontal spike (glasses temple arm or accessory wisp) rather than an anatomical ear
    return { visibility: 'not_detected', confidence: 0 };
  }

  // Verification 5: Curvature / arc profile
  // Ear helix forms a convex curve: top and bottom are closer to head base, middle bulges outward
  const topX = rawPoints[0].x;
  const bottomX = rawPoints[rawPoints.length - 1].x;
  const midPoint = rawPoints[Math.floor(rawPoints.length / 2)];
  const midX = midPoint.x;

  const q1Point = rawPoints[Math.floor(rawPoints.length * 0.25)];
  const q3Point = rawPoints[Math.floor(rawPoints.length * 0.75)];

  let isConvex = false;
  if (isLeft) {
    isConvex = (midX > topX || q1Point.x > topX) && (midX > bottomX || q3Point.x > bottomX);
  } else {
    isConvex = (midX < topX || q1Point.x < topX) && (midX < bottomX || q3Point.x < bottomX);
  }

  // Flat edge check: if x variance is practically zero, it is a straight line (e.g. hair block edge or vertical boundary)
  const meanX = rawPoints.reduce((acc, p) => acc + p.x, 0) / rawPoints.length;
  const varX = rawPoints.reduce((acc, p) => acc + (p.x - meanX) ** 2, 0) / rawPoints.length;
  const stdX = Math.sqrt(varX);

  if (!isConvex || stdX < 0.8) {
    // Straight vertical boundary or inverted/concave line (hair edge, collar line)
    return { visibility: 'not_detected', confidence: 0 };
  }

  // Verification 6: Internal concha contrast
  let internalContrast = 0;
  for (const pt of rawPoints) {
    const rimLum = luminance[pt.y * imgW + pt.x];
    const conchaX = isLeft
      ? Math.max(0, pt.x - Math.round(maxProtrusion * 0.5))
      : Math.min(imgW - 1, pt.x + Math.round(maxProtrusion * 0.5));
    const conchaLum = luminance[pt.y * imgW + conchaX];
    const diff = rimLum - conchaLum;
    if (diff > internalContrast) {
      internalContrast = diff;
    }
  }

  // Score computation
  const spanCoverage = Math.min(1.0, verticalSpan / expectedHeight);
  const avgEdgeScore = rawPoints.reduce((acc, p) => acc + p.score, 0) / rawPoints.length;
  const contrastBonus = internalContrast >= EAR_CONFIG.MIN_CONCHA_CONTRAST ? 1.15 : 0.85;
  const hairPenalty = hairFraction > 0.35 ? 0.70 : 1.0;

  const rawConf = avgEdgeScore * spanCoverage * contrastBonus * hairPenalty * (protrusionRatio * 1.1);
  const confidence = Number(Math.max(0.05, Math.min(0.95, rawConf)).toFixed(3));

  const isVisible = confidence >= EAR_CONFIG.MIN_EAR_VISIBLE_SCORE && spanCoverage >= 0.55 && isConvex && protrudingFraction >= 0.40;
  const visibility: FeatureVisibility = isVisible ? 'visible' : confidence >= EAR_CONFIG.MIN_EAR_UNCERTAIN_SCORE ? 'uncertain' : 'not_detected';

  if (visibility === 'not_detected') {
    return { visibility: 'not_detected', confidence: 0 };
  }

  const normPoints: Point2D[] = rawPoints.map((p) => ({
    x: Number((p.x / imgW).toFixed(5)),
    y: Number((p.y / imgH).toFixed(5)),
  }));

  const path: ContourPath = {
    id: isLeft ? 'left_ear' : 'right_ear',
    region: 'ears',
    points: normPoints,
    closed: false,
    confidence,
    visibility,
  };

  return { path, visibility, confidence };
}

/**
 * Extracts visible ear for side-profile faces (e.g. BM-02).
 * For left_profile: visible ear is the subject's left ear, located behind eye and mandible.
 * For right_profile: visible ear is the subject's right ear.
 */
function extractProfileEar(
  side: 'left' | 'right',
  yTop: number,
  yBottom: number,
  fX: number,
  fY: number,
  fW: number,
  fH: number,
  maskData: Uint8Array,
  gradMag: Float32Array,
  luminance: Float32Array,
  imgW: number,
  imgH: number
): { path?: ContourPath; visibility: FeatureVisibility; confidence: number } {
  const isLeft = side === 'left';
  const rawPoints: { x: number; y: number; score: number }[] = [];

  // In profile, the ear is situated in the posterior portion of the face bounding box
  // For left profile, features are at x ~ fX; ear is around x in [fX + 0.45*fW, fX + 0.85*fW]
  // For right profile, features are at x ~ fX + fW; ear is around x in [fX + 0.15*fW, fX + 0.55*fW]
  const xStart = isLeft
    ? fX + Math.round(fW * 0.42)
    : fX + Math.round(fW * 0.15);
  const xEnd = isLeft
    ? fX + Math.round(fW * 0.85)
    : fX + Math.round(fW * 0.58);

  const expectedHeight = Math.max(EAR_CONFIG.MIN_EAR_HEIGHT_PX, yBottom - yTop);

  for (let y = yTop; y <= yBottom; y++) {
    const rowOffset = y * imgW;
    let bestX = -1;
    let maxEdge = 0;

    for (let x = Math.min(xStart, xEnd); x <= Math.max(xStart, xEnd); x++) {
      if (x < 0 || x >= imgW) continue;
      if (maskData[rowOffset + x] > 0) {
        const edge = gradMag[rowOffset + x];
        if (edge > maxEdge && edge > 0.08) {
          maxEdge = edge;
          bestX = x;
        }
      }
    }

    if (bestX !== -1) {
      const score = Math.min(1.0, maxEdge * 0.70 + 0.30);
      rawPoints.push({ x: bestX, y, score });
    }
  }

  if (rawPoints.length < 5) {
    return { visibility: 'not_detected', confidence: 0 };
  }

  const verticalSpan = rawPoints[rawPoints.length - 1].y - rawPoints[0].y;
  if (verticalSpan < EAR_CONFIG.MIN_EAR_HEIGHT_PX) {
    return { visibility: 'not_detected', confidence: 0 };
  }

  const spanCoverage = Math.min(1.0, verticalSpan / expectedHeight);
  const avgEdgeScore = rawPoints.reduce((acc, p) => acc + p.score, 0) / rawPoints.length;
  const rawConf = avgEdgeScore * spanCoverage;
  const confidence = Number(Math.max(0.10, Math.min(0.95, rawConf)).toFixed(3));

  const isVisible = confidence >= EAR_CONFIG.MIN_EAR_VISIBLE_SCORE && spanCoverage >= 0.50;
  const visibility: FeatureVisibility = isVisible ? 'visible' : 'uncertain';

  const normPoints: Point2D[] = rawPoints.map((p) => ({
    x: Number((p.x / imgW).toFixed(5)),
    y: Number((p.y / imgH).toFixed(5)),
  }));

  const path: ContourPath = {
    id: isLeft ? 'left_ear' : 'right_ear',
    region: 'ears',
    points: normPoints,
    closed: false,
    confidence,
    visibility,
  };

  return { path, visibility, confidence };
}

/**
 * Detects anatomical ear landmarks and outer helix contours from a FaceRegionEstimate.
 *
 * Core principles:
 * - Operates strictly in normalized [0, 1] coordinates.
 * - IMAGE EVIDENCE > GEOMETRIC PRIOR.
 * - Profile faces (BM-02): strictly suppresses occluded far-side ear without fabricating mirrored geometry.
 * - Frontal & three-quarter poses: evaluates left and right ears independently.
 * - Rejects hair, glasses arms, collar lines, and background edges.
 *
 * @param face Detected face region estimate with pose classification
 * @param image Preprocessed normalized image
 * @param gradients Precomputed Sobel gradient field
 * @param mask Segmented subject foreground mask
 * @param detectedEyes Optional detected eye landmarks for vertical anchor
 * @param detectedBrows Optional detected eyebrow landmarks for superior anchor
 * @param detectedNose Optional detected nose landmarks for inferior anchor
 * @param detectedMouth Optional detected mouth landmarks for inferior anchor
 * @param detectedJawline Optional detected jawline landmarks for preauricular anchor
 */
export function detectEars(
  face: FaceRegionEstimate,
  image: NormalizedImage,
  gradients: GradientField,
  mask: SubjectMask,
  detectedEyes?: EyeDetectionResult,
  detectedBrows?: EyebrowDetectionResult,
  detectedNose?: NoseDetectionResult,
  detectedMouth?: MouthDetectionResult,
  detectedJawline?: JawlineDetectionResult
): EarDetectionResult {
  const imgW = image.luminance.width;
  const imgH = image.luminance.height;
  const { faceBoundingBox, pose, visibleSide } = face;

  const fX = Math.round(faceBoundingBox.x * imgW);
  const fY = Math.round(faceBoundingBox.y * imgH);
  const fW = Math.round(faceBoundingBox.width * imgW);
  const fH = Math.round(faceBoundingBox.height * imgH);

  if (fW < 12 || fH < 12) {
    return {
      visibility: 'not_detected',
      confidence: 0,
      leftVisibility: 'not_detected',
      rightVisibility: 'not_detected',
    };
  }

  // -------------------------------------------------------------------------
  // 1. Establish Vertical Ear Bracket [yTop, yBottom]
  // -------------------------------------------------------------------------
  let yTop = fY + Math.round(fH * EAR_CONFIG.DEFAULT_TOP_Y_FRACTION);
  let yBottom = fY + Math.round(fH * EAR_CONFIG.DEFAULT_BOTTOM_Y_FRACTION);

  // Use Eyebrow/Eye as superior boundary
  if (detectedBrows?.leftEyebrow?.points.length) {
    const browY = Math.round(detectedBrows.leftEyebrow.points[0].y * imgH);
    yTop = Math.max(fY + 2, browY - Math.round(fH * 0.04));
  } else if (detectedEyes?.leftEye?.upperLid.points.length) {
    const eyeY = Math.round(detectedEyes.leftEye.upperLid.points[0].y * imgH);
    yTop = Math.max(fY + 2, eyeY - Math.round(fH * 0.08));
  }

  // Use Nose/Mouth as inferior boundary
  if (detectedNose?.tip?.points.length) {
    const noseY = Math.round(detectedNose.tip.points[0].y * imgH);
    yBottom = Math.min(fY + fH - 2, noseY + Math.round(fH * 0.08));
  } else if (detectedMouth?.lipSeparation?.points.length) {
    const mouthY = Math.round(detectedMouth.lipSeparation.points[0].y * imgH);
    yBottom = Math.min(fY + fH - 2, mouthY - Math.round(fH * 0.02));
  }

  const maskData = mask.data;
  const gradMag = gradients.magnitude;
  const luminance = image.luminance.floatData;

  // -------------------------------------------------------------------------
  // 2. Profile Pose Handling (BM-02)
  // -------------------------------------------------------------------------
  if (pose === 'left_profile' || visibleSide === 'left_only') {
    // In left profile, only the subject's left ear is visible; right ear is strictly occluded
    const leftRes = extractProfileEar(
      'left',
      yTop,
      yBottom,
      fX,
      fY,
      fW,
      fH,
      maskData,
      gradMag,
      luminance,
      imgW,
      imgH
    );

    return {
      visibility: leftRes.visibility,
      confidence: leftRes.confidence,
      leftEar: leftRes.path,
      rightEar: undefined,
      leftVisibility: leftRes.visibility,
      rightVisibility: 'occluded',
    };
  }

  if (pose === 'right_profile' || visibleSide === 'right_only') {
    // In right profile, only the subject's right ear is visible; left ear is strictly occluded
    const rightRes = extractProfileEar(
      'right',
      yTop,
      yBottom,
      fX,
      fY,
      fW,
      fH,
      maskData,
      gradMag,
      luminance,
      imgW,
      imgH
    );

    return {
      visibility: rightRes.visibility,
      confidence: rightRes.confidence,
      leftEar: undefined,
      rightEar: rightRes.path,
      leftVisibility: 'occluded',
      rightVisibility: rightRes.visibility,
    };
  }

  // -------------------------------------------------------------------------
  // 3. Frontal & Three-Quarter Pose Handling
  // -------------------------------------------------------------------------
  // Left ear (subject's left = camera right)
  const leftRes = extractFrontalEarContour(
    'left',
    yTop,
    yBottom,
    fX,
    fY,
    fW,
    fH,
    maskData,
    gradMag,
    luminance,
    imgW,
    imgH
  );

  // Right ear (subject's right = camera left)
  const rightRes = extractFrontalEarContour(
    'right',
    yTop,
    yBottom,
    fX,
    fY,
    fW,
    fH,
    maskData,
    gradMag,
    luminance,
    imgW,
    imgH
  );

  // In 3/4 poses, check if the far ear is occluded by head angle
  let finalRightVis = rightRes.visibility;
  let finalLeftVis = leftRes.visibility;

  if (pose === 'three_quarter_left' && rightRes.visibility === 'not_detected') {
    finalRightVis = 'occluded';
  } else if (pose === 'three_quarter_right' && leftRes.visibility === 'not_detected') {
    finalLeftVis = 'occluded';
  }

  const activeConfidences = [leftRes.confidence, rightRes.confidence].filter((c) => c > 0);
  const overallConf = activeConfidences.length > 0
    ? activeConfidences.reduce((a, b) => a + b, 0) / activeConfidences.length
    : 0;

  const isAnyVisible = leftRes.visibility === 'visible' || rightRes.visibility === 'visible';
  const isAnyUncertain = leftRes.visibility === 'uncertain' || rightRes.visibility === 'uncertain';
  const overallVisibility: FeatureVisibility = isAnyVisible
    ? 'visible'
    : isAnyUncertain
    ? 'uncertain'
    : (finalLeftVis === 'occluded' && finalRightVis === 'occluded')
    ? 'occluded'
    : 'not_detected';

  return {
    visibility: overallVisibility,
    confidence: Number(overallConf.toFixed(3)),
    leftEar: leftRes.path,
    rightEar: rightRes.path,
    leftVisibility: finalLeftVis,
    rightVisibility: finalRightVis,
  };
}
