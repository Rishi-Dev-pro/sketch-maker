import {
  SubjectModel,
  ContourPath,
  ArtisticReconstruction,
  HeadPose,
  TonalRegion,
  TonalField,
} from '@sketch-maker/shared-types';
import { LuminanceBuffer, extractMaskContours } from '@sketch-maker/image-processing';
import {
  reconstructEye,
  reconstructEyebrow,
  reconstructNose,
  reconstructMouth,
  reconstructJawChin,
  reconstructEar,
} from './face-reconstructor';
import { reconstructHair } from './hair-reconstructor';
import { reconstructBody } from './body-reconstructor';
import {
  analyzeSubjectTonalRegions,
  analyzeSubjectTonalFields,
  generateSubjectShadingStrokes,
  evaluateTonalDiagnostics,
} from '../tonal';
import { buildSubjectStructuralModel } from '../silhouette';

export * from './face-reconstructor';
export * from './hair-reconstructor';
export * from './body-reconstructor';
export * from './semantic-boundary-filter';
export * from './coverage-reporter';
export * from '../tonal';
export * from '../silhouette';

/**
 * Executes the complete Feature Reconstruction and Artistic Interpretation layer
 * on a raw perception SubjectModel.
 *
 * Enforces the core architectural principle:
 * "Segmentation is the authoritative outer structural anchor;
 *  MediaPipe Face is inner facial anatomy;
 *  MediaPipe Pose is body geometry constrained by segmentation."
 */
export function reconstructSubjectFeatures(
  subject: SubjectModel,
  luminance?: LuminanceBuffer
): ArtisticReconstruction {
  const subjectId = subject.id;
  const face = subject.face;
  const pose: HeadPose = face?.pose ?? 'frontal';
  const confidence = Math.max(0.75, subject.globalConfidence ?? 0.85);

  const allReconstructedPaths: ContourPath[] = [];

  // 0. Build Authoritative Subject Structural Model & Clean Silhouette (TASK-114)
  const {
    structuralModel,
    authoritativeSilhouette,
    hairBoundary,
    clothingBoundary,
  } = buildSubjectStructuralModel(subject);

  // Authoritative Outer Subject Silhouette MUST be the foundational contour (Phase 0 Foundation)
  if (authoritativeSilhouette && authoritativeSilhouette.points.length >= 4) {
    allReconstructedPaths.push(authoritativeSilhouette);
  }
  if (hairBoundary && hairBoundary.points.length >= 4) {
    allReconstructedPaths.push(hairBoundary);
  }
  if (clothingBoundary && clothingBoundary.points.length >= 4) {
    allReconstructedPaths.push(clothingBoundary);
  }

  // 1. Reconstruct Eyes (Smooth, continuous eyelids, crease, and circular iris/pupil)
  const leftEye = reconstructEye(face?.leftEye, 'left', pose, confidence, subjectId);
  if (leftEye && leftEye.visibility === 'visible') {
    allReconstructedPaths.push(leftEye.upperLid, leftEye.lowerLid);
    if (leftEye.upperCrease) allReconstructedPaths.push(leftEye.upperCrease);
    if (leftEye.irisContour) allReconstructedPaths.push(leftEye.irisContour);
    if (leftEye.pupilContour) allReconstructedPaths.push(leftEye.pupilContour);
  }

  const rightEye = reconstructEye(face?.rightEye, 'right', pose, confidence, subjectId);
  if (rightEye && rightEye.visibility === 'visible') {
    allReconstructedPaths.push(rightEye.upperLid, rightEye.lowerLid);
    if (rightEye.upperCrease) allReconstructedPaths.push(rightEye.upperCrease);
    if (rightEye.irisContour) allReconstructedPaths.push(rightEye.irisContour);
    if (rightEye.pupilContour) allReconstructedPaths.push(rightEye.pupilContour);
  }

  // 2. Reconstruct Eyebrows: Natural flowing arch and directional hair strokes
  const leftEyebrow = reconstructEyebrow(face?.leftEyebrow, 'left', pose, confidence, subjectId);
  if (leftEyebrow && leftEyebrow.visibility === 'visible') {
    allReconstructedPaths.push(leftEyebrow.arch);
    if (leftEyebrow.hairStrokes) {
      leftEyebrow.hairStrokes.forEach(h => allReconstructedPaths.push(h));
    }
  }

  const rightEyebrow = reconstructEyebrow(face?.rightEyebrow, 'right', pose, confidence, subjectId);
  if (rightEyebrow && rightEyebrow.visibility === 'visible') {
    allReconstructedPaths.push(rightEyebrow.arch);
    if (rightEyebrow.hairStrokes) {
      rightEyebrow.hairStrokes.forEach(h => allReconstructedPaths.push(h));
    }
  }

  // 3. Reconstruct Nose
  const nose = reconstructNose(
    face?.noseBridge,
    face?.noseTip,
    face?.nostrils,
    pose,
    confidence,
    subjectId,
    face?.columella,
    face?.subnasale
  );
  if (nose && nose.visibility === 'visible') {
    // In frontal portraits, nose bridge has no hard edge; it is modeled by soft tonal shading
    if (pose !== 'frontal') {
      allReconstructedPaths.push(nose.bridge);
    }
    allReconstructedPaths.push(nose.tip);
    if (nose.underside) allReconstructedPaths.push(nose.underside);
    if (nose.columella && (!nose.underside || nose.columella.id !== nose.underside.id)) allReconstructedPaths.push(nose.columella);
    if (nose.subnasale) allReconstructedPaths.push(nose.subnasale);
    if (nose.leftAla) allReconstructedPaths.push(nose.leftAla);
    if (nose.rightAla) allReconstructedPaths.push(nose.rightAla);
    if (nose.leftNostril) allReconstructedPaths.push(nose.leftNostril);
    if (nose.rightNostril) allReconstructedPaths.push(nose.rightNostril);
  }

  // 4. Reconstruct Mouth
  const mouth = reconstructMouth(
    face?.upperLip,
    face?.lowerLip,
    face?.lipSeparation,
    pose,
    confidence,
    subjectId,
    face?.philtrum
  );
  if (mouth && mouth.visibility === 'visible') {
    allReconstructedPaths.push(mouth.oralFissure);
    if (mouth.leftCorner) allReconstructedPaths.push(mouth.leftCorner);
    if (mouth.rightCorner) allReconstructedPaths.push(mouth.rightCorner);
    if (mouth.upperVermilion) allReconstructedPaths.push(mouth.upperVermilion);
    if (mouth.lowerVermilion) allReconstructedPaths.push(mouth.lowerVermilion);
    if (mouth.mentalCrease) allReconstructedPaths.push(mouth.mentalCrease);
    if (mouth.philtrum) {
      mouth.philtrum.forEach(p => allReconstructedPaths.push(p));
    }
  }

  // 5. Reconstruct Jawline & Chin
  const jawChin = reconstructJawChin(
    face?.jawline,
    face?.chin,
    pose,
    confidence,
    subjectId,
    face?.malarPlanes
  );
  if (jawChin && jawChin.visibility === 'visible') {
    allReconstructedPaths.push(jawChin.jawline);
    // Only push separate chin dome if jawline points are sparse
    if (jawChin.jawline.points.length < 5 && jawChin.chin) {
      allReconstructedPaths.push(jawChin.chin);
    }
    if (jawChin.profileContour) allReconstructedPaths.push(jawChin.profileContour);
    // Malar cheek planes are preserved on jawChin for shading analysis,
    // but omitted from hard contour paths to prevent unnatural facial scars.
  }

  // 6. Reconstruct Ears
  const leftEar = reconstructEar(face?.leftEar, 'left', pose, confidence, subjectId);
  if (leftEar && leftEar.visibility === 'visible') {
    allReconstructedPaths.push(leftEar.helix);
    if (leftEar.concha) allReconstructedPaths.push(leftEar.concha);
  }

  const rightEar = reconstructEar(face?.rightEar, 'right', pose, confidence, subjectId);
  if (rightEar && rightEar.visibility === 'visible') {
    allReconstructedPaths.push(rightEar.helix);
    if (rightEar.concha) allReconstructedPaths.push(rightEar.concha);
  }

  // 7. Reconstruct Hair (incorporating neural semantic hair mask contours when present)
  const masks = subject.semanticSegmentation?.masks;
  const hairMask = Array.isArray(masks)
    ? masks.find(m => m.category === 'hair')
    : (masks as any)?.hair;
  const hairMaskLoops = hairMask ? extractMaskContours(hairMask, 2, 35) : undefined;
  const hair = reconstructHair(subject.hair, hairMaskLoops, face?.boundingBox, pose, confidence, subjectId);
  if (hair && hair.visibility === 'visible') {
    if (hair.silhouette) allReconstructedPaths.push(hair.silhouette);
    if (hair.hairline) allReconstructedPaths.push(hair.hairline);
    hair.masses.forEach(m => allReconstructedPaths.push(m));
    hair.flowCurves.forEach(f => allReconstructedPaths.push(f));
    if (hair.strandGroups) {
      hair.strandGroups.forEach(s => allReconstructedPaths.push(s));
    }
  }

  // 8. Reconstruct Body & Neck (incorporating neural semantic clothing contours when present)
  const clothingMask = Array.isArray(masks)
    ? (masks.find(m => m.category === 'clothing') ?? masks.find(m => m.category === 'body_skin'))
    : ((masks as any)?.clothing ?? (masks as any)?.body);
  const clothingMaskLoops = clothingMask ? extractMaskContours(clothingMask, 2, 45) : undefined;
  const chinPt = jawChin?.chin.points[Math.floor(jawChin.chin.points.length / 2)];
  const body = reconstructBody(subject.body, face?.boundingBox, chinPt, pose, confidence, subjectId, clothingMaskLoops);
  body.neckLines.forEach(n => allReconstructedPaths.push(n));
  body.shoulderLines.forEach(s => allReconstructedPaths.push(s));
  body.collarLines.forEach(c => allReconstructedPaths.push(c));
  if (body.clothingContours) {
    body.clothingContours.forEach(cl => allReconstructedPaths.push(cl));
  }

  // 9. Photographic Tonal Analysis & Continuous 2D TonalField Engine (TASK-113)
  const tonalRegions: TonalRegion[] = analyzeSubjectTonalRegions(luminance, subject);
  const tonalFields: TonalField[] = analyzeSubjectTonalFields(luminance, subject);

  // Generate multi-scale form-following graphite shading strokes
  const shadingStrokes: ContourPath[] = generateSubjectShadingStrokes(tonalRegions, tonalFields);
  const hairMassStrokes: ContourPath[] = shadingStrokes.filter(s => s.id.includes('hair_mass'));
  const clothingMassStrokes: ContourPath[] = shadingStrokes.filter(s => s.id.includes('clothing_mass'));

  shadingStrokes.forEach(s => allReconstructedPaths.push(s));

  return {
    subjectId,
    pose,
    leftEye,
    rightEye,
    leftEyebrow,
    rightEyebrow,
    nose,
    mouth,
    jawChin,
    leftEar,
    rightEar,
    hair,
    body,
    tonalRegions,
    tonalFields,
    shadingStrokes,
    hairMassStrokes,
    clothingMassStrokes,
    authoritativeSilhouette,
    structuralModel,
    allReconstructedPaths,
    confidence,
    timestamp: Date.now(),
  };
}

/**
 * Enriches a SubjectModel with its reconstructed artistic features.
 */
export function enrichSubjectWithReconstruction(
  subject: SubjectModel,
  luminance?: LuminanceBuffer
): SubjectModel {
  const reconstruction = reconstructSubjectFeatures(subject, luminance);
  return {
    ...subject,
    silhouette: reconstruction.authoritativeSilhouette
      ? [reconstruction.authoritativeSilhouette]
      : subject.silhouette,
    reconstruction,
  };
}
