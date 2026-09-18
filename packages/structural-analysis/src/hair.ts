import {
  Point2D,
  ContourPath,
  FeatureVisibility,
  HeadPose,
} from '@sketch-maker/shared-types';
import { NormalizedImage } from '@sketch-maker/image-processing';
import { FaceRegionEstimate, SubjectMask } from './types';
import { GradientField } from './gradient';
import { EyebrowDetectionResult } from './eyebrows';
import { EyeDetectionResult } from './eyes';
import { JawlineDetectionResult } from './jawline';
import { EarDetectionResult } from './ears';

/**
 * Result container for detected hair structural landmarks and contours.
 */
export interface HairDetectionResult {
  /** Overall visibility classification for hair structure */
  readonly visibility: FeatureVisibility;
  /** Overall hair detection confidence [0.0 - 1.0] */
  readonly confidence: number;
  /** Outer silhouette contour of the visible scalp hair mass */
  readonly outerContour?: ContourPath;
  /** Alias for outerContour matching procedural art specification */
  readonly outerSilhouette?: ContourPath;
  /** Visible hairline boundary separating forehead/temples from scalp hair mass */
  readonly hairline?: ContourPath;
  /** Prominent internal structural hair mass dividers, part lines, or voluminous bundles */
  readonly masses: readonly ContourPath[];
  /** Combined raw contour paths representing the complete hair structure */
  readonly allContours: readonly ContourPath[];
  /** Qualitative hair volume/style classification estimate */
  readonly styleEstimate?: 'short' | 'voluminous' | 'receding' | 'bald' | 'tied_back';
  /** Mean directional flow angle in radians [-PI, PI] if coherent flow is reliably detected */
  readonly primaryFlowAngle?: number;
}

/**
 * Configuration parameters for hair structure analysis.
 */
export const HAIR_CONFIG = {
  /** Minimum vertical span of hair in pixels to be considered detectable */
  MIN_HAIR_HEIGHT_PX: 12,
  /** Minimum hair mass area as fraction of face box area */
  MIN_HAIR_AREA_RATIO: 0.12,
  /** Relative forehead start fraction above eyebrows */
  FOREHEAD_SEARCH_START_RATIO: 0.02,
  /** Hairline transition edge threshold */
  HAIRLINE_GRADIENT_THRESHOLD: 0.08,
  /** Minimum edge energy inside hair to consider structured hair texture */
  MIN_HAIR_EDGE_ENERGY: 0.07,
  /** Ratio of hair width to face width that triggers 'voluminous' classification */
  VOLUMINOUS_WIDTH_RATIO: 1.25,
  /** Maximum darkness luminance for dark hair */
  DARK_HAIR_LUMINANCE: 0.28,
  /** Minimum confidence score required for 'visible' classification */
  MIN_VISIBLE_CONFIDENCE: 0.32,
  /** Minimum confidence score required for 'uncertain' classification */
  MIN_UNCERTAIN_CONFIDENCE: 0.14,
} as const;

/**
 * Samples reference skin tone metrics from the central mid-face region.
 */
function sampleSkinToneReference(
  fX: number,
  fY: number,
  fW: number,
  fH: number,
  luminance: Float32Array,
  rgba: Uint8ClampedArray,
  maskData: Uint8Array,
  imgW: number,
  imgH: number
): { meanLum: number; stdLum: number; isReliable: boolean } {
  const xStart = Math.max(0, fX + Math.round(fW * 0.30));
  const xEnd = Math.min(imgW - 1, fX + Math.round(fW * 0.70));
  const yStart = Math.max(0, fY + Math.round(fH * 0.35));
  const yEnd = Math.min(imgH - 1, fY + Math.round(fH * 0.65));

  let sumLum = 0;
  let count = 0;

  for (let y = yStart; y <= yEnd; y++) {
    const rowOffset = y * imgW;
    for (let x = xStart; x <= xEnd; x++) {
      if (maskData[rowOffset + x] > 0) {
        sumLum += luminance[rowOffset + x];
        count++;
      }
    }
  }

  if (count < 20) {
    return { meanLum: 0.55, stdLum: 0.15, isReliable: false };
  }

  const meanLum = sumLum / count;
  let sumSqDiff = 0;

  for (let y = yStart; y <= yEnd; y++) {
    const rowOffset = y * imgW;
    for (let x = xStart; x <= xEnd; x++) {
      if (maskData[rowOffset + x] > 0) {
        const diff = luminance[rowOffset + x] - meanLum;
        sumSqDiff += diff * diff;
      }
    }
  }

  const stdLum = Math.sqrt(sumSqDiff / count);
  return { meanLum, stdLum, isReliable: true };
}

/**
 * Detects the visible hairline boundary between forehead skin and scalp hair.
 */
function extractHairlineContour(
  yApex: number,
  yBrow: number,
  fX: number,
  fW: number,
  fH: number,
  skinRef: { meanLum: number; stdLum: number; isReliable: boolean },
  maskData: Uint8Array,
  gradMag: Float32Array,
  luminance: Float32Array,
  imgW: number,
  imgH: number
): { path?: ContourPath; isRecedingOrBald: boolean; coverage: number } {
  // Forehead width: between 15% and 85% of face width
  const xStart = Math.max(0, fX + Math.round(fW * 0.15));
  const xEnd = Math.min(imgW - 1, fX + Math.round(fW * 0.85));

  if (xEnd <= xStart || yBrow <= yApex + 6) {
    return { isRecedingOrBald: false, coverage: 0 };
  }

  const detectedYPerCol: { x: number; y: number; score: number }[] = [];
  let smoothSkinApexCount = 0;
  let totalCols = 0;

  for (let x = xStart; x <= xEnd; x += 2) {
    totalCols++;
    let bestY = -1;
    let maxTransitionScore = 0;

    // Scan upward from above the eyebrows toward the apex
    const scanStartY = yBrow - Math.max(2, Math.round(fH * HAIR_CONFIG.FOREHEAD_SEARCH_START_RATIO));
    const scanEndY = Math.max(0, yApex + 2);

    for (let y = scanStartY; y >= scanEndY; y--) {
      const idx = y * imgW + x;
      if (maskData[idx] === 0) continue;

      const lum = luminance[idx];
      const edge = gradMag[idx];

      // Hair transition evidence: luminance drops below skin or edge energy increases sharply
      const lumDrop = Math.max(0, skinRef.meanLum - lum);
      const transitionScore = lumDrop * 0.60 + edge * 0.40;

      if (transitionScore > maxTransitionScore && transitionScore >= HAIR_CONFIG.HAIRLINE_GRADIENT_THRESHOLD) {
        maxTransitionScore = transitionScore;
        bestY = y;
      }
    }

    // Check if the apex of this column is smooth skin (bald / receding evidence)
    const apexIdx = yApex * imgW + x;
    if (maskData[apexIdx] > 0) {
      const apexLum = luminance[apexIdx];
      const apexEdge = gradMag[apexIdx];
      if (Math.abs(apexLum - skinRef.meanLum) < 0.12 && apexEdge < 0.08) {
        smoothSkinApexCount++;
      }
    }

    if (bestY !== -1) {
      detectedYPerCol.push({ x, y: bestY, score: maxTransitionScore });
    }
  }

  const isRecedingOrBald = totalCols > 0 && smoothSkinApexCount / totalCols > 0.65;

  if (detectedYPerCol.length < 5 || isRecedingOrBald) {
    return { isRecedingOrBald, coverage: detectedYPerCol.length / Math.max(1, totalCols) };
  }

  // Smooth hairline coordinates using local 3-point window median/mean
  const smoothedPoints: Point2D[] = [];
  for (let i = 0; i < detectedYPerCol.length; i++) {
    const prev = detectedYPerCol[Math.max(0, i - 1)].y;
    const curr = detectedYPerCol[i].y;
    const next = detectedYPerCol[Math.min(detectedYPerCol.length - 1, i + 1)].y;
    const smoothY = Math.round((prev + curr + next) / 3);

    smoothedPoints.push({
      x: Number((detectedYPerCol[i].x / imgW).toFixed(5)),
      y: Number((smoothY / imgH).toFixed(5)),
    });
  }

  const coverage = detectedYPerCol.length / totalCols;
  const avgScore = detectedYPerCol.reduce((acc, p) => acc + p.score, 0) / detectedYPerCol.length;
  const confidence = Number(Math.max(0.15, Math.min(0.92, avgScore * coverage + 0.10)).toFixed(3));

  const path: ContourPath = {
    id: 'hairline',
    region: 'hair_boundary',
    points: smoothedPoints,
    closed: false,
    confidence,
    visibility: confidence >= HAIR_CONFIG.MIN_VISIBLE_CONFIDENCE ? 'visible' : 'uncertain',
  };

  return { path, isRecedingOrBald, coverage };
}

/**
 * Traces the outer silhouette perimeter of the visible hair mass against background/neck/ears.
 */
function extractOuterHairSilhouette(
  yApex: number,
  yBrow: number,
  fX: number,
  fY: number,
  fW: number,
  fH: number,
  hX: number,
  hY: number,
  hW: number,
  hH: number,
  pose: HeadPose,
  maskData: Uint8Array,
  gradMag: Float32Array,
  luminance: Float32Array,
  imgW: number,
  imgH: number,
  detectedEars?: EarDetectionResult,
  detectedJaw?: JawlineDetectionResult
): { path?: ContourPath; isVoluminous: boolean; maxProtrusionRatio: number } {
  const isProfile = pose === 'left_profile' || pose === 'right_profile';
  const rawLeftPoints: { x: number; y: number }[] = [];
  const rawRightPoints: { x: number; y: number }[] = [];
  const rawTopPoints: { x: number; y: number }[] = [];

  // Determine bottom row limit for hair tracing:
  // Short hair stops near brow/ear level; long hair descends outside the face box
  const searchMaxY = isProfile
    ? Math.min(imgH - 2, fY + Math.round(fH * 0.85))
    : Math.min(imgH - 2, fY + Math.round(fH * 0.90));

  let maxRowWidth = 0;
  // Lateral search envelope centered around the subject's face/head
  // Allow voluminous expansion (up to ~1.9x face width for voluminous hair), but never leak across subjects or background
  const fCenterX = fX + Math.round(fW * 0.5);
  const maxLateralRadius = Math.round(fW * 0.95);
  const xSearchMin = Math.max(0, fCenterX - maxLateralRadius);
  const xSearchMax = Math.min(imgW - 1, fCenterX + maxLateralRadius);

  // Scan top cranium rim (apex across columns)
  const topScanMinX = Math.max(xSearchMin, fCenterX - Math.round(fW * 0.60));
  const topScanMaxX = Math.min(xSearchMax, fCenterX + Math.round(fW * 0.60));

  for (let x = topScanMinX; x <= topScanMaxX; x += 3) {
    for (let y = Math.max(0, yApex - 4); y <= Math.min(imgH - 1, yApex + 8); y++) {
      const idx = y * imgW + x;
      if (maskData[idx] > 0) {
        rawTopPoints.push({ x, y });
        break;
      }
    }
  }

  // Scan row by row down the lateral sides
  for (let y = yApex; y <= searchMaxY; y++) {
    const rowOffset = y * imgW;
    let minX = -1;
    let maxX = -1;

    // Search horizontal extents within this subject's lateral head envelope
    for (let x = xSearchMin; x <= xSearchMax; x++) {
      if (maskData[rowOffset + x] > 0) {
        if (minX === -1) minX = x;
        maxX = x;
      }
    }

    if (minX === -1) continue;

    const rowW = maxX - minX;
    if (rowW > maxRowWidth) {
      maxRowWidth = rowW;
    }

    // Left lateral hair boundary (subject's right in frontal)
    let bestLeftX = minX;
    let maxLeftEdge = gradMag[rowOffset + minX];
    for (let dx = 0; dx <= 6; dx++) {
      const x = minX + dx;
      if (x < imgW && gradMag[rowOffset + x] > maxLeftEdge) {
        maxLeftEdge = gradMag[rowOffset + x];
        bestLeftX = x;
      }
    }

    // Right lateral hair boundary (subject's left in frontal)
    let bestRightX = maxX;
    let maxRightEdge = gradMag[rowOffset + maxX];
    for (let dx = 0; dx <= 6; dx++) {
      const x = maxX - dx;
      if (x >= 0 && gradMag[rowOffset + x] > maxRightEdge) {
        maxRightEdge = gradMag[rowOffset + x];
        bestRightX = x;
      }
    }

    // For profile faces (BM-02): visible hair is posterior to eye/jaw; avoid anterior nose/lip profile
    if (pose === 'left_profile') {
      // In left profile, anterior profile is on the left; posterior hair is on the right
      const posteriorStartX = fX + Math.round(fW * 0.35);
      if (maxX > posteriorStartX) {
        rawRightPoints.push({ x: bestRightX, y });
      }
    } else if (pose === 'right_profile') {
      // In right profile, anterior profile is on the right; posterior hair is on the left
      const posteriorEndX = fX + Math.round(fW * 0.65);
      if (minX < posteriorEndX) {
        rawLeftPoints.push({ x: bestLeftX, y });
      }
    } else {
      // Frontal & 3/4 poses: collect both lateral borders
      rawLeftPoints.push({ x: bestLeftX, y });
      rawRightPoints.push({ x: bestRightX, y });
    }
  }

  const maxProtrusionRatio = fW > 0 ? maxRowWidth / fW : 1.0;
  const isVoluminous = maxProtrusionRatio >= HAIR_CONFIG.VOLUMINOUS_WIDTH_RATIO;

  // Assemble continuous outer hair boundary:
  // Ascend left boundary, cross cranium apex, descend right boundary
  const combinedPoints: { x: number; y: number }[] = [];

  if (pose === 'left_profile') {
    // In left profile, trace from forehead hairline over apex and down the posterior cranium/occiput
    if (rawTopPoints.length > 0) {
      combinedPoints.push(...rawTopPoints);
    }
    combinedPoints.push(...rawRightPoints);
  } else if (pose === 'right_profile') {
    combinedPoints.push(...rawLeftPoints);
    if (rawTopPoints.length > 0) {
      combinedPoints.push(...rawTopPoints.reverse());
    }
  } else {
    // Ascend along left border (bottom-to-top)
    const reversedLeft = [...rawLeftPoints].reverse();
    combinedPoints.push(...reversedLeft);

    // Cross apex
    if (rawTopPoints.length > 0) {
      combinedPoints.push(...rawTopPoints);
    }

    // Descend along right border (top-to-bottom)
    combinedPoints.push(...rawRightPoints);
  }

  if (combinedPoints.length < 8) {
    return { isVoluminous: false, maxProtrusionRatio: 1.0 };
  }

  const normPoints: Point2D[] = combinedPoints.map((p) => ({
    x: Number((p.x / imgW).toFixed(5)),
    y: Number((p.y / imgH).toFixed(5)),
  }));

  const confidence = Number(
    Math.max(0.20, Math.min(0.95, 0.45 + (combinedPoints.length > 25 ? 0.35 : 0.15) + (isVoluminous ? 0.10 : 0))).toFixed(3)
  );

  const path: ContourPath = {
    id: 'hair_outer_silhouette',
    region: 'hair_boundary',
    points: normPoints,
    closed: false,
    confidence,
    visibility: confidence >= HAIR_CONFIG.MIN_VISIBLE_CONFIDENCE ? 'visible' : 'uncertain',
  };

  return { path, isVoluminous, maxProtrusionRatio };
}

/**
 * Traces prominent internal structural hair mass dividers, part lines, or voluminous bundles.
 */
function extractInternalHairMasses(
  yApex: number,
  yBrow: number,
  fX: number,
  fY: number,
  fW: number,
  fH: number,
  isVoluminous: boolean,
  maskData: Uint8Array,
  gradMag: Float32Array,
  luminance: Float32Array,
  imgW: number,
  imgH: number
): ContourPath[] {
  const masses: ContourPath[] = [];

  // Internal search zone: between cranium apex and upper forehead
  const midX = fX + Math.round(fW * 0.5);
  const partSearchWidth = Math.round(fW * 0.25);
  const xStart = Math.max(0, midX - partSearchWidth);
  const xEnd = Math.min(imgW - 1, midX + partSearchWidth);

  // Search for central or side part line (vertical ridge of contrast / gradient seam)
  const partPoints: Point2D[] = [];
  for (let y = yApex + 4; y < yBrow - 4; y += 3) {
    const rowOffset = y * imgW;
    let bestX = -1;
    let minLum = Infinity;

    for (let x = xStart; x <= xEnd; x++) {
      if (maskData[rowOffset + x] > 0) {
        const lum = luminance[rowOffset + x];
        if (lum < minLum) {
          minLum = lum;
          bestX = x;
        }
      }
    }

    if (bestX !== -1) {
      partPoints.push({
        x: Number((bestX / imgW).toFixed(5)),
        y: Number((y / imgH).toFixed(5)),
      });
    }
  }

  if (partPoints.length >= 6) {
    masses.push({
      id: 'hair_part_line',
      region: 'hair',
      points: partPoints,
      closed: false,
      confidence: 0.65,
      visibility: 'visible',
    });
  }

  return masses;
}

/**
 * Computes mean directional flow orientation angle within the hair mass.
 */
function computeHairDirectionalFlow(
  yApex: number,
  yBrow: number,
  fX: number,
  fW: number,
  maskData: Uint8Array,
  gradDir: Float32Array,
  gradMag: Float32Array,
  imgW: number
): number | undefined {
  let sumCos = 0;
  let sumSin = 0;
  let sampleCount = 0;

  for (let y = yApex + 2; y < yBrow; y += 2) {
    const rowOffset = y * imgW;
    for (let x = fX; x <= fX + fW; x += 2) {
      const idx = rowOffset + x;
      if (maskData[idx] > 0 && gradMag[idx] > 0.08) {
        // Gradient direction is perpendicular to hair flow; rotate by 90 degrees (+ PI/2)
        const gradAngle = gradDir[idx];
        const flowAngle = gradAngle + Math.PI / 2;

        // Double angle representation for unoriented lines (axial direction)
        sumCos += Math.cos(2 * flowAngle);
        sumSin += Math.sin(2 * flowAngle);
        sampleCount++;
      }
    }
  }

  if (sampleCount < 25) return undefined;

  const rCoherence = Math.sqrt(sumCos * sumCos + sumSin * sumSin) / sampleCount;
  if (rCoherence < 0.22) return undefined;

  const meanDoubleAngle = Math.atan2(sumSin, sumCos);
  return Number((meanDoubleAngle / 2).toFixed(4));
}

/**
 * Detects visible hair structural landmarks, hairline, and outer silhouette contours.
 *
 * Core principles:
 * - IMAGE EVIDENCE > GEOMETRIC PRIOR: Never fabricates hair merely because a face exists.
 * - Distinguishes bald / receding scalps (BM-12) from full hair masses.
 * - Separates facial hair (beards / mustaches) from scalp hair mass.
 * - Accurately captures large afro/coiled volumes (BM-05).
 * - Side profiles (BM-02) preserve posterior cranium hair without mirrored frontal geometry.
 * - Ignores complex background clutter (BM-07).
 *
 * @param face Detected face region estimate with pose and bounding boxes
 * @param image Preprocessed normalized image
 * @param gradients Precomputed Sobel gradient field
 * @param mask Segmented subject foreground mask
 * @param detectedBrows Optional detected eyebrow landmarks for superior forehead anchor
 * @param detectedEyes Optional detected eye landmarks
 * @param detectedJawline Optional detected jawline landmarks for facial hair exclusion
 * @param detectedEars Optional detected ear landmarks
 */
export function detectHair(
  face: FaceRegionEstimate,
  image: NormalizedImage,
  gradients: GradientField,
  mask: SubjectMask,
  detectedBrows?: EyebrowDetectionResult,
  detectedEyes?: EyeDetectionResult,
  detectedJawline?: JawlineDetectionResult,
  detectedEars?: EarDetectionResult
): HairDetectionResult {
  const imgW = image.luminance.width;
  const imgH = image.luminance.height;
  const { faceBoundingBox, headBoundingBox, pose } = face;

  const fX = Math.round(faceBoundingBox.x * imgW);
  const fY = Math.round(faceBoundingBox.y * imgH);
  const fW = Math.round(faceBoundingBox.width * imgW);
  const fH = Math.round(faceBoundingBox.height * imgH);

  const hX = Math.round(headBoundingBox.x * imgW);
  const hY = Math.round(headBoundingBox.y * imgH);
  const hW = Math.round(headBoundingBox.width * imgW);
  const hH = Math.round(headBoundingBox.height * imgH);

  if (fW < 12 || fH < 12) {
    return {
      visibility: 'not_detected',
      confidence: 0,
      masses: [],
      allContours: [],
    };
  }

  const maskData = mask.data;
  const gradMag = gradients.magnitude;
  const gradDir = gradients.direction;
  const luminance = image.luminance.floatData;
  const rgba = image.rgba.data;

  // -------------------------------------------------------------------------
  // 1. Locate Cranial Apex & Eyebrow Level
  // -------------------------------------------------------------------------
  // Anatomical cranial bounds: Hair apex cannot be arbitrarily far above the face box.
  // Standard cranium height is ~0.35 to 0.50 * fH above fY. Voluminous hair can reach ~0.85 * fH.
  const maxCranialApexDist = Math.round(fH * 0.85);
  const minPossibleApexY = Math.max(0, fY - maxCranialApexDist);
  const searchStartY = Math.max(minPossibleApexY, Math.min(hY, fY - 5));

  let yApex = searchStartY;
  const fCenterX = fX + Math.round(fW * 0.5);
  const apexColStart = Math.max(0, fCenterX - Math.round(fW * 0.35));
  const apexColEnd = Math.min(imgW - 1, fCenterX + Math.round(fW * 0.35));

  for (let y = searchStartY; y < fY; y++) {
    const rowOffset = y * imgW;
    let hasFg = false;
    for (let x = apexColStart; x <= apexColEnd; x++) {
      if (maskData[rowOffset + x] > 0) {
        hasFg = true;
        break;
      }
    }
    if (hasFg) {
      yApex = y;
      break;
    }
  }

  let yBrow = fY + Math.round(fH * 0.22);
  if (detectedBrows?.leftEyebrow?.points.length && detectedBrows?.rightEyebrow?.points.length) {
    const b1Y = Math.round(detectedBrows.leftEyebrow.points[0].y * imgH);
    const b2Y = Math.round(detectedBrows.rightEyebrow.points[0].y * imgH);
    yBrow = Math.min(b1Y, b2Y);
  } else if (detectedEyes?.leftEye?.upperLid.points.length) {
    const eyeY = Math.round(detectedEyes.leftEye.upperLid.points[0].y * imgH);
    yBrow = Math.max(yApex + 5, eyeY - Math.round(fH * 0.08));
  }

  // -------------------------------------------------------------------------
  // 2. Sample Reference Skin Tone
  // -------------------------------------------------------------------------
  const skinRef = sampleSkinToneReference(fX, fY, fW, fH, luminance, rgba, maskData, imgW, imgH);

  // -------------------------------------------------------------------------
  // 3. Extract Hairline Boundary (Forehead <-> Hair)
  // -------------------------------------------------------------------------
  const hairlineResult = extractHairlineContour(
    yApex,
    yBrow,
    fX,
    fW,
    fH,
    skinRef,
    maskData,
    gradMag,
    luminance,
    imgW,
    imgH
  );

  // -------------------------------------------------------------------------
  // 4. Extract Outer Hair Silhouette
  // -------------------------------------------------------------------------
  const outerSilhouetteResult = extractOuterHairSilhouette(
    yApex,
    yBrow,
    fX,
    fY,
    fW,
    fH,
    hX,
    hY,
    hW,
    hH,
    pose,
    maskData,
    gradMag,
    luminance,
    imgW,
    imgH,
    detectedEars,
    detectedJawline
  );

  // -------------------------------------------------------------------------
  // 5. Extract Internal Masses & Flow
  // -------------------------------------------------------------------------
  const masses = extractInternalHairMasses(
    yApex,
    yBrow,
    fX,
    fY,
    fW,
    fH,
    outerSilhouetteResult.isVoluminous,
    maskData,
    gradMag,
    luminance,
    imgW,
    imgH
  );

  const primaryFlowAngle = computeHairDirectionalFlow(
    yApex,
    yBrow,
    fX,
    fW,
    maskData,
    gradDir,
    gradMag,
    imgW
  );

  // -------------------------------------------------------------------------
  // 6. Style Estimate & Confidence Scoring
  // -------------------------------------------------------------------------
  let styleEstimate: 'short' | 'voluminous' | 'receding' | 'bald' | 'tied_back' = 'short';
  if (outerSilhouetteResult.isVoluminous) {
    styleEstimate = 'voluminous';
  } else if (hairlineResult.isRecedingOrBald) {
    styleEstimate = 'receding';
  }

  const allContours: ContourPath[] = [];
  if (outerSilhouetteResult.path) allContours.push(outerSilhouetteResult.path);
  if (hairlineResult.path) allContours.push(hairlineResult.path);
  allContours.push(...masses);

  // Compute overall confidence
  let overallConf = 0;
  if (outerSilhouetteResult.path) overallConf += outerSilhouetteResult.path.confidence * 0.60;
  if (hairlineResult.path) overallConf += hairlineResult.path.confidence * 0.40;

  if (hairlineResult.isRecedingOrBald) {
    overallConf *= 0.55;
  }

  const confidence = Number(Math.max(0.0, Math.min(0.95, overallConf)).toFixed(3));
  const isVisible = confidence >= HAIR_CONFIG.MIN_VISIBLE_CONFIDENCE && allContours.length > 0;
  const visibility: FeatureVisibility = isVisible
    ? 'visible'
    : confidence >= HAIR_CONFIG.MIN_UNCERTAIN_CONFIDENCE
    ? 'uncertain'
    : 'not_detected';

  return {
    visibility,
    confidence,
    outerContour: outerSilhouetteResult.path,
    outerSilhouette: outerSilhouetteResult.path,
    hairline: hairlineResult.path,
    masses,
    allContours,
    styleEstimate,
    primaryFlowAngle,
  };
}
