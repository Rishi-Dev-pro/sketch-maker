/**
 * MediaPipe Landmark to Canonical SubjectModel Mapper
 * TASK-103.7 MediaPipe Integration
 *
 * Translates raw MediaPipe FaceLandmarker (478 3D landmarks) into the project's
 * Universal Intermediate Representation (SubjectModel, FacialFeatures, ContourPath).
 *
 * Design Constraints:
 * 1. Coordinates strictly clamped to normalized [0.0, 1.0] range.
 * 2. Derives head pose and enforces honest occlusion semantics (e.g. BM-02 side profile).
 * 3. Does NOT fabricate external ear pinna geometry (which MediaPipe lacks).
 * 4. Preserves evidence provenance and confidence scoring.
 */

import {
  Point2D,
  BoundingBox,
  Dimensions,
  ContourPath,
  FacialFeatures,
  SubjectModel,
  EyeLandmarks,
  FeatureVisibility,
  HeadPose,
} from '@sketch-maker/shared-types';

export interface MediaPipeLandmark3D {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

/**
 * Standard MediaPipe FaceMesh canonical landmark indices.
 * Reference: Google Research MediaPipe FaceMesh topology (Apache 2.0).
 */
export const FACEMESH_TOPOLOGY = {
  // Left eye (subject's left, viewer's right in frontal)
  LEFT_EYE_UPPER: [362, 382, 381, 380, 374, 373, 390, 249, 263] as const,
  LEFT_EYE_LOWER: [263, 466, 388, 387, 386, 385, 384, 398, 362] as const,
  LEFT_IRIS_CENTER: 468,

  // Right eye (subject's right, viewer's left in frontal)
  RIGHT_EYE_UPPER: [33, 7, 163, 144, 145, 153, 154, 155, 133] as const,
  RIGHT_EYE_LOWER: [133, 246, 161, 160, 159, 158, 157, 173, 33] as const,
  RIGHT_IRIS_CENTER: 473,

  // Eyebrows
  LEFT_EYEBROW: [336, 296, 334, 293, 300, 276, 283, 282, 295, 285] as const,
  RIGHT_EYEBROW: [107, 66, 105, 63, 70, 46, 53, 52, 65, 55] as const,

  // Nose
  NOSE_BRIDGE: [168, 6, 197, 195, 5] as const,
  NOSE_TIP: 1,
  NOSE_LEFT_ALA: [278, 439, 459, 458, 294] as const,
  NOSE_RIGHT_ALA: [48, 219, 239, 238, 64] as const,

  // Mouth & Vermilion Borders
  LIP_UPPER_VERMILION: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291] as const,
  LIP_LOWER_VERMILION: [291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61] as const,
  ORAL_FISSURE_SEAM: [
    78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95,
  ] as const,

  // Outer Mandibular Jawline / Face Oval
  FACE_OVAL: [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
    400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
    54, 103, 67, 109,
  ] as const,

  // Key anatomical anchors
  CHIN_APEX: 152,
  FOREHEAD_TOP: 10,
  LEFT_TRAGUS_ATTACHMENT: 454,
  RIGHT_TRAGUS_ATTACHMENT: 234,
};

/**
 * Derives discrete HeadPose and yaw metric from 3D facial asymmetry.
 */
export function deriveHeadPoseFromLandmarks(landmarks: MediaPipeLandmark3D[]): {
  pose: HeadPose;
  yawRatio: number;
} {
  const noseX = landmarks[FACEMESH_TOPOLOGY.NOSE_TIP]?.x ?? 0.5;
  const leftEyeX = landmarks[FACEMESH_TOPOLOGY.LEFT_IRIS_CENTER]?.x ?? landmarks[362]?.x ?? 0.7;
  const rightEyeX = landmarks[FACEMESH_TOPOLOGY.RIGHT_IRIS_CENTER]?.x ?? landmarks[33]?.x ?? 0.3;

  const eyeSpan = Math.max(0.01, Math.abs(leftEyeX - rightEyeX));
  const eyeMidX = (leftEyeX + rightEyeX) * 0.5;
  const yawRatio = (noseX - eyeMidX) / eyeSpan;

  // Left tragus to nose distance vs Right tragus to nose distance
  const leftTragusX = landmarks[FACEMESH_TOPOLOGY.LEFT_TRAGUS_ATTACHMENT]?.x ?? leftEyeX;
  const rightTragusX = landmarks[FACEMESH_TOPOLOGY.RIGHT_TRAGUS_ATTACHMENT]?.x ?? rightEyeX;
  const leftCheekWidth = Math.abs(leftTragusX - noseX);
  const rightCheekWidth = Math.abs(noseX - rightTragusX);
  const cheekAsymmetry = (rightCheekWidth - leftCheekWidth) / Math.max(0.01, rightCheekWidth + leftCheekWidth);

  let pose: HeadPose = 'frontal';
  if (yawRatio < -0.42 || cheekAsymmetry < -0.60) {
    pose = 'left_profile';
  } else if (yawRatio > 0.42 || cheekAsymmetry > 0.60) {
    pose = 'right_profile';
  } else if (yawRatio < -0.12 || cheekAsymmetry < -0.22) {
    pose = 'three_quarter_left';
  } else if (yawRatio > 0.12 || cheekAsymmetry > 0.22) {
    pose = 'three_quarter_right';
  }

  return { pose, yawRatio: Number(yawRatio.toFixed(3)) };
}

/**
 * Maps an array of 478 MediaPipe landmarks into canonical FacialFeatures.
 */
export function mapMediaPipeToFacialFeatures(
  landmarks: MediaPipeLandmark3D[],
  confidence = 0.92
): FacialFeatures {
  const clamp = (val: number): number => Math.max(0.0, Math.min(1.0, val));
  const getPoint = (idx: number): Point2D => {
    const p = landmarks[idx] ?? { x: 0.5, y: 0.5, z: 0 };
    return {
      x: Number(clamp(p.x).toFixed(5)),
      y: Number(clamp(p.y).toFixed(5)),
    };
  };

  const getContour = (
    id: string,
    region: any,
    indices: readonly number[],
    closed = false,
    visibility: FeatureVisibility = 'visible'
  ): ContourPath => ({
    id,
    region,
    points: indices.map(getPoint),
    closed,
    confidence,
    visibility,
  });

  // Calculate face bounding box from face oval
  const ovalPoints = FACEMESH_TOPOLOGY.FACE_OVAL.map(getPoint);
  let minX = 1.0;
  let minY = 1.0;
  let maxX = 0.0;
  let maxY = 0.0;

  for (const p of ovalPoints) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const boundingBox: BoundingBox = {
    x: Number(minX.toFixed(5)),
    y: Number(minY.toFixed(5)),
    width: Number((maxX - minX).toFixed(5)),
    height: Number((maxY - minY).toFixed(5)),
  };

  const { pose } = deriveHeadPoseFromLandmarks(landmarks);

  // Visibility determination based on pose
  const leftEyeVis: FeatureVisibility = pose === 'right_profile' ? 'occluded' : 'visible';
  const rightEyeVis: FeatureVisibility = pose === 'left_profile' ? 'occluded' : 'visible';
  const leftBrowVis: FeatureVisibility = pose === 'right_profile' ? 'occluded' : 'visible';
  const rightBrowVis: FeatureVisibility = pose === 'left_profile' ? 'occluded' : 'visible';
  const leftNostrilVis: FeatureVisibility = pose === 'right_profile' ? 'occluded' : 'visible';
  const rightNostrilVis: FeatureVisibility = pose === 'left_profile' ? 'occluded' : 'visible';

  const leftEye: EyeLandmarks = {
    visibility: leftEyeVis,
    upperLid: getContour('mp-left-eye-upper', 'eyes', FACEMESH_TOPOLOGY.LEFT_EYE_UPPER, false, leftEyeVis),
    lowerLid: getContour('mp-left-eye-lower', 'eyes', FACEMESH_TOPOLOGY.LEFT_EYE_LOWER, false, leftEyeVis),
    iris: landmarks.length > 468 && leftEyeVis === 'visible' ? getPoint(FACEMESH_TOPOLOGY.LEFT_IRIS_CENTER) : undefined,
    confidence: leftEyeVis === 'occluded' ? 0.2 : confidence,
  };

  const rightEye: EyeLandmarks = {
    visibility: rightEyeVis,
    upperLid: getContour('mp-right-eye-upper', 'eyes', FACEMESH_TOPOLOGY.RIGHT_EYE_UPPER, false, rightEyeVis),
    lowerLid: getContour('mp-right-eye-lower', 'eyes', FACEMESH_TOPOLOGY.RIGHT_EYE_LOWER, false, rightEyeVis),
    iris: landmarks.length > 473 && rightEyeVis === 'visible' ? getPoint(FACEMESH_TOPOLOGY.RIGHT_IRIS_CENTER) : undefined,
    confidence: rightEyeVis === 'occluded' ? 0.2 : confidence,
  };

  const nostrils: ContourPath[] = [];
  if (leftNostrilVis === 'visible') {
    nostrils.push(getContour('mp-nostril-left', 'nose', FACEMESH_TOPOLOGY.NOSE_LEFT_ALA, false, 'visible'));
  }
  if (rightNostrilVis === 'visible') {
    nostrils.push(getContour('mp-nostril-right', 'nose', FACEMESH_TOPOLOGY.NOSE_RIGHT_ALA, false, 'visible'));
  }

  return {
    boundingBox,
    pose,
    leftEye,
    rightEye,
    leftEyebrow: getContour('mp-eyebrow-left', 'eyebrows', FACEMESH_TOPOLOGY.LEFT_EYEBROW, false, leftBrowVis),
    rightEyebrow: getContour('mp-eyebrow-right', 'eyebrows', FACEMESH_TOPOLOGY.RIGHT_EYEBROW, false, rightBrowVis),
    noseBridge: getContour('mp-nose-bridge', 'nose', FACEMESH_TOPOLOGY.NOSE_BRIDGE, false, 'visible'),
    noseTip: {
      id: 'mp-nose-tip',
      region: 'nose',
      points: [getPoint(FACEMESH_TOPOLOGY.NOSE_TIP)],
      closed: false,
      confidence,
      visibility: 'visible',
    },
    nostrils,
    upperLip: getContour('mp-upper-lip', 'mouth', FACEMESH_TOPOLOGY.LIP_UPPER_VERMILION, false, 'visible'),
    lowerLip: getContour('mp-lower-lip', 'mouth', FACEMESH_TOPOLOGY.LIP_LOWER_VERMILION, false, 'visible'),
    lipSeparation: getContour('mp-oral-fissure', 'mouth', FACEMESH_TOPOLOGY.ORAL_FISSURE_SEAM, false, 'visible'),
    jawline: getContour('mp-jawline-oval', 'jawline', FACEMESH_TOPOLOGY.FACE_OVAL, true, 'visible'),
    chin: {
      id: 'mp-chin-apex',
      region: 'jawline',
      points: [getPoint(FACEMESH_TOPOLOGY.CHIN_APEX)],
      closed: false,
      confidence,
      visibility: 'visible',
    },
    // MediaPipe does NOT provide external ear pinna geometry
    leftEar: undefined,
    rightEar: undefined,
    featureVisibility: {
      leftEye: leftEyeVis,
      rightEye: rightEyeVis,
      leftEyebrow: leftBrowVis,
      rightEyebrow: rightBrowVis,
      nose: 'visible',
      mouth: 'visible',
      jawline: 'visible',
      chin: 'visible',
      leftEar: 'not_detected',
      rightEar: 'not_detected',
    },
    confidence,
  };
}

/**
 * Transforms an array of detected faces from MediaPipe into an array of SubjectModels.
 */
export function mapMediaPipeFacesToSubjectModels(
  multiFaceLandmarks: MediaPipeLandmark3D[][],
  sourceDimensions: Dimensions,
  baseConfidence = 0.92
): SubjectModel[] {
  return multiFaceLandmarks.map((landmarks, index) => {
    const face = mapMediaPipeToFacialFeatures(landmarks, baseConfidence);
    const id = `subject-mediapipe-${index + 1}`;

    const silhouettePath: ContourPath = {
      id: `silhouette-${id}`,
      region: 'body_outline',
      points: face.jawline ? face.jawline.points : [],
      closed: true,
      confidence: baseConfidence,
      visibility: 'visible',
    };

    return {
      id,
      version: '1.0.0',
      sourceDimensions,
      boundingBox: face.boundingBox ?? { x: 0, y: 0, width: 1, height: 1 },
      silhouette: [silhouettePath],
      face,
      globalConfidence: baseConfidence,
      timestamp: Date.now(),
    };
  });
}
