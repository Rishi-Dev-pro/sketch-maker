import assert from 'node:assert/strict';
import {
  calculateTargetDimensions,
  validatePixelBuffer,
  resamplePixelBuffer,
  rgbaToLuminance,
  computeLuminanceStats,
  normalizeLuminanceContrast,
  bilateralFilterLuminance,
  preprocessPixelBuffer,
  PixelBuffer,
  LuminanceBuffer,
} from '../../packages/image-processing/src';

function createSolidBuffer(width: number, height: number, r: number, g: number, b: number, a = 255): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = a;
  }
  return { width, height, data };
}

function runTests() {
  console.log('--- Running Preprocessing Unit Tests ---');

  // Test 1: Validation and invalid input handling
  console.log('Test 1: Input validation');
  assert.throws(() => calculateTargetDimensions(-10, 100, 512), /positive finite/);
  assert.throws(() => calculateTargetDimensions(100, 0, 512), /positive finite/);
  assert.throws(() => calculateTargetDimensions(100, 100, -50), /positive finite/);
  assert.throws(() => validatePixelBuffer(10, 10, new Uint8ClampedArray(100)), /mismatch/);

  // Test 2: Dimension normalization and aspect-ratio preservation
  console.log('Test 2: Dimension normalization');
  const dSquare = calculateTargetDimensions(2048, 2048, 1024);
  assert.strictEqual(dSquare.width, 1024);
  assert.strictEqual(dSquare.height, 1024);
  assert.strictEqual(dSquare.aspectRatio, 1.0);

  const dLandscape = calculateTargetDimensions(1920, 1080, 1024);
  assert.strictEqual(dLandscape.width, 1024);
  assert.strictEqual(dLandscape.height, 576);
  assert.ok(Math.abs(dLandscape.aspectRatio - (1920 / 1080)) < 0.005);

  const dPortrait = calculateTargetDimensions(1080, 1920, 1024);
  assert.strictEqual(dPortrait.width, 576);
  assert.strictEqual(dPortrait.height, 1024);
  assert.ok(Math.abs(dPortrait.aspectRatio - (1080 / 1920)) < 0.005);

  // Test 3: Small image preservation (strictly NO upscaling)
  console.log('Test 3: Small images not upscaled');
  const dSmall = calculateTargetDimensions(320, 240, 1024);
  assert.strictEqual(dSmall.width, 320);
  assert.strictEqual(dSmall.height, 240);

  // Test 4: Extreme aspect ratio
  console.log('Test 4: Extreme aspect ratio');
  const dPanoramic = calculateTargetDimensions(3000, 300, 1024);
  assert.strictEqual(dPanoramic.width, 1024);
  assert.strictEqual(dPanoramic.height, 102);

  // Test 5: Area-weighted downsampling energy conservation
  console.log('Test 5: Downsampling energy conservation');
  const solid = createSolidBuffer(100, 100, 120, 80, 40, 255);
  const downsampled = resamplePixelBuffer(solid, 25, 25);
  assert.strictEqual(downsampled.width, 25);
  assert.strictEqual(downsampled.height, 25);
  assert.strictEqual(downsampled.data[0], 120);
  assert.strictEqual(downsampled.data[1], 80);
  assert.strictEqual(downsampled.data[2], 40);
  assert.strictEqual(downsampled.data[3], 255);

  // Test 6: Rec. 709 perceptual photometric luminance
  console.log('Test 6: Rec. 709 photometric coefficients');
  const white = createSolidBuffer(1, 1, 255, 255, 255);
  const lumWhite = rgbaToLuminance(white);
  assert.strictEqual(lumWhite.data[0], 255);
  assert.strictEqual(lumWhite.floatData[0], 1.0);

  const black = createSolidBuffer(1, 1, 0, 0, 0);
  const lumBlack = rgbaToLuminance(black);
  assert.strictEqual(lumBlack.data[0], 0);
  assert.strictEqual(lumBlack.floatData[0], 0.0);

  // Primary Red (BT.709 weight = 0.2126 -> round(255 * 0.2126) = 54)
  const red = createSolidBuffer(1, 1, 255, 0, 0);
  assert.strictEqual(rgbaToLuminance(red).data[0], 54);

  // Primary Green (BT.709 weight = 0.7152 -> round(255 * 0.7152) = 182)
  const green = createSolidBuffer(1, 1, 0, 255, 0);
  assert.strictEqual(rgbaToLuminance(green).data[0], 182);

  // Primary Blue (BT.709 weight = 0.0722 -> round(255 * 0.0722) = 18)
  const blue = createSolidBuffer(1, 1, 0, 0, 255);
  assert.strictEqual(rgbaToLuminance(blue).data[0], 18);

  // Test 7: Statistical accumulator accuracy
  console.log('Test 7: Luminance distribution statistics');
  const testData = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  const testLum: LuminanceBuffer = {
    width: 10,
    height: 1,
    data: testData,
    floatData: new Float32Array(testData.map(v => v / 255.0)),
  };
  const stats = computeLuminanceStats(testLum);
  assert.strictEqual(stats.min, 10);
  assert.strictEqual(stats.max, 100);
  assert.strictEqual(stats.mean, 55);
  assert.ok(stats.stdDev > 28 && stats.stdDev < 29);
  const histTotal = stats.histogram.reduce((acc, v) => acc + v, 0);
  assert.strictEqual(histTotal, 10);

  // Test 8: Contrast normalization
  console.log('Test 8: Contrast normalization behavior');
  // Washed-out low-contrast image (values between 100 and 140)
  const washedData = new Uint8Array(100);
  for (let i = 0; i < 100; i++) washedData[i] = 100 + (i % 40);
  const washedLum: LuminanceBuffer = {
    width: 10,
    height: 10,
    data: washedData,
    floatData: new Float32Array(washedData.map(v => v / 255.0)),
  };
  const washedStats = computeLuminanceStats(washedLum);
  const stretchedLum = normalizeLuminanceContrast(washedLum, washedStats);
  const stretchedStats = computeLuminanceStats(stretchedLum);
  assert.ok(stretchedStats.min < washedStats.min);
  assert.ok(stretchedStats.max > washedStats.max);

  // Healthy contrast image (min <= 15, max >= 240) should NOT be modified
  const healthyData = new Uint8Array([5, 50, 100, 200, 250]);
  const healthyLum: LuminanceBuffer = {
    width: 5,
    height: 1,
    data: healthyData,
    floatData: new Float32Array(healthyData.map(v => v / 255.0)),
  };
  const healthyStats = computeLuminanceStats(healthyLum);
  const unchanged = normalizeLuminanceContrast(healthyLum, healthyStats);
  assert.strictEqual(unchanged, healthyLum);

  // Test 9: Edge-preserving bilateral filter
  console.log('Test 9: Bilateral edge preservation');
  // 5x5 image with a sharp vertical step: left side = 20, right side = 200, with noise
  const stepData = new Uint8Array(25);
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      stepData[y * 5 + x] = x < 2 ? 20 : 200;
    }
  }
  const stepLum: LuminanceBuffer = {
    width: 5,
    height: 5,
    data: stepData,
    floatData: new Float32Array(stepData.map(v => v / 255.0)),
  };
  const filteredLum = bilateralFilterLuminance(stepLum, 1, 1.5, 25.0);
  // Sharp edge between column 1 and column 2 must remain strong
  const col1 = filteredLum.data[2 * 5 + 1]; // left side
  const col2 = filteredLum.data[2 * 5 + 2]; // right side
  assert.ok(col2 - col1 > 150, `Step edge was blurred too much: col1=${col1}, col2=${col2}`);

  // Test 10: Determinism
  console.log('Test 10: Deterministic execution');
  const randomBuf = createSolidBuffer(64, 64, 180, 120, 70);
  const run1 = preprocessPixelBuffer(randomBuf, { profile: 'fast' });
  const run2 = preprocessPixelBuffer(randomBuf, { profile: 'fast' });
  assert.deepStrictEqual(run1.luminance.data, run2.luminance.data);
  assert.strictEqual(run1.stats.mean, run2.stats.mean);

  console.log('[SUCCESS] All 10 preprocessing unit tests passed!');
}

runTests();
