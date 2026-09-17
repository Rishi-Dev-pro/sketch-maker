import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import {
  detectEyeLandmarks,
  estimateFaceRegion,
  estimateAllFaceRegions,
  segmentSubject,
  computeSobelGradients,
  SubjectRegion,
  SubjectMask,
  SegmentationResult,
  FaceRegionEstimate,
} from '../../packages/structural-analysis/src';
import {
  NormalizedImage,
  PixelBuffer,
  preprocessPixelBuffer,
} from '../../packages/image-processing/src';

/**
 * Creates a synthetic NormalizedImage and SubjectMask for testing eye landmark detection.
 */
function createSyntheticEyeEnvironment(
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

  // Compute photometric luminance
  for (let i = 0; i < pixelCount; i++) {
    const r = rgbaData[i * 4];
    const g = rgbaData[i * 4 + 1];
    const b = rgbaData[i * 4 + 2];
    const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    lumData[i] = lum;
    floatLum[i] = lum / 255;
  }

  const rgba: PixelBuffer = { width, height, data: rgbaData };
  const luminance = { width, height, data: lumData, floatData: floatLum };

  let sum = 0;
  for (let i = 0; i < pixelCount; i++) sum += lumData[i];
  const mean = sum / pixelCount;

  const image: NormalizedImage = {
    rgba,
    luminance,
    scale: { x: 1, y: 1 },
    originalDimensions: { width, height },
    processingDimensions: { width, height },
    stats: {
      min: 0,
      max: 255,
      mean,
      stdDev: 25,
      histogram: new Uint32Array(256),
      p1: 0,
      p99: 255,
    },
  };

  const mask: SubjectMask = {
    width,
    height,
    data: maskData,
    confidenceMap: new Float32Array(pixelCount).fill(1.0),
  };

  return { image, mask };
}

/**
 * Paints a synthetic facial head with eyes, sclera, iris, and pupils.
 */
function paintSyntheticFaceWithEyes(
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
  W: number,
  fX: number,
  fY: number,
  fW: number,
  fH: number,
  options?: {
    darkenRightSide?: boolean;
    lowLight?: boolean;
    paintGlasses?: boolean;
    profileLeftOnly?: boolean;
  }
) {
  // Base face skin tone
  const skinR = options?.lowLight ? 80 : 215;
  const skinG = options?.lowLight ? 55 : 160;
  const skinB = options?.lowLight ? 45 : 130;

  for (let y = fY; y < fY + fH; y++) {
    for (let x = fX; x < fX + fW; x++) {
      const idx = y * W + x;
      mask[idx] = 255;
      const isRightHalf = x > fX + fW * 0.5;

      if (options?.profileLeftOnly && x > fX + Math.floor(fW * 0.44)) {
        // Dark occipital cranium/hair on profile back
        rgba[idx * 4] = 40;
        rgba[idx * 4 + 1] = 30;
        rgba[idx * 4 + 2] = 25;
      } else if (options?.darkenRightSide && isRightHalf) {
        // Heavy shadow
        rgba[idx * 4] = 30;
        rgba[idx * 4 + 1] = 25;
        rgba[idx * 4 + 2] = 20;
      } else {
        rgba[idx * 4] = skinR;
        rgba[idx * 4 + 1] = skinG;
        rgba[idx * 4 + 2] = skinB;
      }
      rgba[idx * 4 + 3] = 255;
    }
  }

  // Paint eyes
  const eyeLevelY = fY + Math.floor(fH * 0.33);
  const eyeRadius = Math.max(3, Math.floor(fW * 0.08));

  const leftEyeCenterX = options?.profileLeftOnly
    ? fX + Math.floor(fW * 0.22)
    : fX + Math.floor(fW * 0.28);
  const rightEyeCenterX = fX + Math.floor(fW * 0.72);

  function paintEye(cx: number, cy: number, darkened: boolean) {
    for (let dy = -eyeRadius; dy <= eyeRadius; dy++) {
      for (let dx = -eyeRadius * 1.5; dx <= eyeRadius * 1.5; dx++) {
        const px = Math.floor(cx + dx);
        const py = Math.floor(cy + dy);
        if (px < 0 || px >= W) continue;
        const idx = py * W + px;

        const distSq = (dx * dx) / (2.25) + (dy * dy);
        if (distSq <= eyeRadius * eyeRadius) {
          if (darkened) {
            // Low-contrast shadowed eye structure (chiaroscuro)
            const rCenterSq = dx * dx + dy * dy;
            if (rCenterSq <= Math.pow(eyeRadius * 0.55, 2)) {
              rgba[idx * 4] = 15;
              rgba[idx * 4 + 1] = 12;
              rgba[idx * 4 + 2] = 10;
            } else {
              rgba[idx * 4] = 45;
              rgba[idx * 4 + 1] = 38;
              rgba[idx * 4 + 2] = 30;
            }
          } else {
            // Sclera (white)
            rgba[idx * 4] = options?.lowLight ? 120 : 240;
            rgba[idx * 4 + 1] = options?.lowLight ? 110 : 235;
            rgba[idx * 4 + 2] = options?.lowLight ? 100 : 230;

            // Iris / Pupil (center dark disk)
            const rCenterSq = dx * dx + dy * dy;
            if (rCenterSq <= Math.pow(eyeRadius * 0.55, 2)) {
              // Iris (dark brown / black)
              rgba[idx * 4] = 45;
              rgba[idx * 4 + 1] = 30;
              rgba[idx * 4 + 2] = 25;

              // Pupil (deepest black in core)
              if (rCenterSq <= Math.pow(eyeRadius * 0.25, 2)) {
                rgba[idx * 4] = 10;
                rgba[idx * 4 + 1] = 10;
                rgba[idx * 4 + 2] = 10;
              }
            }
          }
        }
      }
    }
  }

  // Paint left eye
  paintEye(leftEyeCenterX, eyeLevelY, false);

  // Paint right eye (or shadow if darkened)
  if (!options?.profileLeftOnly) {
    paintEye(rightEyeCenterX, eyeLevelY, Boolean(options?.darkenRightSide));
  }

  // Optional glasses rims across orbital band
  if (options?.paintGlasses) {
    const rimY = eyeLevelY - eyeRadius - 2;
    for (let x = fX + Math.floor(fW * 0.15); x <= fX + Math.floor(fW * 0.85); x++) {
      const idx = rimY * W + x;
      rgba[idx * 4] = 20;
      rgba[idx * 4 + 1] = 20;
      rgba[idx * 4 + 2] = 20;
    }
  }
}

describe('Eye + Eyelid Landmark Detection (TASK-103 Step 2A)', () => {
  it('Test 1: Normalized coordinates strictly in [0, 1]', () => {
    const W = 120;
    const H = 120;
    const { image, mask } = createSyntheticEyeEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEyes(rgba, maskData, W, 20, 20, 80, 80);
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject: SubjectRegion = {
      id: 'sub-norm',
      label: 'primary_subject',
      boundingBox: { x: 20 / W, y: 20 / H, width: 80 / W, height: 80 / H },
      pixelBoundingBox: { x: 20, y: 20, width: 80, height: 80 },
      pixelArea: 6400,
      confidence: 0.95,
    };

    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    assert(eyes.leftEye !== undefined);
    assert(eyes.rightEye !== undefined);

    for (const eye of [eyes.leftEye, eyes.rightEye]) {
      for (const p of eye.upperLid.points) {
        assert(p.x >= 0 && p.x <= 1, `Point x must be in [0,1], got ${p.x}`);
        assert(p.y >= 0 && p.y <= 1, `Point y must be in [0,1], got ${p.y}`);
      }
      for (const p of eye.lowerLid.points) {
        assert(p.x >= 0 && p.x <= 1, `Point x must be in [0,1], got ${p.x}`);
        assert(p.y >= 0 && p.y <= 1, `Point y must be in [0,1], got ${p.y}`);
      }
      if (eye.iris) {
        assert(eye.iris.x >= 0 && eye.iris.x <= 1);
        assert(eye.iris.y >= 0 && eye.iris.y <= 1);
      }
      if (eye.pupil) {
        assert(eye.pupil.x >= 0 && eye.pupil.x <= 1);
        assert(eye.pupil.y >= 0 && eye.pupil.y <= 1);
      }
    }
  });

  it('Test 2: Eye contour points remain within subject bounds', () => {
    const W = 100;
    const H = 100;
    const { image, mask } = createSyntheticEyeEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEyes(rgba, maskData, W, 25, 20, 50, 60);
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject: SubjectRegion = {
      id: 'sub-bounds',
      label: 'primary_subject',
      boundingBox: { x: 0.25, y: 0.20, width: 0.50, height: 0.60 },
      pixelBoundingBox: { x: 25, y: 20, width: 50, height: 60 },
      pixelArea: 3000,
      confidence: 0.95,
    };

    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    assert(eyes.leftEye !== undefined);

    const subXMin = subject.boundingBox.x - 0.02;
    const subXMax = subject.boundingBox.x + subject.boundingBox.width + 0.02;
    const subYMin = subject.boundingBox.y - 0.02;
    const subYMax = subject.boundingBox.y + subject.boundingBox.height + 0.02;

    for (const p of eyes.leftEye.upperLid.points) {
      assert(p.x >= subXMin && p.x <= subXMax);
      assert(p.y >= subYMin && p.y <= subYMax);
    }
  });

  it('Test 3: Deterministic output across identical runs', () => {
    const W = 100;
    const H = 100;
    const { image, mask } = createSyntheticEyeEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEyes(rgba, maskData, W, 20, 20, 60, 60);
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject: SubjectRegion = {
      id: 'sub-det',
      label: 'primary_subject',
      boundingBox: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
      pixelBoundingBox: { x: 20, y: 20, width: 60, height: 60 },
      pixelArea: 3600,
      confidence: 0.95,
    };

    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const run1 = detectEyeLandmarks(face, image, gradients, mask);
    const run2 = detectEyeLandmarks(face, image, gradients, mask);

    assert.deepStrictEqual(run1, run2, 'Repeated detector calls must produce identical landmark results');
  });

  it('Test 4: Synthetic frontal eyes detection (both eyes visible)', () => {
    const W = 100;
    const H = 100;
    const { image, mask } = createSyntheticEyeEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEyes(rgba, maskData, W, 20, 20, 60, 60);
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject: SubjectRegion = {
      id: 'sub-frontal',
      label: 'primary_subject',
      boundingBox: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
      pixelBoundingBox: { x: 20, y: 20, width: 60, height: 60 },
      pixelArea: 3600,
      confidence: 0.95,
    };

    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);
    assert.strictEqual(face.pose, 'frontal');

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    assert(eyes.leftEye !== undefined);
    assert(eyes.rightEye !== undefined);
    assert.strictEqual(eyes.leftEye.visibility, 'visible');
    assert.strictEqual(eyes.rightEye.visibility, 'visible');
    assert(eyes.leftEye.confidence! >= 0.30);
    assert(eyes.rightEye.confidence! >= 0.30);
    assert(eyes.leftEye.upperLid.points.length >= 3);
    assert(eyes.rightEye.upperLid.points.length >= 3);
  });

  it('Test 5: Synthetic profile with one visible eye (hidden eye strictly occluded)', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticEyeEnvironment(W, H, (rgba, maskData) => {
      // Left profile: face on left half (x=20 to 50), cranium on right (x=51 to 85)
      paintSyntheticFaceWithEyes(rgba, maskData, W, 20, 15, 65, 55, { profileLeftOnly: true });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject: SubjectRegion = {
      id: 'sub-profile',
      label: 'primary_subject',
      boundingBox: { x: 20 / W, y: 15 / H, width: 65 / W, height: 55 / H },
      pixelBoundingBox: { x: 20, y: 15, width: 65, height: 55 },
      pixelArea: 3500,
      confidence: 0.93,
    };

    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);
    assert.strictEqual(face.pose, 'left_profile');
    assert.strictEqual(face.visibleSide, 'left_only');

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    assert(eyes.leftEye !== undefined);
    assert(eyes.rightEye !== undefined);

    // Left eye is visible on profile side
    assert(eyes.leftEye.upperLid.points.length >= 3);
    assert(eyes.leftEye.confidence! > 0);

    // Right eye is physically occluded: zero manufactured points, confidence 0
    assert.strictEqual(eyes.rightEye.visibility, 'occluded');
    assert.strictEqual(eyes.rightEye.confidence, 0);
    assert.strictEqual(eyes.rightEye.upperLid.points.length, 0);
    assert.strictEqual(eyes.rightEye.lowerLid.points.length, 0);
    assert.strictEqual(eyes.rightEye.iris, undefined);
    assert.strictEqual(eyes.rightEye.pupil, undefined);
  });

  it('Test 6: Synthetic darkened half-face (chiaroscuro does not hallucinate)', () => {
    const W = 100;
    const H = 100;
    const { image, mask } = createSyntheticEyeEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEyes(rgba, maskData, W, 20, 20, 60, 60, { darkenRightSide: true });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject: SubjectRegion = {
      id: 'sub-chiaroscuro',
      label: 'primary_subject',
      boundingBox: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
      pixelBoundingBox: { x: 20, y: 20, width: 60, height: 60 },
      pixelArea: 3600,
      confidence: 0.94,
    };

    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    assert(eyes.leftEye !== undefined);
    assert(eyes.rightEye !== undefined);

    // Lit left eye should be visible with high confidence
    assert.strictEqual(eyes.leftEye.visibility, 'visible');
    assert(eyes.leftEye.confidence! >= 0.38);

    // Shadowed right eye must NOT be confidently marked visible
    assert(
      eyes.rightEye.visibility === 'uncertain' ||
        eyes.rightEye.visibility === 'not_detected' ||
        eyes.rightEye.visibility === 'occluded',
      `Shadowed eye must be uncertain/not_detected/occluded, got ${eyes.rightEye.visibility}`
    );
    assert(eyes.rightEye.confidence! < eyes.leftEye.confidence!);
  });

  it('Test 7: Low-light case preserves detection using local contrast', () => {
    const W = 100;
    const H = 100;
    const { image, mask } = createSyntheticEyeEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEyes(rgba, maskData, W, 20, 20, 60, 60, { lowLight: true });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject: SubjectRegion = {
      id: 'sub-lowlight',
      label: 'primary_subject',
      boundingBox: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
      pixelBoundingBox: { x: 20, y: 20, width: 60, height: 60 },
      pixelArea: 3600,
      confidence: 0.90,
    };

    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    assert(eyes.leftEye !== undefined);
    // Detection succeeds even when absolute luminance is low because of local valley contrast
    assert(eyes.leftEye.confidence! > 0.20);
  });

  it('Test 8: Glasses case (glasses rim does not corrupt eyelids)', () => {
    const W = 100;
    const H = 100;
    const { image, mask } = createSyntheticEyeEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEyes(rgba, maskData, W, 20, 20, 60, 60, { paintGlasses: true });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject: SubjectRegion = {
      id: 'sub-glasses',
      label: 'primary_subject',
      boundingBox: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
      pixelBoundingBox: { x: 20, y: 20, width: 60, height: 60 },
      pixelArea: 3600,
      confidence: 0.95,
    };

    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    assert(eyes.leftEye !== undefined);
    assert(eyes.rightEye !== undefined);

    // Eyelids are located inside the ocular opening rather than the top rim line
    for (const p of eyes.leftEye.upperLid.points) {
      assert(p.y >= (20 + 60 * 0.25) / H, 'Upper eyelid should be below the glasses top rim');
    }
  });

  it('Test 9: Multi-person isolation (evaluates subjects independently)', () => {
    const W = 180;
    const H = 100;
    const { image, mask } = createSyntheticEyeEnvironment(W, H, (rgba, maskData) => {
      // Person 1 on left
      paintSyntheticFaceWithEyes(rgba, maskData, W, 10, 20, 50, 50);
      // Person 2 on right
      paintSyntheticFaceWithEyes(rgba, maskData, W, 110, 20, 50, 50);
    });

    const gradients = computeSobelGradients(image.luminance);
    const instances: SubjectRegion[] = [
      {
        id: 'p1',
        label: 'primary_subject',
        boundingBox: { x: 10 / W, y: 20 / H, width: 50 / W, height: 50 / H },
        pixelBoundingBox: { x: 10, y: 20, width: 50, height: 50 },
        pixelArea: 2500,
        confidence: 0.95,
      },
      {
        id: 'p2',
        label: 'secondary_subject',
        boundingBox: { x: 110 / W, y: 20 / H, width: 50 / W, height: 50 / H },
        pixelBoundingBox: { x: 110, y: 20, width: 50, height: 50 },
        pixelArea: 2500,
        confidence: 0.93,
      },
    ];

    const segResult: SegmentationResult = {
      mask,
      boundingBox: { x: 10 / W, y: 20 / H, width: 150 / W, height: 50 / H },
      pixelBoundingBox: { x: 10, y: 20, width: 150, height: 50 },
      instances,
      confidence: 0.94,
      coverage: 0.28,
      scale: { x: 1, y: 1 },
      originalDimensions: { width: W, height: H },
      processingDimensions: { width: W, height: H },
      metrics: { latencyMs: 30, algorithm: 'multi-cue' },
    };

    const faceEstimates = estimateAllFaceRegions(segResult, image, gradients);
    assert.strictEqual(faceEstimates.length, 2);

    const eyes1 = detectEyeLandmarks(faceEstimates[0], image, gradients, mask);
    const eyes2 = detectEyeLandmarks(faceEstimates[1], image, gradients, mask);

    assert(eyes1.leftEye !== undefined && eyes2.leftEye !== undefined);
    // Person 1 eyes must be on the left half of the image
    assert(eyes1.leftEye.upperLid.points[0].x < 0.5);
    // Person 2 eyes must be on the right half of the image
    assert(eyes2.leftEye.upperLid.points[0].x > 0.5);
  });

  it('Test 10: Degenerate or invalid region returns gracefully', () => {
    const W = 60;
    const H = 60;
    const { image, mask } = createSyntheticEyeEnvironment(W, H, () => {});
    const gradients = computeSobelGradients(image.luminance);

    const fakeFace: FaceRegionEstimate = {
      subjectId: 'sub-degenerate',
      headBoundingBox: { x: 0, y: 0, width: 0.05, height: 0.05 },
      faceBoundingBox: { x: 0, y: 0, width: 0.05, height: 0.05 }, // 3px < 12px
      center: { x: 0.025, y: 0.025 },
      pose: 'frontal',
      poseConfidence: 0.5,
      confidence: 0.5,
      visibleSide: 'both',
      diagnostics: {
        symmetryScore: 0.5,
        centroidOffset: 0,
        headAreaFraction: 0.1,
        skinToneCoverage: 0,
        edgeEnergy: 0,
        profileAsymmetryRatio: 0.5,
      },
    };

    const eyes = detectEyeLandmarks(fakeFace, image, gradients, mask);
    assert.strictEqual(eyes.leftEye, undefined);
    assert.strictEqual(eyes.rightEye, undefined);
  });

  it('Test 11: Pupil and iris centers are optional and evidence-dependent', () => {
    const W = 100;
    const H = 100;
    // Flat textureless gray eye region with zero contrast
    const { image, mask } = createSyntheticEyeEnvironment(W, H, (rgba, maskData) => {
      for (let y = 20; y <= 70; y++) {
        for (let x = 20; x <= 70; x++) {
          const idx = y * W + x;
          maskData[idx] = 255;
          rgba[idx * 4] = 150;
          rgba[idx * 4 + 1] = 150;
          rgba[idx * 4 + 2] = 150;
          rgba[idx * 4 + 3] = 255;
        }
      }
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject: SubjectRegion = {
      id: 'sub-flat',
      label: 'primary_subject',
      boundingBox: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 },
      pixelBoundingBox: { x: 20, y: 20, width: 50, height: 50 },
      pixelArea: 2500,
      confidence: 0.90,
    };

    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    // When contrast is insufficient, iris and pupil must be undefined
    assert.strictEqual(eyes.leftEye?.iris, undefined);
    assert.strictEqual(eyes.leftEye?.pupil, undefined);
  });

  it('Test 12: Confidence decreases gracefully when evidence weakens', () => {
    // 1. High contrast face
    const W = 100;
    const H = 100;
    const envHigh = createSyntheticEyeEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEyes(rgba, maskData, W, 20, 20, 60, 60);
    });
    const gradsHigh = computeSobelGradients(envHigh.image.luminance);
    const subject: SubjectRegion = {
      id: 'sub-high',
      label: 'primary_subject',
      boundingBox: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
      pixelBoundingBox: { x: 20, y: 20, width: 60, height: 60 },
      pixelArea: 3600,
      confidence: 0.95,
    };
    const faceHigh = estimateFaceRegion(subject, envHigh.mask, envHigh.image, gradsHigh)!;
    const eyesHigh = detectEyeLandmarks(faceHigh, envHigh.image, gradsHigh, envHigh.mask);

    // 2. Washed-out low contrast face
    const envLow = createSyntheticEyeEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEyes(rgba, maskData, W, 20, 20, 60, 60);
      // Reduce contrast heavily
      for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = Math.round(rgba[i] * 0.2 + 120);
        rgba[i + 1] = Math.round(rgba[i + 1] * 0.2 + 120);
        rgba[i + 2] = Math.round(rgba[i + 2] * 0.2 + 120);
      }
    });
    const gradsLow = computeSobelGradients(envLow.image.luminance);
    const faceLow = estimateFaceRegion(subject, envLow.mask, envLow.image, gradsLow)!;
    const eyesLow = detectEyeLandmarks(faceLow, envLow.image, gradsLow, envLow.mask);

    assert(eyesHigh.leftEye !== undefined);
    assert(eyesLow.leftEye !== undefined);
    assert(
      eyesLow.leftEye.confidence! < eyesHigh.leftEye.confidence!,
      `Low contrast eye confidence (${eyesLow.leftEye.confidence}) should be less than high contrast (${eyesHigh.leftEye.confidence})`
    );
  });
});
