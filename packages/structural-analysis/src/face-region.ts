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
 * Heuristic anthropometric search constants.
 * Note: Used solely as INITIAL SEARCH PRIORS; image evidence dynamically overrides priors.
 */
export const FACE_PRIOR_CONFIG = {
  /** Minimum head height as a fraction of full-body subject height */
  MIN_HEAD_HEIGHT_FRACTION: 0.12,
  /** Maximum head height as a fraction of portrait subject height */
  MAX_HEAD_HEIGHT_FRACTION: 0.85,
  /** Default head height fraction when neck constriction is indistinct */
  DEFAULT_PORTRAIT_HEAD_FRACTION: 0.60,
  DEFAULT_BODY_HEAD_FRACTION: 0.22,
  /** Threshold width expansion ratio to identify shoulders */
  SHOULDER_EXPANSION_RATIO: 1.35,
  /** Centroid offset threshold for 90-degree profile classification */
  PROFILE_CENTROID_OFFSET_THRESHOLD: 0.28,
  /** Centroid offset threshold for 3/4 yaw classification */
  THREE_QUARTER_CENTROID_OFFSET_THRESHOLD: 0.12,
  /** Boundary distance asymmetry ratio thresholds (0.5 = perfectly symmetric) */
  PROFILE_ASYMMETRY_MIN: 0.34,
  PROFILE_ASYMMETRY_MAX: 0.66,
  THREE_QUARTER_ASYMMETRY_MIN: 0.44,
  THREE_QUARTER_ASYMMETRY_MAX: 0.56,
} as const;

/**
 * Isolates the head and facial feature bounding regions and estimates head pose
 * orientation for a single subject instance.
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
  const gradMag = gradients.magnitude;

  // -------------------------------------------------------------------------
  // 1. Scanline Foreground Mass Profiling
  // -------------------------------------------------------------------------
  const rowStart = Math.max(0, pBox.y);
  const rowEnd = Math.min(imgH - 1, pBox.y + pBox.height - 1);
  const colStart = Math.max(0, pBox.x);
  const colEnd = Math.min(imgW - 1, pBox.x + pBox.width - 1);

  const rowWidths = new Int32Array(rowEnd - rowStart + 1);
  const rowMinX = new Int32Array(rowEnd - rowStart + 1);
  const rowMaxX = new Int32Array(rowEnd - rowStart + 1);

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
  // 2. Head Region Boundary Isolation
  // -------------------------------------------------------------------------
  // Search for neck constriction or shoulder expansion
  let headBottomY = -1;
  const maxSearchRows = Math.floor(
    subjectHeight * (isFullOrStandingBody ? FACE_PRIOR_CONFIG.DEFAULT_BODY_HEAD_FRACTION * 1.6 : FACE_PRIOR_CONFIG.MAX_HEAD_HEIGHT_FRACTION)
  );

  let peakHeadWidth = 0;
  let peakHeadY = firstFgY;
  const startOffset = firstFgY - rowStart;

  // Find peak width in upper 25% of candidate head
  const upperHeadLimit = Math.min(rowWidths.length - 1, startOffset + Math.floor(maxSearchRows * 0.5));
  for (let i = startOffset; i <= upperHeadLimit; i++) {
    if (rowWidths[i] > peakHeadWidth) {
      peakHeadWidth = rowWidths[i];
      peakHeadY = rowStart + i;
    }
  }

  // Look for neck pinch / shoulder expansion below cranium peak
  let minNeckWidth = peakHeadWidth;
  let minNeckY = peakHeadY;
  const searchEndIdx = Math.min(rowWidths.length - 1, startOffset + maxSearchRows);

  for (let i = peakHeadY - rowStart + 1; i <= searchEndIdx; i++) {
    const w = rowWidths[i];
    if (w > 0 && w < minNeckWidth) {
      minNeckWidth = w;
      minNeckY = rowStart + i;
    } else if (w > minNeckWidth * FACE_PRIOR_CONFIG.SHOULDER_EXPANSION_RATIO && (rowStart + i) - minNeckY >= 8) {
      // Clear shoulder expansion detected!
      headBottomY = minNeckY;
      break;
    }
  }

  // Fallback head height if no abrupt shoulder jump is found
  if (headBottomY === -1) {
    const fallbackFraction = isFullOrStandingBody
      ? FACE_PRIOR_CONFIG.DEFAULT_BODY_HEAD_FRACTION
      : FACE_PRIOR_CONFIG.DEFAULT_PORTRAIT_HEAD_FRACTION;
    headBottomY = Math.min(lastFgY, firstFgY + Math.floor(subjectHeight * fallbackFraction));
  }

  // Calculate head horizontal envelope
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

  // -------------------------------------------------------------------------
  // 3. Facial Feature Zone & Skin Chrominance Extraction
  // -------------------------------------------------------------------------
  let skinPixelCount = 0;
  let totalHeadFgPixels = 0;
  let sumFaceX = 0;
  let sumFaceY = 0;
  let faceMinX = headMaxX;
  let faceMaxX = headMinX;
  let faceMinY = headBottomY;
  let faceMaxY = firstFgY;
  let sumEdgeEnergy = 0;

  const minSkinIntensity = image.stats.mean < 60 ? 45 : 110;

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

        const rNorm = R / intensity;
        const gNorm = G / intensity;

        // Human skin chrominance heuristic across Fitzpatrick types I-VI
        // Intensity floor separates skin from dark hair and cast shadows
        const isSkin =
          intensity >= minSkinIntensity &&
          R >= G &&
          G >= B * 0.80 &&
          rNorm >= 0.33 &&
          rNorm <= 0.62 &&
          gNorm >= 0.24 &&
          gNorm <= 0.40 &&
          rNorm - gNorm >= 0.02;

        if (isSkin) {
          skinPixelCount++;
          sumFaceX += x;
          sumFaceY += y;
          if (x < faceMinX) faceMinX = x;
          if (x > faceMaxX) faceMaxX = x;
          if (y < faceMinY) faceMinY = y;
          if (y > faceMaxY) faceMaxY = y;
        }

        sumEdgeEnergy += gradMag[pIdx];
      }
    }
  }

  const skinToneCoverage = totalHeadFgPixels > 0 ? skinPixelCount / totalHeadFgPixels : 0;
  const avgHeadEdgeEnergy = totalHeadFgPixels > 0 ? sumEdgeEnergy / totalHeadFgPixels : 0;

  // Facial feature zone bounding box
  let faceBoxPixelX: number;
  let faceBoxPixelY: number;
  let faceBoxPixelW: number;
  let faceBoxPixelH: number;
  let faceCentroidX: number;
  let faceCentroidY: number;

  if (skinPixelCount > 30 && faceMinX < faceMaxX && faceMinY < faceMaxY) {
    // Skin evidence informed face box
    faceCentroidX = sumFaceX / skinPixelCount;
    faceCentroidY = sumFaceY / skinPixelCount;
    faceBoxPixelX = faceMinX;
    faceBoxPixelY = faceMinY;
    faceBoxPixelW = faceMaxX - faceMinX + 1;
    faceBoxPixelH = faceMaxY - faceMinY + 1;
  } else {
    // Anthropometric prior fallback if skin chrominance is muted or extreme lighting
    faceCentroidX = headMinX + headPixelW * 0.5;
    faceCentroidY = firstFgY + headPixelH * 0.55;
    faceBoxPixelX = Math.floor(headMinX + headPixelW * 0.15);
    faceBoxPixelY = Math.floor(firstFgY + headPixelH * 0.22);
    faceBoxPixelW = Math.max(8, Math.floor(headPixelW * 0.70));
    faceBoxPixelH = Math.max(8, Math.floor(headPixelH * 0.65));
  }

  // -------------------------------------------------------------------------
  // 4. Bilateral Symmetry & Pose Asymmetry Analysis
  // -------------------------------------------------------------------------
  const headCenterX = headMinX + headPixelW * 0.5;
  const centroidOffset = headPixelW > 0 ? (faceCentroidX - headCenterX) / (headPixelW * 0.5) : 0;

  // Distance from face centroid to left and right silhouette bounds
  const distToLeft = Math.max(1, faceCentroidX - headMinX);
  const distToRight = Math.max(1, headMaxX - faceCentroidX);
  const profileAsymmetryRatio = distToLeft / (distToLeft + distToRight);

  // Gradient energy symmetry split across face vertical axis
  let leftEnergy = 0;
  let rightEnergy = 0;
  let leftCount = 0;
  let rightCount = 0;
  const splitX = Math.floor(faceCentroidX);

  for (let y = Math.floor(faceBoxPixelY); y < faceBoxPixelY + faceBoxPixelH; y++) {
    const rowOffset = y * imgW;
    for (let x = Math.floor(faceBoxPixelX); x < faceBoxPixelX + faceBoxPixelW; x++) {
      const pIdx = rowOffset + x;
      if (x < splitX) {
        leftEnergy += gradMag[pIdx];
        leftCount++;
      } else {
        rightEnergy += gradMag[pIdx];
        rightCount++;
      }
    }
  }

  const avgLeftEnergy = leftCount > 0 ? leftEnergy / leftCount : 0;
  const avgRightEnergy = rightCount > 0 ? rightEnergy / rightCount : 0;
  const maxSideEnergy = Math.max(avgLeftEnergy, avgRightEnergy);
  const gradientAsymmetry = maxSideEnergy > 0.02
    ? Math.abs(avgLeftEnergy - avgRightEnergy) / maxSideEnergy
    : 0.0;

  const symmetryScore = Math.max(
    0.0,
    Math.min(1.0, 1.0 - (gradientAsymmetry * 0.4 + Math.abs(centroidOffset) * 0.6))
  );

  // -------------------------------------------------------------------------
  // 5. Head Pose Classification
  // -------------------------------------------------------------------------
  let pose: HeadPose;
  let visibleSide: LateralVisibility;

  if (
    centroidOffset < -FACE_PRIOR_CONFIG.PROFILE_CENTROID_OFFSET_THRESHOLD ||
    profileAsymmetryRatio < FACE_PRIOR_CONFIG.PROFILE_ASYMMETRY_MIN
  ) {
    // Subject facing camera left (e.g. BM-02)
    pose = 'left_profile';
    visibleSide = 'left_only';
  } else if (
    centroidOffset > FACE_PRIOR_CONFIG.PROFILE_CENTROID_OFFSET_THRESHOLD ||
    profileAsymmetryRatio > FACE_PRIOR_CONFIG.PROFILE_ASYMMETRY_MAX
  ) {
    // Subject facing camera right
    pose = 'right_profile';
    visibleSide = 'right_only';
  } else if (
    centroidOffset < -FACE_PRIOR_CONFIG.THREE_QUARTER_CENTROID_OFFSET_THRESHOLD ||
    profileAsymmetryRatio < FACE_PRIOR_CONFIG.THREE_QUARTER_ASYMMETRY_MIN
  ) {
    pose = 'three_quarter_left';
    visibleSide = 'both';
  } else if (
    centroidOffset > FACE_PRIOR_CONFIG.THREE_QUARTER_CENTROID_OFFSET_THRESHOLD ||
    profileAsymmetryRatio > FACE_PRIOR_CONFIG.THREE_QUARTER_ASYMMETRY_MAX
  ) {
    pose = 'three_quarter_right';
    visibleSide = 'both';
  } else {
    pose = 'frontal';
    visibleSide = 'both';
  }

  // -------------------------------------------------------------------------
  // 6. Evidence-Driven Confidence Formulation
  // -------------------------------------------------------------------------
  // Symmetry clarity metric
  const symmetryClarity =
    pose === 'frontal'
      ? symmetryScore
      : Math.min(1.0, Math.abs(profileAsymmetryRatio - 0.5) * 2.8);

  const poseConfidence = Math.max(
    0.35,
    Math.min(
      0.96,
      subject.confidence * 0.40 +
        symmetryClarity * 0.35 +
        Math.min(1.0, skinToneCoverage * 2.5) * 0.25
    )
  );

  const faceConfidence = Math.max(
    0.30,
    Math.min(
      0.97,
      subject.confidence * 0.35 +
        Math.min(1.0, skinToneCoverage * 3.0) * 0.35 +
        Math.min(1.0, avgHeadEdgeEnergy * 4.0) * 0.30
    )
  );

  const headAreaFraction =
    subject.pixelArea > 0 ? totalHeadFgPixels / subject.pixelArea : 0;

  // -------------------------------------------------------------------------
  // 7. Coordinate Normalization to [0.0 - 1.0]
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
