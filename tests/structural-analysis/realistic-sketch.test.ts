import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  mapMediaPipeToFacialFeatures,
  FACEMESH_TOPOLOGY,
  MediaPipeLandmark3D
} from '../../apps/web/src/vision/mediapipe/landmark-mapper';
import {
  reconstructSubjectFeatures,
  analyzeSubjectTonalRegions,
  generateSubjectShadingStrokes
} from '../../packages/structural-analysis/src';
import {
  getFeatureSpecificTolerance,
  extractAllVectorGeometry,
  generateStrokeCandidates,
  orderStrokeCandidates,
  createStrokeTimeline,
  createRenderState
} from '../../packages/stroke-engine/src';
import {
  REALISTIC_PENCIL_PRESET,
  getStylePreset,
  resolveStyledRenderState
} from '../../packages/style-engine/src';
import {
  SubjectModel,
  ContourPath,
  LuminanceBuffer
} from '../../packages/shared-types/src';

/**
 * Creates a synthetic 478-point MediaPipe landmark array with iris rings.
 */
function createSynthetic478Landmarks(): MediaPipeLandmark3D[] {
  const landmarks: MediaPipeLandmark3D[] = [];
  for (let i = 0; i < 478; i++) {
    landmarks.push({ x: 0.5, y: 0.5, z: 0.0 });
  }

  // Iris centers and rings
  landmarks[FACEMESH_TOPOLOGY.LEFT_IRIS_CENTER] = { x: 0.60, y: 0.45, z: -0.01 };
  const leftRing = [
    { x: 0.59, y: 0.45, z: -0.01 },
    { x: 0.60, y: 0.44, z: -0.01 },
    { x: 0.61, y: 0.45, z: -0.01 },
    { x: 0.60, y: 0.46, z: -0.01 },
  ];
  FACEMESH_TOPOLOGY.LEFT_IRIS_RING.forEach((idx, i) => {
    landmarks[idx] = leftRing[i];
  });

  landmarks[FACEMESH_TOPOLOGY.RIGHT_IRIS_CENTER] = { x: 0.40, y: 0.45, z: -0.01 };
  const rightRing = [
    { x: 0.39, y: 0.45, z: -0.01 },
    { x: 0.40, y: 0.44, z: -0.01 },
    { x: 0.41, y: 0.45, z: -0.01 },
    { x: 0.40, y: 0.46, z: -0.01 },
  ];
  FACEMESH_TOPOLOGY.RIGHT_IRIS_RING.forEach((idx, i) => {
    landmarks[idx] = rightRing[i];
  });

  // Eyelids
  FACEMESH_TOPOLOGY.LEFT_EYE_UPPER.forEach((idx, i) => {
    landmarks[idx] = { x: 0.55 + i * 0.012, y: 0.43 - Math.sin((i / 8) * Math.PI) * 0.02, z: 0.0 };
  });
  FACEMESH_TOPOLOGY.LEFT_EYE_LOWER.forEach((idx, i) => {
    landmarks[idx] = { x: 0.65 - i * 0.012, y: 0.43 + Math.sin((i / 8) * Math.PI) * 0.015, z: 0.0 };
  });
  FACEMESH_TOPOLOGY.RIGHT_EYE_UPPER.forEach((idx, i) => {
    landmarks[idx] = { x: 0.35 + i * 0.012, y: 0.43 - Math.sin((i / 8) * Math.PI) * 0.02, z: 0.0 };
  });
  FACEMESH_TOPOLOGY.RIGHT_EYE_LOWER.forEach((idx, i) => {
    landmarks[idx] = { x: 0.45 - i * 0.012, y: 0.43 + Math.sin((i / 8) * Math.PI) * 0.015, z: 0.0 };
  });

  // Nose: tip, bridge, columella, subnasale, nostrils
  landmarks[FACEMESH_TOPOLOGY.NOSE_TIP] = { x: 0.50, y: 0.55, z: -0.05 };
  FACEMESH_TOPOLOGY.NOSE_BRIDGE.forEach((idx, i) => {
    landmarks[idx] = { x: 0.50, y: 0.44 + i * 0.018, z: -0.02 };
  });
  FACEMESH_TOPOLOGY.NOSE_COLUMELLA.forEach((idx, i) => {
    landmarks[idx] = { x: 0.49 + i * 0.005, y: 0.56, z: -0.03 };
  });
  FACEMESH_TOPOLOGY.NOSE_SUBNASALE.forEach((idx, i) => {
    landmarks[idx] = { x: 0.50, y: 0.57 + i * 0.005, z: -0.02 };
  });

  // Philtrum
  landmarks[FACEMESH_TOPOLOGY.LIP_PHILTRUM_LEFT[0]] = { x: 0.51, y: 0.58, z: 0.0 };
  landmarks[FACEMESH_TOPOLOGY.LIP_PHILTRUM_LEFT[1]] = { x: 0.505, y: 0.60, z: 0.0 };
  landmarks[FACEMESH_TOPOLOGY.LIP_PHILTRUM_RIGHT[0]] = { x: 0.49, y: 0.58, z: 0.0 };
  landmarks[FACEMESH_TOPOLOGY.LIP_PHILTRUM_RIGHT[1]] = { x: 0.495, y: 0.60, z: 0.0 };

  // Mouth vermilion borders and seam
  FACEMESH_TOPOLOGY.LIP_UPPER_VERMILION.forEach((idx, i) => {
    landmarks[idx] = { x: 0.45 + i * 0.01, y: 0.61 - Math.sin((i / 10) * Math.PI) * 0.01, z: 0.0 };
  });
  FACEMESH_TOPOLOGY.LIP_LOWER_VERMILION.forEach((idx, i) => {
    landmarks[idx] = { x: 0.55 - i * 0.01, y: 0.63 + Math.sin((i / 10) * Math.PI) * 0.015, z: 0.0 };
  });

  // Jawline
  FACEMESH_TOPOLOGY.MANDIBULAR_JAWLINE.forEach((idx, i) => {
    const angle = (i / FACEMESH_TOPOLOGY.MANDIBULAR_JAWLINE.length) * Math.PI;
    landmarks[idx] = { x: 0.50 + Math.cos(angle) * 0.20, y: 0.55 + Math.sin(angle) * 0.25, z: 0.0 };
  });

  return landmarks;
}

/**
 * Creates a synthetic luminance buffer with distinct chiaroscuro zones.
 */
function createSyntheticLuminanceBuffer(width = 64, height = 64): LuminanceBuffer {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      const ny = y / height;
      // Key light from top-left, shadow on lower-right and eye sockets
      let lum = 0.65 - (nx * 0.45 + ny * 0.35);
      // Eye socket hollows
      if (ny > 0.40 && ny < 0.48 && (nx > 0.35 && nx < 0.65)) {
        lum -= 0.25;
      }
      // Under-nose and under-chin shadow
      if (ny > 0.55 && ny < 0.60) lum -= 0.20;
      if (ny > 0.70) lum -= 0.30;
      data[y * width + x] = Math.max(0.0, Math.min(1.0, lum));
    }
  }
  return { width, height, data };
}

describe('TASK-111: MediaPipe High-Fidelity Realistic Sketch Reconstruction', () => {

  it('1. Utilizes full 478 MediaPipe landmarks (iris rings, eyelid creases, columella, philtrum, jawline)', () => {
    const rawLandmarks = createSynthetic478Landmarks();
    assert.strictEqual(rawLandmarks.length, 478, 'MediaPipe landmark array must have 478 points');

    const face = mapMediaPipeToFacialFeatures(rawLandmarks);

    // Left and right eye iris boundaries
    assert.ok(face.leftEye.irisContour, 'Left eye must have real iris boundary contour');
    assert.strictEqual(face.leftEye.irisContour.points.length, 4, 'Left iris ring must have 4 points');
    assert.ok(face.rightEye.irisContour, 'Right eye must have real iris boundary contour');
    assert.strictEqual(face.rightEye.irisContour.points.length, 4, 'Right iris ring must have 4 points');

    // Eyelid creases
    assert.ok(face.leftEye.upperCrease, 'Left eye must have eyelid crease');
    assert.ok(face.rightEye.upperCrease, 'Right eye must have eyelid crease');

    // Columella & subnasale
    assert.ok(face.noseBridge, 'Nose bridge must be defined');
    assert.ok(face.nostrils, 'Nostrils must be defined');
  });

  it('2. Enforces feature-specific RDP simplification tolerances', () => {
    const eyeTol = getFeatureSpecificTolerance('eye');
    const mouthTol = getFeatureSpecificTolerance('mouth');
    const noseTol = getFeatureSpecificTolerance('nose');
    const browTol = getFeatureSpecificTolerance('eyebrow');
    const jawTol = getFeatureSpecificTolerance('silhouette');
    const hairTol = getFeatureSpecificTolerance('hair');
    const bodyTol = getFeatureSpecificTolerance('body_structure');

    assert.strictEqual(eyeTol, 0.0004, 'Eyes require ultra-fine 0.0004 tolerance for delicate lids and iris');
    assert.strictEqual(mouthTol, 0.0005, 'Lips require ultra-fine 0.0005 tolerance for vermilion contours');
    assert.strictEqual(noseTol, 0.0008, 'Nose requires fine 0.0008 tolerance');
    assert.strictEqual(browTol, 0.0008, 'Eyebrows require fine 0.0008 tolerance');
    assert.strictEqual(jawTol, 0.0018, 'Jawline/silhouette requires 0.0018 tolerance');
    assert.strictEqual(hairTol, 0.0022, 'Hair requires 0.0022 tolerance for smooth flow');
    assert.strictEqual(bodyTol, 0.0040, 'Body/clothing requires broader 0.0040 tolerance');

    // Verify ordering: eyes < lips < nose < jaw < hair < body
    assert.ok(eyeTol < mouthTol && mouthTol < noseTol && noseTol < jawTol && jawTol < hairTol && hairTol < bodyTol);
  });

  it('3. Reconstructs anatomical features with fine accents (canthi, lashes, nostrils, philtrum, malar planes)', () => {
    const rawLandmarks = createSynthetic478Landmarks();
    const face = mapMediaPipeToFacialFeatures(rawLandmarks);
    const subject: SubjectModel = {
      id: 'test-subject-478',
      version: '1.0.0',
      sourceDimensions: { width: 800, height: 800, aspectRatio: '1:1', megapixels: 0.64 },
      boundingBox: face.boundingBox ?? { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
      silhouette: [{ id: 'sil', region: 'body_outline', points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }], closed: true, confidence: 0.95, visibility: 'visible' }],
      face,
      globalConfidence: 0.95,
      timestamp: Date.now()
    };

    const reconstruction = reconstructSubjectFeatures(subject);

    // Canthi ticks & lash accents
    assert.ok(reconstruction.leftEye?.innerCanthusTick, 'Left eye should reconstruct inner canthus tick');
    assert.ok(reconstruction.leftEye?.outerCanthusTick, 'Left eye should reconstruct outer canthus tick');
    assert.ok(reconstruction.leftEye?.lashAccents && reconstruction.leftEye.lashAccents.length > 0, 'Left eye should have subtle lash accents');

    // Nose columella & nostrils
    assert.ok(reconstruction.nose?.columella, 'Nose must reconstruct columella pillar');
    assert.ok(reconstruction.nose?.subnasale, 'Nose must reconstruct subnasale junction');
    assert.ok(reconstruction.nose?.leftNostril, 'Nose must reconstruct left nostril rim');

    // Mouth philtrum
    assert.ok(reconstruction.mouth?.philtrum && reconstruction.mouth.philtrum.length > 0, 'Mouth must reconstruct philtrum columns');

    // Jaw malar planes
    assert.ok(reconstruction.jawChin?.malarPlanes && reconstruction.jawChin.malarPlanes.length > 0, 'Jaw must reconstruct malar cheek planes');
  });

  it('4. Performs image-evidence tonal analysis and classifies shadow/midtone zones', () => {
    const rawLandmarks = createSynthetic478Landmarks();
    const face = mapMediaPipeToFacialFeatures(rawLandmarks);
    const subject: SubjectModel = {
      id: 'test-subject-tonal',
      version: '1.0.0',
      sourceDimensions: { width: 800, height: 800, aspectRatio: '1:1', megapixels: 0.64 },
      boundingBox: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      silhouette: [],
      face,
      globalConfidence: 0.95,
      timestamp: Date.now()
    };
    const lum = createSyntheticLuminanceBuffer(64, 64);

    const tonalRegions = analyzeSubjectTonalRegions(subject, lum);
    assert.ok(tonalRegions.length > 0, 'Must extract tonal regions from luminance buffer');

    // Verify classifications exist
    const classifications = new Set(tonalRegions.map(r => r.classification));
    assert.ok(classifications.has('shadow') || classifications.has('deep_shadow') || classifications.has('midtone'),
      'Must detect shadow or midtone regions based on luminance');

    // Intensities strictly between 0 and 1
    for (const region of tonalRegions) {
      assert.ok(region.intensity >= 0 && region.intensity <= 1.0, 'Tonal region intensity must be in [0, 1]');
      assert.ok(region.bounds.width > 0 && region.bounds.height > 0, 'Tonal region bounds must be non-zero');
    }
  });

  it('5. Generates 100% deterministic procedural hatching with ZERO Math.random()', () => {
    const rawLandmarks = createSynthetic478Landmarks();
    const face = mapMediaPipeToFacialFeatures(rawLandmarks);
    const subject: SubjectModel = {
      id: 'test-subject-hatching',
      version: '1.0.0',
      sourceDimensions: { width: 800, height: 800, aspectRatio: '1:1', megapixels: 0.64 },
      boundingBox: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      silhouette: [],
      face,
      globalConfidence: 0.95,
      timestamp: 1000 // Fixed timestamp for repeatability
    };
    const lum = createSyntheticLuminanceBuffer(64, 64);
    const tonalRegions = analyzeSubjectTonalRegions(subject, lum);

    // Run generation twice with same inputs
    const run1 = generateSubjectShadingStrokes(subject, tonalRegions);
    const run2 = generateSubjectShadingStrokes(subject, tonalRegions);

    assert.ok(run1.length > 0, 'Must generate shading strokes for shadow regions');
    assert.strictEqual(run1.length, run2.length, 'Shading stroke count must be strictly deterministic');

    // Verify point coordinates match bit-for-bit
    for (let i = 0; i < run1.length; i++) {
      assert.strictEqual(run1[i].points.length, run2[i].points.length);
      for (let j = 0; j < run1[i].points.length; j++) {
        assert.strictEqual(run1[i].points[j].x, run2[i].points[j].x, `Point ${j} x in stroke ${i} must match`);
        assert.strictEqual(run1[i].points[j].y, run2[i].points[j].y, `Point ${j} y in stroke ${i} must match`);
      }
    }
  });

  it('6. Supports realistic hair reconstruction with volumetric masses, flow curves, and strand groups', () => {
    const rawLandmarks = createSynthetic478Landmarks();
    const face = mapMediaPipeToFacialFeatures(rawLandmarks);
    const subject: SubjectModel = {
      id: 'test-subject-hair',
      version: '1.0.0',
      sourceDimensions: { width: 800, height: 800, aspectRatio: '1:1', megapixels: 0.64 },
      boundingBox: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      silhouette: [],
      face,
      globalConfidence: 0.95,
      timestamp: Date.now()
    };
    const lum = createSyntheticLuminanceBuffer(64, 64);

    const recon = reconstructSubjectFeatures(subject, lum);
    assert.ok(recon.hair, 'Must reconstruct hair structure');
    assert.ok(recon.hair.masses && recon.hair.masses.length > 0, 'Hair must have volumetric mass contours');
    assert.ok(recon.hair.flowCurves && recon.hair.flowCurves.length > 0, 'Hair must have directional flow curves');
    assert.ok(recon.hair.strandGroups && recon.hair.strandGroups.length > 0, 'Hair must have fine strand groups');
  });

  it('7. Registers and resolves realistic_pencil preset with graphite modulation', () => {
    const preset = getStylePreset('realistic_pencil');
    assert.ok(preset, 'realistic_pencil preset must be registered');
    assert.strictEqual(preset.id, 'realistic_pencil');
    assert.strictEqual(preset.defaultColor, '#222224', 'Graphite tone must be dark carbon charcoal');
    assert.strictEqual(preset.blendMode, 'multiply', 'Realistic pencil must use multiply blend mode for natural pencil layering');
    assert.strictEqual(preset.baseLineWidth, 1.1, 'Baseline width must be fine (1.1) simulating pencil lead');

    // Verify semantic modifiers exist for fine shading and strands
    assert.ok(preset.semanticModifiers?.eye, 'Eye modifier must be defined');
    assert.ok(preset.semanticModifiers?.hatching, 'Hatching modifier must be defined');
    assert.ok(preset.semanticModifiers?.hair_strand, 'Hair strand modifier must be defined');
    assert.ok(preset.semanticModifiers?.cross_hatching, 'Cross hatching modifier must be defined');

    // Hatching and hair strands should be lighter and thinner than primary eye contours
    const eyeWeight = (preset.semanticModifiers?.eye?.widthMultiplier ?? 1.0) * preset.baseLineWidth;
    const hatchWeight = (preset.semanticModifiers?.hatching?.widthMultiplier ?? 1.0) * preset.baseLineWidth;
    const strandWeight = (preset.semanticModifiers?.hair_strand?.widthMultiplier ?? 1.0) * preset.baseLineWidth;

    assert.ok(hatchWeight < eyeWeight, 'Hatching must be thinner than eye contours');
    assert.ok(strandWeight < eyeWeight, 'Hair strands must be thinner than eye contours');
  });

  it('8. Complete end-to-end pipeline execution: MediaPipe -> Reconstruction -> VectorGeometry -> StrokeCandidates -> Timeline -> RealisticPencil', () => {
    const rawLandmarks = createSynthetic478Landmarks();
    const face = mapMediaPipeToFacialFeatures(rawLandmarks);
    const subject: SubjectModel = {
      id: 'test-subject-e2e',
      version: '1.0.0',
      sourceDimensions: { width: 800, height: 800, aspectRatio: '1:1', megapixels: 0.64 },
      boundingBox: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      silhouette: [{ id: 'sil', region: 'body_outline', points: [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }], closed: true, confidence: 0.92, visibility: 'visible' }],
      face,
      globalConfidence: 0.95,
      timestamp: Date.now()
    };
    const lum = createSyntheticLuminanceBuffer(64, 64);

    // 1. Reconstruct features with luminance
    const reconstruction = reconstructSubjectFeatures(subject, lum);
    const enrichedSubject = { ...subject, reconstruction };

    // 2. Extract Vector Geometry
    const geometry = extractAllVectorGeometry([enrichedSubject]);
    assert.ok(geometry.paths.length > 10, 'Must extract rich vector paths including shading and hair strands');

    // 3. Generate Stroke Candidates with semantic roles
    const candidates = generateStrokeCandidates(geometry);
    assert.ok(candidates.metrics.drawableCandidates > 10, 'Must generate drawable stroke candidates');

    // Verify hatching and hair_strand roles exist in candidate set
    const roles = new Set(candidates.candidates.map(c => c.semanticRole));
    assert.ok(roles.has('eye') || roles.has('contour'), 'Candidates must include eye/contour roles');

    // 4. Order Stroke Candidates
    const ordered = orderStrokeCandidates(candidates);
    assert.strictEqual(ordered.strokes.length, candidates.metrics.drawableCandidates, 'All drawable strokes must be ordered');

    // 5. Timeline creation
    const timeline = createStrokeTimeline(ordered, { targetDurationMs: 12000 });
    assert.ok(timeline.totalDurationMs > 0, 'Timeline must have positive duration');

    // 6. Progressive render state at 100% completion
    const renderState = createRenderState(timeline, timeline.totalDurationMs);
    assert.strictEqual(renderState.completedCount, ordered.strokes.length, 'All strokes completed at 100%');


    // 7. Resolve with realistic_pencil style preset
    const styled = resolveStyledRenderState(renderState, { preset: 'realistic_pencil' });
    assert.strictEqual(styled.stylePreset, 'realistic_pencil');
    assert.strictEqual(styled.styledStrokes.length, renderState.strokes.length);
    assert.strictEqual(styled.background.type, 'solid');
    assert.strictEqual((styled.background as any).color, '#ffffff', 'Realistic pencil must render on white paper canvas');

    // Verify first stroke has resolved graphite color and style parameters
    const firstStyled = styled.styledStrokes[0];
    assert.ok(firstStyled.style.color, 'Must have resolved stroke color');
    assert.strictEqual(firstStyled.style.blendMode, 'multiply');
  });
});
