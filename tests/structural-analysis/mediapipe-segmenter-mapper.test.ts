/**
 * MediaPipe Image Segmenter Mapper & Reconciler Unit Tests
 * TASK-103.9 MediaPipe Integration
 *
 * Tests category ID mapping, mask normalization, nearest-neighbor resampling,
 * bilinear confidence interpolation, hybrid reconciliation, and lifecycle.
 */

import test from 'node:test';
import assert from 'node:assert';
import {
  mapCategoryIdToSemanticCategory,
  resampleCategoryMask,
  resampleConfidenceMap,
  computeMaskBoundingBox,
  mapMediaPipeSegmenterResult,
  RawMediaPipeSegmenterResult,
} from '../../apps/web/src/vision/mediapipe/segmenter-mapper';
import {
  reconcileHybridSegmentation,
} from '../../apps/web/src/vision/mediapipe/segmentation-reconciler';
import { MediaPipeWebDelegate } from '../../apps/web/src/vision/mediapipe/mediapipe-delegate';
import { SubjectMask } from '../../packages/structural-analysis/src/types';

test('MediaPipe Image Segmenter Integration (TASK-103.9)', async (t) => {
  await t.test('Test 1: Category ID mapping correctly converts official MediaPipe classes', () => {
    assert.strictEqual(mapCategoryIdToSemanticCategory(0), 'background');
    assert.strictEqual(mapCategoryIdToSemanticCategory(1), 'hair');
    assert.strictEqual(mapCategoryIdToSemanticCategory(2), 'body_skin');
    assert.strictEqual(mapCategoryIdToSemanticCategory(3), 'face_skin');
    assert.strictEqual(mapCategoryIdToSemanticCategory(4), 'clothing');
    assert.strictEqual(mapCategoryIdToSemanticCategory(5), 'accessories');
  });

  await t.test('Test 2: Unknown category IDs safely map to "unknown"', () => {
    assert.strictEqual(mapCategoryIdToSemanticCategory(99), 'unknown');
    assert.strictEqual(mapCategoryIdToSemanticCategory(-1), 'unknown');
  });

  await t.test('Test 3: Resampling category mask with nearest-neighbor preserves discrete IDs', () => {
    // 2x2 grid: top-left hair (1), top-right face (3), bottom clothes (4)
    const src = new Uint8Array([
      1, 3,
      4, 0,
    ]);
    const targetW = 4;
    const targetH = 4;
    const resampled = resampleCategoryMask(src, 2, 2, targetW, targetH);

    assert.strictEqual(resampled.length, 16);
    // Values should ONLY be 0, 1, 3, 4 (no interpolated 2)
    for (let i = 0; i < resampled.length; i++) {
      const val = resampled[i];
      assert.ok(
        val === 0 || val === 1 || val === 3 || val === 4,
        `Unexpected interpolated value ${val} at index ${i}`
      );
    }
  });

  await t.test('Test 4: Resampling continuous confidence map produces bounded [0.0, 1.0] values', () => {
    const src = new Float32Array([
      0.1, 0.9,
      0.3, 0.7,
    ]);
    const resampled = resampleConfidenceMap(src, 2, 2, 8, 8);
    assert.strictEqual(resampled.length, 64);

    for (let i = 0; i < resampled.length; i++) {
      assert.ok(resampled[i] >= 0.0 && resampled[i] <= 1.0, `Confidence out of bounds: ${resampled[i]}`);
    }
  });

  await t.test('Test 5: mapMediaPipeSegmenterResult generates canonical SemanticSegmentation and SubjectMask', () => {
    const w = 4;
    const h = 4;
    // Category 0: bg, 1: hair, 3: face, 4: clothes
    const catData = new Uint8Array([
      0, 1, 1, 0,
      0, 3, 3, 0,
      0, 4, 4, 0,
      0, 0, 0, 0,
    ]);

    const raw: RawMediaPipeSegmenterResult = {
      categoryMask: {
        width: w,
        height: h,
        getAsUint8Array: () => catData,
      },
    };

    const mapped = mapMediaPipeSegmenterResult(raw, w, h);
    assert.ok(mapped.semanticSegmentation);
    assert.ok(mapped.subjectMask);
    assert.strictEqual(mapped.subjectMask.width, w);
    assert.strictEqual(mapped.subjectMask.height, h);

    // Foreground pixels should be 6 (hair + face + clothes)
    let fgCount = 0;
    for (let i = 0; i < mapped.subjectMask.data.length; i++) {
      if (mapped.subjectMask.data[i] === 255) fgCount++;
    }
    assert.strictEqual(fgCount, 6);

    // Semantic masks should contain hair, face_skin, clothing
    const categories = mapped.semanticSegmentation.categories;
    assert.ok(categories.includes('hair'));
    assert.ok(categories.includes('face_skin'));
    assert.ok(categories.includes('clothing'));
  });

  await t.test('Test 6: Bounding box calculation for discrete semantic masks is normalized [0.0, 1.0]', () => {
    const w = 10;
    const h = 10;
    const mask = new Uint8Array(100);
    // Paint a 4x4 box from x=2..5, y=3..6
    for (let y = 3; y <= 6; y++) {
      for (let x = 2; x <= 5; x++) {
        mask[y * w + x] = 255;
      }
    }

    const bbox = computeMaskBoundingBox(mask, w, h);
    assert.ok(bbox);
    assert.strictEqual(bbox.x, 0.2);
    assert.strictEqual(bbox.y, 0.3);
    assert.strictEqual(bbox.width, 0.4);
    assert.strictEqual(bbox.height, 0.4);
  });

  await t.test('Test 7: Hybrid reconciliation prioritizes mutual agreement', () => {
    const w = 2;
    const h = 2;
    const mlMask: SubjectMask = {
      width: w,
      height: h,
      data: new Uint8Array([255, 0, 255, 0]),
      confidenceMap: new Float32Array([0.9, 0.1, 0.85, 0.2]),
    };
    const detMask: SubjectMask = {
      width: w,
      height: h,
      data: new Uint8Array([255, 0, 255, 0]),
      confidenceMap: new Float32Array([0.8, 0.15, 0.9, 0.1]),
    };

    const mlSemantic = {
      categories: ['hair' as const],
      masks: [{
        category: 'hair' as const,
        confidence: 0.9,
        width: w,
        height: h,
        data: new Uint8Array([255, 0, 255, 0]),
        pixelArea: 2,
      }],
      confidence: 0.9,
      provider: 'mediapipe' as const,
    };

    const reconciled = reconcileHybridSegmentation(mlMask, mlSemantic, detMask);
    assert.strictEqual(reconciled.metrics.agreementRatio, 1.0);
    assert.strictEqual(reconciled.reconciledMask.data[0], 255);
    assert.strictEqual(reconciled.reconciledMask.data[1], 0);
  });

  await t.test('Test 8: Hybrid reconciliation applies strong ML semantic override when deterministic contrast is low', () => {
    const w = 2;
    const h = 2;
    // ML detects clothing strongly (0.92), deterministic missed it (0.2)
    const mlMask: SubjectMask = {
      width: w,
      height: h,
      data: new Uint8Array([255, 0, 0, 0]),
      confidenceMap: new Float32Array([0.92, 0.1, 0.1, 0.1]),
    };
    const detMask: SubjectMask = {
      width: w,
      height: h,
      data: new Uint8Array([0, 0, 0, 0]),
      confidenceMap: new Float32Array([0.2, 0.1, 0.1, 0.1]),
    };

    const mlSemantic = {
      categories: ['clothing' as const],
      masks: [{
        category: 'clothing' as const,
        confidence: 0.92,
        width: w,
        height: h,
        data: new Uint8Array([255, 0, 0, 0]),
        pixelArea: 1,
      }],
      confidence: 0.92,
      provider: 'mediapipe' as const,
    };

    // Low gradient at pixel 0 (no blocking edge)
    const grad = new Float32Array([0.1, 0.1, 0.1, 0.1]);

    const reconciled = reconcileHybridSegmentation(mlMask, mlSemantic, detMask, grad);
    assert.strictEqual(reconciled.reconciledMask.data[0], 255);
    assert.ok(reconciled.metrics.mlOverrideRatio > 0);
  });

  await t.test('Test 9: Hybrid reconciliation preserves deterministic gradient barrier at anatomical edges', () => {
    const w = 2;
    const h = 2;
    // ML over-expanded into background (0.82), but strong gradient barrier (0.50) indicates true boundary
    const mlMask: SubjectMask = {
      width: w,
      height: h,
      data: new Uint8Array([255, 0, 0, 0]),
      confidenceMap: new Float32Array([0.82, 0.1, 0.1, 0.1]),
    };
    const detMask: SubjectMask = {
      width: w,
      height: h,
      data: new Uint8Array([0, 0, 0, 0]),
      confidenceMap: new Float32Array([0.15, 0.1, 0.1, 0.1]),
    };

    const mlSemantic = {
      categories: ['clothing' as const],
      masks: [{
        category: 'clothing' as const,
        confidence: 0.82,
        width: w,
        height: h,
        data: new Uint8Array([255, 0, 0, 0]),
        pixelArea: 1,
      }],
      confidence: 0.82,
      provider: 'mediapipe' as const,
    };

    // High gradient at pixel 0 (blocking silhouette edge)
    const grad = new Float32Array([0.50, 0.1, 0.1, 0.1]);

    const reconciled = reconcileHybridSegmentation(mlMask, mlSemantic, detMask, grad);
    assert.strictEqual(reconciled.reconciledMask.data[0], 0);
    assert.ok(reconciled.metrics.detPreservedRatio > 0);
  });

  await t.test('Test 10: Semantic segmentation does NOT fabricate instance IDs for multi-person groups', () => {
    const w = 4;
    const h = 4;
    // Two distinct people (left and right) with clothing
    const catData = new Uint8Array([
      0, 1, 0, 1,
      0, 3, 0, 3,
      0, 4, 0, 4,
      0, 0, 0, 0,
    ]);

    const raw: RawMediaPipeSegmenterResult = {
      categoryMask: {
        width: w,
        height: h,
        getAsUint8Array: () => catData,
      },
    };

    const mapped = mapMediaPipeSegmenterResult(raw, w, h);
    // Model emits semantic classes (hair, face_skin, clothing), NOT instance 1 vs instance 2
    assert.strictEqual(mapped.semanticSegmentation.masks.filter(m => m.category === 'clothing').length, 1);
    assert.strictEqual(mapped.semanticSegmentation.masks.find(m => m.category === 'clothing')?.pixelArea, 2);
  });

  await t.test('Test 11: MediaPipeWebDelegate starts uninitialized and disposes cleanly', () => {
    const delegate = new MediaPipeWebDelegate();
    assert.strictEqual(delegate.getState(), 'uninitialized');
    assert.strictEqual(delegate.isReady('segmenter'), false);

    delegate.dispose();
    assert.strictEqual(delegate.getState(), 'uninitialized');
    assert.strictEqual(delegate.isReady('segmenter'), false);
  });
});
