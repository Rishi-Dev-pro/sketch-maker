import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import {
  detectMouth,
  detectEyeLandmarks,
  detectNose,
  estimateFaceRegion,
  estimateAllFaceRegions,
  segmentSubject,
  computeSobelGradients,
  SubjectRegion,
  SubjectMask,
  FaceRegionEstimate,
} from '../../packages/structural-analysis/src';
import {
  NormalizedImage,
  PixelBuffer,
  preprocessPixelBuffer,
} from '../../packages/image-processing/src';

/**
 * Creates a synthetic NormalizedImage and SubjectMask for testing mouth landmark detection.
 */
function createSyntheticMouthEnvironment(
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

  for (let i = 0; i < pixelCount; i++) {
    const r = rgbaData[i * 4];
    const g = rgbaData[i * 4 + 1];
    const b = rgbaData[i * 4 + 2];
    const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    lumData[i] = lum;
    floatLum[i] = lum / 255.0;
  }

  const rgba: PixelBuffer = { width, height, data: rgbaData };
  const mask: SubjectMask = {
    width,
    height,
    data: maskData,
    confidenceMap: new Float32Array(maskData).map((v) => (v > 0 ? 0.95 : 0)),
  };

  const image: NormalizedImage = {
    originalDimensions: { width, height, aspectRatio: width / height },
    processingDimensions: { width, height, aspectRatio: width / height },
    normalizedDimensions: { width, height, aspectRatio: width / height },
    rgba,
    luminance: { width, height, data: lumData, floatData: floatLum },
    scale: { x: 1.0, y: 1.0 },
    stats: {
      min: 0,
      max: 255,
      mean: 128,
      stdDev: 40,
      histogram: new Uint32Array(256),
      p1: 5,
      p99: 250,
    },
  };

  return { image, mask };
}

/**
 * Paints a synthetic face with eyes, nose, and mouth structures.
 */
function paintSyntheticFaceWithMouth(
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
  W: number,
  H: number,
  fX: number,
  fY: number,
  fW: number,
  fH: number,
  options?: {
    darkenRightSide?: boolean;
    lowLight?: boolean;
    paintGlasses?: boolean;
    profileLeftOnly?: boolean;
    paintMustache?: boolean;
    openMouth?: boolean;
    smiling?: boolean;
    omitMouth?: boolean;
    threeQuarterLeft?: boolean;
  }
) {
  const skinR = options?.lowLight ? 80 : 215;
  const skinG = options?.lowLight ? 55 : 160;
  const skinB = options?.lowLight ? 45 : 130;

  for (let y = fY; y < fY + fH; y++) {
    for (let x = fX; x < fX + fW; x++) {
      const idx = y * W + x;
      mask[idx] = 255;
      const isRightHalf = x > fX + fW * 0.5;

      if (options?.profileLeftOnly && x > fX + Math.floor(fW * 0.44)) {
        rgba[idx * 4] = 40;
        rgba[idx * 4 + 1] = 30;
        rgba[idx * 4 + 2] = 25;
      } else if (options?.darkenRightSide && isRightHalf) {
        rgba[idx * 4] = 50;
        rgba[idx * 4 + 1] = 40;
        rgba[idx * 4 + 2] = 35;
      } else {
        rgba[idx * 4] = skinR;
        rgba[idx * 4 + 1] = skinG;
        rgba[idx * 4 + 2] = skinB;
      }
      rgba[idx * 4 + 3] = 255;
    }
  }

  // Paint eyes
  const eyeLevelY = fY + Math.floor(fH * 0.28);
  const leftEyeX = fX + Math.floor(fW * (options?.threeQuarterLeft ? 0.22 : 0.28));
  const rightEyeX = fX + Math.floor(fW * (options?.threeQuarterLeft ? 0.55 : 0.72));

  function paintEye(cx: number, cy: number) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        if (px >= 0 && px < W && py >= 0 && py < H) {
          const idx = (py * W + px) * 4;
          rgba[idx] = 30;
          rgba[idx + 1] = 25;
          rgba[idx + 2] = 20;
        }
      }
    }
  }

  paintEye(leftEyeX, eyeLevelY);
  if (!options?.profileLeftOnly) {
    paintEye(rightEyeX, eyeLevelY);
  }

  // Paint nose
  let midX = Math.round((leftEyeX + rightEyeX) * 0.5);
  if (options?.profileLeftOnly) {
    midX = fX + Math.round(fW * 0.20);
  } else if (options?.threeQuarterLeft) {
    midX = fX + Math.round(fW * 0.38);
  }

  const noseTipY = fY + Math.floor(fH * 0.48);
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const px = midX + dx;
      const py = noseTipY + dy;
      if (px >= 0 && px < W && py >= 0 && py < H) {
        const idx = (py * W + px) * 4;
        rgba[idx] = Math.max(0, skinR - 20);
        rgba[idx + 1] = Math.max(0, skinG - 20);
        rgba[idx + 2] = Math.max(0, skinB - 20);
      }
    }
  }

  // Glasses
  if (options?.paintGlasses) {
    for (let x = leftEyeX; x <= rightEyeX; x++) {
      const idx = (eyeLevelY * W + x) * 4;
      rgba[idx] = 15;
      rgba[idx + 1] = 15;
      rgba[idx + 2] = 15;
    }
  }

  // Mustache (strictly between nose tip and upper lip)
  if (options?.paintMustache) {
    const mustacheStartY = noseTipY + 2;
    const mustacheEndY = fY + Math.floor(fH * 0.58);
    for (let y = mustacheStartY; y <= mustacheEndY; y++) {
      for (let dx = -15; dx <= 15; dx++) {
        const px = midX + dx;
        if (px >= 0 && px < W && y >= 0 && y < H) {
          const idx = (y * W + px) * 4;
          rgba[idx] = 25;
          rgba[idx + 1] = 18;
          rgba[idx + 2] = 12;
        }
      }
    }
  }

  // Paint mouth
  if (!options?.omitMouth) {
    const stomionY = fY + Math.floor(fH * 0.65);
    const mouthHalfW = options?.profileLeftOnly ? Math.round(fW * 0.12) : Math.round(fW * 0.18);
    const xStart = options?.profileLeftOnly ? midX - mouthHalfW : midX - mouthHalfW;
    const xEnd = options?.profileLeftOnly ? midX + 2 : midX + mouthHalfW;

    // Upper lip vermilion
    const upperLipThickness = 3;
    for (let y = stomionY - upperLipThickness; y < stomionY; y++) {
      for (let x = xStart; x <= xEnd; x++) {
        if (x >= 0 && x < W && y >= 0 && y < H) {
          const idx = (y * W + x) * 4;
          rgba[idx] = Math.min(255, Math.max(0, skinR - 35));
          rgba[idx + 1] = Math.min(255, Math.max(0, skinG - 45));
          rgba[idx + 2] = Math.min(255, Math.max(0, skinB - 35));
        }
      }
    }

    // Lower lip vermilion
    const lowerLipThickness = 4;
    for (let y = stomionY + 1; y <= stomionY + lowerLipThickness; y++) {
      for (let x = xStart; x <= xEnd; x++) {
        if (x >= 0 && x < W && y >= 0 && y < H) {
          const idx = (y * W + x) * 4;
          rgba[idx] = Math.min(255, Math.max(0, skinR - 30));
          rgba[idx + 1] = Math.min(255, Math.max(0, skinG - 40));
          rgba[idx + 2] = Math.min(255, Math.max(0, skinB - 30));
        }
      }
    }

    // Fissure seam or open mouth
    if (options?.openMouth) {
      // Teeth in center surrounded by dark opening
      for (let y = stomionY - 1; y <= stomionY + 1; y++) {
        for (let x = xStart + 3; x <= xEnd - 3; x++) {
          if (x >= 0 && x < W && y >= 0 && y < H) {
            const idx = (y * W + x) * 4;
            // White teeth
            rgba[idx] = 240;
            rgba[idx + 1] = 240;
            rgba[idx + 2] = 235;
          }
        }
      }
      // Dark corner slits
      for (let y = stomionY - 1; y <= stomionY + 1; y++) {
        for (const x of [xStart, xStart + 1, xEnd - 1, xEnd]) {
          if (x >= 0 && x < W && y >= 0 && y < H) {
            const idx = (y * W + x) * 4;
            rgba[idx] = 20;
            rgba[idx + 1] = 15;
            rgba[idx + 2] = 15;
          }
        }
      }
    } else {
      // Clean horizontal dark fissure seam (with subtle upward curve if smiling)
      for (let x = xStart; x <= xEnd; x++) {
        let seamY = stomionY;
        if (options?.smiling) {
          const normDist = (x - midX) / mouthHalfW;
          seamY = Math.round(stomionY - Math.abs(normDist) * 2);
        }
        if (x >= 0 && x < W && seamY >= 0 && seamY < H) {
          const idx = (seamY * W + x) * 4;
          rgba[idx] = 30;
          rgba[idx + 1] = 20;
          rgba[idx + 2] = 20;
        }
      }
    }
  }
}

function createSubjectFromFaceBox(
  x: number,
  y: number,
  w: number,
  h: number,
  W: number,
  H: number
): SubjectRegion {
  return {
    id: 'sub-test',
    label: 'primary_subject',
    boundingBox: { x: x / W, y: y / H, width: w / W, height: h / H },
    pixelBoundingBox: { x, y, width: w, height: h },
    pixelArea: w * h,
    confidence: 0.95,
  };
}

describe('Mouth & Lip Landmark Detection (TASK-103 Step 2D)', () => {
  it('Test 1: Normalized coordinates strictly in [0, 1]', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticMouthEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithMouth(rgba, maskData, W, H, 20, 10, 80, 75);
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(20, 10, 80, 75, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);
    const mouth = detectMouth(face, image, gradients, mask, eyes, nose);

    assert(mouth.visibility === 'visible' || mouth.visibility === 'uncertain');
    assert(mouth.confidence >= 0 && mouth.confidence <= 1.0);

    function assertNormalizedPath(points?: { x: number; y: number }[]) {
      if (!points) return;
      for (const p of points) {
        assert(p.x >= 0.0 && p.x <= 1.0, `x coordinate ${p.x} out of bounds [0, 1]`);
        assert(p.y >= 0.0 && p.y <= 1.0, `y coordinate ${p.y} out of bounds [0, 1]`);
      }
    }

    assertNormalizedPath(mouth.lipSeparation?.points);
    assertNormalizedPath(mouth.upperLip?.points);
    assertNormalizedPath(mouth.lowerLip?.points);
    if (mouth.leftCorner) {
      assert(mouth.leftCorner.x >= 0.0 && mouth.leftCorner.x <= 1.0);
      assert(mouth.leftCorner.y >= 0.0 && mouth.leftCorner.y <= 1.0);
    }
    if (mouth.rightCorner) {
      assert(mouth.rightCorner.x >= 0.0 && mouth.rightCorner.x <= 1.0);
      assert(mouth.rightCorner.y >= 0.0 && mouth.rightCorner.y <= 1.0);
    }
  });

  it('Test 2: Deterministic output across identical runs', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticMouthEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithMouth(rgba, maskData, W, H, 20, 10, 80, 75);
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(20, 10, 80, 75, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);
    const mouth1 = detectMouth(face, image, gradients, mask, eyes, nose);
    const mouth2 = detectMouth(face, image, gradients, mask, eyes, nose);

    assert.strictEqual(mouth1.visibility, mouth2.visibility);
    assert.strictEqual(mouth1.confidence, mouth2.confidence);
    assert.strictEqual(mouth1.lipSeparation?.points.length, mouth2.lipSeparation?.points.length);
    assert.strictEqual(mouth1.upperLip?.points.length, mouth2.upperLip?.points.length);
    assert.strictEqual(mouth1.lowerLip?.points.length, mouth2.lowerLip?.points.length);
  });

  it('Test 3: Frontal synthetic mouth (fissure, upper lip, lower lip visible)', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticMouthEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithMouth(rgba, maskData, W, H, 20, 10, 80, 75);
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(20, 10, 80, 75, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);
    const mouth = detectMouth(face, image, gradients, mask, eyes, nose);

    assert.strictEqual(mouth.visibility, 'visible');
    assert(mouth.lipSeparation !== undefined, 'Lip separation line must be detected');
    assert(mouth.lipSeparation.points.length >= 6, 'Lip separation must have points');
    assert(mouth.leftCorner !== undefined, 'Left corner must be detected');
    assert(mouth.rightCorner !== undefined, 'Right corner must be detected');
  });

  it('Test 4: Synthetic open mouth with visible teeth', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticMouthEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithMouth(rgba, maskData, W, H, 20, 10, 80, 75, {
        openMouth: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(20, 10, 80, 75, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);
    const mouth = detectMouth(face, image, gradients, mask, eyes, nose);

    assert(mouth.visibility === 'visible' || mouth.visibility === 'uncertain');
    assert(mouth.lipSeparation !== undefined, 'Oral opening/fissure must be resolved');
  });

  it('Test 5: Synthetic smiling/curved mouth', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticMouthEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithMouth(rgba, maskData, W, H, 20, 10, 80, 75, {
        smiling: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(20, 10, 80, 75, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);
    const mouth = detectMouth(face, image, gradients, mask, eyes, nose);

    assert(mouth.visibility === 'visible' || mouth.visibility === 'uncertain');
    assert(mouth.lipSeparation !== undefined);
  });

  it('Test 6: Three-quarter mouth shifts midline toward visible face', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticMouthEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithMouth(rgba, maskData, W, H, 15, 10, 80, 75, {
        threeQuarterLeft: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(15, 10, 80, 75, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);
    const mouth = detectMouth(face, image, gradients, mask, eyes, nose);

    assert(mouth.visibility === 'visible' || mouth.visibility === 'uncertain');
    if (mouth.lipSeparation && mouth.lipSeparation.points.length > 0) {
      const meanX =
        mouth.lipSeparation.points.reduce((a, b) => a + b.x, 0) / mouth.lipSeparation.points.length;
      assert(meanX < 0.50, `Three quarter mouth meanX ${meanX} should be shifted left`);
    }
  });

  it('Test 7: Profile visibility (visible mouth structure detected)', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticMouthEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithMouth(rgba, maskData, W, H, 20, 15, 65, 55, {
        profileLeftOnly: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(20, 15, 65, 55, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const mouth = detectMouth(face, image, gradients, mask);
    assert(mouth.visibility === 'visible' || mouth.visibility === 'uncertain');
    assert(mouth.leftCorner !== undefined, 'Visible profile corner should be present');
  });

  it('Test 8: Hidden-side suppression (never fabricates occluded right corner on left profile)', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticMouthEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithMouth(rgba, maskData, W, H, 20, 15, 65, 55, {
        profileLeftOnly: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(20, 15, 65, 55, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const mouth = detectMouth(face, image, gradients, mask);
    assert.strictEqual(mouth.rightCorner, undefined, 'Occluded right corner must be strictly undefined');
  });

  it('Test 9: Facial-hair / moustache robustness (mustache above oral seam does not corrupt mouth)', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticMouthEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithMouth(rgba, maskData, W, H, 20, 10, 80, 75, {
        paintMustache: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(20, 10, 80, 75, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);
    const mouth = detectMouth(face, image, gradients, mask, eyes, nose);

    assert(mouth.visibility === 'visible' || mouth.visibility === 'uncertain');
    // The mouth fissure should still sit at or near stomion level y ≈ 0.72
    if (mouth.lipSeparation && mouth.lipSeparation.points.length > 0) {
      const meanY =
        mouth.lipSeparation.points.reduce((a, b) => a + b.y, 0) / mouth.lipSeparation.points.length;
      assert(meanY >= (10 + 75 * 0.58) / H, `Mouth meanY ${meanY} must not be sucked into mustache`);
    }
  });

  it('Test 10: Glasses robustness (spectacle rims do not create false mouth contours)', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticMouthEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithMouth(rgba, maskData, W, H, 20, 10, 80, 75, {
        paintGlasses: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(20, 10, 80, 75, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);
    const mouth = detectMouth(face, image, gradients, mask, eyes, nose);

    assert(mouth.visibility === 'visible' || mouth.visibility === 'uncertain');
  });

  it('Test 11: Extreme-lighting robustness (chiaroscuro shadow does not hallucinate false mouth)', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticMouthEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithMouth(rgba, maskData, W, H, 20, 10, 80, 75, {
        darkenRightSide: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(20, 10, 80, 75, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);
    const mouth = detectMouth(face, image, gradients, mask, eyes, nose);

    assert(
      mouth.visibility === 'visible' || mouth.visibility === 'uncertain' || mouth.visibility === 'not_detected',
      'Detector must return valid FeatureVisibility'
    );
    assert(mouth.confidence <= 0.40, 'Shadow boundary must not create inflated false confidence');
  });

  it('Test 12: Low-light behavior preserves detection using local contrast', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticMouthEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithMouth(rgba, maskData, W, H, 20, 10, 80, 75, {
        lowLight: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(20, 10, 80, 75, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);
    const mouth = detectMouth(face, image, gradients, mask, eyes, nose);

    assert(mouth.visibility === 'visible' || mouth.visibility === 'uncertain');
  });

  it('Test 13: Multi-person isolation (evaluates instances independently)', () => {
    const W = 220;
    const H = 100;
    const { image, mask } = createSyntheticMouthEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithMouth(rgba, maskData, W, H, 10, 10, 70, 75);
      paintSyntheticFaceWithMouth(rgba, maskData, W, H, 120, 10, 70, 75);
    });

    const gradients = computeSobelGradients(image.luminance);
    const sub1 = createSubjectFromFaceBox(10, 10, 70, 75, W, H);
    const sub2 = { ...createSubjectFromFaceBox(120, 10, 70, 75, W, H), id: 'sub-2', label: 'secondary_subject' as const };

    const face1 = estimateFaceRegion(sub1, mask, image, gradients);
    const face2 = estimateFaceRegion(sub2, mask, image, gradients);
    assert(face1 !== null && face2 !== null);

    const mouth1 = detectMouth(face1, image, gradients, mask);
    const mouth2 = detectMouth(face2, image, gradients, mask);

    assert(mouth1.visibility === 'visible' || mouth1.visibility === 'uncertain');
    assert(mouth2.visibility === 'visible' || mouth2.visibility === 'uncertain');

    if (mouth1.lipSeparation && mouth1.lipSeparation.points.length > 0) {
      assert(mouth1.lipSeparation.points[0].x < 0.50);
    }
    if (mouth2.lipSeparation && mouth2.lipSeparation.points.length > 0) {
      assert(mouth2.lipSeparation.points[0].x > 0.50);
    }
  });

  it('Test 14: Weak-evidence confidence reduction (featureless skin drops confidence)', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticMouthEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithMouth(rgba, maskData, W, H, 20, 10, 80, 75, {
        omitMouth: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(20, 10, 80, 75, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const mouth = detectMouth(face, image, gradients, mask);
    assert(
      mouth.visibility === 'not_detected' || mouth.visibility === 'uncertain',
      `Expected not_detected or uncertain on featureless face, got ${mouth.visibility}`
    );
  });

  it('Test 15: Optional lip separation behavior returns undefined when fissure is absent', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticMouthEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithMouth(rgba, maskData, W, H, 20, 10, 80, 75, {
        omitMouth: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(20, 10, 80, 75, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const mouth = detectMouth(face, image, gradients, mask);
    assert.strictEqual(mouth.lipSeparation, undefined);
  });

  it('Test 16: Real benchmark BM-02 true side profile strictly suppresses occluded right corner', () => {
    const imagesDir = path.resolve(__dirname, '../images');
    const imgPath = path.join(imagesDir, 'bm-02-side-profile.jpg');
    if (!fs.existsSync(imgPath)) return;

    const buf = fs.readFileSync(imgPath);
    const raw = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    const pixelBuf: PixelBuffer = {
      width: raw.width,
      height: raw.height,
      data: new Uint8ClampedArray(raw.data),
    };

    const normImage = preprocessPixelBuffer(pixelBuf, { targetDimension: 1024, normalizeLighting: false });
    const segResult = segmentSubject(normImage);
    const gradients = computeSobelGradients(normImage.luminance);
    const faceEstimates = estimateAllFaceRegions(segResult, normImage, gradients);
    assert(faceEstimates.length > 0, 'Face must be detected on BM-02');

    const face = faceEstimates[0];
    assert.strictEqual(face.pose, 'left_profile');

    const eyes = detectEyeLandmarks(face, normImage, gradients, segResult.mask);
    const nose = detectNose(face, normImage, gradients, segResult.mask, eyes);
    const mouth = detectMouth(face, normImage, gradients, segResult.mask, eyes, nose);

    // Right corner MUST be strictly suppressed on left profile
    assert.strictEqual(mouth.rightCorner, undefined);
  });
});
