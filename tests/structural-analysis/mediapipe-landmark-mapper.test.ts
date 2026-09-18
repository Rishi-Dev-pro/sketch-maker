/**
 * MediaPipe Landmark Mapper Unit Tests (TASK-103.7)
 *
 * Deterministic, offline unit tests verifying:
 * 1. Normalized coordinate bounds [0.0, 1.0] and clamping.
 * 2. Frontal landmark mapping to canonical FacialFeatures and SubjectModel.
 * 3. Profile pose derivation and explicit occlusion semantics (BM-02).
 * 4. Multi-person mapping and ordering (BM-11).
 * 5. MediaPipe external ear absence and deterministic preservation.
 * 6. Delegate lifecycle and error handling.
 *
 * NOTE: Operates with ZERO network or remote model dependencies.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  mapMediaPipeToFacialFeatures,
  mapMediaPipeFacesToSubjectModels,
  deriveHeadPoseFromLandmarks,
  MediaPipeLandmark3D,
  FACEMESH_TOPOLOGY,
} from '../../apps/web/src/vision/mediapipe/landmark-mapper';
import { MediaPipeWebDelegate } from '../../apps/web/src/vision/mediapipe/mediapipe-delegate';

/**
 * Creates a synthetic 478-point MediaPipe face landmark array.
 */
function createSyntheticLandmarks(options: {
  centerX?: number;
  centerY?: number;
  width?: number;
  height?: number;
  noseOffsetX?: number; // Shifts nose to simulate head yaw
} = {}): MediaPipeLandmark3D[] {
  const cx = options.centerX ?? 0.5;
  const cy = options.centerY ?? 0.5;
  const w = options.width ?? 0.3;
  const h = options.height ?? 0.4;
  const noseOffX = options.noseOffsetX ?? 0.0;

  const landmarks: MediaPipeLandmark3D[] = [];
  for (let i = 0; i < 478; i++) {
    // Default placeholder
    landmarks.push({ x: cx, y: cy, z: 0.0 });
  }

  // Set eyes
  // Left eye (viewer's right in frontal: x ~ 0.60)
  for (const idx of FACEMESH_TOPOLOGY.LEFT_EYE_UPPER) {
    landmarks[idx] = { x: cx + w * 0.35, y: cy - h * 0.15, z: 0.01 };
  }
  for (const idx of FACEMESH_TOPOLOGY.LEFT_EYE_LOWER) {
    landmarks[idx] = { x: cx + w * 0.35, y: cy - h * 0.10, z: 0.01 };
  }
  landmarks[FACEMESH_TOPOLOGY.LEFT_IRIS_CENTER] = { x: cx + w * 0.35, y: cy - h * 0.125, z: 0.01 };

  // Right eye (viewer's left in frontal: x ~ 0.40)
  for (const idx of FACEMESH_TOPOLOGY.RIGHT_EYE_UPPER) {
    landmarks[idx] = { x: cx - w * 0.35, y: cy - h * 0.15, z: 0.01 };
  }
  for (const idx of FACEMESH_TOPOLOGY.RIGHT_EYE_LOWER) {
    landmarks[idx] = { x: cx - w * 0.35, y: cy - h * 0.10, z: 0.01 };
  }
  landmarks[FACEMESH_TOPOLOGY.RIGHT_IRIS_CENTER] = { x: cx - w * 0.35, y: cy - h * 0.125, z: 0.01 };

  // Eyebrows
  for (const idx of FACEMESH_TOPOLOGY.LEFT_EYEBROW) {
    landmarks[idx] = { x: cx + w * 0.35, y: cy - h * 0.25, z: 0.02 };
  }
  for (const idx of FACEMESH_TOPOLOGY.RIGHT_EYEBROW) {
    landmarks[idx] = { x: cx - w * 0.35, y: cy - h * 0.25, z: 0.02 };
  }

  // Nose
  landmarks[FACEMESH_TOPOLOGY.NOSE_TIP] = { x: cx + noseOffX, y: cy, z: -0.05 };
  for (const idx of FACEMESH_TOPOLOGY.NOSE_BRIDGE) {
    landmarks[idx] = { x: cx + noseOffX * 0.5, y: cy - h * 0.15 + (idx % 3) * 0.05, z: -0.02 };
  }
  for (const idx of FACEMESH_TOPOLOGY.NOSE_LEFT_ALA) {
    landmarks[idx] = { x: cx + noseOffX + 0.04, y: cy + 0.02, z: -0.01 };
  }
  for (const idx of FACEMESH_TOPOLOGY.NOSE_RIGHT_ALA) {
    landmarks[idx] = { x: cx + noseOffX - 0.04, y: cy + 0.02, z: -0.01 };
  }

  // Mouth
  for (const idx of FACEMESH_TOPOLOGY.LIP_UPPER_VERMILION) {
    landmarks[idx] = { x: cx, y: cy + h * 0.20, z: 0.0 };
  }
  for (const idx of FACEMESH_TOPOLOGY.LIP_LOWER_VERMILION) {
    landmarks[idx] = { x: cx, y: cy + h * 0.26, z: 0.0 };
  }
  for (const idx of FACEMESH_TOPOLOGY.ORAL_FISSURE_SEAM) {
    landmarks[idx] = { x: cx, y: cy + h * 0.23, z: 0.0 };
  }

  // Face Oval
  FACEMESH_TOPOLOGY.FACE_OVAL.forEach((idx, step) => {
    const angle = (step / FACEMESH_TOPOLOGY.FACE_OVAL.length) * Math.PI * 2;
    landmarks[idx] = {
      x: cx + Math.cos(angle) * (w * 0.5),
      y: cy + Math.sin(angle) * (h * 0.5),
      z: 0.0,
    };
  });

  // Chin and Forehead
  landmarks[FACEMESH_TOPOLOGY.CHIN_APEX] = { x: cx, y: cy + h * 0.5, z: 0.0 };
  landmarks[FACEMESH_TOPOLOGY.FOREHEAD_TOP] = { x: cx, y: cy - h * 0.5, z: 0.0 };

  // Tragus anchors
  landmarks[FACEMESH_TOPOLOGY.LEFT_TRAGUS_ATTACHMENT] = { x: cx + w * 0.5, y: cy - h * 0.1, z: 0.05 };
  landmarks[FACEMESH_TOPOLOGY.RIGHT_TRAGUS_ATTACHMENT] = { x: cx - w * 0.5, y: cy - h * 0.1, z: 0.05 };

  return landmarks;
}

describe('MediaPipe Face Landmarker Integration (TASK-103.7)', () => {
  it('Test 1: Normalized coordinates are clamped strictly within [0.0, 1.0]', () => {
    const outOfBoundsLandmarks = createSyntheticLandmarks();
    // Intentionally inject out-of-bounds coordinate values
    outOfBoundsLandmarks[FACEMESH_TOPOLOGY.NOSE_TIP] = { x: 1.25, y: -0.15, z: 0 };

    const face = mapMediaPipeToFacialFeatures(outOfBoundsLandmarks);
    assert.strictEqual(face.noseTip?.points[0].x, 1.0);
    assert.strictEqual(face.noseTip?.points[0].y, 0.0);
  });

  it('Test 2: Frontal face landmarks map accurately to canonical FacialFeatures', () => {
    const frontalLandmarks = createSyntheticLandmarks({ noseOffsetX: 0.0 });
    const face = mapMediaPipeToFacialFeatures(frontalLandmarks);

    assert.strictEqual(face.pose, 'frontal');
    assert.strictEqual(face.leftEye.visibility, 'visible');
    assert.strictEqual(face.rightEye.visibility, 'visible');
    assert.ok(face.leftEye.iris !== undefined, 'Left iris center should be mapped');
    assert.ok(face.rightEye.iris !== undefined, 'Right iris center should be mapped');
    assert.strictEqual(face.leftEyebrow?.visibility, 'visible');
    assert.strictEqual(face.rightEyebrow?.visibility, 'visible');
    assert.ok(face.noseBridge !== undefined);
    assert.ok(face.upperLip !== undefined);
    assert.ok(face.lowerLip !== undefined);
    assert.ok(face.lipSeparation !== undefined);
    assert.ok(face.jawline !== undefined);
    assert.ok(face.chin !== undefined);
  });

  it('Test 3: MediaPipe does NOT fabricate external ear pinna geometry', () => {
    const landmarks = createSyntheticLandmarks();
    const face = mapMediaPipeToFacialFeatures(landmarks);

    // Architectural guarantee: MediaPipe FaceMesh omits ear pinna
    assert.strictEqual(face.leftEar, undefined);
    assert.strictEqual(face.rightEar, undefined);
    assert.strictEqual(face.featureVisibility?.leftEar, 'not_detected');
    assert.strictEqual(face.featureVisibility?.rightEar, 'not_detected');
  });

  it('Test 4: Profile pose derivation strictly enforces occlusion semantics (BM-02)', () => {
    // Subject looking far left -> nose tip shifted strongly toward viewer's left
    const leftProfileLandmarks = createSyntheticLandmarks({
      centerX: 0.40,
      noseOffsetX: -0.15,
    });

    const { pose } = deriveHeadPoseFromLandmarks(leftProfileLandmarks);
    assert.strictEqual(pose, 'left_profile');

    const face = mapMediaPipeToFacialFeatures(leftProfileLandmarks);
    assert.strictEqual(face.pose, 'left_profile');

    // In left_profile, far side eye/brow/nostril (viewer's right) must be marked occluded
    assert.strictEqual(face.rightEye.visibility, 'occluded');
    assert.strictEqual(face.rightEye.iris, undefined, 'Occluded eye iris must not be fabricated');
    assert.strictEqual(face.rightEyebrow?.visibility, 'occluded');
    assert.strictEqual(face.leftEye.visibility, 'visible');
  });

  it('Test 5: Multi-person faces map cleanly to SubjectModels with independent bounding boxes (BM-11)', () => {
    const face1 = createSyntheticLandmarks({ centerX: 0.30, centerY: 0.40, width: 0.20, height: 0.30 });
    const face2 = createSyntheticLandmarks({ centerX: 0.70, centerY: 0.40, width: 0.20, height: 0.30 });

    const subjects = mapMediaPipeFacesToSubjectModels(
      [face1, face2],
      { width: 1024, height: 1024 },
      0.92
    );

    assert.strictEqual(subjects.length, 2);
    assert.strictEqual(subjects[0].id, 'subject-mediapipe-1');
    assert.strictEqual(subjects[1].id, 'subject-mediapipe-2');

    assert.ok(subjects[0].boundingBox.x < subjects[1].boundingBox.x);
    assert.ok(subjects[0].silhouette.length > 0);
    assert.ok(subjects[1].silhouette.length > 0);
  });

  it('Test 6: MediaPipeWebDelegate starts in uninitialized state and isReady() is false', () => {
    const delegate = new MediaPipeWebDelegate();
    assert.strictEqual(delegate.getState(), 'uninitialized');
    assert.strictEqual(delegate.isReady(), false);

    const metrics = delegate.getMetrics();
    assert.strictEqual(metrics.totalInferences, 0);
    assert.strictEqual(metrics.coldStartDurationMs, 0);
  });

  it('Test 7: MediaPipeWebDelegate disposal cleans up resources cleanly', () => {
    const delegate = new MediaPipeWebDelegate();
    delegate.dispose();
    assert.strictEqual(delegate.getState(), 'uninitialized');
    assert.strictEqual(delegate.isReady(), false);
  });
});
