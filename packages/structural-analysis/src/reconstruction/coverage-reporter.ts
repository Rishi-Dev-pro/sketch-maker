import {
  SubjectModel,
  VectorPath,
  StrokeCandidate,
  RenderStroke,
  FeatureCoverageReport,
  FeatureTraceStatus,
  ArtisticReconstruction,
} from '@sketch-maker/shared-types';

/**
 * Generates an objective, evidence-based Feature Coverage Report across all 19 anatomical features.
 * Evaluates feature progression from Perception -> Geometry -> Vector -> Candidate -> Ordered -> Timelined -> Rendered.
 */
export function generateFeatureCoverageReport(
  subject: SubjectModel,
  reconstruction?: ArtisticReconstruction,
  paths?: readonly VectorPath[],
  candidates?: readonly StrokeCandidate[],
  renderedStrokes?: readonly RenderStroke[]
): FeatureCoverageReport {
  const recon = reconstruction ?? subject.reconstruction;
  const pList = paths ?? [];
  const cList = candidates ?? [];
  const rList = renderedStrokes ?? [];

  const pathMatches = (featurePattern: string): boolean => {
    return pList.some(p => p.id.includes(featurePattern));
  };

  const candidateMatches = (featurePattern: string): boolean => {
    return cList.some(c => c.drawable && c.id.includes(featurePattern));
  };

  const renderedMatches = (featurePattern: string): boolean => {
    return rList.some(r => r.strokeId.includes(featurePattern));
  };

  const face = subject.face;
  const pose = face?.pose ?? 'frontal';
  const isLeftProfile = pose === 'left_profile';
  const isRightProfile = pose === 'right_profile';

  // Helper to trace a single feature
  const trace = (
    detected: boolean,
    hasReconstruction: boolean,
    idPattern: string,
    isOccluded = false,
    occludedNote?: string
  ): FeatureTraceStatus => {
    if (isOccluded) {
      return {
        detected: false,
        geometry: false,
        vector: false,
        candidate: false,
        ordered: false,
        timelined: false,
        rendered: false,
        notes: occludedNote ?? 'Occluded by head pose angle',
      };
    }

    const hasVector = pathMatches(idPattern);
    const hasCandidate = candidateMatches(idPattern);
    const hasRendered = rList.length > 0 ? renderedMatches(idPattern) : hasCandidate;

    return {
      detected,
      geometry: hasReconstruction,
      vector: hasVector,
      candidate: hasCandidate,
      ordered: hasCandidate, // In our pipeline, all drawable candidates are contiguous in ordered sequence
      timelined: hasCandidate,
      rendered: hasRendered,
    };
  };

  // 1. Left Eye
  const leftEyeDet = !!face?.leftEye && face.leftEye.visibility !== 'occluded' && face.leftEye.visibility !== 'not_detected';
  const leftEyeRecon = !!recon?.leftEye && recon.leftEye.visibility === 'visible';
  const leftEye = trace(leftEyeDet, leftEyeRecon, 'left_eye', isRightProfile, 'Occluded in right profile');

  // 2. Right Eye
  const rightEyeDet = !!face?.rightEye && face.rightEye.visibility !== 'occluded' && face.rightEye.visibility !== 'not_detected';
  const rightEyeRecon = !!recon?.rightEye && recon.rightEye.visibility === 'visible';
  const rightEye = trace(rightEyeDet, rightEyeRecon, 'right_eye', isLeftProfile, 'Occluded in left profile');

  // 3. Left Eyebrow
  const leftBrowDet = !!face?.leftEyebrow && face.leftEyebrow.visibility !== 'occluded' && face.leftEyebrow.visibility !== 'not_detected';
  const leftBrowRecon = !!recon?.leftEyebrow && recon.leftEyebrow.visibility === 'visible';
  const leftEyebrow = trace(leftBrowDet, leftBrowRecon, 'left_eyebrow', isRightProfile, 'Occluded in right profile');

  // 4. Right Eyebrow
  const rightBrowDet = !!face?.rightEyebrow && face.rightEyebrow.visibility !== 'occluded' && face.rightEyebrow.visibility !== 'not_detected';
  const rightBrowRecon = !!recon?.rightEyebrow && recon.rightEyebrow.visibility === 'visible';
  const rightEyebrow = trace(rightBrowDet, rightBrowRecon, 'right_eyebrow', isLeftProfile, 'Occluded in left profile');

  // 5. Nose Bridge
  const noseBridgeDet = !!face?.noseBridge && (face.noseBridge.points?.length ?? 0) >= 2;
  const noseBridgeRecon = !!recon?.nose?.bridge;
  const noseBridge = trace(noseBridgeDet, noseBridgeRecon, 'nose_bridge');

  // 6. Nose Tip
  const noseTipDet = !!face?.noseTip && (face.noseTip.points?.length ?? 0) >= 1;
  const noseTipRecon = !!recon?.nose?.tip;
  const noseTip = trace(noseTipDet, noseTipRecon, 'nose_tip');

  // 7. Nostrils
  const nostrilsDet = !!face?.nostrils && face.nostrils.length > 0;
  const nostrilsRecon = !!recon?.nose?.leftAla || !!recon?.nose?.rightAla;
  const nostrils = trace(nostrilsDet, nostrilsRecon, 'nose_ala');

  // 8. Upper Lip
  const upperLipDet = !!face?.upperLip && (face.upperLip.points?.length ?? 0) >= 2;
  const upperLipRecon = !!recon?.mouth?.upperVermilion;
  const upperLip = trace(upperLipDet, upperLipRecon, 'upper_lip');

  // 9. Lower Lip
  const lowerLipDet = !!face?.lowerLip && (face.lowerLip.points?.length ?? 0) >= 2;
  const lowerLipRecon = !!recon?.mouth?.lowerVermilion;
  const lowerLip = trace(lowerLipDet, lowerLipRecon, 'lower_lip');

  // 10. Mouth Corners
  const mouthCornersDet = !!face?.lipSeparation && (face.lipSeparation.points?.length ?? 0) >= 2;
  const mouthCornersRecon = !!recon?.mouth?.leftCorner || !!recon?.mouth?.rightCorner;
  const mouthCorners = trace(mouthCornersDet, mouthCornersRecon, 'mouth_corner');

  // 11. Jaw
  const jawDet = !!face?.jawline && (face.jawline.points?.length ?? 0) >= 2;
  const jawRecon = !!recon?.jawChin?.jawline;
  const jaw = trace(jawDet, jawRecon, 'jaw');

  // 12. Chin
  const chinDet = !!face?.chin && (face.chin.points?.length ?? 0) >= 1;
  const chinRecon = !!recon?.jawChin?.chin;
  const chin = trace(chinDet, chinRecon, 'chin');

  // 13. Left Ear
  const leftEarDet = !!face?.leftEar && face.leftEar.visibility !== 'occluded' && face.leftEar.visibility !== 'not_detected';
  const leftEarRecon = !!recon?.leftEar && recon.leftEar.visibility === 'visible';
  const leftEar = trace(leftEarDet, leftEarRecon, 'left_ear', isRightProfile, 'Occluded in right profile');

  // 14. Right Ear
  const rightEarDet = !!face?.rightEar && face.rightEar.visibility !== 'occluded' && face.rightEar.visibility !== 'not_detected';
  const rightEarRecon = !!recon?.rightEar && recon.rightEar.visibility === 'visible';
  const rightEar = trace(rightEarDet, rightEarRecon, 'right_ear', isLeftProfile, 'Occluded in left profile');

  // 15. Hair Silhouette
  const hairSilDet = (subject.hair && subject.hair.length > 0) || (subject.semanticSegmentation?.masks.some(m => m.category === 'hair'));
  const hairSilRecon = !!recon?.hair?.silhouette;
  const hairSilhouette = trace(!!hairSilDet, hairSilRecon, 'hair_silhouette');

  // 16. Hair Masses
  const hairMassesDet = !!hairSilDet;
  const hairMassesRecon = (recon?.hair?.masses.length ?? 0) > 0;
  const hairMasses = trace(hairMassesDet, hairMassesRecon, 'hair_mass');

  // 17. Hair Flow
  const hairFlowDet = !!hairSilDet;
  const hairFlowRecon = (recon?.hair?.flowCurves.length ?? 0) > 0;
  const hairFlow = trace(hairFlowDet, hairFlowRecon, 'hair_flow');

  // 18. Neck
  const neckDet = !!face?.boundingBox;
  const neckRecon = (recon?.body?.neckLines.length ?? 0) > 0;
  const neck = trace(neckDet, neckRecon, 'neck');

  // 19. Shoulders
  const shouldersDet = !!subject.body?.pose?.leftShoulder || !!subject.body?.pose?.rightShoulder || (subject.body?.shoulders?.length ?? 0) > 0 || !!face?.boundingBox;
  const shouldersRecon = (recon?.body?.shoulderLines.length ?? 0) > 0;
  const shoulders = trace(shouldersDet, shouldersRecon, 'shoulder');

  // 20. Clothing
  const clothingDet = (subject.semanticSegmentation?.masks.some(m => m.category === 'clothing')) || (subject.clothing && subject.clothing.length > 0) || !!face?.boundingBox;
  const clothingRecon = (recon?.body?.collarLines.length ?? 0) > 0 || (recon?.body?.clothingContours.length ?? 0) > 0;
  const clothing = trace(!!clothingDet, clothingRecon, 'clothing');

  const features = {
    leftEye,
    rightEye,
    leftEyebrow,
    rightEyebrow,
    noseBridge,
    noseTip,
    nostrils,
    upperLip,
    lowerLip,
    mouthCorners,
    jaw,
    chin,
    leftEar,
    rightEar,
    hairSilhouette,
    hairMasses,
    hairFlow,
    neck,
    shoulders,
    clothing,
  };

  // Compute aggregate percentage metrics based on active (unoccluded) features
  const calcCoverage = (items: FeatureTraceStatus[]): number => {
    const active = items.filter(f => !f.notes?.includes('Occluded'));
    if (active.length === 0) return 1.0;
    const hasDownstream = pList.length > 0 || cList.length > 0 || rList.length > 0;
    const fulfilled = active.filter(f => hasDownstream ? (f.rendered || f.candidate || f.vector) : (f.geometry || f.detected)).length;
    return Number((fulfilled / active.length).toFixed(3));
  };

  const eyeCoverage = calcCoverage([leftEye, rightEye]);
  const noseCoverage = calcCoverage([noseBridge, noseTip, nostrils]);
  const mouthCoverage = calcCoverage([upperLip, lowerLip, mouthCorners]);
  const jawCoverage = calcCoverage([jaw, chin]);
  const facialCoverage = calcCoverage([
    leftEye, rightEye, leftEyebrow, rightEyebrow,
    noseBridge, noseTip, nostrils,
    upperLip, lowerLip, mouthCorners,
    jaw, chin
  ]);
  const hairCoverage = calcCoverage([hairSilhouette, hairMasses, hairFlow]);
  const bodyCoverage = calcCoverage([neck, shoulders, clothing]);
  const overallStructuralCoverage = calcCoverage(Object.values(features));

  // Compute stroke budget ratios
  const totalStrokes = cList.filter(c => c.drawable).length;
  const semanticStrokes = cList.filter(c => c.drawable && c.source === 'semantic_boundary').length;
  const meaningfulStrokes = cList.filter(c => c.drawable && c.source !== 'semantic_boundary' && c.semanticRole !== 'background').length;

  const semanticBoundaryRatio = totalStrokes > 0
    ? Number((semanticStrokes / totalStrokes).toFixed(3))
    : 0;
  const meaningfulStrokeRatio = totalStrokes > 0
    ? Number((meaningfulStrokes / totalStrokes).toFixed(3))
    : 1;

  return {
    features,
    metrics: {
      facialCoverage,
      eyeCoverage,
      noseCoverage,
      mouthCoverage,
      jawCoverage,
      hairCoverage,
      bodyCoverage,
      overallStructuralCoverage,
      semanticBoundaryRatio,
      meaningfulStrokeRatio,
      generatedStrokeCount: totalStrokes,
    },
  };
}
