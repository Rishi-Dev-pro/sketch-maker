/**
 * MediaPipe Pose Landmarker Integration Unit Tests
 * TASK-103.8 MediaPipe Pose Landmarker Integration
 *
 * Validates canonical BodyPose mapping, coordinate clamping, neck synthesis,
 * skeletal connections, standing/sitting posture, visibility thresholds,
 * multi-person isolation, and Face + Pose association.
 *
 * NOTE: These unit tests run 100% offline with zero remote model downloads.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapMediaPipePoseToBodyPose,
  mapMediaPipePoseToBodyFeatures,
  BLAZEPOSE_INDICES,
  RawPoseLandmark,
  clamp01,
  mapVisibility,
} from '../../apps/web/src/vision/mediapipe/pose-mapper';
import {
  associateFacesAndPoses,
  unionBoundingBoxes,
  pointDistance,
} from '../../apps/web/src/vision/mediapipe/face-pose-associator';
import { MediaPipeWebDelegate } from '../../apps/web/src/vision/mediapipe/mediapipe-delegate';
import { SubjectModel } from '../../packages/shared-types/src/subject';

/**
 * Creates a synthetic 33-point BlazePose landmark array representing a standing person.
 */
function createSyntheticStandingPose(xOffset = 0.5, yOffset = 0.5, scale = 1.0): RawPoseLandmark[] {
  const landmarks: RawPoseLandmark[] = new Array(33);

  for (let i = 0; i < 33; i++) {
    landmarks[i] = { x: xOffset, y: yOffset, z: 0, visibility: 0.95, presence: 0.98 };
  }

  // Head
  landmarks[BLAZEPOSE_INDICES.NOSE] = { x: xOffset, y: yOffset - 0.35 * scale, z: -0.05, visibility: 0.98 };
  landmarks[BLAZEPOSE_INDICES.LEFT_EYE] = { x: xOffset - 0.02 * scale, y: yOffset - 0.37 * scale, z: -0.05, visibility: 0.98 };
  landmarks[BLAZEPOSE_INDICES.RIGHT_EYE] = { x: xOffset + 0.02 * scale, y: yOffset - 0.37 * scale, z: -0.05, visibility: 0.98 };
  landmarks[BLAZEPOSE_INDICES.LEFT_EAR] = { x: xOffset - 0.05 * scale, y: yOffset - 0.35 * scale, z: 0.0, visibility: 0.90 };
  landmarks[BLAZEPOSE_INDICES.RIGHT_EAR] = { x: xOffset + 0.05 * scale, y: yOffset - 0.35 * scale, z: 0.0, visibility: 0.90 };

  // Shoulders
  landmarks[BLAZEPOSE_INDICES.LEFT_SHOULDER] = { x: xOffset - 0.12 * scale, y: yOffset - 0.25 * scale, z: 0.0, visibility: 0.96 };
  landmarks[BLAZEPOSE_INDICES.RIGHT_SHOULDER] = { x: xOffset + 0.12 * scale, y: yOffset - 0.25 * scale, z: 0.0, visibility: 0.96 };

  // Elbows & Wrists
  landmarks[BLAZEPOSE_INDICES.LEFT_ELBOW] = { x: xOffset - 0.15 * scale, y: yOffset - 0.10 * scale, z: 0.05, visibility: 0.94 };
  landmarks[BLAZEPOSE_INDICES.RIGHT_ELBOW] = { x: xOffset + 0.15 * scale, y: yOffset - 0.10 * scale, z: 0.05, visibility: 0.94 };
  landmarks[BLAZEPOSE_INDICES.LEFT_WRIST] = { x: xOffset - 0.14 * scale, y: yOffset + 0.05 * scale, z: 0.08, visibility: 0.91 };
  landmarks[BLAZEPOSE_INDICES.RIGHT_WRIST] = { x: xOffset + 0.14 * scale, y: yOffset + 0.05 * scale, z: 0.08, visibility: 0.91 };

  // Hips
  landmarks[BLAZEPOSE_INDICES.LEFT_HIP] = { x: xOffset - 0.08 * scale, y: yOffset + 0.05 * scale, z: 0.0, visibility: 0.95 };
  landmarks[BLAZEPOSE_INDICES.RIGHT_HIP] = { x: xOffset + 0.08 * scale, y: yOffset + 0.05 * scale, z: 0.0, visibility: 0.95 };

  // Knees
  landmarks[BLAZEPOSE_INDICES.LEFT_KNEE] = { x: xOffset - 0.08 * scale, y: yOffset + 0.25 * scale, z: 0.0, visibility: 0.95 };
  landmarks[BLAZEPOSE_INDICES.RIGHT_KNEE] = { x: xOffset + 0.08 * scale, y: yOffset + 0.25 * scale, z: 0.0, visibility: 0.95 };

  // Ankles
  landmarks[BLAZEPOSE_INDICES.LEFT_ANKLE] = { x: xOffset - 0.08 * scale, y: yOffset + 0.42 * scale, z: 0.02, visibility: 0.93 };
  landmarks[BLAZEPOSE_INDICES.RIGHT_ANKLE] = { x: xOffset + 0.08 * scale, y: yOffset + 0.42 * scale, z: 0.02, visibility: 0.93 };

  return landmarks;
}

/**
 * Creates a synthetic seated pose (BM-10) with flexed knees and forward lower legs.
 */
function createSyntheticSeatedPose(): RawPoseLandmark[] {
  const pose = createSyntheticStandingPose(0.5, 0.45, 0.9);

  // In sitting pose, hips are higher, knees project horizontally forward, ankles drop down
  pose[BLAZEPOSE_INDICES.LEFT_HIP] = { x: 0.44, y: 0.45, z: 0.0, visibility: 0.95 };
  pose[BLAZEPOSE_INDICES.RIGHT_HIP] = { x: 0.56, y: 0.45, z: 0.0, visibility: 0.95 };

  // Knees bend forward at horizontal thigh plane
  pose[BLAZEPOSE_INDICES.LEFT_KNEE] = { x: 0.40, y: 0.58, z: 0.25, visibility: 0.92 };
  pose[BLAZEPOSE_INDICES.RIGHT_KNEE] = { x: 0.60, y: 0.58, z: 0.25, visibility: 0.92 };

  // Ankles drop vertically below knees
  pose[BLAZEPOSE_INDICES.LEFT_ANKLE] = { x: 0.40, y: 0.78, z: 0.22, visibility: 0.90 };
  pose[BLAZEPOSE_INDICES.RIGHT_ANKLE] = { x: 0.60, y: 0.78, z: 0.22, visibility: 0.90 };

  return pose;
}

test('MediaPipe Pose Landmarker Integration (TASK-103.8)', async (t) => {
  await t.test('Test 1: Normalized coordinates are clamped strictly within [0.0, 1.0]', () => {
    const raw: RawPoseLandmark[] = [
      { x: -0.25, y: 1.45, z: 0.5, visibility: 0.8 },
      { x: 0.5, y: 0.5, z: -0.1, visibility: 0.9 },
      { x: 1.85, y: -0.15, z: 0.0, visibility: 0.7 },
    ];
    while (raw.length < 33) {
      raw.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.5 });
    }

    const pose = mapMediaPipePoseToBodyPose(raw);
    for (const lm of pose.landmarks) {
      assert.ok(lm.point.x >= 0.0 && lm.point.x <= 1.0, `X coordinate out of bounds: ${lm.point.x}`);
      assert.ok(lm.point.y >= 0.0 && lm.point.y <= 1.0, `Y coordinate out of bounds: ${lm.point.y}`);
    }
    assert.strictEqual(pose.landmarks[0].point.x, 0.0);
    assert.strictEqual(pose.landmarks[0].point.y, 1.0);
    assert.strictEqual(pose.landmarks[2].point.x, 1.0);
    assert.strictEqual(pose.landmarks[2].point.y, 0.0);
  });

  await t.test('Test 2: 33-point landmarks map accurately to canonical BodyPose fields', () => {
    const rawStanding = createSyntheticStandingPose(0.5, 0.5, 1.0);
    const pose = mapMediaPipePoseToBodyPose(rawStanding);

    assert.strictEqual(pose.landmarks.length, 33);
    assert.ok(pose.nose, 'Nose must be present');
    assert.ok(pose.leftShoulder, 'Left shoulder must be present');
    assert.ok(pose.rightShoulder, 'Right shoulder must be present');
    assert.ok(pose.leftElbow, 'Left elbow must be present');
    assert.ok(pose.rightElbow, 'Right elbow must be present');
    assert.ok(pose.leftWrist, 'Left wrist must be present');
    assert.ok(pose.rightWrist, 'Right wrist must be present');
    assert.ok(pose.leftHip, 'Left hip must be present');
    assert.ok(pose.rightHip, 'Right hip must be present');
    assert.ok(pose.leftKnee, 'Left knee must be present');
    assert.ok(pose.rightKnee, 'Right knee must be present');
    assert.ok(pose.leftAnkle, 'Left ankle must be present');
    assert.ok(pose.rightAnkle, 'Right ankle must be present');
  });

  await t.test('Test 3: Neck keypoint is correctly synthesized as midpoint of shoulders', () => {
    const rawStanding = createSyntheticStandingPose(0.5, 0.5, 1.0);
    const pose = mapMediaPipePoseToBodyPose(rawStanding);

    assert.ok(pose.neck, 'Neck must be synthesized');
    const expectedNeckX = (pose.leftShoulder!.point.x + pose.rightShoulder!.point.x) * 0.5;
    const expectedNeckY = (pose.leftShoulder!.point.y + pose.rightShoulder!.point.y) * 0.5;

    assert.ok(Math.abs(pose.neck.point.x - expectedNeckX) < 1e-4);
    assert.ok(Math.abs(pose.neck.point.y - expectedNeckY) < 1e-4);
    assert.strictEqual(pose.neck.visibility, 'visible');
  });

  await t.test('Test 4: Skeletal connections are generated with valid topological links', () => {
    const rawStanding = createSyntheticStandingPose(0.5, 0.5, 1.0);
    const pose = mapMediaPipePoseToBodyPose(rawStanding);

    assert.ok(pose.connections.length > 20, `Expected >20 skeletal links, got ${pose.connections.length}`);
    const shoulderLink = pose.connections.find((c) => c.name === 'shoulders');
    assert.ok(shoulderLink, 'Shoulder link must exist');
    assert.ok(shoulderLink.confidence > 0.8, 'Shoulder link must have high confidence');

    const leftArmLink = pose.connections.find((c) => c.name === 'left_upper_arm');
    assert.ok(leftArmLink, 'Left upper arm link must exist');
  });

  await t.test('Test 5: Standing pose (BM-09) exhibits anatomical vertical consistency', () => {
    const rawStanding = createSyntheticStandingPose(0.5, 0.5, 1.0);
    const pose = mapMediaPipePoseToBodyPose(rawStanding);

    // In standing pose: Head Y < Shoulders Y < Hips Y < Knees Y < Ankles Y
    assert.ok(pose.nose!.point.y < pose.leftShoulder!.point.y, 'Nose must be above shoulders');
    assert.ok(pose.leftShoulder!.point.y < pose.leftHip!.point.y, 'Shoulders must be above hips');
    assert.ok(pose.leftHip!.point.y < pose.leftKnee!.point.y, 'Hips must be above knees');
    assert.ok(pose.leftKnee!.point.y < pose.leftAnkle!.point.y, 'Knees must be above ankles');

    // Bilateral shoulder and hip width
    const shoulderWidth = Math.abs(pose.rightShoulder!.point.x - pose.leftShoulder!.point.x);
    const hipWidth = Math.abs(pose.rightHip!.point.x - pose.leftHip!.point.x);
    assert.ok(shoulderWidth > hipWidth, 'Shoulder width should exceed or equal hip width in anatomical reference');
  });

  await t.test('Test 6: Seated pose (BM-10) correctly represents flexed sitting posture', () => {
    const rawSitting = createSyntheticSeatedPose();
    const pose = mapMediaPipePoseToBodyPose(rawSitting);

    assert.ok(pose.leftHip, 'Hip must exist');
    assert.ok(pose.leftKnee, 'Knee must exist');
    assert.ok(pose.leftAnkle, 'Ankle must exist');

    // In sitting posture, torso height (shoulder to hip) is distinct from thigh displacement
    const torsoYDist = pose.leftHip!.point.y - pose.leftShoulder!.point.y;
    assert.ok(torsoYDist > 0.1, 'Torso height must be non-zero');
    // Knees project forward
    assert.ok(pose.leftKnee!.point.y > pose.leftHip!.point.y);
  });

  await t.test('Test 7: Visibility thresholds enforce visible vs. occluded semantics', () => {
    assert.strictEqual(mapVisibility(0.95), 'visible');
    assert.strictEqual(mapVisibility(0.65), 'visible');
    assert.strictEqual(mapVisibility(0.50), 'uncertain');
    assert.strictEqual(mapVisibility(0.35), 'uncertain');
    assert.strictEqual(mapVisibility(0.20), 'occluded');
    assert.strictEqual(mapVisibility(0.0), 'occluded');
    assert.strictEqual(mapVisibility(undefined), 'uncertain');
  });

  await t.test('Test 8: mapMediaPipePoseToBodyFeatures constructs structured ContourPaths', () => {
    const rawStanding = createSyntheticStandingPose(0.5, 0.5, 1.0);
    const features = mapMediaPipePoseToBodyFeatures(rawStanding);

    assert.ok(features.pose, 'Articulated pose must be present');
    assert.ok(features.shoulders.length > 0, 'Shoulders contour must be present');
    assert.ok(features.arms.length === 2, 'Arms contours must have left and right paths');
    assert.ok(features.torso.length === 1, 'Torso contour must be present');
    assert.ok(features.legs.length === 2, 'Legs contours must have left and right paths');
    assert.strictEqual(features.torso[0].closed, true, 'Torso polygon must be closed');
  });

  await t.test('Test 9: Multi-person pose isolation (BM-11) preserves independent subjects', () => {
    const person1Raw = createSyntheticStandingPose(0.25, 0.5, 0.8);
    const person2Raw = createSyntheticStandingPose(0.75, 0.5, 0.8);

    const dims = { width: 1024, height: 1024, aspectRatio: '1:1', megapixels: 1.0 };
    const unified = associateFacesAndPoses([], [person1Raw, person2Raw], dims);

    assert.strictEqual(unified.length, 2, 'Must yield 2 independent SubjectModels');
    assert.ok(unified[0].boundingBox.x < unified[1].boundingBox.x, 'Person 1 must be left of Person 2');
    assert.ok(unified[0].body?.pose, 'Person 1 must have pose');
    assert.ok(unified[1].body?.pose, 'Person 2 must have pose');

    // Bounding boxes should not completely overlap
    assert.ok(unified[0].boundingBox.x + unified[0].boundingBox.width <= unified[1].boundingBox.x + 0.1);
  });

  await t.test('Test 10: Face + Pose association unifies matching instances into single SubjectModel', () => {
    const dims = { width: 1024, height: 1024, aspectRatio: '1:1', megapixels: 1.0 };
    const rawPose = createSyntheticStandingPose(0.5, 0.5, 1.0);

    const faceSubject: SubjectModel = {
      id: 'face-sub-1',
      version: '1.0.0',
      sourceDimensions: dims,
      boundingBox: { x: 0.45, y: 0.12, width: 0.10, height: 0.12 },
      silhouette: [],
      face: {
        confidence: 0.95,
      },
      globalConfidence: 0.95,
      timestamp: Date.now(),
    };

    const unified = associateFacesAndPoses([faceSubject], [rawPose], dims);

    assert.strictEqual(unified.length, 1, 'Must merge single face and single pose into 1 SubjectModel');
    const combined = unified[0];
    assert.ok(combined.face, 'Combined subject must retain face');
    assert.ok(combined.body?.pose, 'Combined subject must retain body pose');
    assert.ok(combined.boundingBox.height > faceSubject.boundingBox.height, 'Combined bounding box must expand to cover body');
  });

  await t.test('Test 11: MediaPipeWebDelegate starts uninitialized and disposes cleanly', () => {
    const delegate = new MediaPipeWebDelegate();
    assert.strictEqual(delegate.getState(), 'uninitialized');
    assert.strictEqual(delegate.isReady('face'), false);
    assert.strictEqual(delegate.isReady('pose'), false);

    delegate.dispose();
    assert.strictEqual(delegate.getState(), 'uninitialized');
  });
});
