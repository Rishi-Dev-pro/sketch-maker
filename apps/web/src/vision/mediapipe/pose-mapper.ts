/**
 * MediaPipe Pose Landmark Mapper
 * TASK-103.8 MediaPipe Pose Landmarker Integration
 *
 * Maps raw 33-point MediaPipe BlazePose landmarks into canonical
 * BodyPose, BodyFeatures, and SubjectModel intermediate representations.
 */

import {
  Point2D,
  BoundingBox,
  ContourPath,
  BodyFeatures,
  BodyPose,
  PoseLandmark,
  PoseConnection,
  FeatureVisibility,
} from '@sketch-maker/shared-types';

export interface RawPoseLandmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
}

/**
 * Standard 33 BlazePose anatomical landmark indices.
 */
export const BLAZEPOSE_INDICES = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
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

export const POSE_LANDMARK_NAMES: Record<number, string> = {
  0: 'nose',
  1: 'left_eye_inner',
  2: 'left_eye',
  3: 'left_eye_outer',
  4: 'right_eye_inner',
  5: 'right_eye',
  6: 'right_eye_outer',
  7: 'left_ear',
  8: 'right_ear',
  9: 'mouth_left',
  10: 'mouth_right',
  11: 'left_shoulder',
  12: 'right_shoulder',
  13: 'left_elbow',
  14: 'right_elbow',
  15: 'left_wrist',
  16: 'right_wrist',
  17: 'left_pinky',
  18: 'right_pinky',
  19: 'left_index',
  20: 'right_index',
  21: 'left_thumb',
  22: 'right_thumb',
  23: 'left_hip',
  24: 'right_hip',
  25: 'left_knee',
  26: 'right_knee',
  27: 'left_ankle',
  28: 'right_ankle',
  29: 'left_heel',
  30: 'right_heel',
  31: 'left_foot_index',
  32: 'right_foot_index',
};

/**
 * Skeletal link connection pairs for procedural bone generation and UI visualization.
 */
export const SKELETAL_CONNECTIONS: [number, number, string][] = [
  // Head / Neck
  [0, 1, 'nose_to_left_eye_inner'],
  [0, 4, 'nose_to_right_eye_inner'],
  [2, 7, 'left_eye_to_left_ear'],
  [5, 8, 'right_eye_to_right_ear'],
  [9, 10, 'mouth_left_to_mouth_right'],

  // Torso
  [11, 12, 'shoulders'],
  [11, 23, 'left_torso'],
  [12, 24, 'right_torso'],
  [23, 24, 'pelvis'],

  // Left Arm
  [11, 13, 'left_upper_arm'],
  [13, 15, 'left_forearm'],
  [15, 17, 'left_wrist_to_pinky'],
  [15, 19, 'left_wrist_to_index'],
  [15, 21, 'left_wrist_to_thumb'],

  // Right Arm
  [12, 14, 'right_upper_arm'],
  [14, 16, 'right_forearm'],
  [16, 18, 'right_wrist_to_pinky'],
  [16, 20, 'right_wrist_to_index'],
  [16, 22, 'right_wrist_to_thumb'],

  // Left Leg
  [23, 25, 'left_thigh'],
  [25, 27, 'left_shin'],
  [27, 29, 'left_ankle_to_heel'],
  [29, 31, 'left_heel_to_foot_index'],
  [27, 31, 'left_ankle_to_foot_index'],

  // Right Leg
  [24, 26, 'right_thigh'],
  [26, 28, 'right_shin'],
  [28, 30, 'right_ankle_to_heel'],
  [30, 32, 'right_heel_to_foot_index'],
  [28, 32, 'right_ankle_to_foot_index'],
];

/**
 * Clamps coordinates defensively to canonical normalized [0.0, 1.0] viewport.
 */
export function clamp01(val: number): number {
  if (Number.isNaN(val)) return 0;
  return Number(Math.max(0, Math.min(1, val)).toFixed(5));
}

/**
 * Maps visibility likelihood to canonical FeatureVisibility state.
 */
export function mapVisibility(vis?: number): FeatureVisibility {
  if (vis === undefined || vis === null) return 'uncertain';
  if (vis >= 0.65) return 'visible';
  if (vis >= 0.35) return 'uncertain';
  return 'occluded';
}

/**
 * Transforms raw MediaPipe 33-landmark pose array to canonical BodyPose.
 */
export function mapMediaPipePoseToBodyPose(
  rawLandmarks: RawPoseLandmark[],
  globalConfidence = 0.85
): BodyPose {
  const landmarks: PoseLandmark[] = rawLandmarks.map((lm, idx) => {
    const visibility = mapVisibility(lm.visibility);
    const confidence = lm.visibility !== undefined
      ? Number(Math.max(0, Math.min(1, lm.visibility)).toFixed(3))
      : globalConfidence;

    return {
      id: POSE_LANDMARK_NAMES[idx] ?? `joint_${idx}`,
      point: {
        x: clamp01(lm.x),
        y: clamp01(lm.y),
      },
      z: lm.z !== undefined ? Number(lm.z.toFixed(5)) : undefined,
      visibility,
      presence: lm.presence !== undefined ? Number(lm.presence.toFixed(3)) : undefined,
      confidence,
    };
  });

  // Calculate bounding box across valid landmarks
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  let validCount = 0;
  for (const lm of landmarks) {
    if (lm.visibility !== 'occluded') {
      minX = Math.min(minX, lm.point.x);
      minY = Math.min(minY, lm.point.y);
      maxX = Math.max(maxX, lm.point.x);
      maxY = Math.max(maxY, lm.point.y);
      validCount++;
    }
  }

  const boundingBox: BoundingBox = validCount > 0
    ? {
        x: minX,
        y: minY,
        width: Math.max(0.01, maxX - minX),
        height: Math.max(0.01, maxY - minY),
      }
    : { x: 0, y: 0, width: 1, height: 1 };

  // Synthesize neck as midpoint between shoulders
  let neck: PoseLandmark | undefined;
  const leftShoulder = landmarks[BLAZEPOSE_INDICES.LEFT_SHOULDER];
  const rightShoulder = landmarks[BLAZEPOSE_INDICES.RIGHT_SHOULDER];
  if (leftShoulder && rightShoulder) {
    const neckVis: FeatureVisibility =
      leftShoulder.visibility === 'visible' && rightShoulder.visibility === 'visible'
        ? 'visible'
        : leftShoulder.visibility === 'occluded' && rightShoulder.visibility === 'occluded'
        ? 'occluded'
        : 'uncertain';

    neck = {
      id: 'neck',
      point: {
        x: clamp01((leftShoulder.point.x + rightShoulder.point.x) * 0.5),
        y: clamp01((leftShoulder.point.y + rightShoulder.point.y) * 0.5),
      },
      z: leftShoulder.z !== undefined && rightShoulder.z !== undefined
        ? (leftShoulder.z + rightShoulder.z) * 0.5
        : undefined,
      visibility: neckVis,
      confidence: (leftShoulder.confidence + rightShoulder.confidence) * 0.5,
    };
  }

  // Generate skeletal connections
  const connections: PoseConnection[] = [];
  for (const [fromIdx, toIdx, name] of SKELETAL_CONNECTIONS) {
    const fromLm = landmarks[fromIdx];
    const toLm = landmarks[toIdx];
    if (fromLm && toLm) {
      const linkConf = Math.min(fromLm.confidence, toLm.confidence);
      connections.push({
        from: fromLm.point,
        to: toLm.point,
        name,
        confidence: linkConf,
      });
    }
  }

  return {
    landmarks,
    connections,
    nose: landmarks[BLAZEPOSE_INDICES.NOSE],
    leftEye: landmarks[BLAZEPOSE_INDICES.LEFT_EYE],
    rightEye: landmarks[BLAZEPOSE_INDICES.RIGHT_EYE],
    leftEar: landmarks[BLAZEPOSE_INDICES.LEFT_EAR],
    rightEar: landmarks[BLAZEPOSE_INDICES.RIGHT_EAR],
    neck,
    leftShoulder,
    rightShoulder,
    leftElbow: landmarks[BLAZEPOSE_INDICES.LEFT_ELBOW],
    rightElbow: landmarks[BLAZEPOSE_INDICES.RIGHT_ELBOW],
    leftWrist: landmarks[BLAZEPOSE_INDICES.LEFT_WRIST],
    rightWrist: landmarks[BLAZEPOSE_INDICES.RIGHT_WRIST],
    leftHip: landmarks[BLAZEPOSE_INDICES.LEFT_HIP],
    rightHip: landmarks[BLAZEPOSE_INDICES.RIGHT_HIP],
    leftKnee: landmarks[BLAZEPOSE_INDICES.LEFT_KNEE],
    rightKnee: landmarks[BLAZEPOSE_INDICES.RIGHT_KNEE],
    leftAnkle: landmarks[BLAZEPOSE_INDICES.LEFT_ANKLE],
    rightAnkle: landmarks[BLAZEPOSE_INDICES.RIGHT_ANKLE],
    leftHeel: landmarks[BLAZEPOSE_INDICES.LEFT_HEEL],
    rightHeel: landmarks[BLAZEPOSE_INDICES.RIGHT_HEEL],
    leftFootIndex: landmarks[BLAZEPOSE_INDICES.LEFT_FOOT_INDEX],
    rightFootIndex: landmarks[BLAZEPOSE_INDICES.RIGHT_FOOT_INDEX],
    boundingBox,
    confidence: globalConfidence,
  };
}

/**
 * Constructs BodyFeatures containing both articulated BodyPose and structured ContourPaths.
 */
export function mapMediaPipePoseToBodyFeatures(
  rawLandmarks: RawPoseLandmark[],
  confidence = 0.85
): BodyFeatures {
  const pose = mapMediaPipePoseToBodyPose(rawLandmarks, confidence);

  const getPt = (idx: number): Point2D => pose.landmarks[idx]?.point ?? { x: 0, y: 0 };
  const getConf = (idx: number): number => pose.landmarks[idx]?.confidence ?? 0;
  const getVis = (idx: number): FeatureVisibility => pose.landmarks[idx]?.visibility ?? 'uncertain';

  // Shoulders contour
  const shoulders: ContourPath[] = [
    {
      id: 'shoulders_line',
      region: 'shoulders',
      points: [getPt(BLAZEPOSE_INDICES.LEFT_SHOULDER), getPt(BLAZEPOSE_INDICES.RIGHT_SHOULDER)],
      closed: false,
      confidence: Math.min(getConf(BLAZEPOSE_INDICES.LEFT_SHOULDER), getConf(BLAZEPOSE_INDICES.RIGHT_SHOULDER)),
      visibility: getVis(BLAZEPOSE_INDICES.LEFT_SHOULDER),
    },
  ];

  // Arms contours
  const arms: ContourPath[] = [
    {
      id: 'left_arm',
      region: 'body_outline',
      points: [
        getPt(BLAZEPOSE_INDICES.LEFT_SHOULDER),
        getPt(BLAZEPOSE_INDICES.LEFT_ELBOW),
        getPt(BLAZEPOSE_INDICES.LEFT_WRIST),
      ],
      closed: false,
      confidence: Math.min(
        getConf(BLAZEPOSE_INDICES.LEFT_SHOULDER),
        getConf(BLAZEPOSE_INDICES.LEFT_ELBOW),
        getConf(BLAZEPOSE_INDICES.LEFT_WRIST)
      ),
      visibility: getVis(BLAZEPOSE_INDICES.LEFT_ELBOW),
    },
    {
      id: 'right_arm',
      region: 'body_outline',
      points: [
        getPt(BLAZEPOSE_INDICES.RIGHT_SHOULDER),
        getPt(BLAZEPOSE_INDICES.RIGHT_ELBOW),
        getPt(BLAZEPOSE_INDICES.RIGHT_WRIST),
      ],
      closed: false,
      confidence: Math.min(
        getConf(BLAZEPOSE_INDICES.RIGHT_SHOULDER),
        getConf(BLAZEPOSE_INDICES.RIGHT_ELBOW),
        getConf(BLAZEPOSE_INDICES.RIGHT_WRIST)
      ),
      visibility: getVis(BLAZEPOSE_INDICES.RIGHT_ELBOW),
    },
  ];

  // Torso polygon
  const torso: ContourPath[] = [
    {
      id: 'torso_contour',
      region: 'body_outline',
      points: [
        getPt(BLAZEPOSE_INDICES.LEFT_SHOULDER),
        getPt(BLAZEPOSE_INDICES.RIGHT_SHOULDER),
        getPt(BLAZEPOSE_INDICES.RIGHT_HIP),
        getPt(BLAZEPOSE_INDICES.LEFT_HIP),
        getPt(BLAZEPOSE_INDICES.LEFT_SHOULDER),
      ],
      closed: true,
      confidence: Math.min(
        getConf(BLAZEPOSE_INDICES.LEFT_SHOULDER),
        getConf(BLAZEPOSE_INDICES.RIGHT_SHOULDER),
        getConf(BLAZEPOSE_INDICES.LEFT_HIP),
        getConf(BLAZEPOSE_INDICES.RIGHT_HIP)
      ),
      visibility: getVis(BLAZEPOSE_INDICES.LEFT_SHOULDER),
    },
  ];

  // Legs contours
  const legs: ContourPath[] = [
    {
      id: 'left_leg',
      region: 'body_outline',
      points: [
        getPt(BLAZEPOSE_INDICES.LEFT_HIP),
        getPt(BLAZEPOSE_INDICES.LEFT_KNEE),
        getPt(BLAZEPOSE_INDICES.LEFT_ANKLE),
      ],
      closed: false,
      confidence: Math.min(
        getConf(BLAZEPOSE_INDICES.LEFT_HIP),
        getConf(BLAZEPOSE_INDICES.LEFT_KNEE),
        getConf(BLAZEPOSE_INDICES.LEFT_ANKLE)
      ),
      visibility: getVis(BLAZEPOSE_INDICES.LEFT_KNEE),
    },
    {
      id: 'right_leg',
      region: 'body_outline',
      points: [
        getPt(BLAZEPOSE_INDICES.RIGHT_HIP),
        getPt(BLAZEPOSE_INDICES.RIGHT_KNEE),
        getPt(BLAZEPOSE_INDICES.RIGHT_ANKLE),
      ],
      closed: false,
      confidence: Math.min(
        getConf(BLAZEPOSE_INDICES.RIGHT_HIP),
        getConf(BLAZEPOSE_INDICES.RIGHT_KNEE),
        getConf(BLAZEPOSE_INDICES.RIGHT_ANKLE)
      ),
      visibility: getVis(BLAZEPOSE_INDICES.RIGHT_KNEE),
    },
  ];

  return {
    pose,
    shoulders,
    arms,
    torso,
    legs,
    poseConfidence: confidence,
  };
}
