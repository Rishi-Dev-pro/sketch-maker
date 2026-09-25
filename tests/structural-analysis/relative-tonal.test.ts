import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  classifyIntensity,
  sampleFacialLuminanceStats,
  analyzeSubjectTonalRegions,
  FacialLuminanceStats,
} from '../../packages/structural-analysis/src/tonal/tonal-analyzer';
import {
  generateRegionShadingStrokes,
  generateSubjectShadingStrokes,
} from '../../packages/structural-analysis/src/tonal/shading-generator';
import { LuminanceBuffer } from '@sketch-maker/image-processing';
import { BoundingBox, SubjectModel, TonalRegion } from '@sketch-maker/shared-types';

describe('TASK-112.5 — Relative Facial Luminance & Tonal Classification', () => {
  it('classifies relative deep_shadow in a high-key studio portrait (e.g. BM-01)', () => {
    // High-key stats: entire face is bright, min is 0.38, max is 0.88, median is 0.62
    const highKeyStats: FacialLuminanceStats = {
      min: 0.38,
      p15: 0.45,
      p35: 0.54,
      median: 0.62,
      mean: 0.61,
      p65: 0.72,
      p85: 0.82,
      max: 0.88,
    };

    // A socket or shadow crevice at 0.43 is bright in absolute terms, but in the lowest 15% of this subject
    const socketClass = classifyIntensity(0.43, highKeyStats);
    assert.strictEqual(socketClass, 'deep_shadow', 'Relative deep shadow should be detected on high-key portrait');

    const shadowPlaneClass = classifyIntensity(0.51, highKeyStats);
    assert.strictEqual(shadowPlaneClass, 'shadow', '0.51 should be classified as shadow in high-key portrait');

    const midtoneClass = classifyIntensity(0.65, highKeyStats);
    assert.strictEqual(midtoneClass, 'midtone', '0.65 should be classified as midtone in high-key portrait');

    const lightClass = classifyIntensity(0.78, highKeyStats);
    assert.strictEqual(lightClass, 'light', '0.78 should be classified as light in high-key portrait');

    const highlightClass = classifyIntensity(0.86, highKeyStats);
    assert.strictEqual(highlightClass, 'highlight', '0.86 should be classified as highlight in high-key portrait');
  });

  it('classifies relative tones correctly in low-key portrait', () => {
    // Low-key stats: dark subject / dramatic lighting
    const lowKeyStats: FacialLuminanceStats = {
      min: 0.04,
      p15: 0.12,
      p35: 0.22,
      median: 0.32,
      mean: 0.30,
      p65: 0.42,
      p85: 0.55,
      max: 0.68,
    };

    assert.strictEqual(classifyIntensity(0.08, lowKeyStats), 'deep_shadow');
    assert.strictEqual(classifyIntensity(0.18, lowKeyStats), 'shadow');
    assert.strictEqual(classifyIntensity(0.35, lowKeyStats), 'midtone');
    assert.strictEqual(classifyIntensity(0.48, lowKeyStats), 'light');
    assert.strictEqual(classifyIntensity(0.60, lowKeyStats), 'highlight');
  });

  it('preserves absolute dark floor (< 0.20) as deep shadow regardless of stats', () => {
    const neutralStats: FacialLuminanceStats = {
      min: 0.05,
      p15: 0.25,
      p35: 0.40,
      median: 0.55,
      mean: 0.54,
      p65: 0.70,
      p85: 0.85,
      max: 0.95,
    };

    assert.strictEqual(classifyIntensity(0.12, neutralStats), 'deep_shadow');
    assert.strictEqual(classifyIntensity(0.05, neutralStats), 'deep_shadow');
  });

  it('computes robust facial percentiles from synthetic luminance buffer', () => {
    const W = 100;
    const H = 100;
    const floatData = new Float32Array(W * H);
    // Fill with linear gradient 0.0 to 1.0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        floatData[y * W + x] = (x + y) / (2 * W);
      }
    }
    const lum: LuminanceBuffer = {
      width: W,
      height: H,
      floatData,
      data: new Uint8ClampedArray(W * H),
    };

    const faceBox: BoundingBox = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 };
    const stats = sampleFacialLuminanceStats(lum, faceBox);

    assert.ok(stats.min < stats.p15, 'min < p15');
    assert.ok(stats.p15 < stats.p35, 'p15 < p35');
    assert.ok(stats.p35 < stats.median, 'p35 < median');
    assert.ok(stats.median < stats.p65, 'median < p65');
    assert.ok(stats.p65 < stats.p85, 'p65 < p85');
    assert.ok(stats.p85 < stats.max, 'p85 < max');
  });

  it('allocates meaningful stroke density for large planes and deep crevices', () => {
    // 1. Deep shadow eye socket -> must receive 8+ primary strokes + cross-hatching
    const eyeSocketRegion: TonalRegion = {
      id: 'sub_tonal_left_eye_socket',
      bounds: { x: 0.35, y: 0.32, width: 0.08, height: 0.05 },
      centroid: { x: 0.39, y: 0.345 },
      intensity: 0.43,
      confidence: 0.90,
      importance: 0.85,
      semanticAssociation: 'eye_socket',
      classification: 'deep_shadow',
    };
    const eyeSocketStrokes = generateRegionShadingStrokes(eyeSocketRegion, 0);
    const formHatchCount = eyeSocketStrokes.filter(s => s.id.includes('form_hatch')).length;
    const crossHatchCount = eyeSocketStrokes.filter(s => s.id.includes('cross_hatch')).length;

    assert.ok(formHatchCount >= 8, `Expected >= 8 form hatch strokes in eye socket, got ${formHatchCount}`);
    assert.ok(crossHatchCount >= 4, `Expected >= 4 cross hatch strokes in deep crevice, got ${crossHatchCount}`);

    // 2. Large cheek plane midtone -> must receive area-aware density (>= 6 strokes)
    const cheekPlaneRegion: TonalRegion = {
      id: 'sub_tonal_left_cheek_plane',
      bounds: { x: 0.25, y: 0.45, width: 0.18, height: 0.15 },
      centroid: { x: 0.34, y: 0.525 },
      intensity: 0.55,
      confidence: 0.85,
      importance: 0.60,
      semanticAssociation: 'cheek_plane',
      classification: 'midtone',
    };
    const cheekStrokes = generateRegionShadingStrokes(cheekPlaneRegion, 1);
    const cheekFormCount = cheekStrokes.filter(s => s.id.includes('form_hatch')).length;
    const cheekCrossCount = cheekStrokes.filter(s => s.id.includes('cross_hatch')).length;

    assert.ok(cheekFormCount >= 6, `Expected >= 6 strokes on large cheek plane, got ${cheekFormCount}`);
    assert.strictEqual(cheekCrossCount, 0, 'Cheek plane must NEVER receive cross-hatching');

    // 3. Highlight region -> strictly zero strokes (clean paper)
    const highlightRegion: TonalRegion = {
      id: 'sub_tonal_nose_tip',
      bounds: { x: 0.48, y: 0.45, width: 0.04, height: 0.04 },
      centroid: { x: 0.50, y: 0.47 },
      intensity: 0.92,
      confidence: 0.95,
      importance: 0.90,
      semanticAssociation: 'nose_tip',
      classification: 'highlight',
    };
    const highlightStrokes = generateRegionShadingStrokes(highlightRegion, 2);
    assert.strictEqual(highlightStrokes.length, 0, 'Highlight must produce strictly zero strokes');
  });

  it('verifies reconstructed hair paths survive into stroke candidates and styled strokes', () => {
    const { reconstructHair } = require('../../packages/structural-analysis/src/reconstruction/hair-reconstructor');
    const { extractAllVectorGeometry } = require('../../packages/stroke-engine/src');
    const { generateStrokeCandidates } = require('../../packages/stroke-engine/src');

    const faceBox = { x: 0.3, y: 0.3, width: 0.4, height: 0.5 };
    const hair = reconstructHair(undefined, undefined, faceBox, 'frontal', 0.90, 'test_subject');
    assert.ok(hair, 'Hair must be reconstructed from faceBox');
    assert.ok(hair.strandGroups && hair.strandGroups.length >= 18, 'Expected >= 18 strand groups');

    const mockSubject: SubjectModel = {
      id: 'test_subject',
      globalConfidence: 0.90,
      boundingBox: faceBox,
      reconstruction: {
        subjectId: 'test_subject',
        pose: 'frontal',
        allReconstructedPaths: [
          hair.silhouette!,
          ...hair.masses,
          ...hair.flowCurves,
          ...hair.strandGroups!,
        ],
        hair,
        confidence: 0.90,
        timestamp: Date.now(),
      },
    };

    const geometry = extractAllVectorGeometry([mockSubject]);
    const hairGeoPaths = geometry.paths.filter(p => p.id.includes('hair'));
    assert.ok(hairGeoPaths.length >= 18, `Expected >= 18 hair paths in geometry, got ${hairGeoPaths.length}`);

    const candidates = generateStrokeCandidates(geometry);
    const hairCandidates = candidates.candidates.filter(c => c.semanticRole === 'hair_strand' || c.semanticRole === 'hair');
    console.log('All candidate roles:', candidates.candidates.map(c => ({ id: c.id, role: c.semanticRole, drawable: c.drawable, filteredReason: c.filteredReason })).slice(0, 10));
    assert.ok(hairCandidates.length >= 18, `Expected >= 18 hair candidates with hair role, got ${hairCandidates.length}`);
  });
});
