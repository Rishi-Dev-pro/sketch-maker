import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  cleanSubjectSegmentation,
  labelConnectedComponents,
  traceOuterBoundary,
  smoothClosedPolyline,
  simplifyPolylineRDP,
  extractAuthoritativeSilhouette,
  isPointInMask,
  clipPolylineToMask,
  buildSubjectStructuralModel,
} from '../../packages/structural-analysis/src/silhouette';
import {
  validateAndClipSpatialOwnership,
  isPointInPolygonWithMargin,
} from '../../packages/stroke-engine/src/candidates/spatial-validator';
import {
  generateStrokeCandidates,
} from '../../packages/stroke-engine/src/candidates/generator';
import {
  SubjectModel,
  VectorGeometry,
  VectorPath,
  SemanticMask,
  Point2D,
} from '../../packages/shared-types/src';

describe('TASK-114: Segmentation-Anchored Structural Reconstruction', () => {

  it('1. Connected Component Labeling & Small Side Artifact Removal', () => {
    const W = 100;
    const H = 100;
    const rawMask = new Uint8Array(W * H);

    // Primary subject in center: 40x50 block (2000 pixels)
    for (let y = 30; y < 80; y++) {
      for (let x = 30; x < 70; x++) {
        rawMask[y * W + x] = 255;
      }
    }

    // Small disconnected side artifact: 3x3 block (9 pixels) in top-left corner
    for (let y = 2; y < 5; y++) {
      for (let x = 2; x < 5; x++) {
        rawMask[y * W + x] = 255;
      }
    }

    // Disconnected noise speckle: 2x2 block (4 pixels) in top-right
    for (let y = 5; y < 7; y++) {
      for (let x = 90; x < 92; x++) {
        rawMask[y * W + x] = 255;
      }
    }

    const res = cleanSubjectSegmentation(rawMask, W, H, {
      minAreaFraction: 0.02,
      minAbsolutePixels: 50,
      closingRadius: 1,
      openingRadius: 1,
    });

    assert.strictEqual(res.componentCount, 3, 'Raw mask should have 3 components');
    assert.strictEqual(res.retainedComponentCount, 1, 'Only primary component should be retained');
    assert.ok(res.removedArtifactArea >= 13, 'Artifact area (9 + 4 = 13) should be removed');
    assert.strictEqual(res.cleanMask[3 * W + 3], 0, 'Side artifact pixel must be cleared to 0');
    assert.strictEqual(res.cleanMask[50 * W + 50], 255, 'Center subject pixel must be preserved as 255');
  });

  it('2. Authoritative Boundary Tracing, Gaussian Smoothing, and RDP Simplification', () => {
    const W = 100;
    const H = 100;
    const cleanMask = new Uint8Array(W * H);

    // Square subject in center: 40x40
    for (let y = 30; y < 70; y++) {
      for (let x = 30; x < 70; x++) {
        cleanMask[y * W + x] = 255;
      }
    }

    const { authoritativeSilhouette } = extractAuthoritativeSilhouette(cleanMask, W, H, 'test_subject_1', {
      simplificationTolerance: 0.002,
      smoothingPasses: 2,
    });

    assert.ok(authoritativeSilhouette, 'Authoritative silhouette must be generated');
    assert.strictEqual(authoritativeSilhouette.region, 'body_outline');
    assert.strictEqual(authoritativeSilhouette.closed, true);
    assert.ok(authoritativeSilhouette.points.length >= 4, 'Silhouette should have >= 4 points');

    // All points must be within [0.0, 1.0]
    for (const pt of authoritativeSilhouette.points) {
      assert.ok(pt.x >= 0.0 && pt.x <= 1.0, `X coordinate ${pt.x} must be in [0, 1]`);
      assert.ok(pt.y >= 0.0 && pt.y <= 1.0, `Y coordinate ${pt.y} must be in [0, 1]`);
    }

    // Points should span approximately [0.30, 0.70]
    const xs = authoritativeSilhouette.points.map(p => p.x);
    const ys = authoritativeSilhouette.points.map(p => p.y);
    assert.ok(Math.min(...xs) <= 0.35 && Math.max(...xs) >= 0.65, 'Silhouette X span must match shape');
    assert.ok(Math.min(...ys) <= 0.35 && Math.max(...ys) >= 0.65, 'Silhouette Y span must match shape');
  });

  it('3. Pose Anchoring: Pose landmarks outside segmentation are constrained', () => {
    const W = 100;
    const H = 100;
    const maskData = new Uint8Array(W * H);
    // Torso in center
    for (let y = 30; y < 80; y++) {
      for (let x = 35; x < 65; x++) {
        maskData[y * W + x] = 255;
      }
    }

    const subject: SubjectModel = {
      id: 'subject_pose_test',
      version: '1.0.0',
      sourceDimensions: { width: W, height: H, aspectRatio: '1:1', megapixels: 0.01 },
      boundingBox: { x: 0.35, y: 0.3, width: 0.3, height: 0.5 },
      silhouette: [],
      body: {
        pose: {
          confidence: 0.85,
          leftShoulder: { point: { x: 0.40, y: 0.40 }, visibility: 'visible', confidence: 0.9 }, // inside
          rightShoulder: { point: { x: 0.60, y: 0.40 }, visibility: 'visible', confidence: 0.9 }, // inside
          connections: [
            {
              from: { x: 0.40, y: 0.40 },
              to: { x: 0.60, y: 0.40 },
              confidence: 0.9,
              name: 'shoulder_line',
            },
            {
              from: { x: 0.40, y: 0.40 },
              to: { x: 0.05, y: 0.40 }, // Stray connection into empty background
              confidence: 0.9,
              name: 'stray_arm',
            },
          ],
        },
      },
      globalConfidence: 0.9,
      timestamp: Date.now(),
    };

    const masks: SemanticMask[] = [{
      category: 'clothing',
      confidence: 0.9,
      width: W,
      height: H,
      data: maskData,
      pixelArea: 1500,
    }];

    const { structuralModel } = buildSubjectStructuralModel(subject, masks);
    assert.ok(structuralModel.subjects[0].pose, 'Constrained pose must be present');
    const conns = structuralModel.subjects[0].pose?.connections ?? [];
    assert.strictEqual(conns.length, 1, 'Stray connection outside subject must be removed');
    assert.strictEqual(conns[0].name, 'shoulder_line', 'Only valid inside connection should be retained');
  });

  it('4. Multi-Person Isolation (BM-11): Subjects retain independent IDs and silhouettes', () => {
    const W = 100;
    const H = 100;
    const maskData = new Uint8Array(W * H);

    // Person 1 on left: x in [10, 40]
    for (let y = 20; y < 80; y++) {
      for (let x = 10; x < 40; x++) {
        maskData[y * W + x] = 255;
      }
    }

    // Person 2 on right: x in [60, 90]
    for (let y = 20; y < 80; y++) {
      for (let x = 60; x < 90; x++) {
        maskData[y * W + x] = 255;
      }
    }

    const sub1: SubjectModel = {
      id: 'subject_1',
      version: '1.0.0',
      sourceDimensions: { width: W, height: H, aspectRatio: '1:1', megapixels: 0.01 },
      boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.6 },
      face: { boundingBox: { x: 0.15, y: 0.2, width: 0.2, height: 0.25 } },
      silhouette: [],
      globalConfidence: 0.9,
      timestamp: Date.now(),
    };

    const sub2: SubjectModel = {
      id: 'subject_2',
      version: '1.0.0',
      sourceDimensions: { width: W, height: H, aspectRatio: '1:1', megapixels: 0.01 },
      boundingBox: { x: 0.6, y: 0.2, width: 0.3, height: 0.6 },
      face: { boundingBox: { x: 0.65, y: 0.2, width: 0.2, height: 0.25 } },
      silhouette: [],
      globalConfidence: 0.9,
      timestamp: Date.now(),
    };

    const masks: SemanticMask[] = [{
      category: 'clothing',
      confidence: 0.9,
      width: W,
      height: H,
      data: maskData,
      pixelArea: 3600,
    }];

    const m1 = buildSubjectStructuralModel(sub1, masks);
    const m2 = buildSubjectStructuralModel(sub2, masks);

    assert.strictEqual(m1.structuralModel.subjects[0].subjectId, 'subject_1');
    assert.strictEqual(m2.structuralModel.subjects[0].subjectId, 'subject_2');

    // Subject 1 silhouette points must all be on the left side (x < 0.50)
    for (const p of m1.authoritativeSilhouette.points) {
      assert.ok(p.x < 0.55, `Subject 1 silhouette point (${p.x}, ${p.y}) must stay on left side`);
    }

    // Subject 2 silhouette points must all be on the right side (x > 0.45)
    for (const p of m2.authoritativeSilhouette.points) {
      assert.ok(p.x > 0.45, `Subject 2 silhouette point (${p.x}, ${p.y}) must stay on right side`);
    }
  });

  it('5. Hard Stroke Validation Gate: Rejects strokes outside subject boundary', () => {
    // Subject silhouette box: [0.2, 0.2] to [0.8, 0.8]
    const silPoly: Point2D[] = [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 },
    ];
    const silMap = new Map<string, Point2D[]>([['subject_1', silPoly]]);

    // Valid inside stroke
    const validPts: Point2D[] = [{ x: 0.4, y: 0.4 }, { x: 0.5, y: 0.5 }];
    const resValid = validateAndClipSpatialOwnership(validPts, 'hatching', 'subject_1', silMap);
    assert.strictEqual(resValid.valid, true);

    // Stray external diagonal line outside subject: e.g. [0.02, 0.02] to [0.08, 0.08]
    const strayPts: Point2D[] = [{ x: 0.02, y: 0.02 }, { x: 0.08, y: 0.08 }];
    const resStray = validateAndClipSpatialOwnership(strayPts, 'hatching', 'subject_1', silMap);
    assert.strictEqual(resStray.valid, false);
    assert.strictEqual(resStray.filteredReason, 'outside_subject');
  });

  it('6. Segmentation-Aware Stroke Clipping: Trims strokes crossing the boundary', () => {
    const silPoly: Point2D[] = [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 },
    ];
    const silMap = new Map<string, Point2D[]>([['subject_1', silPoly]]);

    // Stroke starting inside (0.5, 0.5) and exiting to (0.95, 0.5)
    const crossingPts: Point2D[] = [{ x: 0.5, y: 0.5 }, { x: 0.95, y: 0.5 }];
    const res = validateAndClipSpatialOwnership(crossingPts, 'clothing_boundary', 'subject_1', silMap);

    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.wasClipped, true);
    assert.strictEqual(res.points.length, 2);
    // End point should be clipped near border x ≈ 0.80 (+ tolerance)
    assert.ok(res.points[1].x <= 0.84, `Clipped point X ${res.points[1].x} should terminate at boundary`);
  });

  it('7. Rejection Telemetry: Captures and reports detailed metrics in generateStrokeCandidates', () => {
    // Construct VectorGeometry with valid, crossing, and stray external paths
    const silPoly: Point2D[] = [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 },
    ];

    const paths: VectorPath[] = [
      // Foundational silhouette
      {
        id: 'subject_1_authoritative_silhouette',
        source: 'silhouette',
        region: 'body_outline',
        level: 0,
        points: silPoly,
        closed: true,
        confidence: 0.95,
        importance: 0.9,
        length: 2.4,
        bounds: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
        subjectId: 'subject_1',
      },
      // Valid interior eye feature
      {
        id: 'subject_1_eye_upper',
        source: 'reconstructed_feature',
        region: 'eyes',
        level: 2,
        points: [{ x: 0.4, y: 0.35 }, { x: 0.45, y: 0.35 }],
        closed: false,
        confidence: 0.9,
        importance: 0.85,
        length: 0.05,
        bounds: { x: 0.4, y: 0.35, width: 0.05, height: 0.01 },
        subjectId: 'subject_1',
      },
      // Stray external line outside subject
      {
        id: 'subject_1_stray_diagonal',
        source: 'tonal_shading',
        region: 'clothing',
        level: 4,
        points: [{ x: 0.01, y: 0.01 }, { x: 0.05, y: 0.05 }],
        closed: false,
        confidence: 0.8,
        importance: 0.5,
        length: 0.06,
        bounds: { x: 0.01, y: 0.01, width: 0.04, height: 0.04 },
        subjectId: 'subject_1',
      },
      // Occluded path
      {
        id: 'subject_1_occluded_feature',
        source: 'reconstructed_feature',
        region: 'ears',
        level: 2,
        points: [{ x: 0.75, y: 0.35 }, { x: 0.78, y: 0.35 }],
        closed: false,
        confidence: 0.9,
        importance: 0.6,
        length: 0.03,
        bounds: { x: 0.75, y: 0.35, width: 0.03, height: 0.01 },
        visibility: 'occluded',
        subjectId: 'subject_1',
      },
    ];

    const geom: VectorGeometry = {
      version: '1.0.0',
      paths,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      metrics: {
        totalPaths: paths.length,
        totalRawPoints: 10,
        totalSimplifiedPoints: 10,
        pointReductionRatio: 0,
        pathCountByLevel: { 0: 1, 1: 0, 2: 2, 3: 0, 4: 1 },
        pathCountByRegion: {},
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        processingTimeMs: 1.0,
      },
      timestamp: Date.now(),
    };

    const candidateSet = generateStrokeCandidates(geom);
    assert.ok(candidateSet.metrics.rejectionTelemetry, 'Rejection telemetry must be populated');

    const telem = candidateSet.metrics.rejectionTelemetry;
    assert.ok(telem.totalCandidates >= 4, 'Total candidates should be >= 4');
    assert.ok(telem.rejectedOutsideSubject >= 1, 'Stray external line must be counted in rejectedOutsideSubject');
    assert.ok(telem.rejectedOccluded >= 1, 'Occluded feature must be counted in rejectedOccluded');
  });

});
