import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import {
  NormalizedImage,
  PixelBuffer,
  preprocessPixelBuffer,
} from '../../packages/image-processing/src';
import {
  estimateFaceRegion,
  estimateAllFaceRegions,
  segmentSubject,
  computeSobelGradients,
  detectEyeLandmarks,
  detectNose,
  detectMouth,
  detectJawline,
  SubjectMask,
  SubjectRegion,
} from '../../packages/structural-analysis/src';
import { detectEars } from '../../packages/structural-analysis/src/ears';

/**
 * Creates a synthetic RGBA image and SubjectMask for controlled ear tests.
 */
export function createSyntheticEarEnvironment(
  width: number,
  height: number,
  painter: (rgba: Uint8ClampedArray, maskData: Uint8Array) => void
): { image: NormalizedImage; mask: SubjectMask } {
  const pixelCount = width * height;
  const rgbaData = new Uint8ClampedArray(pixelCount * 4);
  const maskData = new Uint8Array(pixelCount);

  // Default neutral background (RGB 180, 180, 180, alpha 255)
  for (let i = 0; i < pixelCount; i++) {
    rgbaData[i * 4] = 180;
    rgbaData[i * 4 + 1] = 180;
    rgbaData[i * 4 + 2] = 180;
    rgbaData[i * 4 + 3] = 255;
    maskData[i] = 0;
  }

  painter(rgbaData, maskData);

  const floatLum = new Float32Array(pixelCount);
  const lumData = new Uint8Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const r = rgbaData[i * 4];
    const g = rgbaData[i * 4 + 1];
    const b = rgbaData[i * 4 + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    floatLum[i] = lum / 255;
    lumData[i] = Math.round(lum);
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
 * Helper to paint a synthetic face with optional ear protrusions, hair, glasses, etc.
 */
export function paintSyntheticFaceWithEars(
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
  W: number,
  H: number,
  fX: number,
  fY: number,
  fW: number,
  fH: number,
  options?: {
    paintLeftEar?: boolean;
    paintRightEar?: boolean;
    paintHairOverEars?: boolean;
    paintGlassesTemples?: boolean;
    paintBeard?: boolean;
    profileLeftOnly?: boolean;
    darkenRightSide?: boolean;
    lowContrast?: boolean;
  }
): void {
  const skinR = options?.lowContrast ? 140 : 210;
  const skinG = options?.lowContrast ? 120 : 165;
  const skinB = options?.lowContrast ? 110 : 140;

  // Face oval
  const midX = fX + Math.floor(fW * 0.5);
  for (let y = fY; y < fY + fH; y++) {
    const yFraction = (y - fY) / fH;
    let taper = 0;
    if (yFraction > 0.45) {
      taper = Math.round(((yFraction - 0.45) / 0.55) * (fW * 0.25));
    }
    const leftX = fX + taper;
    const rightX = fX + fW - taper;

    for (let x = leftX; x <= rightX; x++) {
      if (x >= 0 && x < W && y >= 0 && y < H) {
        const idx = y * W + x;
        mask[idx] = 255;
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

  // Ear parameters: top around y = fY + 0.20*fH, bottom around y = fY + 0.65*fH
  const earTopY = fY + Math.floor(fH * 0.20);
  const earBottomY = fY + Math.floor(fH * 0.65);
  const earHeight = earBottomY - earTopY;

  // Subject's Left Ear (camera's right side, x > fX + fW)
  if (options?.paintLeftEar !== false && !options?.profileLeftOnly) {
    const baseX = fX + fW;
    for (let y = earTopY; y <= earBottomY; y++) {
      const prog = (y - earTopY) / earHeight;
      // Convex arc protrusion of ~8px
      const protrusion = Math.round(Math.sin(prog * Math.PI) * 9);
      for (let dx = 0; dx <= protrusion; dx++) {
        const px = baseX + dx;
        if (px >= 0 && px < W && y >= 0 && y < H) {
          const idx = y * W + px;
          mask[idx] = 255;
          // Conchal hollow is darker
          const isConcha = dx <= Math.floor(protrusion * 0.5);
          const lumOffset = isConcha ? -40 : 0;
          rgba[idx * 4] = skinR + lumOffset;
          rgba[idx * 4 + 1] = skinG + lumOffset;
          rgba[idx * 4 + 2] = skinB + lumOffset;
          rgba[idx * 4 + 3] = 255;
        }
      }
    }
  }

  // Subject's Right Ear (camera's left side, x < fX)
  if (options?.paintRightEar && !options?.profileLeftOnly) {
    const baseX = fX;
    for (let y = earTopY; y <= earBottomY; y++) {
      const prog = (y - earTopY) / earHeight;
      const protrusion = Math.round(Math.sin(prog * Math.PI) * 9);
      for (let dx = 0; dx <= protrusion; dx++) {
        const px = baseX - dx;
        if (px >= 0 && px < W && y >= 0 && y < H) {
          const idx = y * W + px;
          mask[idx] = 255;
          const isConcha = dx <= Math.floor(protrusion * 0.5);
          const lumOffset = isConcha ? -40 : 0;
          rgba[idx * 4] = skinR + lumOffset;
          rgba[idx * 4 + 1] = skinG + lumOffset;
          rgba[idx * 4 + 2] = skinB + lumOffset;
          rgba[idx * 4 + 3] = 255;
        }
      }
    }
  }

  // Profile Ear (for left_profile, ear is located on posterior half of head, behind eye)
  if (options?.profileLeftOnly && options?.paintLeftEar !== false) {
    const earCenterX = fX + Math.floor(fW * 0.65);
    const earCenterY = fY + Math.floor(fH * 0.45);
    for (let dy = -10; dy <= 10; dy++) {
      const widthAtY = Math.round(Math.cos((dy / 10) * (Math.PI / 2)) * 6);
      for (let dx = -widthAtY; dx <= widthAtY; dx++) {
        const px = earCenterX + dx;
        const py = earCenterY + dy;
        if (px >= 0 && px < W && py >= 0 && py < H) {
          const idx = py * W + px;
          mask[idx] = 255;
          const isConcha = dx < 0;
          const lumOffset = isConcha ? -45 : 15;
          rgba[idx * 4] = skinR + lumOffset;
          rgba[idx * 4 + 1] = skinG + lumOffset;
          rgba[idx * 4 + 2] = skinB + lumOffset;
          rgba[idx * 4 + 3] = 255;
        }
      }
    }
  }

  // Hair covering lateral ear regions
  if (options?.paintHairOverEars) {
    for (let y = fY; y < fY + fH; y++) {
      for (const sideX of [fX - 15, fX + fW + 5]) {
        for (let dx = 0; dx < 12; dx++) {
          const px = sideX + dx;
          if (px >= 0 && px < W && y >= 0 && y < H) {
            const idx = y * W + px;
            mask[idx] = 255;
            rgba[idx * 4] = 20;
            rgba[idx * 4 + 1] = 15;
            rgba[idx * 4 + 2] = 12;
            rgba[idx * 4 + 3] = 255;
          }
        }
      }
    }
  }

  // Glasses temples (thin horizontal lines at eye level)
  if (options?.paintGlassesTemples) {
    const templeY = fY + Math.floor(fH * 0.28);
    for (let x = fX - 15; x <= fX + fW + 15; x++) {
      if (x >= 0 && x < W && templeY >= 0 && templeY < H) {
        const idx = templeY * W + x;
        mask[idx] = 255;
        rgba[idx * 4] = 15;
        rgba[idx * 4 + 1] = 15;
        rgba[idx * 4 + 2] = 15;
        rgba[idx * 4 + 3] = 255;
      }
    }
  }

  // Beard
  if (options?.paintBeard) {
    const chinY = fY + Math.floor(fH * 0.70);
    for (let y = chinY; y < fY + fH + 5; y++) {
      for (let x = fX + 10; x < fX + fW - 10; x++) {
        if (x >= 0 && x < W && y >= 0 && y < H) {
          const idx = y * W + x;
          mask[idx] = 255;
          rgba[idx * 4] = 30;
          rgba[idx * 4 + 1] = 25;
          rgba[idx * 4 + 2] = 20;
          rgba[idx * 4 + 3] = 255;
        }
      }
    }
  }
}

export function createSubjectFromFaceBox(
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
    boundingBox: {
      x: x / W,
      y: y / H,
      width: w / W,
      height: h / H,
    },
    pixelBoundingBox: { x, y, width: w, height: h },
    pixelArea: w * h,
    confidence: 0.95,
  };
}

describe('Ear Landmark Detection (TASK-103 Step 2E.2)', () => {
  it('Test 1: Normalized coordinates strictly in [0, 1]', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticEarEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEars(rgba, maskData, W, H, 40, 20, 80, 90, {
        paintLeftEar: true,
        paintRightEar: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(40, 20, 80, 90, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const result = detectEars(face, image, gradients, mask);
    const allPaths = [result.leftEar, result.rightEar].filter(Boolean);

    for (const p of allPaths) {
      assert(p !== undefined);
      for (const pt of p.points) {
        assert(pt.x >= 0 && pt.x <= 1, `pt.x ${pt.x} outside [0, 1]`);
        assert(pt.y >= 0 && pt.y <= 1, `pt.y ${pt.y} outside [0, 1]`);
      }
    }
  });

  it('Test 2: Deterministic output across identical runs', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticEarEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEars(rgba, maskData, W, H, 40, 20, 80, 90, {
        paintLeftEar: true,
        paintRightEar: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(40, 20, 80, 90, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const run1 = detectEars(face, image, gradients, mask);
    const run2 = detectEars(face, image, gradients, mask);

    assert.strictEqual(run1.visibility, run2.visibility);
    assert.strictEqual(run1.confidence, run2.confidence);
    assert.strictEqual(run1.leftEar?.points.length, run2.leftEar?.points.length);
    assert.strictEqual(run1.rightEar?.points.length, run2.rightEar?.points.length);
  });

  it('Test 3: Frontal visible ear detection (both ears detected when protruding)', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticEarEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEars(rgba, maskData, W, H, 40, 20, 80, 90, {
        paintLeftEar: true,
        paintRightEar: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(40, 20, 80, 90, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const result = detectEars(face, image, gradients, mask);

    assert(result.visibility === 'visible' || result.visibility === 'uncertain');
    assert(result.leftEar !== undefined, 'Left ear must be detected');
    assert(result.rightEar !== undefined, 'Right ear must be detected');
    assert(result.leftEar.points.length >= 5);
    assert(result.rightEar.points.length >= 5);
  });

  it('Test 4: Independent left/right detection (only left ear painted)', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticEarEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEars(rgba, maskData, W, H, 40, 20, 80, 90, {
        paintLeftEar: true,
        paintRightEar: false, // Right ear omitted
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(40, 20, 80, 90, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const frontalFace = {
      ...face,
      pose: 'frontal' as const,
      visibleSide: 'both' as const,
    };

    const result = detectEars(frontalFace, image, gradients, mask);

    assert(result.leftEar !== undefined, 'Left ear must be detected');
    assert.strictEqual(result.rightEar, undefined, 'Right ear must not be hallucinated when omitted');
    assert.strictEqual(result.rightVisibility, 'not_detected');
  });

  it('Test 5: Three-quarter pose respects asymmetry', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticEarEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEars(rgba, maskData, W, H, 40, 20, 80, 90, {
        paintLeftEar: true,
        paintRightEar: false,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(40, 20, 80, 90, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    // Override pose to three_quarter_left
    const tqFace = {
      ...face,
      pose: 'three_quarter_left' as const,
    };

    const result = detectEars(tqFace, image, gradients, mask);
    assert(result.leftEar !== undefined);
    assert.strictEqual(result.rightEar, undefined);
    assert.strictEqual(result.rightVisibility, 'occluded', 'Missing far ear in 3/4 left must be marked occluded');
  });

  it('Test 6: Profile visible ear detection', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticEarEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEars(rgba, maskData, W, H, 30, 20, 90, 90, {
        profileLeftOnly: true,
        paintLeftEar: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(30, 20, 90, 90, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const profileFace = {
      ...face,
      pose: 'left_profile' as const,
      visibleSide: 'left_only' as const,
    };

    const result = detectEars(profileFace, image, gradients, mask);
    assert(result.visibility === 'visible' || result.visibility === 'uncertain');
    assert(result.leftEar !== undefined, 'Visible ear in profile must be detected');
  });

  it('Test 7: Profile hidden-side suppression (never fabricates occluded ear)', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticEarEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEars(rgba, maskData, W, H, 30, 20, 90, 90, {
        profileLeftOnly: true,
        paintLeftEar: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(30, 20, 90, 90, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const profileFace = {
      ...face,
      pose: 'left_profile' as const,
      visibleSide: 'left_only' as const,
    };

    const result = detectEars(profileFace, image, gradients, mask);
    assert.strictEqual(result.rightEar, undefined, 'Occluded ear in left_profile must be undefined');
    assert.strictEqual(result.rightVisibility, 'occluded', 'Occluded ear must carry occluded visibility');
  });

  it('Test 8: Hair robustness (hair covering ears does not become ear contour)', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticEarEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEars(rgba, maskData, W, H, 40, 20, 80, 90, {
        paintLeftEar: false,
        paintRightEar: false,
        paintHairOverEars: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(40, 20, 80, 90, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const result = detectEars(face, image, gradients, mask);
    assert.strictEqual(result.leftEar, undefined, 'Hair on left must not be classified as ear');
    assert.strictEqual(result.rightEar, undefined, 'Hair on right must not be classified as ear');
    assert.strictEqual(result.visibility, 'not_detected');
  });

  it('Test 9: Glasses / accessory robustness (glasses temples do not become ear contour)', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticEarEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEars(rgba, maskData, W, H, 40, 20, 80, 90, {
        paintLeftEar: false,
        paintRightEar: false,
        paintGlassesTemples: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(40, 20, 80, 90, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const result = detectEars(face, image, gradients, mask);
    assert.strictEqual(result.leftEar, undefined, 'Glasses temple bar must not be classified as ear');
    assert.strictEqual(result.rightEar, undefined, 'Glasses temple bar must not be classified as ear');
    assert.strictEqual(result.visibility, 'not_detected');
  });

  it('Test 10: Facial-hair robustness (beard on lower face does not corrupt ears)', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticEarEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEars(rgba, maskData, W, H, 40, 20, 80, 90, {
        paintLeftEar: true,
        paintRightEar: true,
        paintBeard: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(40, 20, 80, 90, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const result = detectEars(face, image, gradients, mask);
    assert(result.leftEar !== undefined, 'Left ear must remain detectable with beard');
    assert(result.rightEar !== undefined, 'Right ear must remain detectable with beard');
  });

  it('Test 11: Complex-background robustness (clutter outside mask is ignored)', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticEarEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEars(rgba, maskData, W, H, 40, 20, 80, 90, {
        paintLeftEar: true,
        paintRightEar: true,
      });
      // Add background clutter outside mask (mask = 0)
      for (let y = 10; y < 130; y += 4) {
        for (let x = 5; x < 25; x++) {
          const idx = (y * W + x) * 4;
          rgba[idx] = 20;
          rgba[idx + 1] = 220;
          rgba[idx + 2] = 20; // High contrast clutter
        }
      }
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(40, 20, 80, 90, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const result = detectEars(face, image, gradients, mask);
    assert(result.rightEar !== undefined);
  });

  it('Test 12: Extreme-lighting behavior (chiaroscuro shadow does not crash detector)', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticEarEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEars(rgba, maskData, W, H, 40, 20, 80, 90, {
        paintLeftEar: true,
        paintRightEar: true,
        darkenRightSide: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(40, 20, 80, 90, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const result = detectEars(face, image, gradients, mask);
    assert(result !== null);
    assert(typeof result.confidence === 'number');
  });

  it('Test 13: Low-light behavior preserves detection using local contrast', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticEarEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEars(rgba, maskData, W, H, 40, 20, 80, 90, {
        paintLeftEar: true,
        paintRightEar: true,
        lowContrast: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(40, 20, 80, 90, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const result = detectEars(face, image, gradients, mask);
    assert(result.visibility === 'visible' || result.visibility === 'uncertain');
  });

  it('Test 14: Multi-person isolation (evaluates instances independently)', () => {
    const W = 240;
    const H = 120;
    const { image, mask } = createSyntheticEarEnvironment(W, H, (rgba, maskData) => {
      // Subject 1 (left side) with left ear only
      paintSyntheticFaceWithEars(rgba, maskData, W, H, 15, 15, 75, 85, {
        paintLeftEar: true,
        paintRightEar: false,
      });
      // Subject 2 (right side) with right ear only
      paintSyntheticFaceWithEars(rgba, maskData, W, H, 140, 15, 75, 85, {
        paintLeftEar: false,
        paintRightEar: true,
      });
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

    const res1 = detectEars(face1, image, gradients, mask);
    const res2 = detectEars(face2, image, gradients, mask);

    // Subject 1 has left ear, subject 2 has right ear
    assert(res1.leftEar !== undefined, 'Sub 1 left ear must be detected');
    assert.strictEqual(res1.rightEar, undefined, 'Sub 1 right ear must not be detected');

    assert.strictEqual(res2.leftEar, undefined, 'Sub 2 left ear must not be detected');
    assert(res2.rightEar !== undefined, 'Sub 2 right ear must be detected');
  });

  it('Test 15: Weak-evidence confidence reduction (flush cheek without ear drops confidence)', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticEarEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEars(rgba, maskData, W, H, 40, 20, 80, 90, {
        paintLeftEar: false,
        paintRightEar: false,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(40, 20, 80, 90, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const result = detectEars(face, image, gradients, mask);
    assert.strictEqual(result.visibility, 'not_detected');
    assert.strictEqual(result.confidence, 0);
  });

  it('Test 16: No fabricated mirrored ear geometry in real BM-02 profile', () => {
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
    const result = detectEars(profileFace, norm, gradients, seg.mask);

    // In left profile, right ear must be strictly occluded and undefined
    assert.strictEqual(result.rightEar, undefined, 'Right ear on BM-02 left profile must never be fabricated');
    assert.strictEqual(result.rightVisibility, 'occluded');
  });
});
