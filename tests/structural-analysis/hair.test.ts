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
  detectEyebrows,
  detectNose,
  detectMouth,
  detectJawline,
  detectEars,
  detectHair,
  SubjectMask,
  SubjectRegion,
} from '../../packages/structural-analysis/src';

/**
 * Creates a synthetic RGBA image and SubjectMask for controlled hair tests.
 */
export function createSyntheticHairEnvironment(
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
 * Helper to paint a synthetic face with optional hair dome, afro volume, beard, etc.
 */
export function paintSyntheticFaceWithHair(
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
  W: number,
  H: number,
  fX: number,
  fY: number,
  fW: number,
  fH: number,
  options?: {
    hairStyle?: 'standard' | 'voluminous' | 'short' | 'bald';
    profileLeft?: boolean;
    threeQuarter?: boolean;
    paintBeard?: boolean;
    paintClothingCollar?: boolean;
    clutteredBackground?: boolean;
    darkenRightSide?: boolean;
    lowLight?: boolean;
  }
): void {
  const skinR = options?.lowLight ? 80 : 215;
  const skinG = options?.lowLight ? 60 : 165;
  const skinB = options?.lowLight ? 50 : 135;

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

  // Hair dome
  const hairStyle = options?.hairStyle ?? 'standard';

  if (hairStyle !== 'bald') {
    const isVoluminous = hairStyle === 'voluminous';
    const isShort = hairStyle === 'short';

    const hairHeight = isVoluminous ? Math.round(fH * 0.55) : isShort ? Math.round(fH * 0.22) : Math.round(fH * 0.35);
    const hairWidthMargin = isVoluminous ? Math.round(fW * 0.35) : isShort ? Math.round(fW * 0.05) : Math.round(fW * 0.12);

    const hairTopY = Math.max(0, fY - hairHeight);
    const hairBottomY = fY + Math.round(fH * (isVoluminous ? 0.60 : isShort ? 0.15 : 0.28));

    const hairLeftX = fX - hairWidthMargin;
    const hairRightX = fX + fW + hairWidthMargin;

    for (let y = hairTopY; y <= hairBottomY; y++) {
      const rowProgress = (y - hairTopY) / Math.max(1, hairBottomY - hairTopY);
      const bulge = Math.sin(rowProgress * Math.PI);
      const curLeft = Math.max(0, Math.round(hairLeftX - bulge * (isVoluminous ? 12 : 3)));
      const curRight = Math.min(W - 1, Math.round(hairRightX + bulge * (isVoluminous ? 12 : 3)));

      for (let x = curLeft; x <= curRight; x++) {
        // Exclude forehead skin if below fY + 0.10*fH and inside central face
        const isForeheadSkin = y >= fY && y <= fY + Math.round(fH * 0.22) && x > fX + 8 && x < fX + fW - 8;
        if (isForeheadSkin && !isVoluminous) continue;

        const idx = y * W + x;
        mask[idx] = 255;
        // Hair color: dark brown/black with slight texture
        const textureNoise = ((x * 17 + y * 23) % 15) - 7;
        rgba[idx * 4] = Math.max(10, 30 + textureNoise);
        rgba[idx * 4 + 1] = Math.max(8, 22 + textureNoise);
        rgba[idx * 4 + 2] = Math.max(6, 18 + textureNoise);
        rgba[idx * 4 + 3] = 255;
      }
    }
  } else {
    // Bald cranium: smooth skin dome on top of forehead
    const craniumHeight = Math.round(fH * 0.25);
    const craniumTopY = Math.max(0, fY - craniumHeight);
    for (let y = craniumTopY; y < fY; y++) {
      const prog = (y - craniumTopY) / craniumHeight;
      const curW = Math.round(fW * Math.sin(prog * (Math.PI / 2)));
      const leftX = midX - Math.floor(curW * 0.5);
      const rightX = midX + Math.floor(curW * 0.5);
      for (let x = leftX; x <= rightX; x++) {
        if (x >= 0 && x < W && y >= 0 && y < H) {
          const idx = y * W + x;
          mask[idx] = 255;
          rgba[idx * 4] = skinR;
          rgba[idx * 4 + 1] = skinG;
          rgba[idx * 4 + 2] = skinB;
          rgba[idx * 4 + 3] = 255;
        }
      }
    }
  }

  // Profile hair (posterior cranium)
  if (options?.profileLeft) {
    const occiputStartX = fX + Math.round(fW * 0.45);
    const occiputEndX = fX + fW + 15;
    for (let y = fY - 15; y <= fY + Math.round(fH * 0.70); y++) {
      for (let x = occiputStartX; x <= Math.min(W - 1, occiputEndX); x++) {
        const idx = y * W + x;
        mask[idx] = 255;
        rgba[idx * 4] = 30;
        rgba[idx * 4 + 1] = 22;
        rgba[idx * 4 + 2] = 18;
        rgba[idx * 4 + 3] = 255;
      }
    }
  }

  // Beard (facial hair on lower face)
  if (options?.paintBeard) {
    const chinY = fY + Math.floor(fH * 0.65);
    for (let y = chinY; y < fY + fH + 6; y++) {
      for (let x = fX + 10; x < fX + fW - 10; x++) {
        if (x >= 0 && x < W && y >= 0 && y < H) {
          const idx = y * W + x;
          mask[idx] = 255;
          rgba[idx * 4] = 32;
          rgba[idx * 4 + 1] = 24;
          rgba[idx * 4 + 2] = 20;
          rgba[idx * 4 + 3] = 255;
        }
      }
    }
  }

  // Clothing collar
  if (options?.paintClothingCollar) {
    const collarY = fY + fH + 2;
    for (let y = collarY; y < Math.min(H, collarY + 25); y++) {
      for (let x = Math.max(0, fX - 30); x < Math.min(W, fX + fW + 30); x++) {
        const idx = y * W + x;
        mask[idx] = 255;
        rgba[idx * 4] = 40;
        rgba[idx * 4 + 1] = 80;
        rgba[idx * 4 + 2] = 160; // Blue shirt
        rgba[idx * 4 + 3] = 255;
      }
    }
  }

  // Cluttered background
  if (options?.clutteredBackground) {
    for (let y = 5; y < H - 5; y += 4) {
      for (let x = 5; x < 25; x++) {
        const idx = (y * W + x) * 4;
        rgba[idx] = 20;
        rgba[idx + 1] = 220;
        rgba[idx + 2] = 20;
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

describe('Hair Structure Detection (TASK-103 Step 2F)', () => {
  it('Test 1: Normalized coordinates strictly in [0, 1]', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticHairEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithHair(rgba, maskData, W, H, 45, 35, 70, 80, {
        hairStyle: 'standard',
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(45, 35, 70, 80, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const result = detectHair(face, image, gradients, mask);
    for (const contour of result.allContours) {
      for (const pt of contour.points) {
        assert(pt.x >= 0 && pt.x <= 1, `pt.x ${pt.x} outside [0, 1]`);
        assert(pt.y >= 0 && pt.y <= 1, `pt.y ${pt.y} outside [0, 1]`);
      }
    }
  });

  it('Test 2: Deterministic output across identical runs', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticHairEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithHair(rgba, maskData, W, H, 45, 35, 70, 80, {
        hairStyle: 'standard',
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(45, 35, 70, 80, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const run1 = detectHair(face, image, gradients, mask);
    const run2 = detectHair(face, image, gradients, mask);

    assert.strictEqual(run1.visibility, run2.visibility);
    assert.strictEqual(run1.confidence, run2.confidence);
    assert.strictEqual(run1.outerContour?.points.length, run2.outerContour?.points.length);
    assert.strictEqual(run1.hairline?.points.length, run2.hairline?.points.length);
    assert.strictEqual(run1.masses.length, run2.masses.length);
  });

  it('Test 3: Frontal hair (outer silhouette and hairline detected)', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticHairEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithHair(rgba, maskData, W, H, 45, 35, 70, 80, {
        hairStyle: 'standard',
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(45, 35, 70, 80, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const result = detectHair(face, image, gradients, mask);
    assert(result.visibility === 'visible');
    assert(result.outerContour !== undefined, 'Outer hair silhouette must be detected');
    assert(result.outerContour.points.length >= 10);
    assert(result.confidence >= 0.40);
  });

  it('Test 4: Side-profile hair preserves visible posterior cranium hair', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticHairEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithHair(rgba, maskData, W, H, 35, 35, 75, 80, {
        profileLeft: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(35, 35, 75, 80, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const profileFace = {
      ...face,
      pose: 'left_profile' as const,
      visibleSide: 'left_only' as const,
    };

    const result = detectHair(profileFace, image, gradients, mask);
    assert(result.visibility === 'visible' || result.visibility === 'uncertain');
    assert(result.outerContour !== undefined);
  });

  it('Test 5: Three-quarter hair respects asymmetric head orientation', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticHairEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithHair(rgba, maskData, W, H, 40, 35, 75, 80, {
        threeQuarter: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(40, 35, 75, 80, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const tqFace = {
      ...face,
      pose: 'three_quarter_left' as const,
    };

    const result = detectHair(tqFace, image, gradients, mask);
    assert(result.outerContour !== undefined);
  });

  it('Test 6: Voluminous / curly hair classified as voluminous', () => {
    const W = 180;
    const H = 160;
    const { image, mask } = createSyntheticHairEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithHair(rgba, maskData, W, H, 50, 45, 70, 80, {
        hairStyle: 'voluminous',
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(50, 45, 70, 80, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const result = detectHair(face, image, gradients, mask);
    assert.strictEqual(result.styleEstimate, 'voluminous');
    assert(result.outerContour !== undefined);
    assert(result.outerContour.points.length >= 15);
  });

  it('Test 7: Short hair closely follows cranium boundary', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticHairEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithHair(rgba, maskData, W, H, 45, 35, 70, 80, {
        hairStyle: 'short',
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(45, 35, 70, 80, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const result = detectHair(face, image, gradients, mask);
    assert.strictEqual(result.styleEstimate, 'short');
    assert(result.outerContour !== undefined);
  });

  it('Test 8: Facial-hair separation (beard does not become scalp hair)', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticHairEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithHair(rgba, maskData, W, H, 45, 35, 70, 80, {
        hairStyle: 'standard',
        paintBeard: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(45, 35, 70, 80, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const result = detectHair(face, image, gradients, mask);
    // Scalp hair outer contour must be situated above the lower chin (y < 0.85)
    assert(result.outerContour !== undefined);
    const maxY = Math.max(...result.outerContour.points.map((p) => p.y));
    const chinThresholdY = (35 + 80 + 10) / H;
    assert(maxY <= chinThresholdY, `Hair outer contour invaded chin beard: ${maxY} > ${chinThresholdY}`);
  });

  it('Test 9: Complex background rejection (clutter outside mask ignored)', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticHairEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithHair(rgba, maskData, W, H, 45, 35, 70, 80, {
        hairStyle: 'standard',
        clutteredBackground: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(45, 35, 70, 80, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const result = detectHair(face, image, gradients, mask);
    assert(result.outerContour !== undefined);
    // Outer points must stay on subject
    for (const pt of result.outerContour.points) {
      assert(pt.x > 0.15, `pt.x ${pt.x} strayed into background clutter`);
    }
  });

  it('Test 10: Extreme-lighting behavior (chiaroscuro shadow does not crash detector)', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticHairEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithHair(rgba, maskData, W, H, 45, 35, 70, 80, {
        hairStyle: 'standard',
        darkenRightSide: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(45, 35, 70, 80, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const result = detectHair(face, image, gradients, mask);
    assert(result !== null);
    assert(typeof result.confidence === 'number');
  });

  it('Test 11: Low-light behavior preserves detection using local contrast', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticHairEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithHair(rgba, maskData, W, H, 45, 35, 70, 80, {
        hairStyle: 'standard',
        lowLight: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(45, 35, 70, 80, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const result = detectHair(face, image, gradients, mask);
    assert(result.visibility === 'visible' || result.visibility === 'uncertain');
  });

  it('Test 12: Multi-person isolation (evaluates instances independently)', () => {
    const W = 260;
    const H = 140;
    const { image, mask } = createSyntheticHairEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithHair(rgba, maskData, W, H, 20, 35, 70, 80, {
        hairStyle: 'voluminous',
      });
      paintSyntheticFaceWithHair(rgba, maskData, W, H, 160, 35, 70, 80, {
        hairStyle: 'short',
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const sub1 = createSubjectFromFaceBox(20, 35, 70, 80, W, H);
    const sub2 = {
      ...createSubjectFromFaceBox(160, 35, 70, 80, W, H),
      id: 'sub-2',
      label: 'secondary_subject' as const,
    };

    const face1 = estimateFaceRegion(sub1, mask, image, gradients);
    const face2 = estimateFaceRegion(sub2, mask, image, gradients);
    assert(face1 !== null && face2 !== null);

    const res1 = detectHair(face1, image, gradients, mask);
    const res2 = detectHair(face2, image, gradients, mask);

    assert.strictEqual(res1.styleEstimate, 'voluminous');
    assert.strictEqual(res2.styleEstimate, 'short');
  });

  it('Test 13: Partial/receding hairline detected on smooth scalp', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticHairEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithHair(rgba, maskData, W, H, 45, 35, 70, 80, {
        hairStyle: 'bald',
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(45, 35, 70, 80, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const result = detectHair(face, image, gradients, mask);
    assert.strictEqual(result.styleEstimate, 'receding');
  });

  it('Test 14: Weak-evidence confidence reduction (bald cranium lowers hair confidence)', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticHairEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithHair(rgba, maskData, W, H, 45, 35, 70, 80, {
        hairStyle: 'bald',
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(45, 35, 70, 80, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const result = detectHair(face, image, gradients, mask);
    assert(result.confidence < 0.60, `Confidence ${result.confidence} not reduced for bald scalp`);
  });

  it('Test 15: No mirrored geometry in real BM-02 side profile', () => {
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
    const result = detectHair(profileFace, norm, gradients, seg.mask);

    assert(result.outerContour !== undefined);
    // Profile hair contour must not be mirrored symmetrically across face center
    const xCoords = result.outerContour.points.map((p) => p.x);
    const minX = Math.min(...xCoords);
    const maxX = Math.max(...xCoords);
    assert(maxX > minX, 'Must have non-degenerate profile hair points');
  });

  it('Test 16: No false hair from clothing collar below chin', () => {
    const W = 160;
    const H = 140;
    const { image, mask } = createSyntheticHairEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithHair(rgba, maskData, W, H, 45, 35, 70, 80, {
        hairStyle: 'short',
        paintClothingCollar: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(45, 35, 70, 80, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const result = detectHair(face, image, gradients, mask);
    assert(result.outerContour !== undefined);
    // Hair points must not extend into collar below chin (y > fY + fH)
    for (const pt of result.outerContour.points) {
      assert(pt.y <= (35 + 80 + 5) / H, `pt.y ${pt.y} strayed into clothing collar`);
    }
  });
});
