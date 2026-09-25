/**
 * TASK-113 — Photographic Tonal Reconstruction & High-Fidelity Graphite Portrait Engine Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  sampleTonalField,
  sampleFacialLuminanceStats,
  analyzeSubjectTonalFields,
  generateFieldShadingStrokes,
  generateSubjectShadingStrokes,
  evaluateTonalDiagnostics,
} from '../../packages/structural-analysis/src/tonal';
import {
  BoundingBox,
  SubjectModel,
  TonalField,
} from '../../packages/shared-types';
import { LuminanceBuffer } from '../../packages/image-processing/src';

function createSyntheticLuminance(width: number, height: number, fn: (x: number, y: number) => number): LuminanceBuffer {
  const floatData = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      floatData[y * width + x] = fn(x / width, y / height);
    }
  }
  return {
    width,
    height,
    floatData,
  };
}

describe('TASK-113 — Photographic Tonal Reconstruction & TonalField Engine', () => {
  it('samples a continuous 2D spatial TonalField with bilinear interpolation and non-linear density', () => {
    // Gradient: 0.1 (dark) at top-left to 0.9 (bright) at bottom-right
    const lum = createSyntheticLuminance(100, 100, (u, v) => 0.1 + 0.8 * (u * 0.5 + v * 0.5));
    const box: BoundingBox = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 };

    const field = sampleTonalField(lum, box, 16, 16, 'test_cheek', 'cheek_plane');

    assert.strictEqual(field.width, 16);
    assert.strictEqual(field.height, 16);
    assert.strictEqual(field.values.length, 256);
    assert.strictEqual(field.density.length, 256);
    assert.ok(field.min >= 0.1 && field.min < field.max);
    assert.ok(field.max <= 0.9);
    assert.ok(field.mean > field.min && field.mean < field.max);

    // High luminance at bottom right must map to low/zero graphite density
    const lastIdx = 16 * 16 - 1;
    assert.ok(field.values[lastIdx] > field.values[0], 'Bottom-right is brighter than top-left');
    assert.ok(field.density[0] > field.density[lastIdx], 'Top-left has higher graphite density than bottom-right');
  });

  it('preserves clean paper highlights with zero graphite density', () => {
    // Pure bright highlight
    const lum = createSyntheticLuminance(50, 50, () => 0.95);
    const box: BoundingBox = { x: 0.45, y: 0.45, width: 0.1, height: 0.1 };

    const field = sampleTonalField(lum, box, 8, 8, 'nose_highlight', 'nose_tip');
    assert.strictEqual(field.classification, 'highlight');

    const strokes = generateFieldShadingStrokes(field, 0);
    assert.strictEqual(strokes.length, 0, 'Highlights must produce strictly zero strokes (clean paper)');
  });

  it('synthesizes multi-scale form-following graphite marks for deep shadow', () => {
    // Deep shadow crevice
    const lum = createSyntheticLuminance(50, 50, () => 0.15);
    const box: BoundingBox = { x: 0.35, y: 0.35, width: 0.1, height: 0.08 };

    const field = sampleTonalField(lum, box, 12, 12, 'eye_socket_shadow', 'eye_socket');
    assert.strictEqual(field.classification, 'deep_shadow');

    const strokes = generateFieldShadingStrokes(field, 0);
    assert.ok(strokes.length >= 8, `Expected >= 8 strokes for deep shadow, got ${strokes.length}`);

    // Verify cross-hatching is emitted in deep crevices
    const crossStrokes = strokes.filter(s => s.id.includes('cross_hatch'));
    assert.ok(crossStrokes.length >= 2, `Expected >= 2 cross-hatch strokes in deep eye socket, got ${crossStrokes.length}`);
  });

  it('extracts volumetric hair mass and clothing mass fields from semantic masks', () => {
    // Dark sweater (luminance 0.12) and dark hair (luminance 0.18)
    const lum = createSyntheticLuminance(100, 100, (u, v) => (v > 0.65 ? 0.12 : (v < 0.35 ? 0.18 : 0.65)));

    const mockSubject: SubjectModel = {
      id: 'sub_bm01',
      globalConfidence: 0.95,
      boundingBox: { x: 0.3, y: 0.2, width: 0.4, height: 0.5 },
      face: {
        boundingBox: { x: 0.3, y: 0.2, width: 0.4, height: 0.5 },
        pose: 'frontal',
      },
      semanticSegmentation: {
        category: 'clothing',
        masks: [
          {
            category: 'hair',
            confidence: 0.92,
            boundingBox: { x: 0.25, y: 0.05, width: 0.5, height: 0.28 },
            mask: new Uint8Array(100),
          },
          {
            category: 'clothing',
            confidence: 0.95,
            boundingBox: { x: 0.15, y: 0.65, width: 0.7, height: 0.35 },
            mask: new Uint8Array(100),
          },
        ],
      },
    };

    const fields = analyzeSubjectTonalFields(lum, mockSubject);
    const hairField = fields.find(f => f.semanticAssociation === 'hair_mass');
    const clothingField = fields.find(f => f.semanticAssociation === 'clothing_mass');

    assert.ok(hairField, 'Must extract hair_mass TonalField');
    assert.ok(clothingField, 'Must extract clothing_mass TonalField');
    assert.ok(hairField.mean < 0.35, `Expected dark hair mean < 0.35, got ${hairField.mean}`);
    assert.ok(clothingField.mean < 0.25, `Expected dark clothing mean < 0.25, got ${clothingField.mean}`);

    // Generate strokes across all fields
    const allStrokes = generateSubjectShadingStrokes([], fields);
    const hairMassStrokes = allStrokes.filter(s => s.id.includes('hair_mass'));
    const clothingMassStrokes = allStrokes.filter(s => s.id.includes('clothing_mass'));

    assert.ok(hairMassStrokes.length >= 10, `Expected >= 10 hair mass strokes, got ${hairMassStrokes.length}`);
    assert.ok(clothingMassStrokes.length >= 10, `Expected >= 10 clothing mass strokes, got ${clothingMassStrokes.length}`);
  });

  it('guarantees 100% deterministic mark generation (zero Math.random)', () => {
    const lum = createSyntheticLuminance(80, 80, (u, v) => 0.2 + 0.6 * Math.sin(u * 3 + v * 2) ** 2);
    const mockSubject: SubjectModel = {
      id: 'determ_subject',
      globalConfidence: 0.90,
      boundingBox: { x: 0.25, y: 0.2, width: 0.5, height: 0.6 },
      face: {
        boundingBox: { x: 0.25, y: 0.2, width: 0.5, height: 0.6 },
        pose: 'frontal',
      },
    };

    // Run 1
    const fields1 = analyzeSubjectTonalFields(lum, mockSubject);
    const strokes1 = generateSubjectShadingStrokes([], fields1);

    // Run 2
    const fields2 = analyzeSubjectTonalFields(lum, mockSubject);
    const strokes2 = generateSubjectShadingStrokes([], fields2);

    assert.strictEqual(fields1.length, fields2.length, 'Field count must be identical');
    assert.strictEqual(strokes1.length, strokes2.length, 'Stroke count must be identical');

    for (let i = 0; i < strokes1.length; i++) {
      const s1 = strokes1[i];
      const s2 = strokes2[i];
      assert.strictEqual(s1.id, s2.id, `Stroke id ${i} must match`);
      assert.strictEqual(s1.points.length, s2.points.length, `Stroke point count ${i} must match`);
      for (let p = 0; p < s1.points.length; p++) {
        assert.strictEqual(s1.points[p].x, s2.points[p].x, `Point x mismatch at stroke ${i}, pt ${p}`);
        assert.strictEqual(s1.points[p].y, s2.points[p].y, `Point y mismatch at stroke ${i}, pt ${p}`);
      }
    }
  });

  it('enforces multi-subject isolation (BM-11 safety)', () => {
    const lum = createSyntheticLuminance(120, 80, (u, v) => (u < 0.5 ? 0.3 : 0.7));

    const subjectA: SubjectModel = {
      id: 'person_left',
      globalConfidence: 0.9,
      boundingBox: { x: 0.05, y: 0.15, width: 0.35, height: 0.7 },
      face: {
        boundingBox: { x: 0.1, y: 0.2, width: 0.25, height: 0.4 },
        pose: 'frontal',
      },
    };

    const subjectB: SubjectModel = {
      id: 'person_right',
      globalConfidence: 0.9,
      boundingBox: { x: 0.55, y: 0.15, width: 0.35, height: 0.7 },
      face: {
        boundingBox: { x: 0.6, y: 0.2, width: 0.25, height: 0.4 },
        pose: 'frontal',
      },
    };

    const fieldsA = analyzeSubjectTonalFields(lum, subjectA);
    const fieldsB = analyzeSubjectTonalFields(lum, subjectB);

    assert.ok(fieldsA.length > 0 && fieldsB.length > 0);
    // Subject A is in the dark half; Subject B is in the bright half
    const meanA = fieldsA.reduce((acc, f) => acc + f.mean, 0) / fieldsA.length;
    const meanB = fieldsB.reduce((acc, f) => acc + f.mean, 0) / fieldsB.length;

    assert.ok(meanA < meanB, `Subject A mean (${meanA}) must be darker than Subject B (${meanB})`);

    // Verify all strokes belonging to subject A are restricted within x <= 0.5
    const strokesA = generateSubjectShadingStrokes([], fieldsA);
    for (const stroke of strokesA) {
      for (const pt of stroke.points) {
        assert.ok(pt.x <= 0.50, `Subject A stroke leaked into Subject B territory at x=${pt.x}`);
      }
    }
  });

  it('computes objective image-level diagnostics across 12 semantic regions and 10 histogram bins', () => {
    const lum = createSyntheticLuminance(100, 100, (u, v) => (u + v) * 0.5);
    const mockSubject: SubjectModel = {
      id: 'diag_subject',
      globalConfidence: 0.92,
      boundingBox: { x: 0.25, y: 0.2, width: 0.5, height: 0.6 },
      face: {
        boundingBox: { x: 0.25, y: 0.2, width: 0.5, height: 0.6 },
        pose: 'frontal',
      },
    };

    const fields = analyzeSubjectTonalFields(lum, mockSubject);
    const diagnostics = evaluateTonalDiagnostics(lum, mockSubject, fields);

    assert.ok(diagnostics.globalSourceMean >= 0.0 && diagnostics.globalSourceMean <= 1.0);
    assert.ok(diagnostics.globalGeneratedMean >= 0.0 && diagnostics.globalGeneratedMean <= 1.0);
    assert.strictEqual(diagnostics.histogramBins.source.length, 10);
    assert.strictEqual(diagnostics.histogramBins.generated.length, 10);
    assert.strictEqual(diagnostics.regionalMetrics.length, 12);

    const forehead = diagnostics.regionalMetrics.find(r => r.region === 'forehead');
    const nose = diagnostics.regionalMetrics.find(r => r.region === 'nose');
    assert.ok(forehead, 'Forehead metric must be present');
    assert.ok(nose, 'Nose metric must be present');
    assert.ok(forehead.valueCorrelation > 0.40, 'Forehead correlation must be positive');
  });
});
