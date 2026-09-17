import { BoundingBox, HeadPose, Point2D } from '@sketch-maker/shared-types';
import { NormalizedImage } from '@sketch-maker/image-processing';
import {
  FaceRegionDiagnostics,
  FaceRegionEstimate,
  LateralVisibility,
  SegmentationResult,
  SubjectMask,
  SubjectRegion,
} from './types';
import { GradientField } from './gradient';

/**
 * Anthropometric search priors and geometric thresholds.
 * Note: Used solely as INITIAL SEARCH PRIORS; image evidence dynamically overrides priors.
 */
export const FACE_PRIOR_CONFIG = {
  /** Minimum head height as a fraction of full-body subject height */
  MIN_HEAD_HEIGHT_FRACTION: 0.12,
  /** Maximum head height as a fraction of portrait subject height */
  MAX_HEAD_HEIGHT_FRACTION: 0.70,
  /** Default head height fraction when neck constriction is indistinct */
  DEFAULT_PORTRAIT_HEAD_FRACTION: 0.50,
  DEFAULT_BODY_HEAD_FRACTION: 0.20,
  /** Maximum anatomical head height-to-width aspect ratio (crown to chin) */
  MAX_HEAD_ASPECT_RATIO: 1.25,
  /** Minimum head height-to-width aspect ratio */
  MIN_HEAD_ASPECT_RATIO: 0.70,
  /** Threshold width expansion ratio to identify shoulders */
  SHOULDER_EXPANSION_RATIO: 1.25,
  /** Structural feature energy offset threshold for 90-degree profile classification */
  PROFILE_ENERGY_OFFSET_THRESHOLD: 0.28,
  /** Structural feature energy ratio threshold for 90-degree profile classification */
  PROFILE_ENERGY_RATIO_THRESHOLD: 0.68,
  /** Structural feature energy offset threshold for 3/4 yaw classification */
  THREE_QUARTER_ENERGY_OFFSET_THRESHOLD: 0.10,
  /** Structural feature energy ratio threshold for 3/4 yaw classification */
  THREE_QUARTER_ENERGY_RATIO_THRESHOLD: 0.58,
  /** Illumination asymmetry threshold above which skin chrominance is discounted */
  CHIAROSCURO_ILLUMINATION_THRESHOLD: 0.35,
  /** Minimum skin coverage fraction required for skin centroid to be deemed reliable */
  MIN_RELIABLE_SKIN_COVERAGE: 0.15,
} as const;

/**
 * Isolates the head and facial feature bounding regions and estimates head pose
 * orientation for a single subject instance.
 *
 * Implements a lighting-robust, torso-isolated multi-cue geometric evidence model.
 *
 * @param subject SubjectRegion instance from segmentation
 * @param mask SubjectMask (binary foreground and continuous confidence map)
 * @param image NormalizedImage (RGBA, luminance, scale)
 * @param gradients GradientField (magnitude and direction)
 * @returns FaceRegionEstimate or null if subject bounds are degenerate
 */
export function estimateFaceRegion(
  subject: SubjectRegion,
  mask: SubjectMask,
  image: NormalizedImage,
  gradients: GradientField
): FaceRegionEstimate | null {
  const { width: imgW, height: imgH } = mask;
  const pBox = subject.pixelBoundingBox;

  // Reject degenerate subject bounds
  if (pBox.width < 12 || pBox.height < 12) {
    return null;
  }

  const maskData = mask.data;
  const rgbaData = image.rgba.data;
  const lumData = image.luminance.data;
  const gradMag = gradients.magnitude;

  // -------------------------------------------------------------------------
  // 1. Scanline Foreground Mass Profiling
  // -------------------------------------------------------------------------
  const rowStart = Math.max(0, pBox.y);
  const rowEnd = Math.min(imgH - 1, pBox.y + pBox.height - 1);
  const colStart = Math.max(0, pBox.x);
  const colEnd = Math.min(imgW - 1, pBox.x + pBox.width - 1);

  const numRows = rowEnd - rowStart + 1;
  const rowWidths = new Int32Array(numRows);
  const rowMinX = new Int32Array(numRows);
  const rowMaxX = new Int32Array(numRows);

  let firstFgY = -1;
  let lastFgY = -1;

  for (let y = rowStart; y <= rowEnd; y++) {
    const idx = y - rowStart;
    let minX = -1;
    let maxX = -1;
    let count = 0;
    const rowOffset = y * imgW;

    for (let x = colStart; x <= colEnd; x++) {
      if (maskData[rowOffset + x] > 0) {
        if (minX === -1) minX = x;
        maxX = x;
        count++;
      }
    }

    rowWidths[idx] = count;
    rowMinX[idx] = minX !== -1 ? minX : colStart;
    rowMaxX[idx] = maxX !== -1 ? maxX : colEnd;

    if (count > 0) {
      if (firstFgY === -1) firstFgY = y;
      lastFgY = y;
    }
  }

  if (firstFgY === -1 || lastFgY <= firstFgY) {
    return null;
  }

  const subjectHeight = lastFgY - firstFgY + 1;
  const isFullOrStandingBody = subjectHeight > imgH * 0.65 && pBox.width < pBox.height * 0.65;

  // -------------------------------------------------------------------------
  // 2. Head Region Boundary Isolation (Torso/Chest Excluded)
  // -------------------------------------------------------------------------
  const startOffset = firstFgY - rowStart;
  const maxSearchRows = Math.floor(
    subjectHeight * (isFullOrStandingBody ? FACE_PRIOR_CONFIG.DEFAULT_BODY_HEAD_FRACTION * 1.5 : FACE_PRIOR_CONFIG.MAX_HEAD_HEIGHT_FRACTION)
  );

  // Measure peak cranium width in upper 40% of candidate head
  let peakHeadWidth = 0;
  let peakHeadY = firstFgY;
  const upperHeadLimit = Math.min(numRows - 1, startOffset + Math.max(10, Math.floor(maxSearchRows * 0.40)));

  for (let i = startOffset; i <= upperHeadLimit; i++) {
    if (rowWidths[i] > peakHeadWidth) {
      peakHeadWidth = rowWidths[i];
      peakHeadY = rowStart + i;
    }
  }

  // Enforce human anatomical aspect ratio bounds:
  // Head height (crown to chin) cannot exceed MAX_HEAD_ASPECT_RATIO * cranium width
  const maxAllowedHeadHeight = Math.max(
    30,
    Math.round(peakHeadWidth * FACE_PRIOR_CONFIG.MAX_HEAD_ASPECT_RATIO)
  );
  const minAllowedHeadHeight = Math.max(
    20,
    Math.round(peakHeadWidth * FACE_PRIOR_CONFIG.MIN_HEAD_ASPECT_RATIO)
  );

  // Search for neck constriction / shoulder expansion below cranium peak
  let headBottomY = -1;
  let minNeckWidth = peakHeadWidth;
  let minNeckY = peakHeadY;
  const searchEndIdx = Math.min(
    numRows - 1,
    startOffset + Math.min(maxSearchRows, maxAllowedHeadHeight)
  );

  for (let i = peakHeadY - rowStart + 1; i <= searchEndIdx; i++) {
    const w = rowWidths[i];
    if (w > 0 && w < minNeckWidth) {
      minNeckWidth = w;
      minNeckY = rowStart + i;
    } else if (
      w > minNeckWidth * FACE_PRIOR_CONFIG.SHOULDER_EXPANSION_RATIO &&
      (rowStart + i) - minNeckY >= 6 &&
      (minNeckY - firstFgY) >= minAllowedHeadHeight
    ) {
      // Shoulder expansion detected below neck constriction
      headBottomY = minNeckY;
      break;
    }
  }

  // Fallback to anatomical height if no abrupt shoulder step was detected
  if (headBottomY === -1) {
    if (minNeckY - firstFgY >= minAllowedHeadHeight) {
      headBottomY = minNeckY;
    } else {
      const fallbackH = isFullOrStandingBody
        ? Math.floor(subjectHeight * FACE_PRIOR_CONFIG.DEFAULT_BODY_HEAD_FRACTION)
        : Math.min(maxAllowedHeadHeight, Math.floor(subjectHeight * FACE_PRIOR_CONFIG.DEFAULT_PORTRAIT_HEAD_FRACTION));
      headBottomY = Math.min(lastFgY, firstFgY + Math.max(minAllowedHeadHeight, fallbackH));
    }
  }

  // Ensure headBottomY does not exceed anatomical head height ceiling
  headBottomY = Math.min(headBottomY, firstFgY + maxAllowedHeadHeight);

  // Calculate true head-local horizontal envelope (strictly above chest/collar)
  let headMinX = imgW;
  let headMaxX = 0;
  for (let y = firstFgY; y <= headBottomY; y++) {
    const idx = y - rowStart;
    if (rowWidths[idx] > 0) {
      if (rowMinX[idx] < headMinX) headMinX = rowMinX[idx];
      if (rowMaxX[idx] > headMaxX) headMaxX = rowMaxX[idx];
    }
  }

  if (headMinX >= headMaxX) {
    headMinX = colStart;
    headMaxX = colEnd;
  }

  const headPixelW = headMaxX - headMinX + 1;
  const headPixelH = headBottomY - firstFgY + 1;
  const headCenterX = headMinX + headPixelW * 0.5;

  // -------------------------------------------------------------------------
  // 3. Structural Feature Energy Centroid (Lighting-Invariant Geometry)
  // -------------------------------------------------------------------------
  // In the facial band (18% to 78% of head height), compute the center of mass
  // of high-frequency structural edges (eyes, eyebrows, nose, lips, ears).
  // Inset x slightly (2px) from head silhouette envelope so outer silhouette
  // boundary contrast against background does not distort internal landmark distribution.
  let sumWeightX = 0;
  let sumWeightY = 0;
  let totalEdgeWeight = 0;
  let leftEdgeEnergy = 0;
  let rightEdgeEnergy = 0;
  let leftEdgeCount = 0;
  let rightEdgeCount = 0;

  const yFaceStart = firstFgY + Math.floor(headPixelH * 0.18);
  const yFaceEnd = firstFgY + Math.floor(headPixelH * 0.78);
  const xFaceStart = headMinX + (headPixelW >= 12 ? 2 : 0);
  const xFaceEnd = headMaxX - (headPixelW >= 12 ? 2 : 0);

  for (let y = yFaceStart; y <= yFaceEnd; y++) {
    const rowOffset = y * imgW;
    for (let x = xFaceStart; x <= xFaceEnd; x++) {
      const idx = rowOffset + x;
      if (maskData[idx] > 0) {
        const g = gradMag[idx];
        if (g > 0.02) {
          sumWeightX += x * g;
          sumWeightY += y * g;
          totalEdgeWeight += g;
        }
        if (x < headCenterX) {
          leftEdgeEnergy += g;
          leftEdgeCount++;
        } else {
          rightEdgeEnergy += g;
          rightEdgeCount++;
        }
      }
    }
  }

  const hasStructuralEdges = totalEdgeWeight > 0.15;
  const energyCenterX = hasStructuralEdges ? sumWeightX / totalEdgeWeight : headCenterX;
  const energyCenterY = hasStructuralEdges ? sumWeightY / totalEdgeWeight : firstFgY + headPixelH * 0.52;
  const energyOffset = (hasStructuralEdges && headPixelW > 0) ? (energyCenterX - headCenterX) / (headPixelW * 0.5) : 0;
  const energyRatioLeft = hasStructuralEdges ? leftEdgeEnergy / (leftEdgeEnergy + rightEdgeEnergy + 1e-4) : 0.5;

  // -------------------------------------------------------------------------
  // 4. Illumination Asymmetry & Skin-Chrominance Sampling
  // -------------------------------------------------------------------------
  let leftLumSum = 0, leftLumCount = 0;
  let rightLumSum = 0, rightLumCount = 0;
  let skinPixelCount = 0;
  let totalHeadFgPixels = 0;
  let sumSkinX = 0;
  let sumSkinY = 0;
  let skinMinX = headMaxX;
  let skinMaxX = headMinX;
  let skinMinY = headBottomY;
  let skinMaxY = firstFgY;
  let headMaxLum = 0;
  for (let y = firstFgY; y <= headBottomY; y++) {
    const rowOffset = y * imgW;
    for (let x = headMinX; x <= headMaxX; x++) {
      const pIdx = rowOffset + x;
      if (maskData[pIdx] > 0 && lumData[pIdx] > headMaxLum) {
        headMaxLum = lumData[pIdx];
      }
    }
  }

  const baseMinIntensity = image.stats.mean < 60 ? 40 : 95;
  const minSkinIntensity = Math.max(baseMinIntensity, headMaxLum * 3 * 0.35);
  let sumAllGrad = 0;

  for (let y = firstFgY; y <= headBottomY; y++) {
    const rowOffset = y * imgW;
    for (let x = headMinX; x <= headMaxX; x++) {
      const pIdx = rowOffset + x;
      if (maskData[pIdx] > 0) {
        totalHeadFgPixels++;
        const r4 = pIdx * 4;
        const R = rgbaData[r4];
        const G = rgbaData[r4 + 1];
        const B = rgbaData[r4 + 2];
        const intensity = R + G + B + 1e-4;
        const lumVal = lumData[pIdx];
        const gVal = gradMag[pIdx];

        sumAllGrad += gVal;

        if (x < headCenterX) {
          leftLumSum += lumVal;
          leftLumCount++;
        } else {
          rightLumSum += lumVal;
          rightLumCount++;
        }

        const rNorm = R / intensity;
        const gNorm = G / intensity;

        const isSkin =
          intensity >= minSkinIntensity &&
          R >= G &&
          G >= B * 0.78 &&
          rNorm >= 0.33 &&
          rNorm <= 0.62 &&
          gNorm >= 0.24 &&
          gNorm <= 0.40 &&
          rNorm - gNorm >= 0.02;

        if (isSkin) {
          skinPixelCount++;
          sumSkinX += x;
          sumSkinY += y;
          if (x < skinMinX) skinMinX = x;
          if (x > skinMaxX) skinMaxX = x;
          if (y < skinMinY) skinMinY = y;
          if (y > skinMaxY) skinMaxY = y;
        }
      }
    }
  }

  const avgLeftLum = leftLumCount > 0 ? leftLumSum / leftLumCount : 0;
  const avgRightLum = rightLumCount > 0 ? rightLumSum / rightLumCount : 0;
  const maxLum = Math.max(avgLeftLum, avgRightLum, 1);
  const illuminationAsymmetry = Math.abs(avgLeftLum - avgRightLum) / maxLum;

  const skinToneCoverage = totalHeadFgPixels > 0 ? skinPixelCount / totalHeadFgPixels : 0;
  const avgHeadEdgeEnergy = totalHeadFgPixels > 0 ? sumAllGrad / totalHeadFgPixels : 0;

  // -------------------------------------------------------------------------
  // 5. Multi-Cue Evidence Fusion
  // -------------------------------------------------------------------------
  // Distinguish illumination asymmetry (chiaroscuro) from geometric asymmetry (profile).
  // Chiaroscuro occurs when illumination is asymmetric but structural edges and head silhouette
  // remain geometrically symmetric across the facial axis (e.g. BM-06).
  const headSilhouetteRatio = (leftLumCount + rightLumCount > 0)
    ? leftLumCount / (leftLumCount + rightLumCount)
    : 0.5;

  const isGeometricallySymmetric =
    Math.abs(energyOffset) < 0.15 &&
    Math.abs(energyRatioLeft - 0.5) < 0.15 &&
    headSilhouetteRatio >= 0.44 &&
    headSilhouetteRatio <= 0.56;

  const isChiaroscuro =
    illuminationAsymmetry > FACE_PRIOR_CONFIG.CHIAROSCURO_ILLUMINATION_THRESHOLD &&
    isGeometricallySymmetric;

  const isSkinReliable =
    skinToneCoverage >= FACE_PRIOR_CONFIG.MIN_RELIABLE_SKIN_COVERAGE &&
    skinMinX < skinMaxX &&
    skinMinY < skinMaxY;

  let faceCentroidX: number;
  let faceCentroidY: number;
  let faceBoxPixelX: number;
  let faceBoxPixelY: number;
  let faceBoxPixelW: number;
  let faceBoxPixelH: number;

  if (isSkinReliable && hasStructuralEdges) {
    const skinCentroidX = sumSkinX / skinPixelCount;
    const skinCentroidY = sumSkinY / skinPixelCount;
    // When chiaroscuro is detected on a symmetric head, structural edge geometry takes 80% weight
    // When illumination is balanced or head is genuinely asymmetric (profile), share weight 50/50
    const skinWeight = isChiaroscuro ? 0.20 : 0.50;
    const edgeWeight = 1.0 - skinWeight;
    faceCentroidX = edgeWeight * energyCenterX + skinWeight * skinCentroidX;
    faceCentroidY = edgeWeight * energyCenterY + skinWeight * skinCentroidY;
    faceBoxPixelX = skinMinX;
    faceBoxPixelY = skinMinY;
    faceBoxPixelW = skinMaxX - skinMinX + 1;
    faceBoxPixelH = skinMaxY - skinMinY + 1;
  } else if (isSkinReliable && !hasStructuralEdges) {
    // Only skin chrominance available (e.g. smooth synthetic rendering)
    faceCentroidX = sumSkinX / skinPixelCount;
    faceCentroidY = sumSkinY / skinPixelCount;
    faceBoxPixelX = skinMinX;
    faceBoxPixelY = skinMinY;
    faceBoxPixelW = skinMaxX - skinMinX + 1;
    faceBoxPixelH = skinMaxY - skinMinY + 1;
  } else if (!isSkinReliable && hasStructuralEdges) {
    // Structural energy centroid takes full precedence when skin chrominance is muted or shadowed (BM-02, BM-06)
    faceCentroidX = energyCenterX;
    faceCentroidY = energyCenterY;
    faceBoxPixelX = Math.floor(headMinX + headPixelW * 0.15);
    faceBoxPixelY = Math.floor(firstFgY + headPixelH * 0.20);
    faceBoxPixelW = Math.max(8, Math.floor(headPixelW * 0.70));
    faceBoxPixelH = Math.max(8, Math.floor(headPixelH * 0.65));
  } else {
    // Low-evidence fallback: anatomical head prior
    faceCentroidX = headCenterX;
    faceCentroidY = firstFgY + headPixelH * 0.52;
    faceBoxPixelX = Math.floor(headMinX + headPixelW * 0.15);
    faceBoxPixelY = Math.floor(firstFgY + headPixelH * 0.20);
    faceBoxPixelW = Math.max(8, Math.floor(headPixelW * 0.70));
    faceBoxPixelH = Math.max(8, Math.floor(headPixelH * 0.65));
  }

  // Centroid offset [-1.0 to 1.0]
  const centroidOffset = headPixelW > 0 ? (faceCentroidX - headCenterX) / (headPixelW * 0.5) : 0;

  // Profile boundary asymmetry ratio
  const distToLeft = Math.max(1, faceCentroidX - headMinX);
  const distToRight = Math.max(1, headMaxX - faceCentroidX);
  const profileAsymmetryRatio = distToLeft / (distToLeft + distToRight);

  // Symmetry score: balanced structural edge energy across head center
  const avgLeftEdge = leftEdgeCount > 0 ? leftEdgeEnergy / leftEdgeCount : 0;
  const avgRightEdge = rightEdgeCount > 0 ? rightEdgeEnergy / rightEdgeCount : 0;
  const maxSideEdge = Math.max(avgLeftEdge, avgRightEdge, 0.01);
  const edgeAsymmetry = Math.abs(avgLeftEdge - avgRightEdge) / maxSideEdge;
  const symmetryScore = Math.max(0.0, Math.min(1.0, 1.0 - (edgeAsymmetry * 0.40 + Math.abs(centroidOffset) * 0.60)));

  // -------------------------------------------------------------------------
  // 6. Pose Classification (Multi-Cue Evidence Model)
  // -------------------------------------------------------------------------
  // Independent geometric cues:
  // 1. Head silhouette / boundary asymmetry
  const cueSilLeft = profileAsymmetryRatio < 0.42 ? (0.42 - profileAsymmetryRatio) / 0.15 : 0;
  const cueSilRight = profileAsymmetryRatio > 0.58 ? (profileAsymmetryRatio - 0.58) / 0.15 : 0;

  // 2. Face centroid lateral offset
  const cueOffsetLeft = centroidOffset < -0.22 ? (-0.22 - centroidOffset) / 0.25 : 0;
  const cueOffsetRight = centroidOffset > 0.22 ? (centroidOffset - 0.22) / 0.25 : 0;

  // 3. Structural feature energy lateral concentration
  const cueEnergyLeft =
    hasStructuralEdges && energyOffset < -0.20 && energyRatioLeft > 0.60
      ? (energyRatioLeft - 0.60) / 0.25
      : 0;
  const cueEnergyRight =
    hasStructuralEdges && energyOffset > 0.20 && energyRatioLeft < 0.40
      ? (0.40 - energyRatioLeft) / 0.25
      : 0;

  // 4. Appearance consistency check:
  // If skin is reliable and well-illuminated, does skin centroid contradict profile?
  const skinOffset =
    isSkinReliable && skinPixelCount > 0
      ? (sumSkinX / skinPixelCount - headCenterX) / (headPixelW * 0.5)
      : 0;
  const skinContradictsProfile = isSkinReliable && Math.abs(skinOffset) < 0.12;

  // Multi-cue vote for 90-degree profile
  const leftEvidenceVotes = (cueSilLeft > 0.2 ? 1 : 0) + (cueOffsetLeft > 0.2 ? 1 : 0) + (cueEnergyLeft > 0.2 ? 1 : 0);
  const rightEvidenceVotes = (cueSilRight > 0.2 ? 1 : 0) + (cueOffsetRight > 0.2 ? 1 : 0) + (cueEnergyRight > 0.2 ? 1 : 0);

  const isLeftProfile =
    !skinContradictsProfile &&
    leftEvidenceVotes >= 2 &&
    (centroidOffset < -0.26 || energyOffset < -0.26);

  const isRightProfile =
    !skinContradictsProfile &&
    rightEvidenceVotes >= 2 &&
    (centroidOffset > 0.26 || energyOffset > 0.26);

  let pose: HeadPose;
  let visibleSide: LateralVisibility;

  if (isLeftProfile) {
    pose = 'left_profile';
    visibleSide = 'left_only';
  } else if (isRightProfile) {
    pose = 'right_profile';
    visibleSide = 'right_only';
  } else {
    // 3/4 Yaw detection: genuine partial asymmetry
    const isLeftThreeQuarter =
      centroidOffset < -FACE_PRIOR_CONFIG.THREE_QUARTER_ENERGY_OFFSET_THRESHOLD ||
      (hasStructuralEdges && (energyOffset < -FACE_PRIOR_CONFIG.THREE_QUARTER_ENERGY_OFFSET_THRESHOLD || energyRatioLeft > FACE_PRIOR_CONFIG.THREE_QUARTER_ENERGY_RATIO_THRESHOLD)) ||
      profileAsymmetryRatio < 0.44;

    const isRightThreeQuarter =
      centroidOffset > FACE_PRIOR_CONFIG.THREE_QUARTER_ENERGY_OFFSET_THRESHOLD ||
      (hasStructuralEdges && (energyOffset > FACE_PRIOR_CONFIG.THREE_QUARTER_ENERGY_OFFSET_THRESHOLD || energyRatioLeft < (1.0 - FACE_PRIOR_CONFIG.THREE_QUARTER_ENERGY_RATIO_THRESHOLD))) ||
      profileAsymmetryRatio > 0.56;

    if (isLeftThreeQuarter) {
      pose = 'three_quarter_left';
      visibleSide = 'both';
    } else if (isRightThreeQuarter) {
      pose = 'three_quarter_right';
      visibleSide = 'both';
    } else {
      pose = 'frontal';
      visibleSide = 'both';
    }
  }

  // -------------------------------------------------------------------------
  // 7. Evidence-Driven Confidence Formulation
  // -------------------------------------------------------------------------
  const evidenceClarity =
    pose === 'frontal'
      ? symmetryScore
      : Math.min(1.0, Math.abs(energyRatioLeft - 0.5) * 3.2);

  const poseConfidence = Math.max(
    0.35,
    Math.min(
      0.96,
      subject.confidence * 0.35 +
        evidenceClarity * 0.45 +
        (isChiaroscuro ? 0.05 : 0.20)
    )
  );

  const faceConfidence = Math.max(
    0.30,
    Math.min(
      0.97,
      subject.confidence * 0.35 +
        (isSkinReliable ? Math.min(1.0, skinToneCoverage * 2.5) * 0.35 : 0.20) +
        Math.min(1.0, avgHeadEdgeEnergy * 4.0) * 0.30
    )
  );

  const headAreaFraction =
    subject.pixelArea > 0 ? totalHeadFgPixels / subject.pixelArea : 0;

  // -------------------------------------------------------------------------
  // 8. Coordinate Normalization to [0.0 - 1.0]
  // -------------------------------------------------------------------------
  const headBoundingBox: BoundingBox = {
    x: Math.max(0, Math.min(1, headMinX / imgW)),
    y: Math.max(0, Math.min(1, firstFgY / imgH)),
    width: Math.max(0.001, Math.min(1, headPixelW / imgW)),
    height: Math.max(0.001, Math.min(1, headPixelH / imgH)),
  };

  const faceBoundingBox: BoundingBox = {
    x: Math.max(0, Math.min(1, faceBoxPixelX / imgW)),
    y: Math.max(0, Math.min(1, faceBoxPixelY / imgH)),
    width: Math.max(0.001, Math.min(1, faceBoxPixelW / imgW)),
    height: Math.max(0.001, Math.min(1, faceBoxPixelH / imgH)),
  };

  const center: Point2D = {
    x: Math.max(0, Math.min(1, faceCentroidX / imgW)),
    y: Math.max(0, Math.min(1, faceCentroidY / imgH)),
  };

  const diagnostics: FaceRegionDiagnostics = {
    symmetryScore: Number(symmetryScore.toFixed(3)),
    centroidOffset: Number(centroidOffset.toFixed(3)),
    headAreaFraction: Number(headAreaFraction.toFixed(3)),
    skinToneCoverage: Number(skinToneCoverage.toFixed(3)),
    edgeEnergy: Number(avgHeadEdgeEnergy.toFixed(3)),
    profileAsymmetryRatio: Number(profileAsymmetryRatio.toFixed(3)),
    illuminationAsymmetry: Number(illuminationAsymmetry.toFixed(3)),
    headSilhouetteAsymmetry: Number((distToLeft / (distToLeft + distToRight)).toFixed(3)),
  };

  return {
    subjectId: subject.id,
    headBoundingBox,
    faceBoundingBox,
    center,
    pose,
    poseConfidence: Number(poseConfidence.toFixed(3)),
    confidence: Number(faceConfidence.toFixed(3)),
    visibleSide,
    diagnostics,
  };
}

/**
 * Estimates face regions and head poses for all subject instances in a SegmentationResult.
 * Handles multi-person shots (e.g. BM-11) by evaluating each subject instance independently.
 *
 * @param segmentation Output from subject segmentation
 * @param image Normalized image container
 * @param gradients Gradient field
 * @returns Array of FaceRegionEstimate for all valid subject instances
 */
export function estimateAllFaceRegions(
  segmentation: SegmentationResult,
  image: NormalizedImage,
  gradients: GradientField
): FaceRegionEstimate[] {
  const estimates: FaceRegionEstimate[] = [];

  for (const instance of segmentation.instances) {
    const estimate = estimateFaceRegion(instance, segmentation.mask, image, gradients);
    if (estimate) {
      estimates.push(estimate);
    }
  }

  return estimates;
}
