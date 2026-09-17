import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import {
  estimateFaceRegion,
  estimateAllFaceRegions,
  segmentSubject,
  SubjectRegion,
  SubjectMask,
  SegmentationResult,
} from '../../packages/structural-analysis/src';
import {
  computeSobelGradients,
} from '../../packages/structural-analysis/src/gradient';
import {
  NormalizedImage,
  PixelBuffer,
  LuminanceBuffer,
  preprocessPixelBuffer,
} from '../../packages/image-processing/src';

/**
 * Creates a synthetic NormalizedImage and SubjectMask for testing.
 */
function createSyntheticEnvironment(
  width: number,
  height: number,
  setupFn: (rgba: Uint8ClampedArray, mask: Uint8Array) => void
): { image: NormalizedImage; mask: SubjectMask } {
  const pixelCount = width * height;
  const rgbaData = new Uint8ClampedArray(pixelCount * 4);
  const maskData = new Uint8Array(pixelCount);
  const lumData = new Uint8Array(pixelCount);
  const floatLum = new Float32Array(pixelCount);

  setupFn(rgbaData, maskData);

  // Compute luminance
  for (let i = 0; i < pixelCount; i++) {
    const r = rgbaData[i * 4];
    const g = rgbaData[i * 4 + 1];
    const b = rgbaData[i * 4 + 2];
    const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    lumData[i] = lum;
    floatLum[i] = lum / 255;
  }

  const rgba: PixelBuffer = { width, height, data: rgbaData };
  const luminance: LuminanceBuffer = { width, height, data: lumData, floatData: floatLum };
  const mask: SubjectMask = {
    width,
    height,
    data: maskData,
    confidenceMap: new Float32Array(maskData).map((v) => (v > 0 ? 0.95 : 0)),
  };

  const image: NormalizedImage = {
    originalDimensions: { width, height, aspectRatio: width / height },
    processingDimensions: { width, height, aspectRatio: width / height },
    scale: { x: 1, y: 1 },
    rgba,
    luminance,
    stats: {
      min: 0,
      max: 255,
      mean: 128,
      stdDev: 40,
      p1: 10,
      p99: 245,
      histogram: new Uint32Array(256),
    },
    exifOrientation: 1,
  };

  return { image, mask };
}

describe('Face Region Isolation & Head Pose Estimation', () => {
  it('Test 1: Normalized bounding box validity', () => {
    const W = 100;
    const H = 100;
    const { image, mask } = createSyntheticEnvironment(W, H, (rgba, maskData) => {
      // Centered head (circle at 50, 40, radius 25)
      for (let y = 15; y <= 65; y++) {
        for (let x = 25; x <= 75; x++) {
          const dx = x - 50;
          const dy = y - 40;
          if (dx * dx + dy * dy <= 25 * 25) {
            const idx = y * W + x;
            maskData[idx] = 255;
            // Warm skin tone (R=220, G=160, B=130)
            rgba[idx * 4] = 220;
            rgba[idx * 4 + 1] = 160;
            rgba[idx * 4 + 2] = 130;
            rgba[idx * 4 + 3] = 255;
          }
        }
      }
    });

    const subject: SubjectRegion = {
      id: 'sub-01',
      label: 'primary_subject',
      boundingBox: { x: 0.25, y: 0.15, width: 0.5, height: 0.5 },
      pixelBoundingBox: { x: 25, y: 15, width: 50, height: 50 },
      pixelArea: 1960,
      confidence: 0.95,
    };

    const gradients = computeSobelGradients(image.luminance);
    const estimate = estimateFaceRegion(subject, mask, image, gradients);

    assert(estimate !== null, 'Estimate must not be null');
    assert(estimate.headBoundingBox.x >= 0 && estimate.headBoundingBox.x <= 1);
    assert(estimate.headBoundingBox.y >= 0 && estimate.headBoundingBox.y <= 1);
    assert(estimate.headBoundingBox.width > 0 && estimate.headBoundingBox.width <= 1);
    assert(estimate.headBoundingBox.height > 0 && estimate.headBoundingBox.height <= 1);
    assert(estimate.faceBoundingBox.x >= 0 && estimate.faceBoundingBox.x <= 1);
    assert(estimate.faceBoundingBox.y >= 0 && estimate.faceBoundingBox.y <= 1);
    assert(estimate.faceBoundingBox.width > 0 && estimate.faceBoundingBox.width <= 1);
    assert(estimate.faceBoundingBox.height > 0 && estimate.faceBoundingBox.height <= 1);
  });

  it('Test 2: Face region stays within subject bounds', () => {
    const W = 120;
    const H = 140;
    const { image, mask } = createSyntheticEnvironment(W, H, (rgba, maskData) => {
      // Upper torso and head
      for (let y = 20; y <= 110; y++) {
        const halfW = y < 70 ? 25 : 45;
        for (let x = 60 - halfW; x <= 60 + halfW; x++) {
          const idx = y * W + x;
          maskData[idx] = 255;
          rgba[idx * 4] = 210;
          rgba[idx * 4 + 1] = 150;
          rgba[idx * 4 + 2] = 120;
          rgba[idx * 4 + 3] = 255;
        }
      }
    });

    const subject: SubjectRegion = {
      id: 'sub-02',
      label: 'primary_subject',
      boundingBox: { x: 15 / W, y: 20 / H, width: 90 / W, height: 90 / H },
      pixelBoundingBox: { x: 15, y: 20, width: 90, height: 90 },
      pixelArea: 5500,
      confidence: 0.94,
    };

    const gradients = computeSobelGradients(image.luminance);
    const estimate = estimateFaceRegion(subject, mask, image, gradients);

    assert(estimate !== null);
    // Face box should not extend beyond subject bounds (with tiny floating-point tolerance)
    assert(estimate.faceBoundingBox.x >= subject.boundingBox.x - 0.01);
    assert(estimate.faceBoundingBox.y >= subject.boundingBox.y - 0.01);
    assert(
      estimate.faceBoundingBox.x + estimate.faceBoundingBox.width <=
        subject.boundingBox.x + subject.boundingBox.width + 0.01
    );
  });

  it('Test 3: Coordinates remain strictly in [0, 1]', () => {
    const W = 80;
    const H = 80;
    const { image, mask } = createSyntheticEnvironment(W, H, (rgba, maskData) => {
      for (let y = 5; y < 75; y++) {
        for (let x = 5; x < 75; x++) {
          const idx = y * W + x;
          maskData[idx] = 255;
          rgba[idx * 4] = 200;
          rgba[idx * 4 + 1] = 150;
          rgba[idx * 4 + 2] = 120;
          rgba[idx * 4 + 3] = 255;
        }
      }
    });

    const subject: SubjectRegion = {
      id: 'sub-03',
      label: 'primary_subject',
      boundingBox: { x: 5 / W, y: 5 / H, width: 70 / W, height: 70 / H },
      pixelBoundingBox: { x: 5, y: 5, width: 70, height: 70 },
      pixelArea: 4900,
      confidence: 0.90,
    };

    const gradients = computeSobelGradients(image.luminance);
    const estimate = estimateFaceRegion(subject, mask, image, gradients);

    assert(estimate !== null);
    assert(estimate.center.x >= 0 && estimate.center.x <= 1);
    assert(estimate.center.y >= 0 && estimate.center.y <= 1);
  });

  it('Test 4: Deterministic output', () => {
    const W = 100;
    const H = 100;
    const { image, mask } = createSyntheticEnvironment(W, H, (rgba, maskData) => {
      for (let y = 20; y <= 70; y++) {
        for (let x = 30; x <= 70; x++) {
          const idx = y * W + x;
          maskData[idx] = 255;
          rgba[idx * 4] = 215;
          rgba[idx * 4 + 1] = 160;
          rgba[idx * 4 + 2] = 135;
          rgba[idx * 4 + 3] = 255;
        }
      }
    });

    const subject: SubjectRegion = {
      id: 'sub-04',
      label: 'primary_subject',
      boundingBox: { x: 0.3, y: 0.2, width: 0.4, height: 0.5 },
      pixelBoundingBox: { x: 30, y: 20, width: 40, height: 50 },
      pixelArea: 2000,
      confidence: 0.92,
    };

    const gradients = computeSobelGradients(image.luminance);
    const est1 = estimateFaceRegion(subject, mask, image, gradients);
    const est2 = estimateFaceRegion(subject, mask, image, gradients);

    assert.deepStrictEqual(est1, est2, 'Repeated calls must yield identical output');
  });

  it('Test 5: Frontal synthetic case (balanced centered face)', () => {
    const W = 100;
    const H = 100;
    const { image, mask } = createSyntheticEnvironment(W, H, (rgba, maskData) => {
      // Perfectly symmetric head & face
      for (let y = 15; y <= 65; y++) {
        for (let x = 30; x <= 70; x++) {
          const idx = y * W + x;
          maskData[idx] = 255;
          rgba[idx * 4] = 220;
          rgba[idx * 4 + 1] = 165;
          rgba[idx * 4 + 2] = 130;
          rgba[idx * 4 + 3] = 255;
        }
      }
    });

    const subject: SubjectRegion = {
      id: 'sub-05',
      label: 'primary_subject',
      boundingBox: { x: 0.3, y: 0.15, width: 0.4, height: 0.5 },
      pixelBoundingBox: { x: 30, y: 15, width: 40, height: 50 },
      pixelArea: 2000,
      confidence: 0.95,
    };

    const gradients = computeSobelGradients(image.luminance);
    const estimate = estimateFaceRegion(subject, mask, image, gradients);

    assert(estimate !== null);
    assert.strictEqual(estimate.pose, 'frontal', `Expected frontal, got ${estimate.pose}`);
    assert.strictEqual(estimate.visibleSide, 'both');
    assert(estimate.diagnostics.symmetryScore >= 0.7, 'Symmetry score should be high for centered head');
  });

  it('Test 6: Profile synthetic case (asymmetric offset face)', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticEnvironment(W, H, (rgba, maskData) => {
      // Left profile: nose/face on the left (x=20 to x=45), back of cranium/hair extending right (x=45 to x=85)
      for (let y = 15; y <= 70; y++) {
        for (let x = 20; x <= 85; x++) {
          const idx = y * W + x;
          maskData[idx] = 255;
          if (x <= 48) {
            // Skin tone on left facing profile
            rgba[idx * 4] = 225;
            rgba[idx * 4 + 1] = 170;
            rgba[idx * 4 + 2] = 135;
          } else {
            // Dark hair on right
            rgba[idx * 4] = 40;
            rgba[idx * 4 + 1] = 30;
            rgba[idx * 4 + 2] = 25;
          }
          rgba[idx * 4 + 3] = 255;
        }
      }
    });

    const subject: SubjectRegion = {
      id: 'sub-06',
      label: 'primary_subject',
      boundingBox: { x: 20 / W, y: 15 / H, width: 65 / W, height: 55 / H },
      pixelBoundingBox: { x: 20, y: 15, width: 65, height: 55 },
      pixelArea: 3500,
      confidence: 0.93,
    };

    const gradients = computeSobelGradients(image.luminance);
    const estimate = estimateFaceRegion(subject, mask, image, gradients);

    assert(estimate !== null);
    assert.strictEqual(
      estimate.pose,
      'left_profile',
      `Expected left_profile, got ${estimate.pose} (offset=${estimate.diagnostics.centroidOffset}, asym=${estimate.diagnostics.profileAsymmetryRatio})`
    );
    assert.strictEqual(estimate.visibleSide, 'left_only');
  });

  it('Test 7: Ambiguous / low-evidence case (confidence decreases gracefully)', () => {
    const W = 80;
    const H = 80;
    const { image, mask } = createSyntheticEnvironment(W, H, (rgba, maskData) => {
      // Neutral gray texture with no skin tone and low contrast
      for (let y = 20; y <= 60; y++) {
        for (let x = 20; x <= 60; x++) {
          const idx = y * W + x;
          maskData[idx] = 255;
          rgba[idx * 4] = 100;
          rgba[idx * 4 + 1] = 100;
          rgba[idx * 4 + 2] = 100;
          rgba[idx * 4 + 3] = 255;
        }
      }
    });

    const subject: SubjectRegion = {
      id: 'sub-07',
      label: 'primary_subject',
      boundingBox: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      pixelBoundingBox: { x: 20, y: 20, width: 40, height: 40 },
      pixelArea: 1600,
      confidence: 0.50, // lower mask confidence
    };

    const gradients = computeSobelGradients(image.luminance);
    const estimate = estimateFaceRegion(subject, mask, image, gradients);

    assert(estimate !== null);
    assert(
      estimate.confidence < 0.65,
      `Expected lower confidence on low-evidence input, got ${estimate.confidence}`
    );
  });

  it('Test 8: Multi-person isolation (evaluates instances independently)', () => {
    const W = 160;
    const H = 100;
    const { image, mask } = createSyntheticEnvironment(W, H, (rgba, maskData) => {
      // Person 1 on left (x=20 to x=60)
      for (let y = 20; y <= 70; y++) {
        for (let x = 20; x <= 60; x++) {
          const idx = y * W + x;
          maskData[idx] = 255;
          rgba[idx * 4] = 220;
          rgba[idx * 4 + 1] = 160;
          rgba[idx * 4 + 2] = 130;
          rgba[idx * 4 + 3] = 255;
        }
      }
      // Person 2 on right (x=100 to x=140)
      for (let y = 20; y <= 70; y++) {
        for (let x = 100; x <= 140; x++) {
          const idx = y * W + x;
          maskData[idx] = 255;
          rgba[idx * 4] = 210;
          rgba[idx * 4 + 1] = 150;
          rgba[idx * 4 + 2] = 120;
          rgba[idx * 4 + 3] = 255;
        }
      }
    });

    const instances: SubjectRegion[] = [
      {
        id: 'person-1',
        label: 'primary_subject',
        boundingBox: { x: 20 / W, y: 20 / H, width: 40 / W, height: 50 / H },
        pixelBoundingBox: { x: 20, y: 20, width: 40, height: 50 },
        pixelArea: 2000,
        confidence: 0.95,
      },
      {
        id: 'person-2',
        label: 'secondary_subject',
        boundingBox: { x: 100 / W, y: 20 / H, width: 40 / W, height: 50 / H },
        pixelBoundingBox: { x: 100, y: 20, width: 40, height: 50 },
        pixelArea: 2000,
        confidence: 0.93,
      },
    ];

    const segResult: SegmentationResult = {
      mask,
      boundingBox: { x: 20 / W, y: 20 / H, width: 120 / W, height: 50 / H },
      pixelBoundingBox: { x: 20, y: 20, width: 120, height: 50 },
      instances,
      confidence: 0.94,
      coverage: 0.25,
      scale: { x: 1, y: 1 },
      originalDimensions: { width: W, height: H },
      processingDimensions: { width: W, height: H },
      metrics: { latencyMs: 50, algorithm: 'multi-cue' },
    };

    const gradients = computeSobelGradients(image.luminance);
    const estimates = estimateAllFaceRegions(segResult, image, gradients);

    assert.strictEqual(estimates.length, 2, 'Should isolate both subjects independently');
    assert.strictEqual(estimates[0].subjectId, 'person-1');
    assert.strictEqual(estimates[1].subjectId, 'person-2');
    assert(estimates[0].center.x < 0.5, 'Person 1 must be on left half');
    assert(estimates[1].center.x > 0.5, 'Person 2 must be on right half');
  });

  it('Test 9: Empty or invalid mask handling (graceful null return)', () => {
    const W = 60;
    const H = 60;
    const { image, mask } = createSyntheticEnvironment(W, H, () => {});

    const subject: SubjectRegion = {
      id: 'sub-degenerate',
      label: 'primary_subject',
      boundingBox: { x: 0, y: 0, width: 0.05, height: 0.05 },
      pixelBoundingBox: { x: 0, y: 0, width: 3, height: 3 }, // < 12px
      pixelArea: 9,
      confidence: 0.1,
    };

    const gradients = computeSobelGradients(image.luminance);
    const estimate = estimateFaceRegion(subject, mask, image, gradients);

    assert.strictEqual(estimate, null, 'Degenerate subject box must return null gracefully');
  });

  it('Test 10: High-resolution scaling invariance', () => {
    // Test on 400x400 synthetic canvas to ensure normalization is resolution invariant
    const W = 400;
    const H = 400;
    const { image, mask } = createSyntheticEnvironment(W, H, (rgba, maskData) => {
      for (let y = 80; y <= 260; y++) {
        for (let x = 120; x <= 280; x++) {
          const idx = y * W + x;
          maskData[idx] = 255;
          rgba[idx * 4] = 215;
          rgba[idx * 4 + 1] = 160;
          rgba[idx * 4 + 2] = 130;
          rgba[idx * 4 + 3] = 255;
        }
      }
    });

    const subject: SubjectRegion = {
      id: 'sub-high-res',
      label: 'primary_subject',
      boundingBox: { x: 120 / W, y: 80 / H, width: 160 / W, height: 180 / H },
      pixelBoundingBox: { x: 120, y: 80, width: 160, height: 180 },
      pixelArea: 28800,
      confidence: 0.96,
    };

    const gradients = computeSobelGradients(image.luminance);
    const estimate = estimateFaceRegion(subject, mask, image, gradients);

    assert(estimate !== null);
    assert(estimate.faceBoundingBox.x >= 0.25 && estimate.faceBoundingBox.x <= 0.35);
    assert(estimate.faceBoundingBox.width >= 0.25 && estimate.faceBoundingBox.width <= 0.45);
    assert.strictEqual(estimate.pose, 'frontal');
  });

  it('Test 11: Real benchmark BM-02 true side profile classifies as left_profile', () => {
    const filePath = path.resolve(__dirname, '../images/bm_02_side_profile.jpg');
    if (!fs.existsSync(filePath)) return; // Skip if benchmark assets missing

    const buf = fs.readFileSync(filePath);
    const raw = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    const imgBuffer: PixelBuffer = {
      width: raw.width,
      height: raw.height,
      data: new Uint8ClampedArray(raw.data),
    };

    const norm = preprocessPixelBuffer(imgBuffer, { targetDimension: 1024, normalizeLighting: false });
    const seg = segmentSubject(norm);
    const grads = computeSobelGradients(norm.luminance);
    const estimate = estimateFaceRegion(seg.primarySubject, seg.mask, norm, grads);

    assert(estimate !== null);
    assert.strictEqual(estimate.pose, 'left_profile', `Expected left_profile for BM-02, got ${estimate.pose}`);
    assert.strictEqual(estimate.visibleSide, 'left_only');
    assert(estimate.diagnostics.headSilhouetteAsymmetry !== undefined);
    assert(estimate.diagnostics.headSilhouetteAsymmetry < 0.40, 'Profile silhouette asymmetry should project leftward');
  });

  it('Test 12: Real benchmark BM-06 extreme chiaroscuro does NOT classify as profile', () => {
    const filePath = path.resolve(__dirname, '../images/bm_06_extreme_lighting.jpg');
    if (!fs.existsSync(filePath)) return; // Skip if benchmark assets missing

    const buf = fs.readFileSync(filePath);
    const raw = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    const imgBuffer: PixelBuffer = {
      width: raw.width,
      height: raw.height,
      data: new Uint8ClampedArray(raw.data),
    };

    const norm = preprocessPixelBuffer(imgBuffer, { targetDimension: 1024, normalizeLighting: false });
    const seg = segmentSubject(norm);
    const grads = computeSobelGradients(norm.luminance);
    const estimate = estimateFaceRegion(seg.primarySubject, seg.mask, norm, grads);

    assert(estimate !== null);
    assert.strictEqual(estimate.pose, 'frontal', `BM-06 should remain frontal under illumination asymmetry, got ${estimate.pose}`);
    assert.strictEqual(estimate.visibleSide, 'both');
  });

  it('Test 13: Synthetic frontal face with one side darkened must NOT confidently classify as profile', () => {
    const W = 100;
    const H = 100;
    const { image, mask } = createSyntheticEnvironment(W, H, (rgba, maskData) => {
      // Frontal head (x=25 to x=75, y=15 to x=65)
      for (let y = 15; y <= 65; y++) {
        for (let x = 25; x <= 75; x++) {
          const idx = y * W + x;
          maskData[idx] = 255;
          if (x < 50) {
            // Lit left half of face: normal skin
            rgba[idx * 4] = 220;
            rgba[idx * 4 + 1] = 165;
            rgba[idx * 4 + 2] = 130;
          } else {
            // Shadowed right half of face: dark shadow
            rgba[idx * 4] = 40;
            rgba[idx * 4 + 1] = 30;
            rgba[idx * 4 + 2] = 25;
          }
          rgba[idx * 4 + 3] = 255;
        }
      }
    });

    const subject: SubjectRegion = {
      id: 'sub-darkened-side',
      label: 'primary_subject',
      boundingBox: { x: 0.25, y: 0.15, width: 0.5, height: 0.5 },
      pixelBoundingBox: { x: 25, y: 15, width: 50, height: 50 },
      pixelArea: 2500,
      confidence: 0.95,
    };

    const gradients = computeSobelGradients(image.luminance);
    const estimate = estimateFaceRegion(subject, mask, image, gradients);

    assert(estimate !== null);
    // Must NOT confidently classify as a profile face simply because of shadow!
    assert.notStrictEqual(estimate.pose, 'right_profile');
    assert(
      estimate.pose === 'frontal' || estimate.pose === 'three_quarter_left',
      `Darkened side must remain frontal or low-confidence 3/4, got ${estimate.pose}`
    );
  });

  it('Test 14: Synthetic three-quarter face classifies as three_quarter_left', () => {
    const W = 100;
    const H = 100;
    const { image, mask } = createSyntheticEnvironment(W, H, (rgba, maskData) => {
      // Three-quarter head: face shifted left (x=15 to x=52), hair/cranium on right (x=45 to x=72)
      for (let y = 15; y <= 65; y++) {
        for (let x = 15; x <= 72; x++) {
          const idx = y * W + x;
          maskData[idx] = 255;
          if (x <= 62) {
            rgba[idx * 4] = 220;
            rgba[idx * 4 + 1] = 160;
            rgba[idx * 4 + 2] = 130;
            // Internal facial feature edges (eye, nose, mouth) on the face side (x=24 to x=40)
            if ((y === 28 || y === 38 || y === 48) && x >= 24 && x <= 40) {
              rgba[idx * 4] = 70;
              rgba[idx * 4 + 1] = 45;
              rgba[idx * 4 + 2] = 35;
            }
          } else {
            rgba[idx * 4] = 55;
            rgba[idx * 4 + 1] = 45;
            rgba[idx * 4 + 2] = 35;
          }
          rgba[idx * 4 + 3] = 255;
        }
      }
    });

    const subject: SubjectRegion = {
      id: 'sub-three-quarter',
      label: 'primary_subject',
      boundingBox: { x: 0.15, y: 0.15, width: 0.58, height: 0.50 },
      pixelBoundingBox: { x: 15, y: 15, width: 58, height: 50 },
      pixelArea: 2900,
      confidence: 0.94,
    };

    const gradients = computeSobelGradients(image.luminance);
    const estimate = estimateFaceRegion(subject, mask, image, gradients);

    assert(estimate !== null);
    assert.strictEqual(estimate.pose, 'three_quarter_left');
    assert.strictEqual(estimate.visibleSide, 'both');
  });
});
