/**
 * Experimental Prototype Adapter
 * TASK-103.5 Vision Backend Evaluation
 *
 * Demonstrates the architectural mapping from candidate pretrained model outputs
 * (MediaPipe 468/478 FaceMesh & 33-point BlazePose) into the project's canonical
 * Universal Intermediate Representation (SubjectModel, FacialFeatures, BodyFeatures).
 *
 * NOTE: This is an evaluation prototype and is NOT used in production packages.
 */

import {
  Point2D,
  BoundingBox,
  ContourPath,
  FacialFeatures,
  BodyFeatures,
  EyeLandmarks,
  FeatureVisibility,
  HeadPose,
} from '../../packages/shared-types/src';

export interface RawLandmark3D {
  x: number; // Normalized [0.0 - 1.0]
  y: number; // Normalized [0.0 - 1.0]
  z: number; // Relative depth in normalized screen units
  visibility?: number;
}

/**
 * Standard MediaPipe FaceMesh canonical landmark index definitions.
 * Source: MediaPipe Face Landmarker Topology (Google Research, Apache 2.0).
 */
export const FACEMESH_INDICES = {
  // Left Eye contours (subject's left, viewer's right in frontal)
  LEFT_EYE_UPPER: [362, 382, 381, 380, 374, 373, 390, 249, 263],
  LEFT_EYE_LOWER: [263, 466, 388, 387, 386, 385, 384, 398, 362],
  LEFT_IRIS_CENTER: 468, // Requires withIrises=true (478-landmark model)

  // Right Eye contours (subject's right, viewer's left in frontal)
  RIGHT_EYE_UPPER: [33, 7, 163, 144, 145, 153, 154, 155, 133],
  RIGHT_EYE_LOWER: [133, 246, 161, 160, 159, 158, 157, 173, 33],
  RIGHT_IRIS_CENTER: 473,

  // Eyebrows
  LEFT_EYEBROW: [336, 296, 334, 293, 300, 276, 283, 282, 295, 285],
  RIGHT_EYEBROW: [107, 66, 105, 63, 70, 46, 53, 52, 65, 55],

  // Nose
  NOSE_BRIDGE: [168, 6, 197, 195, 5],
  NOSE_TIP: 1,
  NOSE_LEFT_ALA: [278, 439, 459, 458, 294],
  NOSE_RIGHT_ALA: [48, 219, 239, 238, 64],

  // Lips & Mouth
  LIP_OUTER_UPPER: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291],
  LIP_OUTER_LOWER: [291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61],
  LIP_INNER_SEAM: [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95],

  // Jawline / Outer Face Oval
  FACE_OVAL: [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
    400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
    54, 103, 67, 109
  ],

  // Ear attachment approximation points (tragus/lobule base, NOT external pinna)
  LEFT_EAR_ATTACHMENT: 454,
  RIGHT_EAR_ATTACHMENT: 234,
} as const;

/**
 * Standard MediaPipe Pose Landmarker canonical landmark indices.
 * Source: BlazePose Topology (Google Research, Apache 2.0).
 */
export const POSE_INDICES = {
  NOSE: 0,
  LEFT_EYE: 2,
  RIGHT_EYE: 5,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

/**
 * Prototype adapter mapping MediaPipe FaceMesh raw landmarks to FacialFeatures.
 */
export function mapFaceMeshToFacialFeatures(
  landmarks: RawLandmark3D[],
  confidence = 0.90
): FacialFeatures {
  const getPoint = (idx: number): Point2D => ({
    x: Number(Math.max(0, Math.min(1, landmarks[idx].x)).toFixed(5)),
    y: Number(Math.max(0, Math.min(1, landmarks[idx].y)).toFixed(5)),
  });

  const getContour = (id: string, region: any, indices: readonly number[], closed = false): ContourPath => ({
    id,
    region,
    points: indices.map(getPoint),
    closed,
    confidence,
    visibility: 'visible',
  });

  // Calculate face bounding box from face oval
  const ovalPoints = FACEMESH_INDICES.FACE_OVAL.map(getPoint);
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of ovalPoints) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const boundingBox: BoundingBox = {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };

  // Derive pose yaw from nose tip offset relative to eyes
  const noseX = landmarks[FACEMESH_INDICES.NOSE_TIP].x;
  const leftEyeX = landmarks[FACEMESH_INDICES.LEFT_IRIS_CENTER]?.x ?? landmarks[362].x;
  const rightEyeX = landmarks[FACEMESH_INDICES.RIGHT_IRIS_CENTER]?.x ?? landmarks[33].x;
  const eyeMidX = (leftEyeX + rightEyeX) * 0.5;
  const yawOffset = (noseX - eyeMidX) / Math.max(0.01, Math.abs(leftEyeX - rightEyeX));

  let pose: HeadPose = 'frontal';
  if (yawOffset < -0.45) pose = 'left_profile';
  else if (yawOffset > 0.45) pose = 'right_profile';
  else if (yawOffset < -0.15) pose = 'three_quarter_left';
  else if (yawOffset > 0.15) pose = 'three_quarter_right';

  const leftEye: EyeLandmarks = {
    visibility: pose === 'right_profile' ? 'occluded' : 'visible',
    upperLid: getContour('left_eye_upper', 'eyes', FACEMESH_INDICES.LEFT_EYE_UPPER),
    lowerLid: getContour('left_eye_lower', 'eyes', FACEMESH_INDICES.LEFT_EYE_LOWER),
    iris: landmarks.length > 468 ? getPoint(FACEMESH_INDICES.LEFT_IRIS_CENTER) : undefined,
    confidence,
  };

  const rightEye: EyeLandmarks = {
    visibility: pose === 'left_profile' ? 'occluded' : 'visible',
    upperLid: getContour('right_eye_upper', 'eyes', FACEMESH_INDICES.RIGHT_EYE_UPPER),
    lowerLid: getContour('right_eye_lower', 'eyes', FACEMESH_INDICES.RIGHT_EYE_LOWER),
    iris: landmarks.length > 473 ? getPoint(FACEMESH_INDICES.RIGHT_IRIS_CENTER) : undefined,
    confidence,
  };

  return {
    boundingBox,
    pose,
    leftEye,
    rightEye,
    leftEyebrow: getContour('left_eyebrow', 'eyebrows', FACEMESH_INDICES.LEFT_EYEBROW),
    rightEyebrow: getContour('right_eyebrow', 'eyebrows', FACEMESH_INDICES.RIGHT_EYEBROW),
    noseBridge: getContour('nose_bridge', 'nose', FACEMESH_INDICES.NOSE_BRIDGE),
    noseTip: {
      id: 'nose_tip',
      region: 'nose',
      points: [getPoint(FACEMESH_INDICES.NOSE_TIP)],
      closed: false,
      confidence,
      visibility: 'visible',
    },
    upperLip: getContour('upper_lip', 'mouth', FACEMESH_INDICES.LIP_OUTER_UPPER),
    lowerLip: getContour('lower_lip', 'mouth', FACEMESH_INDICES.LIP_OUTER_LOWER),
    lipSeparation: getContour('lip_separation', 'mouth', FACEMESH_INDICES.LIP_INNER_SEAM),
    jawline: getContour('jawline', 'jawline', FACEMESH_INDICES.FACE_OVAL),
    confidence,
  };
}

/**
 * Prototype adapter mapping MediaPipe Pose 33-point skeleton to BodyFeatures.
 */
export function mapPoseToBodyFeatures(
  landmarks: RawLandmark3D[],
  confidence = 0.85
): BodyFeatures {
  const getPoint = (idx: number): Point2D => ({
    x: Number(Math.max(0, Math.min(1, landmarks[idx].x)).toFixed(5)),
    y: Number(Math.max(0, Math.min(1, landmarks[idx].y)).toFixed(5)),
  });

  // Shoulders line
  const shoulders: ContourPath[] = [
    {
      id: 'shoulders',
      region: 'shoulders',
      points: [getPoint(POSE_INDICES.LEFT_SHOULDER), getPoint(POSE_INDICES.RIGHT_SHOULDER)],
      closed: false,
      confidence,
      visibility: 'visible',
    },
  ];

  // Arms (shoulder -> elbow -> wrist)
  const arms: ContourPath[] = [
    {
      id: 'left_arm',
      region: 'body_outline',
      points: [
        getPoint(POSE_INDICES.LEFT_SHOULDER),
        getPoint(POSE_INDICES.LEFT_ELBOW),
        getPoint(POSE_INDICES.LEFT_WRIST),
      ],
      closed: false,
      confidence,
      visibility: 'visible',
    },
    {
      id: 'right_arm',
      region: 'body_outline',
      points: [
        getPoint(POSE_INDICES.RIGHT_SHOULDER),
        getPoint(POSE_INDICES.RIGHT_ELBOW),
        getPoint(POSE_INDICES.RIGHT_WRIST),
      ],
      closed: false,
      confidence,
      visibility: 'visible',
    },
  ];

  // Torso box (shoulders to hips)
  const torso: ContourPath[] = [
    {
      id: 'torso',
      region: 'body_outline',
      points: [
        getPoint(POSE_INDICES.LEFT_SHOULDER),
        getPoint(POSE_INDICES.RIGHT_SHOULDER),
        getPoint(POSE_INDICES.RIGHT_HIP),
        getPoint(POSE_INDICES.LEFT_HIP),
        getPoint(POSE_INDICES.LEFT_SHOULDER),
      ],
      closed: true,
      confidence,
      visibility: 'visible',
    },
  ];

  // Legs (hip -> knee -> ankle)
  const legs: ContourPath[] = [
    {
      id: 'left_leg',
      region: 'body_outline',
      points: [
        getPoint(POSE_INDICES.LEFT_HIP),
        getPoint(POSE_INDICES.LEFT_KNEE),
        getPoint(POSE_INDICES.LEFT_ANKLE),
      ],
      closed: false,
      confidence,
      visibility: 'visible',
    },
    {
      id: 'right_leg',
      region: 'body_outline',
      points: [
        getPoint(POSE_INDICES.RIGHT_HIP),
        getPoint(POSE_INDICES.RIGHT_KNEE),
        getPoint(POSE_INDICES.RIGHT_ANKLE),
      ],
      closed: false,
      confidence,
      visibility: 'visible',
    },
  ];

  return {
    shoulders,
    arms,
    torso,
    legs,
    poseConfidence: confidence,
  };
}
