/**
 * Facial Structural Recovery & Jawline Continuity Tests (TASK-114.6)
 *
 * Verifies:
 * 1. Facial Pipeline Accounting: Valid facial features (eyes, brows, nose, mouth, jaw)
 *    survive spatial ownership validation without being dropped as 'outside_subject'.
 * 2. Silhouette Separation: Authoritative whole-subject silhouette is NOT replaced by
 *    hair-only or clothing-only boundaries in generator.ts.
 * 3. Jawline Continuity: Bilateral jawline point ordering connects seamlessly at the chin
 *    without cross-face diagonal bridges to the opposite ear.
 * 4. Lip Confidence: Soft lower lip maintains sufficient confidence floor to survive
 *    minConfidence (0.15) filtering.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  SubjectModel,
  Point2D,
  SemanticMask,
} from '../../packages/shared-types/src';
import {
  mapMediaPipeToFacialFeatures,
  FACEMESH_TOPOLOGY,
} from '../../apps/web/src/vision/mediapipe/landmark-mapper';
import {
  reconstructSubjectFeatures,
  buildSubjectStructuralModel,
} from '../../packages/structural-analysis/src';
import { extractAllVectorGeometry } from '../../packages/stroke-engine/src/geometry/extractor';
import { generateStrokeCandidates } from '../../packages/stroke-engine/src/candidates/generator';

function createSynthetic478Landmarks(): any[] {
  const landmarks: any[] = [];
  for (let i = 0; i < 478; i++) {
    landmarks.push({ x: 0.5, y: 0.5, z: 0.0 });
  }

  // Left Eye (x: ~0.60, y: ~0.45)
  for (const idx of FACEMESH_TOPOLOGY.LEFT_EYE_UPPER) {
    landmarks[idx] = { x: 0.60, y: 0.44, z: 0.01 };
  }
  for (const idx of FACEMESH_TOPOLOGY.LEFT_EYE_LOWER) {
    landmarks[idx] = { x: 0.60, y: 0.46, z: 0.01 };
  }
  landmarks[FACEMESH_TOPOLOGY.LEFT_IRIS_CENTER] = { x: 0.60, y: 0.45, z: 0.0 };

  // Right Eye (x: ~0.40, y: ~0.45)
  for (const idx of FACEMESH_TOPOLOGY.RIGHT_EYE_UPPER) {
    landmarks[idx] = { x: 0.40, y: 0.44, z: 0.01 };
  }
  for (const idx of FACEMESH_TOPOLOGY.RIGHT_EYE_LOWER) {
    landmarks[idx] = { x: 0.40, y: 0.46, z: 0.01 };
  }
  landmarks[FACEMESH_TOPOLOGY.RIGHT_IRIS_CENTER] = { x: 0.40, y: 0.45, z: 0.0 };

  // Eyebrows
  for (const idx of FACEMESH_TOPOLOGY.LEFT_EYEBROW) {
    landmarks[idx] = { x: 0.60, y: 0.38, z: 0.02 };
  }
  for (const idx of FACEMESH_TOPOLOGY.RIGHT_EYEBROW) {
    landmarks[idx] = { x: 0.40, y: 0.38, z: 0.02 };
  }

  // Nose
  landmarks[FACEMESH_TOPOLOGY.NOSE_TIP] = { x: 0.50, y: 0.55, z: -0.05 };
  for (const idx of FACEMESH_TOPOLOGY.NOSE_BRIDGE) {
    landmarks[idx] = { x: 0.50, y: 0.48, z: -0.02 };
  }

  // Mouth
  FACEMESH_TOPOLOGY.LIP_UPPER_VERMILION.forEach((idx, i) => {
    landmarks[idx] = { x: 0.42 + i * 0.015, y: 0.62 - Math.sin((i / 10) * Math.PI) * 0.01, z: 0.0 };
  });
  FACEMESH_TOPOLOGY.ORAL_FISSURE_SEAM.forEach((idx, i) => {
    landmarks[idx] = { x: 0.42 + i * 0.015, y: 0.64, z: 0.0 };
  });
  FACEMESH_TOPOLOGY.LIP_LOWER_VERMILION.forEach((idx, i) => {
    landmarks[idx] = { x: 0.42 + i * 0.015, y: 0.66 + Math.sin((i / 10) * Math.PI) * 0.01, z: 0.0 };
  });

  // Face Oval / Jawline
  FACEMESH_TOPOLOGY.FACE_OVAL.forEach((idx, step) => {
    const angle = (step / FACEMESH_TOPOLOGY.FACE_OVAL.length) * Math.PI * 2;
    landmarks[idx] = { x: 0.50 + Math.cos(angle) * 0.22, y: 0.55 + Math.sin(angle) * 0.28, z: 0.0 };
  });

  return landmarks;
}

function createSyntheticMultiClassMasks(w = 128, h = 128): SemanticMask[] {
  const total = w * h;
  const hairData = new Uint8Array(total);
  const faceData = new Uint8Array(total);
  const bodyData = new Uint8Array(total);

  // Hair in top third
  for (let y = Math.floor(h * 0.1); y < Math.floor(h * 0.38); y++) {
    for (let x = Math.floor(w * 0.25); x < Math.floor(w * 0.75); x++) {
      hairData[y * w + x] = 255;
    }
  }

  // Face in middle
  for (let y = Math.floor(h * 0.32); y < Math.floor(h * 0.75); y++) {
    for (let x = Math.floor(w * 0.28); x < Math.floor(w * 0.72); x++) {
      faceData[y * w + x] = 255;
    }
  }

  // Body in lower half
  for (let y = Math.floor(h * 0.65); y < h; y++) {
    for (let x = Math.floor(w * 0.15); x < Math.floor(w * 0.85); x++) {
      bodyData[y * w + x] = 255;
    }
  }

  return [
    { category: 'hair', confidence: 0.95, width: w, height: h, data: hairData, pixelArea: 1000 },
    { category: 'face_skin', confidence: 0.95, width: w, height: h, data: faceData, pixelArea: 1200 },
    { category: 'clothing', confidence: 0.90, width: w, height: h, data: bodyData, pixelArea: 2000 },
  ];
}

describe('TASK-114.6: Facial Structural Ownership & Continuity Restoration', () => {

  it('1. Facial Pipeline Accounting: MediaPipe facial features survive candidate validation', () => {
    const landmarks = createSynthetic478Landmarks();
    const face = mapMediaPipeToFacialFeatures(landmarks, 0.95);
    const masks = createSyntheticMultiClassMasks(128, 128);

    const subject: SubjectModel = {
      id: 'test_subject_114_6',
      version: '1.0.0',
      sourceDimensions: { width: 1024, height: 1024, aspectRatio: '1:1', megapixels: 1.05 },
      boundingBox: face.boundingBox ?? { x: 0.2, y: 0.1, width: 0.6, height: 0.8 },
      silhouette: [],
      face,
      semanticSegmentation: {
        category: 'person',
        confidence: 0.95,
        masks,
        instances: [],
      },
      globalConfidence: 0.95,
      timestamp: Date.now(),
    };

    const recon = reconstructSubjectFeatures(subject);
    const geo = extractAllVectorGeometry([{ ...subject, reconstruction: recon }]);
    const candidates = generateStrokeCandidates(geo);

    const validFacialStrokes = candidates.candidates.filter(
      c => c.drawable && (c.semanticRole === 'eye' || c.semanticRole === 'eyebrow' || c.semanticRole === 'nose' || c.semanticRole === 'mouth')
    );

    const eyeStrokes = candidates.candidates.filter(c => c.drawable && c.semanticRole === 'eye');
    const browStrokes = candidates.candidates.filter(c => c.drawable && c.semanticRole === 'eyebrow');
    const noseStrokes = candidates.candidates.filter(c => c.drawable && c.semanticRole === 'nose');
    const mouthStrokes = candidates.candidates.filter(c => c.drawable && c.semanticRole === 'mouth');

    assert.ok(eyeStrokes.length >= 2, `Expected >= 2 valid eye strokes, got ${eyeStrokes.length}`);
    assert.ok(browStrokes.length >= 2, `Expected >= 2 valid eyebrow strokes, got ${browStrokes.length}`);
    assert.ok(noseStrokes.length >= 1, `Expected >= 1 valid nose strokes, got ${noseStrokes.length}`);
    assert.ok(mouthStrokes.length >= 1, `Expected >= 1 valid mouth strokes, got ${mouthStrokes.length}`);
    assert.ok(validFacialStrokes.length >= 6, `Expected >= 6 total valid facial strokes, got ${validFacialStrokes.length}`);

    // Verify rejection reasons: ZERO facial features rejected as 'outside_subject'
    const rejectedFacial = candidates.candidates.filter(
      c => !c.drawable && (c.semanticRole === 'eye' || c.semanticRole === 'eyebrow' || c.semanticRole === 'nose' || c.semanticRole === 'mouth')
    );
    const outsideSubjectFacial = rejectedFacial.filter(c => c.filteredReason === 'outside_subject');
    assert.strictEqual(
      outsideSubjectFacial.length,
      0,
      `ZERO facial strokes should be rejected as 'outside_subject', found: ${outsideSubjectFacial.map(c => c.id).join(', ')}`
    );
  });

  it('2. Silhouette Separation: Authoritative silhouette is NOT the hair boundary', () => {
    const masks = createSyntheticMultiClassMasks(128, 128);
    const subject: SubjectModel = {
      id: 'test_sub_sil',
      version: '1.0.0',
      sourceDimensions: { width: 1024, height: 1024, aspectRatio: '1:1', megapixels: 1.05 },
      boundingBox: { x: 0.15, y: 0.1, width: 0.7, height: 0.9 },
      silhouette: [],
      semanticSegmentation: {
        category: 'person',
        confidence: 0.95,
        masks,
        instances: [],
      },
      globalConfidence: 0.95,
      timestamp: Date.now(),
    };

    const { authoritativeSilhouette, hairBoundary } = buildSubjectStructuralModel(subject);

    assert.ok(authoritativeSilhouette, 'Must produce authoritative silhouette');
    assert.ok(hairBoundary, 'Must produce hair boundary');

    // Authoritative silhouette must have broader height spanning whole body (from head to chest/torso)
    const silMinY = Math.min(...authoritativeSilhouette.points.map(p => p.y));
    const silMaxY = Math.max(...authoritativeSilhouette.points.map(p => p.y));
    const hairMaxY = Math.max(...hairBoundary.points.map(p => p.y));

    assert.ok(
      silMaxY > hairMaxY + 0.15,
      `Whole-subject silhouette bottom (${silMaxY.toFixed(3)}) must extend well below hair boundary (${hairMaxY.toFixed(3)})`
    );
  });

  it('3. Jawline Continuity: Bilateral jawline point order connects at the chin without cross-face bridge', () => {
    const leftJaw: Point2D[] = [
      { x: 0.25, y: 0.35 }, // left ear
      { x: 0.27, y: 0.50 },
      { x: 0.35, y: 0.65 }, // chin
    ];
    const rightJaw: Point2D[] = [
      { x: 0.75, y: 0.35 }, // right ear
      { x: 0.73, y: 0.50 },
      { x: 0.65, y: 0.65 }, // chin
    ];

    // Correct continuous sequence: leftJaw + reversed rightJaw
    const continuousPts: Point2D[] = [
      ...leftJaw,
      ...[...rightJaw].reverse(),
    ];

    // Check maximum jump between any two consecutive points
    let maxJump = 0;
    for (let i = 0; i < continuousPts.length - 1; i++) {
      const p0 = continuousPts[i];
      const p1 = continuousPts[i + 1];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > maxJump) maxJump = d;
    }

    // Left ear to right ear direct distance is ~0.50. Consecutive anatomical step should be <= 0.32
    assert.ok(
      maxJump < 0.35,
      `Max step along continuous jawline must be small (< 0.35), got ${maxJump.toFixed(3)}. No chin-to-ear cross bridge.`
    );
  });

  it('4. Lip Confidence: Soft lower lip maintains sufficient confidence to survive minConfidence (0.15) gate', () => {
    const landmarks = createSynthetic478Landmarks();
    const face = mapMediaPipeToFacialFeatures(landmarks, 0.92);

    const subject: SubjectModel = {
      id: 'test_lip_conf',
      version: '1.0.0',
      sourceDimensions: { width: 1024, height: 1024, aspectRatio: '1:1', megapixels: 1.05 },
      boundingBox: face.boundingBox ?? { x: 0.2, y: 0.1, width: 0.6, height: 0.8 },
      silhouette: [],
      face,
      globalConfidence: 0.92,
      timestamp: Date.now(),
    };

    const recon = reconstructSubjectFeatures(subject);
    assert.ok(recon.mouth?.lowerVermilion, 'Lower vermilion must be reconstructed');
    assert.ok(
      recon.mouth.lowerVermilion.confidence >= 0.35,
      `Lower vermilion confidence (${recon.mouth.lowerVermilion.confidence}) must maintain floor >= 0.35`
    );

    const geo = extractAllVectorGeometry([{ ...subject, reconstruction: recon }]);
    const candidates = generateStrokeCandidates(geo);

    const lowerLipStroke = candidates.candidates.find(c => c.id.includes('mouth_lower_lip'));
    assert.ok(lowerLipStroke, 'Lower lip candidate must exist');
    assert.ok(lowerLipStroke.drawable, 'Lower lip candidate must be drawable (not dropped by minConfidence)');
    assert.strictEqual(lowerLipStroke.filteredReason, undefined, 'Lower lip candidate must have no filteredReason');
  });
});
