import assert from 'node:assert/strict';
import {
  preprocessPixelBuffer,
  PixelBuffer,
  NormalizedImage,
} from '../../packages/image-processing/src';
import {
  segmentSubject,
  computeSobelGradients,
  computePerceptualSaliency,
  SegmentationResult,
} from '../../packages/structural-analysis/src';

/**
 * Creates a synthetic RGBA PixelBuffer with a background color and an optional foreground rectangle.
 */
function createSyntheticImage(
  width: number,
  height: number,
  bgR: number,
  bgG: number,
  bgB: number,
  fg?: { x: number; y: number; w: number; h: number; r: number; g: number; b: number }
): NormalizedImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    data[idx] = bgR;
    data[idx + 1] = bgG;
    data[idx + 2] = bgB;
    data[idx + 3] = 255;
  }

  if (fg) {
    for (let y = fg.y; y < fg.y + fg.h; y++) {
      if (y < 0 || y >= height) continue;
      const rowOffset = y * width;
      for (let x = fg.x; x < fg.x + fg.w; x++) {
        if (x < 0 || x >= width) continue;
        const idx = (rowOffset + x) * 4;
        data[idx] = fg.r;
        data[idx + 1] = fg.g;
        data[idx + 2] = fg.b;
        data[idx + 3] = 255;
      }
    }
  }

  const rawBuffer: PixelBuffer = { width, height, data };
  return preprocessPixelBuffer(rawBuffer, { maxDimension: Math.max(width, height) });
}

function runSegmentationTests() {
  console.log('--- Running Segmentation Unit Tests ---');

  // Test 1: Degenerate input handling
  console.log('Test 1: Degenerate input handling');
  assert.throws(
    () => segmentSubject({} as any),
    /Cannot read properties|width|height|empty/
  );

  // Test 2: High-contrast centered synthetic subject
  console.log('Test 2: High-contrast centered synthetic subject');
  // 100x100 white background, 40x50 dark subject in center (x=30..69, y=25..74)
  const normImg = createSyntheticImage(100, 100, 240, 240, 240, {
    x: 30,
    y: 25,
    w: 40,
    h: 50,
    r: 30,
    g: 30,
    b: 30,
  });
  const result = segmentSubject(normImg);

  assert.strictEqual(result.mask.width, 100);
  assert.strictEqual(result.mask.height, 100);
  assert.ok(result.coverage > 0.15 && result.coverage < 0.45, `Coverage ${result.coverage} out of expected range`);
  assert.ok(result.instances.length >= 1, 'Expected at least 1 primary subject instance');

  // Verify bounding box overlaps closely with ground truth x: 0.30, y: 0.25, w: 0.40, h: 0.50
  const bb = result.boundingBox;
  assert.ok(Math.abs(bb.x - 0.30) <= 0.05, `Bounding box X mismatch: got ${bb.x}`);
  assert.ok(Math.abs(bb.y - 0.25) <= 0.05, `Bounding box Y mismatch: got ${bb.y}`);
  assert.ok(Math.abs(bb.width - 0.40) <= 0.05, `Bounding box width mismatch: got ${bb.width}`);
  assert.ok(Math.abs(bb.height - 0.50) <= 0.05, `Bounding box height mismatch: got ${bb.height}`);

  // Test 3: Sobel gradient barriers
  console.log('Test 3: Sobel gradient barrier detection');
  const grads = computeSobelGradients(normImg.luminance);
  assert.strictEqual(grads.magnitude.length, 100 * 100);
  // Edge of the square should have high gradient magnitude
  const edgeIdx = 25 * 100 + 30; // top-left corner
  assert.ok(grads.magnitude[edgeIdx] > 0.10, 'Expected high edge gradient on boundary');
  // Center of the square should have low/zero gradient
  const centerIdx = 50 * 100 + 50;
  assert.strictEqual(grads.magnitude[centerIdx], 0.0);

  // Test 4: Saliency field calculation
  console.log('Test 4: Saliency field calculation');
  const saliency = computePerceptualSaliency(normImg.rgba, grads);
  assert.strictEqual(saliency.data.length, 100 * 100);
  // Center subject pixel should have higher saliency than outer corner background
  const fgSaliency = saliency.data[50 * 100 + 50];
  const bgSaliency = saliency.data[5 * 100 + 5];
  assert.ok(fgSaliency > bgSaliency, `Foreground saliency (${fgSaliency}) should exceed background (${bgSaliency})`);

  // Test 5: Soft boundary confidence map
  console.log('Test 5: Soft boundary confidence map properties');
  const confMap = result.mask.confidenceMap;
  assert.strictEqual(confMap.length, 100 * 100);
  // Interior should be 1.0
  assert.strictEqual(confMap[50 * 100 + 50], 1.0);
  // Outer background should be 0.0
  assert.strictEqual(confMap[2 * 100 + 2], 0.0);

  // Test 6: Bounding box normalized coordinates [0.0 - 1.0]
  console.log('Test 6: Bounding box coordinate bounds');
  assert.ok(bb.x >= 0.0 && bb.x <= 1.0, `bb.x out of range: ${bb.x}`);
  assert.ok(bb.y >= 0.0 && bb.y <= 1.0, `bb.y out of range: ${bb.y}`);
  assert.ok(bb.width > 0.0 && bb.width <= 1.0, `bb.width out of range: ${bb.width}`);
  assert.ok(bb.height > 0.0 && bb.height <= 1.0, `bb.height out of range: ${bb.height}`);

  // Test 7: Multi-subject instance clustering
  console.log('Test 7: Multi-subject instance clustering');
  // Create an image with two distinct figures side-by-side (like BM-11)
  const dataMulti = new Uint8ClampedArray(120 * 100 * 4);
  dataMulti.fill(245); // light background
  // Figure 1: left side x=20..45, y=30..85
  for (let y = 30; y <= 85; y++) {
    for (let x = 20; x <= 45; x++) {
      const idx = (y * 120 + x) * 4;
      dataMulti[idx] = 40;
      dataMulti[idx + 1] = 50;
      dataMulti[idx + 2] = 60;
    }
  }
  // Figure 2: right side x=75..100, y=30..85
  for (let y = 30; y <= 85; y++) {
    for (let x = 75; x <= 100; x++) {
      const idx = (y * 120 + x) * 4;
      dataMulti[idx] = 50;
      dataMulti[idx + 1] = 40;
      dataMulti[idx + 2] = 70;
    }
  }
  const multiBuf: PixelBuffer = { width: 120, height: 100, data: dataMulti };
  const multiNorm = preprocessPixelBuffer(multiBuf, { maxDimension: 120 });
  const multiResult = segmentSubject(multiNorm, { maxInstances: 3 });

  assert.strictEqual(multiResult.instances.length, 2, `Expected exactly 2 instances, got ${multiResult.instances.length}`);
  assert.strictEqual(multiResult.instances[0].label, 'primary_subject');
  assert.strictEqual(multiResult.instances[1].label, 'secondary_subject');
  // The two bounding boxes should not overlap horizontally
  const b1 = multiResult.instances[0].pixelBoundingBox;
  const b2 = multiResult.instances[1].pixelBoundingBox;
  assert.ok(
    b1.x + b1.width <= b2.x || b2.x + b2.width <= b1.x,
    `Instances should be horizontally separated: b1=${JSON.stringify(b1)}, b2=${JSON.stringify(b2)}`
  );

  // Test 8: Coordinate scale factor preservation
  console.log('Test 8: Coordinate scale factor preservation');
  assert.ok(result.scale.x >= 1.0);
  assert.ok(result.scale.y >= 1.0);

  // Test 9: Determinism
  console.log('Test 9: Deterministic segmentation execution');
  const runA = segmentSubject(normImg);
  const runB = segmentSubject(normImg);
  assert.deepStrictEqual(runA.mask.data, runB.mask.data);
  assert.strictEqual(runA.coverage, runB.coverage);
  assert.deepStrictEqual(runA.boundingBox, runB.boundingBox);

  // Test 10: Mode adjustment behavior
  console.log('Test 10: Mode adjustment (aggressive vs conservative)');
  const aggressiveResult = segmentSubject(normImg, { mode: 'aggressive' });
  const conservativeResult = segmentSubject(normImg, { mode: 'conservative' });
  assert.ok(
    conservativeResult.coverage >= aggressiveResult.coverage,
    `Conservative coverage (${conservativeResult.coverage}) should be >= aggressive coverage (${aggressiveResult.coverage})`
  );

  console.log('[SUCCESS] All 10 segmentation unit tests passed!');
}

runSegmentationTests();
