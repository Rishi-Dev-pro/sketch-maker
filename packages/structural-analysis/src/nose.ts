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

/**
 * Result container for detected nose landmarks on a single subject.
 */
export interface NoseDetectionResult {
  /** Overall visibility classification for the nose */
  readonly visibility: FeatureVisibility;
  /** Overall nose detection confidence [0.0 - 1.0] */
  readonly confidence: number;
  /** Traced nasal bridge contour path (dorsum from nasion to supratip) */
  readonly bridge?: ContourPath;
  /** Traced nasal tip contour path (nasal lobule dome) */
  readonly tip?: ContourPath;
  /** Traced left nostril opening / alar boundary */
  readonly leftNostril?: ContourPath;
  /** Traced right nostril opening / alar boundary */
  readonly rightNostril?: ContourPath;
  /** Convenience array containing detected nostrils for direct FacialFeatures compatibility */
  readonly nostrils?: ContourPath[];
}

/**
 * Configuration constants for nose landmark detection.
 */
export const NOSE_DETECTOR_CONFIG = {
  /** Relative vertical search range for nasal bridge within face bounding box [min, max] */
  BRIDGE_BAND_Y: [0.28, 0.64] as const,
  /** Relative vertical search range for nasal tip within face bounding box [min, max] */
  TIP_BAND_Y: [0.50, 0.68] as const,
  /** Relative vertical search range for nostrils within face bounding box [min, max] */
  NOSTRIL_BAND_Y: [0.52, 0.72] as const,
  /** Relative expected alar half-width fraction of face width */
  ALAR_HALF_WIDTH_FRACTION: 0.14,
  /** Relative columella half-width fraction of face width */
  COLUMELLA_HALF_WIDTH_FRACTION: 0.03,
  /** Maximum vertical fraction of face height before reaching mustache/lip barrier */
  MAX_NOSE_BOTTOM_FRACTION: 0.74,
  /** Minimum score required to mark nose bridge as visible */
  MIN_BRIDGE_VISIBLE_SCORE: 0.16,
  /** Minimum score required to mark nose bridge as uncertain */
  MIN_BRIDGE_UNCERTAIN_SCORE: 0.10,
  /** Minimum score required to mark a nostril as visible */
  MIN_NOSTRIL_VISIBLE_SCORE: 0.16,
  /** Minimum score required to mark a nostril as uncertain */
  MIN_NOSTRIL_UNCERTAIN_SCORE: 0.09,
  /** Minimum local radial contrast for nostril localization */
  MIN_NOSTRIL_CONTRAST: 0.035,
} as const;

/**
 * Creates an occluded nostril placeholder for hidden profile sides (e.g. BM-02).
 */
function createOccludedNostril(side: 'left' | 'right'): ContourPath {
  return {
    id: `${side}_nostril`,
    region: 'nose',
    points: [],
    closed: false,
    confidence: 0,
    visibility: 'occluded',
  };
}

/**
 * Evaluates nasal bridge node saliency at pixel (x, y).
 * Combines horizontal Sobel gradient components, lateral ridge/step contrast,
 * and a midline Gaussian prior.
 */
function evaluateBridgeNodeSaliency(
  x: number,
  y: number,
  midlineX: number,
  sigmaX: number,
  lumData: Uint8Array,
  gradMag: Float32Array,
  gradDir: Float32Array,
  maskData: Uint8Array,
  imgW: number,
  imgH: number
): number {
  if (x < 1 || x >= imgW - 1 || y < 1 || y >= imgH - 1) return 0;
  const idx = y * imgW + x;
  if (maskData[idx] === 0) return 0;

  const edge = gradMag[idx];
  const dir = gradDir[idx];

  // The nasal bridge is primarily vertical, so the edge gradient is horizontal.
  // |cos(dir)| close to 1 indicates horizontal luminance variation across the bridge.
  const horizontalFactor = 0.4 + 0.6 * Math.abs(Math.cos(dir));
  const directedEdge = edge * horizontalFactor;

  // Sample lateral neighbors (4 pixels to each side)
  const deltaX = 4;
  const xLeft = Math.max(0, x - deltaX);
  const xRight = Math.min(imgW - 1, x + deltaX);
  const lumCenter = lumData[idx] / 255.0;
  const lumLeft = lumData[y * imgW + xLeft] / 255.0;
  const lumRight = lumData[y * imgW + xRight] / 255.0;

  // Lateral contrast: center highlight (dorsum) or directional illumination step (side shadow)
  const isHighlight = lumCenter > lumLeft && lumCenter > lumRight;
  const highlightStrength = isHighlight ? Math.min(lumCenter - lumLeft, lumCenter - lumRight) : 0;
  const stepStrength = Math.abs(lumRight - lumLeft);
  const ridgeContrast = Math.max(highlightStrength * 1.5, stepStrength);

  // Structural evidence must be present
  const structuralEvidence = directedEdge * 0.55 + ridgeContrast * 0.45;
  if (structuralEvidence < 0.03) return 0;

  // Lateral Gaussian prior relative to expected midline
  const dx = x - midlineX;
  const midlinePrior = Math.exp(-(dx * dx) / (2 * sigmaX * sigmaX));

  return structuralEvidence * midlinePrior;
}

/**
 * Traces the nasal bridge dorsum from nasion to supratip using vertical dynamic programming.
 */
function traceNoseBridge(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  expectedMidX: number,
  lumData: Uint8Array,
  gradMag: Float32Array,
  gradDir: Float32Array,
  maskData: Uint8Array,
  imgW: number,
  imgH: number
): { points: Point2D[]; meanScore: number } {
  const spanW = xMax - xMin + 1;
  const spanH = yMax - yMin + 1;
  if (spanW < 4 || spanH < 8) {
    return { points: [], meanScore: 0 };
  }

  const sigmaX = Math.max(5, spanW * 0.28);

  // Compute saliency grid for the search region: grid[yi][xi]
  const grid: number[][] = [];
  for (let yi = 0; yi < spanH; yi++) {
    const y = yMin + yi;
    const row: number[] = [];
    for (let xi = 0; xi < spanW; xi++) {
      const x = xMin + xi;
      const score = evaluateBridgeNodeSaliency(
        x,
        y,
        expectedMidX,
        sigmaX,
        lumData,
        gradMag,
        gradDir,
        maskData,
        imgW,
        imgH
      );
      row.push(score);
    }
    grid.push(row);
  }

  // Dynamic programming: find vertical path from yi = 0 to spanH - 1
  // with lateral jump constraint |xi - prevXi| <= 2
  const dp: number[][] = [];
  const parent: number[][] = [];
  for (let yi = 0; yi < spanH; yi++) {
    dp.push(new Array(spanW).fill(-Infinity));
    parent.push(new Array(spanW).fill(-1));
  }

  // Base row (nasion level)
  for (let xi = 0; xi < spanW; xi++) {
    dp[0][xi] = grid[0][xi];
  }

  // Recurrence downward
  for (let yi = 1; yi < spanH; yi++) {
    for (let xi = 0; xi < spanW; xi++) {
      let maxPrev = -Infinity;
      let bestPrevXi = -1;
      const prevMinXi = Math.max(0, xi - 2);
      const prevMaxXi = Math.min(spanW - 1, xi + 2);

      for (let pxi = prevMinXi; pxi <= prevMaxXi; pxi++) {
        const val = dp[yi - 1][pxi];
        if (val > maxPrev) {
          maxPrev = val;
          bestPrevXi = pxi;
        }
      }

      if (maxPrev > -Infinity) {
        // Continuity penalty for lateral wandering
        const stepPenalty = Math.abs(xi - bestPrevXi) * 0.03;
        dp[yi][xi] = maxPrev + grid[yi][xi] - stepPenalty;
        parent[yi][xi] = bestPrevXi;
      }
    }
  }

  // Find best endpoint in the bottom 4 rows (supratip level)
  let bestScore = -Infinity;
  let bestEndYi = spanH - 1;
  let bestEndXi = -1;

  for (let checkYi = spanH - 1; checkYi >= Math.max(0, spanH - 4); checkYi--) {
    for (let xi = 0; xi < spanW; xi++) {
      if (dp[checkYi][xi] > bestScore) {
        bestScore = dp[checkYi][xi];
        bestEndYi = checkYi;
        bestEndXi = xi;
      }
    }
  }

  if (bestScore <= 0 || bestEndXi < 0) {
    return { points: [], meanScore: 0 };
  }

  // Backtrack upward
  const rawPoints: { x: number; y: number; score: number }[] = [];
  let currXi = bestEndXi;
  for (let yi = bestEndYi; yi >= 0; yi--) {
    const x = xMin + currXi;
    const y = yMin + yi;
    rawPoints.push({ x, y, score: grid[yi][currXi] });
    currXi = parent[yi][currXi];
    if (currXi < 0 && yi > 0) break;
  }

  rawPoints.reverse();
  if (rawPoints.length < 6) {
    return { points: [], meanScore: 0 };
  }

  // Trim weak terminal segments
  let validStart = 0;
  while (validStart < rawPoints.length && rawPoints[validStart].score < 0.05) {
    validStart++;
  }
  let validEnd = rawPoints.length - 1;
  while (validEnd > validStart && rawPoints[validEnd].score < 0.05) {
    validEnd--;
  }

  const activePoints = rawPoints.slice(validStart, validEnd + 1);
  if (activePoints.length < 6) {
    return { points: [], meanScore: 0 };
  }

  const sumScore = activePoints.reduce((acc, p) => acc + p.score, 0);
  const meanScore = sumScore / activePoints.length;

  const normalizedPoints: Point2D[] = activePoints.map((p) => ({
    x: Number((p.x / imgW).toFixed(5)),
    y: Number((p.y / imgH).toFixed(5)),
  }));

  return { points: normalizedPoints, meanScore };
}

/**
 * Detects nasal tip contour near the lower terminus of the bridge.
 */
function detectNoseTip(
  bridgePoints: Point2D[],
  expectedMidX: number,
  expectedTipY: number,
  lumData: Uint8Array,
  gradMag: Float32Array,
  maskData: Uint8Array,
  imgW: number,
  imgH: number
): { tipPath?: ContourPath; confidence: number } {
  let tipPixelX = expectedMidX;
  let tipPixelY = expectedTipY;

  if (bridgePoints.length > 0) {
    const lowerPt = bridgePoints[bridgePoints.length - 1];
    tipPixelX = Math.round(lowerPt.x * imgW);
    tipPixelY = Math.min(imgH - 2, Math.round(lowerPt.y * imgH) + 3);
  }

  if (tipPixelX < 2 || tipPixelX >= imgW - 2 || tipPixelY < 2 || tipPixelY >= imgH - 4) {
    return { confidence: 0 };
  }

  // Evaluate local downward luminance step (tip highlight transitioning into subnasal shadow)
  const centerLum = lumData[tipPixelY * imgW + tipPixelX] / 255.0;
  const belowLum = lumData[Math.min(imgH - 1, tipPixelY + 4) * imgW + tipPixelX] / 255.0;
  const downwardContrast = centerLum - belowLum;

  const localGrad = gradMag[tipPixelY * imgW + tipPixelX];
  const tipScore = localGrad * 0.5 + Math.max(0, downwardContrast) * 0.5;

  if (tipScore < 0.06) {
    return { confidence: Number(tipScore.toFixed(3)) };
  }

  // Construct a small curved arch representing the nasal lobule dome (5 points)
  const tipRadius = Math.max(2, Math.round(imgW * 0.008));
  const tipArc: Point2D[] = [
    { x: Number(((tipPixelX - tipRadius) / imgW).toFixed(5)), y: Number(((tipPixelY + 1) / imgH).toFixed(5)) },
    { x: Number(((tipPixelX - Math.round(tipRadius * 0.5)) / imgW).toFixed(5)), y: Number((tipPixelY / imgH).toFixed(5)) },
    { x: Number((tipPixelX / imgW).toFixed(5)), y: Number((tipPixelY / imgH).toFixed(5)) },
    { x: Number(((tipPixelX + Math.round(tipRadius * 0.5)) / imgW).toFixed(5)), y: Number((tipPixelY / imgH).toFixed(5)) },
    { x: Number(((tipPixelX + tipRadius) / imgW).toFixed(5)), y: Number(((tipPixelY + 1) / imgH).toFixed(5)) },
  ];

  const confidence = Math.min(0.95, Math.max(0.12, Number(tipScore.toFixed(3))));
  const isVisible = confidence >= 0.16;

  return {
    tipPath: {
      id: 'nose_tip',
      region: 'nose',
      points: tipArc,
      closed: false,
      confidence,
      visibility: isVisible ? 'visible' : 'uncertain',
    },
    confidence,
  };
}

/**
 * Detects a single nostril opening and alar boundary in a localized search window.
 */
function detectSingleNostril(
  side: 'left' | 'right',
  searchMinX: number,
  searchMaxX: number,
  searchMinY: number,
  searchMaxY: number,
  lumData: Uint8Array,
  gradMag: Float32Array,
  maskData: Uint8Array,
  imgW: number,
  imgH: number
): ContourPath {
  let bestX = -1;
  let bestY = -1;
  let bestScore = -Infinity;

  const delta = 3;

  for (let y = searchMinY; y <= searchMaxY; y++) {
    for (let x = searchMinX; x <= searchMaxX; x++) {
      if (x < delta || x >= imgW - delta || y < delta || y >= imgH - delta) continue;
      const idx = y * imgW + x;
      if (maskData[idx] === 0) continue;

      const centerLum = lumData[idx] / 255.0;

      // Nostril is a local luminance depression surrounded by skin
      const topLum = lumData[(y - delta) * imgW + x] / 255.0;
      const botLum = lumData[(y + delta) * imgW + x] / 255.0;
      const leftLum = lumData[y * imgW + (x - delta)] / 255.0;
      const rightLum = lumData[y * imgW + (x + delta)] / 255.0;
      const surroundMean = (topLum + botLum + leftLum + rightLum) * 0.25;

      const valleyContrast = surroundMean - centerLum;
      if (valleyContrast < NOSE_DETECTOR_CONFIG.MIN_NOSTRIL_CONTRAST) continue;

      const edge = gradMag[idx];
      const darkness = 1.0 - centerLum;

      // Multi-cue nostril score: local valley contrast (50%) + edge gradient (30%) + darkness (20%)
      const score = valleyContrast * 0.50 + edge * 0.30 + darkness * 0.20;
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }
  }

  if (bestScore < NOSE_DETECTOR_CONFIG.MIN_NOSTRIL_UNCERTAIN_SCORE || bestX < 0) {
    return {
      id: `${side}_nostril`,
      region: 'nose',
      points: [],
      closed: false,
      confidence: Math.max(0, Number(bestScore.toFixed(3))),
      visibility: 'not_detected',
    };
  }

  // Construct a small curved alar contour path (5 points) around the nostril opening
  const radX = Math.max(2, Math.round(imgW * 0.006));
  const radY = Math.max(1, Math.round(imgH * 0.004));

  const nostrilPts: Point2D[] = [
    { x: Number(((bestX - radX) / imgW).toFixed(5)), y: Number(((bestY + radY) / imgH).toFixed(5)) },
    { x: Number(((bestX - Math.round(radX * 0.5)) / imgW).toFixed(5)), y: Number((bestY / imgH).toFixed(5)) },
    { x: Number((bestX / imgW).toFixed(5)), y: Number(((bestY - radY) / imgH).toFixed(5)) },
    { x: Number(((bestX + Math.round(radX * 0.5)) / imgW).toFixed(5)), y: Number((bestY / imgH).toFixed(5)) },
    { x: Number(((bestX + radX) / imgW).toFixed(5)), y: Number(((bestY + radY) / imgH).toFixed(5)) },
  ];

  const confidence = Math.min(0.95, Math.max(0.12, Number(bestScore.toFixed(3))));
  const isVisible = bestScore >= NOSE_DETECTOR_CONFIG.MIN_NOSTRIL_VISIBLE_SCORE;

  return {
    id: `${side}_nostril`,
    region: 'nose',
    points: nostrilPts,
    closed: false,
    confidence,
    visibility: isVisible ? 'visible' : 'uncertain',
  };
}

/**
 * Detects nasal landmark structures (bridge, tip, and nostrils) from a FaceRegionEstimate and segmented image.
 *
 * Principles:
 * - Operates strictly in normalized [0, 1] coordinates.
 * - Nose is NOT assumed to be a single dark shape; detects structural transitions (ridge highlight or side shadow).
 * - Anchors search space relative to detected eye landmarks and head pose.
 * - Glasses and facial-hair robust: bounds search strictly above the upper lip and below the glasses bridge.
 * - Profile poses strictly mark hidden-side geometry as 'occluded' without fabricating coordinates.
 * - Returns evidence-dependent results: missing evidence yields 'not_detected' / 'uncertain'.
 *
 * @param face The isolated face region estimate from Step 1 / 1.1.
 * @param image The normalized preprocessed image.
 * @param gradients Sobel directional gradient field.
 * @param mask Segmented subject foreground mask.
 * @param detectedEyes Optional detected eye landmarks from Step 2A to establish facial midline.
 */
export function detectNose(
  face: FaceRegionEstimate,
  image: NormalizedImage,
  gradients: GradientField,
  mask: SubjectMask,
  detectedEyes?: EyeDetectionResult
): NoseDetectionResult {
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
  // 1. Establish Midline and Vertical Search Envelope
  // -------------------------------------------------------------------------
  let expectedMidX = fX + Math.round(fW * 0.50);
  let eyeBottomY = fY + Math.round(fH * 0.32);

  const leftEye = detectedEyes?.leftEye;
  const rightEye = detectedEyes?.rightEye;

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

    let maxEyeY = 0;
    for (const p of [...leftEye.lowerLid.points, ...rightEye.lowerLid.points]) {
      const py = Math.round(p.y * imgH);
      if (py > maxEyeY) maxEyeY = py;
    }
    if (maxEyeY > 0) eyeBottomY = maxEyeY;
  } else if (pose === 'left_profile') {
    expectedMidX = fX + Math.round(fW * 0.22);
  } else if (pose === 'right_profile') {
    expectedMidX = fX + Math.round(fW * 0.78);
  } else if (pose === 'three_quarter_left') {
    expectedMidX = fX + Math.round(fW * 0.38);
  } else if (pose === 'three_quarter_right') {
    expectedMidX = fX + Math.round(fW * 0.62);
  }

  // Vertical search bounds:
  // Nasion starts slightly below the eyes (to avoid the spectacle bridge on BM-03)
  const bridgeMinY = Math.max(fY + 2, eyeBottomY + 2);
  const bridgeMaxY = Math.min(imgH - 2, fY + Math.floor(fH * NOSE_DETECTOR_CONFIG.BRIDGE_BAND_Y[1]));
  const maxAllowedBottomY = Math.min(
    imgH - 2,
    fY + Math.floor(fH * NOSE_DETECTOR_CONFIG.MAX_NOSE_BOTTOM_FRACTION)
  );

  const bridgeHalfW = Math.max(4, Math.round(fW * 0.12));
  const bridgeXMin = Math.max(1, expectedMidX - bridgeHalfW);
  const bridgeXMax = Math.min(imgW - 2, expectedMidX + bridgeHalfW);

  // -------------------------------------------------------------------------
  // 2. Trace Nasal Bridge
  // -------------------------------------------------------------------------
  let bridge: ContourPath | undefined;
  let bridgeScore = 0;

  if (bridgeMaxY > bridgeMinY + 6) {
    const trace = traceNoseBridge(
      bridgeXMin,
      bridgeXMax,
      bridgeMinY,
      bridgeMaxY,
      expectedMidX,
      lumData,
      gradMag,
      gradDir,
      maskData,
      imgW,
      imgH
    );

    bridgeScore = trace.meanScore;
    if (trace.points.length >= 6 && trace.meanScore >= NOSE_DETECTOR_CONFIG.MIN_BRIDGE_UNCERTAIN_SCORE) {
      const isVisible = trace.meanScore >= NOSE_DETECTOR_CONFIG.MIN_BRIDGE_VISIBLE_SCORE;
      const conf = Math.max(0.12, Math.min(0.95, Number(trace.meanScore.toFixed(3))));
      bridge = {
        id: 'nose_bridge',
        region: 'nose',
        points: trace.points,
        closed: false,
        confidence: conf,
        visibility: isVisible ? 'visible' : 'uncertain',
      };
    }
  }

  // -------------------------------------------------------------------------
  // 3. Detect Nasal Tip
  // -------------------------------------------------------------------------
  const expectedTipY = Math.min(
    maxAllowedBottomY - 4,
    fY + Math.floor(fH * ((NOSE_DETECTOR_CONFIG.TIP_BAND_Y[0] + NOSE_DETECTOR_CONFIG.TIP_BAND_Y[1]) * 0.5))
  );

  const tipResult = detectNoseTip(
    bridge ? bridge.points : [],
    expectedMidX,
    expectedTipY,
    lumData,
    gradMag,
    maskData,
    imgW,
    imgH
  );
  const tip = tipResult.tipPath;

  // -------------------------------------------------------------------------
  // 4. Detect Nostrils
  // -------------------------------------------------------------------------
  let leftNostril: ContourPath | undefined;
  let rightNostril: ContourPath | undefined;

  const alarHalfW = Math.max(4, Math.round(fW * NOSE_DETECTOR_CONFIG.ALAR_HALF_WIDTH_FRACTION));
  const columellaHalfW = Math.max(2, Math.round(fW * NOSE_DETECTOR_CONFIG.COLUMELLA_HALF_WIDTH_FRACTION));

  const nostrilMinY = Math.max(
    bridgeMinY + 4,
    fY + Math.floor(fH * NOSE_DETECTOR_CONFIG.NOSTRIL_BAND_Y[0])
  );
  const nostrilMaxY = Math.min(
    maxAllowedBottomY,
    fY + Math.floor(fH * NOSE_DETECTOR_CONFIG.NOSTRIL_BAND_Y[1])
  );

  // Profile handling: physical occlusion suppression
  if (visibleSide === 'right_only' || pose === 'right_profile') {
    leftNostril = createOccludedNostril('left');
  } else {
    const leftNostrilXMin = Math.max(1, expectedMidX - alarHalfW);
    const leftNostrilXMax = Math.max(leftNostrilXMin + 2, expectedMidX - columellaHalfW);

    leftNostril = detectSingleNostril(
      'left',
      leftNostrilXMin,
      leftNostrilXMax,
      nostrilMinY,
      nostrilMaxY,
      lumData,
      gradMag,
      maskData,
      imgW,
      imgH
    );
  }

  if (visibleSide === 'left_only' || pose === 'left_profile') {
    rightNostril = createOccludedNostril('right');
  } else {
    const rightNostrilXMin = Math.min(imgW - 3, expectedMidX + columellaHalfW);
    const rightNostrilXMax = Math.min(imgW - 2, expectedMidX + alarHalfW);

    rightNostril = detectSingleNostril(
      'right',
      rightNostrilXMin,
      rightNostrilXMax,
      nostrilMinY,
      nostrilMaxY,
      lumData,
      gradMag,
      maskData,
      imgW,
      imgH
    );
  }

  // -------------------------------------------------------------------------
  // 5. Aggregate Nose Confidence & Visibility
  // -------------------------------------------------------------------------
  const detectedNostrils: ContourPath[] = [];
  if (leftNostril && leftNostril.points.length > 0) detectedNostrils.push(leftNostril);
  if (rightNostril && rightNostril.points.length > 0) detectedNostrils.push(rightNostril);

  // Compute composite nose confidence
  const confidences: number[] = [];
  if (bridge) confidences.push(bridge.confidence);
  if (tip) confidences.push(tip.confidence);
  if (leftNostril && leftNostril.visibility !== 'occluded' && leftNostril.confidence > 0) {
    confidences.push(leftNostril.confidence);
  }
  if (rightNostril && rightNostril.visibility !== 'occluded' && rightNostril.confidence > 0) {
    confidences.push(rightNostril.confidence);
  }

  const avgConf =
    confidences.length > 0
      ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(3))
      : 0;

  // Determine overall visibility
  let visibility: FeatureVisibility = 'not_detected';
  if (
    (bridge && bridge.visibility === 'visible') ||
    (tip && tip.visibility === 'visible') ||
    detectedNostrils.some((n) => n.visibility === 'visible')
  ) {
    visibility = 'visible';
  } else if (
    (bridge && bridge.visibility === 'uncertain') ||
    (tip && tip.visibility === 'uncertain') ||
    detectedNostrils.some((n) => n.visibility === 'uncertain')
  ) {
    visibility = 'uncertain';
  }

  return {
    visibility,
    confidence: avgConf,
    bridge,
    tip,
    leftNostril,
    rightNostril,
    nostrils: detectedNostrils.length > 0 ? detectedNostrils : undefined,
  };
}
