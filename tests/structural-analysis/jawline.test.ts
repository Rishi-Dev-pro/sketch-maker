import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import {
  detectJawline,
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
 * Creates a synthetic NormalizedImage and SubjectMask for testing jawline detection.
 */
function createSyntheticJawlineEnvironment(
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
 * Paints a synthetic face with anatomical jawline, cheekbones, chin, eyes, nose, and mouth.
 */
function paintSyntheticFaceWithJaw(
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
  W: number,
  H: number,
  fX: number,
  fY: number,
  fW: number,
  fH: number,
  options?: {
    asymmetricRightJaw?: boolean;
    threeQuarterLeft?: boolean;
    profileLeftOnly?: boolean;
    paintBeard?: boolean;
    paintLargeHair?: boolean;
    paintClothingCollar?: boolean;
    clutteredBackground?: boolean;
    darkenRightSide?: boolean;
    lowLight?: boolean;
    omitJawMask?: boolean;
  }
) {
  const skinR = options?.lowLight ? 75 : 215;
  const skinG = options?.lowLight ? 55 : 160;
  const skinB = options?.lowLight ? 45 : 130;

  const midX = fX + Math.round(fW * 0.5);
  const chinY = fY + Math.floor(fH * 0.75);

  // Background clutter
  if (options?.clutteredBackground) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (x < fX - 10 || x > fX + fW + 10 || y > chinY + 15) {
          const idx = (y * W + x) * 4;
          rgba[idx] = 120;
          rgba[idx + 1] = 130;
          rgba[idx + 2] = 140;
          rgba[idx + 3] = 255;
        }
      }
    }
  }

  // Paint face mask and skin pixels following a tapering anatomical jaw contour
  for (let y = fY; y <= chinY; y++) {
    const yFraction = (y - fY) / (chinY - fY);
    let leftX: number;
    let rightX: number;

    if (options?.profileLeftOnly) {
      // Left profile: visible contour on left edge, flat cranium on right
      const profileOffset = Math.round(Math.sin(yFraction * Math.PI) * 10);
      leftX = fX + 5 - profileOffset;
      rightX = fX + Math.round(fW * 0.50);
    } else {
      // Frontal tapering oval
      let taper = 0;
      if (yFraction > 0.45) {
        // Inward mandibular taper toward chin
        taper = Math.round(((yFraction - 0.45) / 0.55) * (fW * 0.28));
      }
      leftX = fX + taper;
      rightX = fX + fW - (options?.asymmetricRightJaw ? Math.round(taper * 0.6) : taper);
      if (options?.threeQuarterLeft) {
        leftX = fX + Math.round(taper * 1.3);
        rightX = fX + fW - Math.round(taper * 0.7);
      }
    }

    for (let x = leftX; x <= rightX; x++) {
      if (x >= 0 && x < W && y >= 0 && y < H) {
        const idx = y * W + x;
        mask[idx] = options?.omitJawMask && yFraction > 0.45 ? 0 : 255;

        const isRightHalf = x > midX;
        if (options?.darkenRightSide && isRightHalf) {
          rgba[idx * 4] = 45;
          rgba[idx * 4 + 1] = 35;
          rgba[idx * 4 + 2] = 30;
        } else {
          rgba[idx * 4] = skinR;
          rgba[idx * 4 + 1] = skinG;
          rgba[idx * 4 + 2] = skinB;
        }
        rgba[idx * 4 + 3] = 255;
      }
    }
  }

  // Large hair extending above and around temples
  if (options?.paintLargeHair) {
    for (let y = Math.max(0, fY - 15); y < fY + Math.floor(fH * 0.35); y++) {
      for (let x = Math.max(0, fX - 15); x < Math.min(W, fX + fW + 15); x++) {
        const idx = y * W + x;
        mask[idx] = 255;
        rgba[idx * 4] = 20;
        rgba[idx * 4 + 1] = 15;
        rgba[idx * 4 + 2] = 12;
        rgba[idx * 4 + 3] = 255;
      }
    }
  }

  // Beard below mouth covering lower jaw
  if (options?.paintBeard) {
    for (let y = fY + Math.floor(fH * 0.55); y <= chinY + 5; y++) {
      for (let x = midX - 25; x <= midX + 25; x++) {
        if (x >= 0 && x < W && y >= 0 && y < H) {
          const idx = y * W + x;
          mask[idx] = 255;
          rgba[idx * 4] = 35;
          rgba[idx * 4 + 1] = 25;
          rgba[idx * 4 + 2] = 20;
          rgba[idx * 4 + 3] = 255;
        }
      }
    }
  }

  // Clothing collar expanding horizontally below chin
  if (options?.paintClothingCollar) {
    for (let y = chinY + 4; y < Math.min(H, chinY + 20); y++) {
      for (let x = Math.max(0, fX - 20); x < Math.min(W, fX + fW + 20); x++) {
        const idx = y * W + x;
        mask[idx] = 255;
        rgba[idx * 4] = 50;
        rgba[idx * 4 + 1] = 80;
        rgba[idx * 4 + 2] = 160; // Blue shirt
        rgba[idx * 4 + 3] = 255;
      }
    }
  }

  // Eyes
  const eyeY = fY + Math.floor(fH * 0.28);
  for (const cx of [fX + Math.floor(fW * 0.28), fX + Math.floor(fW * 0.72)]) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const px = cx + dx;
        const py = eyeY + dy;
        if (px >= 0 && px < W && py >= 0 && py < H) {
          const idx = (py * W + px) * 4;
          rgba[idx] = 30;
          rgba[idx + 1] = 25;
          rgba[idx + 2] = 20;
        }
      }
    }
  }

  // Nose
  const noseY = fY + Math.floor(fH * 0.48);
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const px = midX + dx;
      const py = noseY + dy;
      if (px >= 0 && px < W && py >= 0 && py < H) {
        const idx = (py * W + px) * 4;
        rgba[idx] = skinR - 20;
        rgba[idx + 1] = skinG - 20;
        rgba[idx + 2] = skinB - 20;
      }
    }
  }

  // Mouth
  const mouthY = fY + Math.floor(fH * 0.65);
  for (let dx = -12; dx <= 12; dx++) {
    const px = midX + dx;
    if (px >= 0 && px < W && mouthY >= 0 && mouthY < H) {
      const idx = (mouthY * W + px) * 4;
      rgba[idx] = 30;
      rgba[idx + 1] = 20;
      rgba[idx + 2] = 20;
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

describe('Jawline & Facial Outer Contour Detection (TASK-103 Step 2E.1)', () => {
  it('Test 1: Normalized coordinates strictly in [0, 1]', () => {
    const W = 140;
    const H = 120;
    const { image, mask } = createSyntheticJawlineEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithJaw(rgba, maskData, W, H, 30, 15, 80, 85);
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(30, 15, 80, 85, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);
    const mouth = detectMouth(face, image, gradients, mask, eyes, nose);
    const result = detectJawline(face, image, gradients, mask, eyes, nose, mouth);

    assert(result.visibility === 'visible' || result.visibility === 'uncertain');
    assert(result.confidence >= 0 && result.confidence <= 1.0);

    function assertNormalizedPath(points?: { x: number; y: number }[]) {
      if (!points) return;
      for (const p of points) {
        assert(p.x >= 0 && p.x <= 1.0, `p.x ${p.x} must be in [0, 1]`);
        assert(p.y >= 0 && p.y <= 1.0, `p.y ${p.y} must be in [0, 1]`);
      }
    }

    assertNormalizedPath(result.jawline?.points);
    assertNormalizedPath(result.chin?.points);
    assertNormalizedPath(result.leftJaw?.points);
    assertNormalizedPath(result.rightJaw?.points);
    if (result.chinTip) {
      assert(result.chinTip.x >= 0 && result.chinTip.x <= 1.0);
      assert(result.chinTip.y >= 0 && result.chinTip.y <= 1.0);
    }
  });

  it('Test 2: Deterministic output across identical runs', () => {
    const W = 140;
    const H = 120;
    const { image, mask } = createSyntheticJawlineEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithJaw(rgba, maskData, W, H, 30, 15, 80, 85);
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(30, 15, 80, 85, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);
    const mouth = detectMouth(face, image, gradients, mask, eyes, nose);

    const run1 = detectJawline(face, image, gradients, mask, eyes, nose, mouth);
    const run2 = detectJawline(face, image, gradients, mask, eyes, nose, mouth);

    assert.strictEqual(run1.visibility, run2.visibility);
    assert.strictEqual(run1.confidence, run2.confidence);
    assert.strictEqual(run1.jawline?.points.length, run2.jawline?.points.length);
    assert.strictEqual(run1.chin?.points.length, run2.chin?.points.length);
    assert.strictEqual(run1.leftJaw?.points.length, run2.leftJaw?.points.length);
    assert.strictEqual(run1.rightJaw?.points.length, run2.rightJaw?.points.length);
  });

  it('Test 3: Frontal synthetic jawline (bilateral jaw and chin arc detected)', () => {
    const W = 140;
    const H = 120;
    const { image, mask } = createSyntheticJawlineEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithJaw(rgba, maskData, W, H, 30, 15, 80, 85);
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(30, 15, 80, 85, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);
    const mouth = detectMouth(face, image, gradients, mask, eyes, nose);
    const result = detectJawline(face, image, gradients, mask, eyes, nose, mouth);

    assert.strictEqual(result.visibility, 'visible');
    assert(result.jawline !== undefined && result.jawline.points.length >= 10);
    assert(result.leftJaw !== undefined && result.leftJaw.points.length >= 5);
    assert(result.rightJaw !== undefined && result.rightJaw.points.length >= 5);
    assert(result.chin !== undefined);
    assert(result.chinTip !== undefined);
  });

  it('Test 4: Synthetic asymmetric face allows asymmetric mandibular points', () => {
    const W = 140;
    const H = 120;
    const { image, mask } = createSyntheticJawlineEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithJaw(rgba, maskData, W, H, 30, 15, 80, 85, {
        asymmetricRightJaw: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(30, 15, 80, 85, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);
    const mouth = detectMouth(face, image, gradients, mask, eyes, nose);
    const result = detectJawline(face, image, gradients, mask, eyes, nose, mouth);

    assert(result.visibility === 'visible' || result.visibility === 'uncertain');
    assert(result.leftJaw !== undefined);
    assert(result.rightJaw !== undefined);
  });

  it('Test 5: Three-quarter face respects visible lateral geometry', () => {
    const W = 140;
    const H = 120;
    const { image, mask } = createSyntheticJawlineEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithJaw(rgba, maskData, W, H, 30, 15, 80, 85, {
        threeQuarterLeft: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(30, 15, 80, 85, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);
    const mouth = detectMouth(face, image, gradients, mask, eyes, nose);
    const result = detectJawline(face, image, gradients, mask, eyes, nose, mouth);

    assert(result.visibility === 'visible' || result.visibility === 'uncertain');
    assert(result.jawline !== undefined && result.jawline.points.length >= 10);
  });

  it('Test 6: Profile silhouette preserves visible anterior facial contour', () => {
    const W = 140;
    const H = 120;
    const { image, mask } = createSyntheticJawlineEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithJaw(rgba, maskData, W, H, 30, 15, 80, 85, {
        profileLeftOnly: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(30, 15, 80, 85, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    // Profile left
    const profileFace: FaceRegionEstimate = {
      ...face,
      pose: 'left_profile',
      visibleSide: 'left_only',
    };

    const result = detectJawline(profileFace, image, gradients, mask);
    assert(result.visibility === 'visible' || result.visibility === 'uncertain');
    assert(result.leftJaw !== undefined, 'Visible profile jawline must be detected');
    assert(result.chinTip !== undefined, 'Chin apex must be detected on profile');
  });

  it('Test 7: Profile hidden-side suppression (never fabricates occluded right jaw on left profile)', () => {
    const W = 140;
    const H = 120;
    const { image, mask } = createSyntheticJawlineEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithJaw(rgba, maskData, W, H, 30, 15, 80, 85, {
        profileLeftOnly: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(30, 15, 80, 85, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const profileFace: FaceRegionEstimate = {
      ...face,
      pose: 'left_profile',
      visibleSide: 'left_only',
    };

    const result = detectJawline(profileFace, image, gradients, mask);
    assert.strictEqual(result.rightJaw, undefined, 'Occluded right jaw must be strictly undefined');
  });

  it('Test 8: Facial hair / beard robustness (beard does not corrupt jawline search)', () => {
    const W = 140;
    const H = 120;
    const { image, mask } = createSyntheticJawlineEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithJaw(rgba, maskData, W, H, 30, 15, 80, 85, {
        paintBeard: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(30, 15, 80, 85, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);
    const mouth = detectMouth(face, image, gradients, mask, eyes, nose);
    const result = detectJawline(face, image, gradients, mask, eyes, nose, mouth);

    assert(result.visibility === 'visible' || result.visibility === 'uncertain');
    assert(result.jawline !== undefined);
  });

  it('Test 9: Hair robustness (upper cranium hair does not become jawline)', () => {
    const W = 140;
    const H = 120;
    const { image, mask } = createSyntheticJawlineEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithJaw(rgba, maskData, W, H, 30, 25, 80, 85, {
        paintLargeHair: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(30, 25, 80, 85, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);
    const mouth = detectMouth(face, image, gradients, mask, eyes, nose);
    const result = detectJawline(face, image, gradients, mask, eyes, nose, mouth);

    assert(result.jawline !== undefined);
    // All jawline points must be below eye level / cheeks
    const fY = face.faceBoundingBox.y;
    for (const p of result.jawline.points) {
      assert(p.y >= fY + 0.05, `Jawline point ${p.y} must sit below cranium hair`);
    }
  });

  it('Test 10: Neck / clothing robustness (clothing collar does not become jawline)', () => {
    const W = 140;
    const H = 140;
    const { image, mask } = createSyntheticJawlineEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithJaw(rgba, maskData, W, H, 30, 15, 80, 85, {
        paintClothingCollar: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(30, 15, 80, 85, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);
    const mouth = detectMouth(face, image, gradients, mask, eyes, nose);
    const result = detectJawline(face, image, gradients, mask, eyes, nose, mouth);

    assert(result.jawline !== undefined);
    // Chin tip must sit above the bottom of the clothing
    if (result.chinTip) {
      assert(result.chinTip.y <= (15 + 85 * 1.1) / H, 'Chin tip must not sprawl into torso collar');
    }
  });

  it('Test 11: Complex background robustness (background clutter does not corrupt jawline)', () => {
    const W = 140;
    const H = 120;
    const { image, mask } = createSyntheticJawlineEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithJaw(rgba, maskData, W, H, 30, 15, 80, 85, {
        clutteredBackground: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(30, 15, 80, 85, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);
    const mouth = detectMouth(face, image, gradients, mask, eyes, nose);
    const result = detectJawline(face, image, gradients, mask, eyes, nose, mouth);

    assert(result.visibility === 'visible' || result.visibility === 'uncertain');
  });

  it('Test 12: Low-light behavior preserves detection using local contrast', () => {
    const W = 140;
    const H = 120;
    const { image, mask } = createSyntheticJawlineEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithJaw(rgba, maskData, W, H, 30, 15, 80, 85, {
        lowLight: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(30, 15, 80, 85, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);
    const mouth = detectMouth(face, image, gradients, mask, eyes, nose);
    const result = detectJawline(face, image, gradients, mask, eyes, nose, mouth);

    assert(result.visibility === 'visible' || result.visibility === 'uncertain');
  });

  it('Test 13: Extreme-lighting behavior (chiaroscuro shadow does not hallucinate false jawline)', () => {
    const W = 140;
    const H = 120;
    const { image, mask } = createSyntheticJawlineEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithJaw(rgba, maskData, W, H, 30, 15, 80, 85, {
        darkenRightSide: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(30, 15, 80, 85, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);
    const mouth = detectMouth(face, image, gradients, mask, eyes, nose);
    const result = detectJawline(face, image, gradients, mask, eyes, nose, mouth);

    assert(result.visibility === 'visible' || result.visibility === 'uncertain');
    assert(result.leftJaw !== undefined);
  });

  it('Test 14: Multi-person isolation (evaluates instances independently)', () => {
    const W = 260;
    const H = 120;
    const { image, mask } = createSyntheticJawlineEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithJaw(rgba, maskData, W, H, 15, 15, 75, 85);
      paintSyntheticFaceWithJaw(rgba, maskData, W, H, 140, 15, 75, 85);
    });

    const gradients = computeSobelGradients(image.luminance);
    const sub1 = createSubjectFromFaceBox(15, 15, 75, 85, W, H);
    const sub2 = {
      ...createSubjectFromFaceBox(140, 15, 75, 85, W, H),
      id: 'sub-2',
      label: 'secondary_subject' as const,
    };

    const face1 = estimateFaceRegion(sub1, mask, image, gradients);
    const face2 = estimateFaceRegion(sub2, mask, image, gradients);
    assert(face1 !== null && face2 !== null);

    const res1 = detectJawline(face1, image, gradients, mask);
    const res2 = detectJawline(face2, image, gradients, mask);

    assert(res1.visibility === 'visible' || res1.visibility === 'uncertain');
    assert(res2.visibility === 'visible' || res2.visibility === 'uncertain');

    if (res1.chinTip) {
      assert(res1.chinTip.x < 0.50, 'Subject 1 chin tip must remain in left half');
    }
    if (res2.chinTip) {
      assert(res2.chinTip.x > 0.50, 'Subject 2 chin tip must remain in right half');
    }
  });

  it('Test 15: Weak-evidence confidence reduction (missing lower face drops confidence)', () => {
    const W = 140;
    const H = 120;
    const { image, mask } = createSyntheticJawlineEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithJaw(rgba, maskData, W, H, 30, 15, 80, 85, {
        omitJawMask: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(30, 15, 80, 85, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const result = detectJawline(face, image, gradients, mask);
    assert(result.visibility === 'uncertain' || result.visibility === 'not_detected');
  });

  it('Test 16: Real benchmark BM-02 true side profile strictly suppresses hidden right jaw', () => {
    const rootDir = path.resolve(__dirname, '..', '..');
    const imagesDir = path.join(rootDir, 'tests', 'images');
    const imgPath = path.join(imagesDir, 'bm-02-side-profile.jpg');
    if (!fs.existsSync(imgPath)) return;

    const rawJpeg = jpeg.decode(fs.readFileSync(imgPath), { useTArray: true });
    const norm = preprocessPixelBuffer(rawJpeg);
    const seg = segmentSubject(norm);
    const gradients = computeSobelGradients(norm.luminance);
    const faces = estimateAllFaceRegions(seg, norm, gradients);
    assert(faces.length > 0);

    const profileFace = faces[0];
    const result = detectJawline(profileFace, norm, gradients, seg.mask);

    assert(result.visibility === 'visible' || result.visibility === 'uncertain');
    assert.strictEqual(result.rightJaw, undefined, 'BM-02 hidden right jaw must be strictly undefined');
    assert(result.leftJaw !== undefined, 'BM-02 visible profile anterior contour must be detected');
    assert(result.chinTip !== undefined, 'BM-02 profile chin tip must be detected');
  });
});
