/**
 * Structural Model & Fusion Engine (TASK-114)
 *
 * Implements the Structural Model fusing:
 * 1. Segmentation -> Outer Silhouette & Semantic Spatial Ownership
 * 2. MediaPipe Face -> Inner Facial Anatomy
 * 3. MediaPipe Pose -> Body Geometry (constrained by segmentation)
 *
 * Enforces the Responsibility Matrix:
 * - Hair outer silhouette: Segmentation
 * - Head outer silhouette: Segmentation
 * - Face internal anatomy: MediaPipe Face
 * - Neck & Shoulders: Segmentation + Pose
 * - Torso & Clothing: Segmentation
 */

import {
  SubjectModel,
  ContourPath,
  StructuralModel,
  SubjectStructure,
  RegionMask,
  FacialFeatures,
  BodyFeatures,
  SemanticMask,
} from '@sketch-maker/shared-types';
import { cleanSubjectSegmentation } from './clean-segmentation';
import { extractAuthoritativeSilhouette } from './authoritative-silhouette';
import { isPointInMask } from './spatial-ownership';

/**
 * Builds a complete StructuralModel for a SubjectModel, establishing segmentation
 * as the authoritative outer structural anchor and MediaPipe landmarks as inner anatomy.
 */
export function buildSubjectStructuralModel(
  subject: SubjectModel,
  segmentationMasks?: readonly SemanticMask[]
): {
  structuralModel: StructuralModel;
  authoritativeSilhouette: ContourPath;
  hairBoundary?: ContourPath;
  clothingBoundary?: ContourPath;
} {
  const subjectId = subject.id;
  const masks = segmentationMasks ?? subject.semanticSegmentation?.masks;

  // 1. Identify or synthesize raw foreground mask
  let rawForegroundMask: Uint8Array | undefined;
  let maskWidth = 256;
  let maskHeight = 256;

  if (masks && masks.length > 0) {
    maskWidth = masks[0].width;
    maskHeight = masks[0].height;
    const totalPixels = maskWidth * maskHeight;
    rawForegroundMask = new Uint8Array(totalPixels);

    for (const m of masks) {
      if (m.category === 'background' || m.category === 'unknown') continue;
      for (let i = 0; i < totalPixels; i++) {
        if (m.data[i] > 0) {
          rawForegroundMask[i] = 255;
        }
      }
    }
  }

  // 2. If no semantic masks, synthesize from subject bounding box and silhouette if present
  if (!rawForegroundMask) {
    const totalPixels = maskWidth * maskHeight;
    rawForegroundMask = new Uint8Array(totalPixels);
    const box = subject.boundingBox ?? { x: 0.15, y: 0.1, width: 0.7, height: 0.85 };
    const minX = Math.floor(box.x * maskWidth);
    const maxX = Math.ceil((box.x + box.width) * maskWidth);
    const minY = Math.floor(box.y * maskHeight);
    const maxY = Math.ceil((box.y + box.height) * maskHeight);

    for (let y = minY; y <= maxY && y < maskHeight; y++) {
      const row = y * maskWidth;
      for (let x = minX; x <= maxX && x < maskWidth; x++) {
        rawForegroundMask[row + x] = 255;
      }
    }
  }

  // 3. Clean segmentation: eliminate side artifacts, fill pinholes, smooth boundaries
  const faceBox = subject.face?.boundingBox ?? subject.boundingBox;
  const poseAnchor = subject.body?.pose?.neck?.point ?? subject.body?.pose?.leftShoulder?.point;

  const cleanResult = cleanSubjectSegmentation(
    rawForegroundMask,
    maskWidth,
    maskHeight,
    {
      minAreaFraction: 0.02,
      minAbsolutePixels: 80,
      closingRadius: 2,
      openingRadius: 1,
    },
    faceBox,
    poseAnchor
  );

  // 4. Extract smoothed authoritative silhouette
  const { authoritativeSilhouette, hairBoundary, clothingBoundary } = extractAuthoritativeSilhouette(
    cleanResult.cleanMask,
    maskWidth,
    maskHeight,
    subjectId,
    {
      simplificationTolerance: 0.0018,
      smoothingPasses: 2,
    },
    masks
  );

  // 5. Build semantic region masks
  const regions: { hair?: RegionMask; face?: RegionMask; clothing?: RegionMask; neck?: RegionMask; torso?: RegionMask } = {};
  if (masks) {
    const hairMask = masks.find(m => m.category === 'hair');
    if (hairMask) {
      regions.hair = {
        category: 'hair',
        bounds: hairMask.boundingBox ?? subject.boundingBox,
        data: hairMask.data,
        width: hairMask.width,
        height: hairMask.height,
        confidence: hairMask.confidence,
        pixelArea: hairMask.pixelArea,
      };
    }

    const faceSkinMask = masks.find(m => m.category === 'face_skin');
    if (faceSkinMask) {
      regions.face = {
        category: 'face',
        bounds: faceSkinMask.boundingBox ?? faceBox,
        data: faceSkinMask.data,
        width: faceSkinMask.width,
        height: faceSkinMask.height,
        confidence: faceSkinMask.confidence,
        pixelArea: faceSkinMask.pixelArea,
      };
    }

    const clothingMask = masks.find(m => m.category === 'clothing');
    if (clothingMask) {
      regions.clothing = {
        category: 'clothing',
        bounds: clothingMask.boundingBox ?? subject.boundingBox,
        data: clothingMask.data,
        width: clothingMask.width,
        height: clothingMask.height,
        confidence: clothingMask.confidence,
        pixelArea: clothingMask.pixelArea,
      };
    }
  }

  // 6. Constrain Pose Landmarks to Subject Mask (Section 19: Pose Anchoring)
  let constrainedPose = subject.body?.pose;
  if (constrainedPose) {
    const isShoulderLeftInside = constrainedPose.leftShoulder
      ? isPointInMask(constrainedPose.leftShoulder.point, cleanResult.cleanMask, maskWidth, maskHeight, 6)
      : false;
    const isShoulderRightInside = constrainedPose.rightShoulder
      ? isPointInMask(constrainedPose.rightShoulder.point, cleanResult.cleanMask, maskWidth, maskHeight, 6)
      : false;

    // Filter connections that extend into empty background
    const validConnections = (constrainedPose.connections ?? []).filter(conn => {
      const fromIn = isPointInMask(conn.from, cleanResult.cleanMask, maskWidth, maskHeight, 6);
      const toIn = isPointInMask(conn.to, cleanResult.cleanMask, maskWidth, maskHeight, 6);
      return fromIn && toIn;
    });

    constrainedPose = {
      ...constrainedPose,
      connections: validConnections,
    };
  }

  // 7. Assemble SubjectStructure
  const subjectStructure: SubjectStructure = {
    subjectId,
    silhouette: authoritativeSilhouette,
    regions,
    face: subject.face,
    pose: constrainedPose,
    confidence: subject.globalConfidence ?? 0.92,
  };

  const structuralModel: StructuralModel = {
    subjects: [subjectStructure],
    timestamp: Date.now(),
  };

  return {
    structuralModel,
    authoritativeSilhouette,
    hairBoundary,
    clothingBoundary,
  };
}
