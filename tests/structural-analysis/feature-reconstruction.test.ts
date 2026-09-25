import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  reconstructEye,
  reconstructEyebrow,
  reconstructNose,
  reconstructMouth,
  reconstructJawChin,
  reconstructEars,
  reconstructHair,
  reconstructBody,
  reconstructSubjectFeatures,
  generateFeatureCoverageReport,
  SubjectModel,
  FacialFeatures,
  ContourPath,
  EyeLandmarks,
  EyebrowLandmarks,
} from '../../packages/structural-analysis/src';

describe('TASK-110: Feature Reconstruction & Fidelity Recovery', () => {
  const dummyContour = (id: string, pts: Array<{ x: number; y: number }>): ContourPath => ({
    id,
    region: 'eyes',
    points: pts,
    closed: false,
    confidence: 0.95,
    visibility: 'visible',
  });

  const createFrontalEyes = (): { left: EyeLandmarks; right: EyeLandmarks } => ({
    left: {
      upperLid: dummyContour('l-upper', [{ x: 0.35, y: 0.38 }, { x: 0.38, y: 0.36 }, { x: 0.42, y: 0.38 }]),
      lowerLid: dummyContour('l-lower', [{ x: 0.35, y: 0.38 }, { x: 0.38, y: 0.40 }, { x: 0.42, y: 0.38 }]),
      iris: { x: 0.38, y: 0.38 },
      pupil: { x: 0.38, y: 0.38 },
      confidence: 0.95,
      visibility: 'visible',
    },
    right: {
      upperLid: dummyContour('r-upper', [{ x: 0.58, y: 0.38 }, { x: 0.62, y: 0.36 }, { x: 0.65, y: 0.38 }]),
      lowerLid: dummyContour('r-lower', [{ x: 0.58, y: 0.38 }, { x: 0.62, y: 0.40 }, { x: 0.65, y: 0.38 }]),
      iris: { x: 0.62, y: 0.38 },
      pupil: { x: 0.62, y: 0.38 },
      confidence: 0.95,
      visibility: 'visible',
    },
  });

  it('Test 1: Eye Reconstruction synthesizes lids, upper crease, iris & pupil contours, and corners', () => {
    const rawEyes = createFrontalEyes();
    const left = reconstructEye(rawEyes.left, 'left', 'frontal', 0.9, 'test-subject');
    const right = reconstructEye(rawEyes.right, 'right', 'frontal', 0.9, 'test-subject');

    assert.ok(left, 'Left eye should be reconstructed');
    assert.ok(right, 'Right eye should be reconstructed');

    // Left eye structural verification
    assert.strictEqual(left.visibility, 'visible');
    assert.ok(left.upperLid.points.length >= 2, 'Upper eyelid points required');
    assert.ok(left.lowerLid.points.length >= 2, 'Lower eyelid points required');
    assert.ok(left.upperCrease, 'Palpebral superior crease should be synthesized');
    assert.ok(left.upperCrease.points.length >= 2, 'Crease curve points required');
    assert.ok(left.irisContour, 'Iris circular contour curve synthesized');
    assert.ok(left.irisContour.points.length >= 4, 'Iris contour should have multiple vertices');
    assert.ok(left.pupilContour, 'Pupil circular contour curve synthesized');
    assert.ok(left.innerCorner, 'Inner canthus corner landmark defined');
    assert.ok(left.outerCorner, 'Outer canthus corner landmark defined');

    // Right eye structural verification
    assert.strictEqual(right.visibility, 'visible');
    assert.ok(right.upperCrease, 'Right upper crease should be synthesized');
    assert.ok(right.irisContour, 'Right iris contour should be synthesized');
  });

  it('Test 2: Profile Pose Eye Reconstruction enforces strict occlusion semantics (BM-02)', () => {
    const rawEyes = createFrontalEyes();
    rawEyes.right.visibility = 'occluded';

    const left = reconstructEye(rawEyes.left, 'left', 'left_profile', 0.9, 'test-subject');
    const right = reconstructEye(rawEyes.right, 'right', 'left_profile', 0.9, 'test-subject');

    assert.ok(left, 'Left eye should exist');
    assert.strictEqual(left?.visibility, 'visible');
    assert.strictEqual(right?.visibility, 'occluded', 'Right eye must be occluded in left profile');
  });

  it('Test 3: Eyebrow Reconstruction synthesizes expressive arch, mass upper/lower contours, and tapered tail', () => {
    const leftBrow = dummyContour('l-brow', [{ x: 0.33, y: 0.32 }, { x: 0.38, y: 0.29 }, { x: 0.43, y: 0.32 }]);
    const rightBrow = dummyContour('r-brow', [{ x: 0.57, y: 0.32 }, { x: 0.62, y: 0.29 }, { x: 0.67, y: 0.32 }]);

    const l = reconstructEyebrow(leftBrow, 'left', 'frontal', 0.9, 'test-subject');
    const r = reconstructEyebrow(rightBrow, 'right', 'frontal', 0.9, 'test-subject');

    assert.ok(l, 'Left eyebrow reconstructed');
    assert.ok(r, 'Right eyebrow reconstructed');

    assert.ok(l.arch.points.length >= 2, 'Arch points required');
    assert.ok(l.upperContour, 'Upper boundary curve required to convey volumetric mass');
    assert.ok(l.lowerContour, 'Lower boundary curve required to convey volumetric mass');
    assert.ok(l.head, 'Medial brow head accent required');
    assert.ok(l.tail, 'Lateral brow tapered tail accent required');
  });

  it('Test 4: Nose Reconstruction synthesizes bridge, apex dome (>= 3 points), and columella shelf', () => {
    const bridge = dummyContour('bridge', [{ x: 0.5, y: 0.38 }, { x: 0.5, y: 0.46 }]);
    const tip = dummyContour('tip', [{ x: 0.5, y: 0.47 }]); // Single raw landmark point
    const nostrils = [
      dummyContour('nostril-l', [{ x: 0.48, y: 0.48 }, { x: 0.46, y: 0.47 }]),
      dummyContour('nostril-r', [{ x: 0.52, y: 0.48 }, { x: 0.54, y: 0.47 }]),
    ];

    const reconNose = reconstructNose(bridge, tip, nostrils, 'frontal', 0.9, 'test-subject');

    assert.ok(reconNose, 'Nose reconstructed');
    assert.ok(reconNose.bridge.points.length >= 2, 'Bridge ridge line points required');
    assert.ok(reconNose.tip.points.length >= 3, 'Tip MUST be a multi-point dome curve (never a dropped single point)');
    assert.ok(reconNose.underside, 'Columella under-nose shelf curve must be generated');
    assert.ok(reconNose.underside.points.length >= 3, 'Columella curve must have width');
    assert.ok(reconNose.leftAla, 'Left alar wing curve reconstructed');
    assert.ok(reconNose.rightAla, 'Right alar wing curve reconstructed');
  });

  it('Test 5: Mouth Reconstruction synthesizes oral fissure, cupid bow, lower lip, and mental crease', () => {
    const upperLip = dummyContour('upper-lip', [{ x: 0.44, y: 0.62 }, { x: 0.50, y: 0.61 }, { x: 0.56, y: 0.62 }]);
    const lowerLip = dummyContour('lower-lip', [{ x: 0.44, y: 0.62 }, { x: 0.50, y: 0.65 }, { x: 0.56, y: 0.62 }]);
    const oralFissure = dummyContour('fissure', [{ x: 0.44, y: 0.62 }, { x: 0.50, y: 0.62 }, { x: 0.56, y: 0.62 }]);

    const reconMouth = reconstructMouth(upperLip, lowerLip, oralFissure, 'frontal', 0.9, 'test-subject');

    assert.ok(reconMouth, 'Mouth reconstructed');
    assert.ok(reconMouth.oralFissure.points.length >= 2, 'Oral fissure seam required');
    assert.ok(reconMouth.upperVermilion, 'Upper vermilion with cupid bow required');
    assert.ok(reconMouth.lowerVermilion, 'Lower vermilion curve required');
    assert.ok(reconMouth.mentalCrease, 'Sub-labial mental crease required for chin definition');
    assert.ok(reconMouth.leftCorner, 'Left commissure tick required');
    assert.ok(reconMouth.rightCorner, 'Right commissure tick required');
  });

  it('Test 6: Jaw & Chin Reconstruction synthesizes bilateral jawline and apex dome (>= 3 points)', () => {
    const jawline = dummyContour('jawline', [
      { x: 0.32, y: 0.50 },
      { x: 0.36, y: 0.64 },
      { x: 0.50, y: 0.74 },
      { x: 0.64, y: 0.64 },
      { x: 0.68, y: 0.50 },
    ]);
    const chin = dummyContour('chin', [{ x: 0.50, y: 0.74 }]); // Single raw landmark point

    const reconJaw = reconstructJawChin(jawline, chin, 'frontal', 0.9, 'test-subject');

    assert.ok(reconJaw, 'Jaw and chin reconstructed');
    assert.ok(reconJaw.jawline.points.length >= 2, 'Jawline points required');
    assert.ok(reconJaw.chin.points.length >= 3, 'Chin apex MUST be a multi-point dome curve (never a dropped single point)');
  });

  it('Test 7: Hair Reconstruction synthesizes smoothed outer silhouette, major masses, and flow streamlines', () => {
    const rawHair = [
      dummyContour('hair-raw', [
        { x: 0.30, y: 0.20 },
        { x: 0.40, y: 0.12 },
        { x: 0.50, y: 0.10 },
        { x: 0.60, y: 0.12 },
        { x: 0.70, y: 0.20 },
      ]),
    ];

    const reconHair = reconstructHair(rawHair, undefined, 'frontal', 0.9, 'test-subject');

    assert.ok(reconHair, 'Hair reconstructed');
    assert.ok(reconHair.silhouette, 'Smoothed silhouette required');
    assert.ok(reconHair.silhouette.points.length >= 3, 'Silhouette curve points required');
    assert.ok(reconHair.masses.length >= 1, 'Major volumetric hair masses required');
    assert.ok(reconHair.flowCurves.length >= 1, 'Internal flow streamlines required');
  });

  it('Test 8: Body Reconstruction synthesizes bilateral neck, organic shoulder curves, and collar lines', () => {
    const reconBody = reconstructBody(
      undefined,
      { x: 0.35, y: 0.35, width: 0.30, height: 0.40 },
      0.9,
      'test-subject'
    );

    assert.ok(reconBody, 'Body reconstructed');
    assert.ok(reconBody.neckLines.length >= 2, 'Bilateral neck contours required');
    assert.ok(reconBody.shoulderLines.length >= 2, 'Anatomical shoulder lines required');
    assert.ok(reconBody.collarLines.length >= 1, 'Garment collar curve required');
  });

  it('Test 9: Feature Coverage Reporter evaluates 19 features and aggregate percentages correctly', () => {
    const rawEyes = createFrontalEyes();
    const face: FacialFeatures = {
      boundingBox: { x: 0.3, y: 0.2, width: 0.4, height: 0.5 },
      pose: 'frontal',
      leftEye: rawEyes.left,
      rightEye: rawEyes.right,
      leftEyebrow: { contour: dummyContour('l-brow', [{ x: 0.35, y: 0.32 }, { x: 0.42, y: 0.32 }]), confidence: 0.9, visibility: 'visible' },
      rightEyebrow: { contour: dummyContour('r-brow', [{ x: 0.58, y: 0.32 }, { x: 0.65, y: 0.32 }]), confidence: 0.9, visibility: 'visible' },
      noseBridge: dummyContour('bridge', [{ x: 0.5, y: 0.38 }, { x: 0.5, y: 0.46 }]),
      noseTip: dummyContour('tip', [{ x: 0.5, y: 0.47 }]),
      nostrils: [dummyContour('nostril', [{ x: 0.48, y: 0.48 }, { x: 0.52, y: 0.48 }])],
      upperLip: dummyContour('upper-lip', [{ x: 0.45, y: 0.62 }, { x: 0.55, y: 0.62 }]),
      lowerLip: dummyContour('lower-lip', [{ x: 0.45, y: 0.65 }, { x: 0.55, y: 0.65 }]),
      lipSeparation: dummyContour('fissure', [{ x: 0.45, y: 0.63 }, { x: 0.55, y: 0.63 }]),
      jawline: dummyContour('jaw', [{ x: 0.35, y: 0.60 }, { x: 0.50, y: 0.72 }, { x: 0.65, y: 0.60 }]),
      chin: dummyContour('chin', [{ x: 0.50, y: 0.72 }]),
      leftEar: dummyContour('l-ear', [{ x: 0.30, y: 0.40 }, { x: 0.28, y: 0.45 }]),
      rightEar: dummyContour('r-ear', [{ x: 0.70, y: 0.40 }, { x: 0.72, y: 0.45 }]),
    };

    const subject: SubjectModel = {
      id: 'sub-01',
      boundingBox: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 },
      confidence: 0.95,
      face,
    };

    const recon = reconstructSubjectFeatures(subject);
    subject.reconstruction = recon;

    const report = generateFeatureCoverageReport(subject, recon);

    assert.ok(report, 'Report must be generated');
    assert.strictEqual(report.features.leftEye.detected, true);
    assert.strictEqual(report.features.leftEye.geometry, true);
    assert.strictEqual(report.features.noseTip.detected, true);
    assert.strictEqual(report.features.noseTip.geometry, true);
    assert.strictEqual(report.features.chin.detected, true);
    assert.strictEqual(report.features.chin.geometry, true);
    assert.ok(report.metrics.overallStructuralCoverage > 0.7, 'Overall structural coverage must be robust (> 70%)');
  });

  it('Test 10: Full Subject Reconstruction attaches all reconstructed paths and preserves pose semantics', () => {
    const rawEyes = createFrontalEyes();
    const subject: SubjectModel = {
      id: 'sub-full',
      boundingBox: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 },
      confidence: 0.95,
      face: {
        boundingBox: { x: 0.3, y: 0.2, width: 0.4, height: 0.5 },
        pose: 'frontal',
        leftEye: rawEyes.left,
        rightEye: rawEyes.right,
      },
    };

    const recon = reconstructSubjectFeatures(subject);

    assert.ok(recon, 'Reconstruction object must be returned');
    assert.strictEqual(recon.subjectId, 'sub-full');
    assert.strictEqual(recon.pose, 'frontal');
    assert.ok(recon.allReconstructedPaths.length > 5, 'allReconstructedPaths must contain multiple curated paths');
  });
});
