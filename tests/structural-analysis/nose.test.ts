import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import {
  detectNose,
  detectEyeLandmarks,
  detectEyebrows,
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
 * Creates a synthetic NormalizedImage and SubjectMask for testing nose landmark detection.
 */
function createSyntheticNoseEnvironment(
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
 * Paints a synthetic face with eyes, eyebrows, nasal bridge, tip, and nostrils.
 */
function paintSyntheticFaceWithNose(
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
    omitNose?: boolean;
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
        // Occipital dark hair
        rgba[idx * 4] = 40;
        rgba[idx * 4 + 1] = 30;
        rgba[idx * 4 + 2] = 25;
      } else if (options?.darkenRightSide && isRightHalf) {
        // Chiaroscuro shadow
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

  // Paint eyes & eyebrows for face reference
  const eyeLevelY = fY + Math.floor(fH * 0.32);
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

  // Paint nose unless omitted
  if (!options?.omitNose) {
    let midX = Math.round((leftEyeX + rightEyeX) * 0.5);
    if (options?.profileLeftOnly) {
      midX = fX + Math.round(fW * 0.24);
    } else if (options?.threeQuarterLeft) {
      midX = fX + Math.round(fW * 0.38);
    }

    const bridgeStartY = eyeLevelY + 3;
    const bridgeEndY = fY + Math.floor(fH * 0.60);

    // Nasal bridge: dorsum highlight in center flanked by subtle side shading
    for (let y = bridgeStartY; y <= bridgeEndY; y++) {
      for (let dx = -3; dx <= 3; dx++) {
        const x = midX + dx;
        if (x >= 0 && x < W && y >= 0 && y < H) {
          const idx = (y * W + x) * 4;
          if (dx === 0 || Math.abs(dx) === 1) {
            // Bright dorsum ridge
            rgba[idx] = Math.min(255, skinR + 25);
            rgba[idx + 1] = Math.min(255, skinG + 25);
            rgba[idx + 2] = Math.min(255, skinB + 25);
          } else {
            // Lateral side shading
            rgba[idx] = Math.max(0, skinR - 25);
            rgba[idx + 1] = Math.max(0, skinG - 25);
            rgba[idx + 2] = Math.max(0, skinB - 25);
          }
        }
      }
    }

    // Nasal tip dome
    const tipY = bridgeEndY + 2;
    for (let dx = -4; dx <= 4; dx++) {
      const x = midX + dx;
      if (x >= 0 && x < W && tipY < H) {
        const idx = (tipY * W + x) * 4;
        rgba[idx] = Math.min(255, skinR + 20);
        rgba[idx + 1] = Math.min(255, skinG + 20);
        rgba[idx + 2] = Math.min(255, skinB + 20);
      }
    }

    // Subnasal shadow
    const subnasalY = tipY + 3;
    for (let dx = -5; dx <= 5; dx++) {
      const x = midX + dx;
      if (x >= 0 && x < W && subnasalY < H) {
        const idx = (subnasalY * W + x) * 4;
        rgba[idx] = Math.max(0, skinR - 35);
        rgba[idx + 1] = Math.max(0, skinG - 35);
        rgba[idx + 2] = Math.max(0, skinB - 35);
      }
    }

    // Nostril dark pockets
    const nostrilY = bridgeEndY + 1;
    const alarOffset = Math.max(4, Math.round(fW * 0.08));

    // Left nostril
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const px = midX - alarOffset + dx;
        const py = nostrilY + dy;
        if (px >= 0 && px < W && py >= 0 && py < H) {
          const idx = (py * W + px) * 4;
          rgba[idx] = 25;
          rgba[idx + 1] = 20;
          rgba[idx + 2] = 18;
        }
      }
    }

    // Right nostril (unless profile)
    if (!options?.profileLeftOnly) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const px = midX + alarOffset + dx;
          const py = nostrilY + dy;
          if (px >= 0 && px < W && py >= 0 && py < H) {
            const idx = (py * W + px) * 4;
            rgba[idx] = 25;
            rgba[idx + 1] = 20;
            rgba[idx + 2] = 18;
          }
        }
      }
    }
  }

  // Glasses bridge (between eyes at nasion)
  if (options?.paintGlasses) {
    const gY = eyeLevelY;
    for (let x = leftEyeX; x <= rightEyeX; x++) {
      const idx = (gY * W + x) * 4;
      rgba[idx] = 15;
      rgba[idx + 1] = 15;
      rgba[idx + 2] = 15;
    }
  }

  // Mustache on upper lip
  if (options?.paintMustache) {
    const mustacheY = fY + Math.floor(fH * 0.74);
    for (let y = mustacheY; y < mustacheY + 6; y++) {
      for (let x = fX + Math.floor(fW * 0.25); x < fX + Math.floor(fW * 0.75); x++) {
        if (x >= 0 && x < W && y >= 0 && y < H) {
          const idx = (y * W + x) * 4;
          rgba[idx] = 20;
          rgba[idx + 1] = 15;
          rgba[idx + 2] = 10;
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

describe('Nose Landmark Detection (TASK-103 Step 2C)', () => {
  it('Test 1: Normalized coordinates strictly in [0, 1]', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticNoseEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithNose(rgba, maskData, W, H, 20, 10, 80, 75);
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(20, 10, 80, 75, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null, 'Face region must be estimated');

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);

    assert(nose.visibility === 'visible' || nose.visibility === 'uncertain');
    assert(nose.confidence >= 0 && nose.confidence <= 1.0);

    function assertNormalizedPath(points?: { x: number; y: number }[]) {
      if (!points) return;
      for (const p of points) {
        assert(p.x >= 0.0 && p.x <= 1.0, `x coordinate ${p.x} out of bounds [0, 1]`);
        assert(p.y >= 0.0 && p.y <= 1.0, `y coordinate ${p.y} out of bounds [0, 1]`);
      }
    }

    assertNormalizedPath(nose.bridge?.points);
    assertNormalizedPath(nose.tip?.points);
    assertNormalizedPath(nose.leftNostril?.points);
    assertNormalizedPath(nose.rightNostril?.points);
  });

  it('Test 2: Deterministic output across identical runs', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticNoseEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithNose(rgba, maskData, W, H, 20, 10, 80, 75);
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(20, 10, 80, 75, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const noseRun1 = detectNose(face, image, gradients, mask, eyes);
    const noseRun2 = detectNose(face, image, gradients, mask, eyes);

    assert.strictEqual(noseRun1.visibility, noseRun2.visibility);
    assert.strictEqual(noseRun1.confidence, noseRun2.confidence);
    assert.strictEqual(noseRun1.bridge?.points.length, noseRun2.bridge?.points.length);
    assert.strictEqual(noseRun1.tip?.points.length, noseRun2.tip?.points.length);
    assert.strictEqual(noseRun1.leftNostril?.points.length, noseRun2.leftNostril?.points.length);
    assert.strictEqual(noseRun1.rightNostril?.points.length, noseRun2.rightNostril?.points.length);
  });

  it('Test 3: Frontal synthetic nose detection (bridge, tip, and nostrils visible)', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticNoseEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithNose(rgba, maskData, W, H, 20, 10, 80, 75);
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(20, 10, 80, 75, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);

    assert.strictEqual(nose.visibility, 'visible');
    assert(nose.bridge !== undefined, 'Bridge must be detected');
    assert(nose.bridge.points.length >= 6, 'Bridge must have points');
    assert(nose.tip !== undefined, 'Tip must be detected');
    assert(nose.leftNostril !== undefined, 'Left nostril must be detected');
    assert(nose.rightNostril !== undefined, 'Right nostril must be detected');
  });

  it('Test 4: Synthetic three-quarter nose allows shifted midline', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticNoseEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithNose(rgba, maskData, W, H, 15, 10, 80, 75, {
        threeQuarterLeft: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(15, 10, 80, 75, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);

    assert(nose.visibility === 'visible' || nose.visibility === 'uncertain');
    if (nose.bridge && nose.bridge.points.length > 0) {
      const meanX = nose.bridge.points.reduce((a, b) => a + b.x, 0) / nose.bridge.points.length;
      assert(meanX < 0.50, `Three quarter bridge meanX ${meanX} should be shifted left`);
    }
  });

  it('Test 5: Profile nose visibility (visible side detected, hidden side occluded)', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticNoseEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithNose(rgba, maskData, W, H, 20, 15, 65, 55, {
        profileLeftOnly: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(20, 15, 65, 55, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);

    // Occluded right nostril MUST be strictly occluded with 0 points
    assert(nose.rightNostril !== undefined);
    assert.strictEqual(nose.rightNostril.visibility, 'occluded');
    assert.strictEqual(nose.rightNostril.confidence, 0);
    assert.strictEqual(nose.rightNostril.points.length, 0);
  });

  it('Test 6: Hidden-side suppression (never fabricates coordinates for occluded nostril)', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticNoseEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithNose(rgba, maskData, W, H, 20, 15, 65, 55, {
        profileLeftOnly: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(20, 15, 65, 55, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const nose = detectNose(face, image, gradients, mask);
    assert.strictEqual(nose.rightNostril?.visibility, 'occluded');
    assert.strictEqual(nose.rightNostril?.points.length, 0);
    assert.strictEqual(nose.rightNostril?.confidence, 0);
  });

  it('Test 7: Glasses robustness (spectacle bridge does not corrupt nasal bridge)', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticNoseEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithNose(rgba, maskData, W, H, 20, 10, 80, 75, {
        paintGlasses: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(20, 10, 80, 75, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);

    assert(nose.visibility === 'visible' || nose.visibility === 'uncertain');
    if (nose.bridge && nose.bridge.points.length > 0) {
      const startY = nose.bridge.points[0].y;
      assert(
        startY >= (10 + 75 * 0.32) / H - 0.02,
        `Bridge startY ${startY} must descend below the spectacle bridge`
      );
    }
  });

  it('Test 8: Facial-hair robustness (mustache on upper lip does not contaminate nostrils)', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticNoseEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithNose(rgba, maskData, W, H, 20, 10, 80, 75, {
        paintMustache: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(20, 10, 80, 75, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);

    const mustacheCutoffY = (10 + 75 * 0.74) / H;
    if (nose.leftNostril && nose.leftNostril.points.length > 0) {
      for (const p of nose.leftNostril.points) {
        assert(p.y < mustacheCutoffY, `Left nostril point y=${p.y} invaded mustache region`);
      }
    }
    if (nose.rightNostril && nose.rightNostril.points.length > 0) {
      for (const p of nose.rightNostril.points) {
        assert(p.y < mustacheCutoffY, `Right nostril point y=${p.y} invaded mustache region`);
      }
    }
  });

  it('Test 9: Extreme-lighting robustness (chiaroscuro shadow boundary does not hallucinate false bridge)', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticNoseEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithNose(rgba, maskData, W, H, 20, 10, 80, 75, {
        darkenRightSide: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(20, 10, 80, 75, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);

    // In severe synthetic half-face darkening, detector must not hallucinate false geometry on the shadow line
    assert(
      nose.visibility === 'visible' || nose.visibility === 'uncertain' || nose.visibility === 'not_detected',
      'Detector must return valid FeatureVisibility'
    );
    assert(nose.confidence <= 0.40, 'Shadow boundary must not create inflated false confidence');
  });

  it('Test 10: Low-light behavior preserves detection using local contrast', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticNoseEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithNose(rgba, maskData, W, H, 20, 10, 80, 75, {
        lowLight: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(20, 10, 80, 75, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const nose = detectNose(face, image, gradients, mask, eyes);

    assert(nose.visibility === 'visible' || nose.visibility === 'uncertain');
  });

  it('Test 11: Multi-person isolation (evaluates instances independently)', () => {
    const W = 220;
    const H = 100;
    const { image, mask } = createSyntheticNoseEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithNose(rgba, maskData, W, H, 10, 10, 70, 75);
      paintSyntheticFaceWithNose(rgba, maskData, W, H, 120, 10, 70, 75);
    });

    const gradients = computeSobelGradients(image.luminance);
    const sub1 = createSubjectFromFaceBox(10, 10, 70, 75, W, H);
    const sub2 = { ...createSubjectFromFaceBox(120, 10, 70, 75, W, H), id: 'sub-2', label: 'secondary_subject' as const };

    const face1 = estimateFaceRegion(sub1, mask, image, gradients);
    const face2 = estimateFaceRegion(sub2, mask, image, gradients);
    assert(face1 !== null && face2 !== null);

    const nose1 = detectNose(face1, image, gradients, mask);
    const nose2 = detectNose(face2, image, gradients, mask);

    assert(nose1.visibility === 'visible' || nose1.visibility === 'uncertain');
    assert(nose2.visibility === 'visible' || nose2.visibility === 'uncertain');

    if (nose1.bridge && nose1.bridge.points.length > 0) {
      assert(nose1.bridge.points[0].x < 0.50);
    }
    if (nose2.bridge && nose2.bridge.points.length > 0) {
      assert(nose2.bridge.points[0].x > 0.50);
    }
  });

  it('Test 12: Weak-evidence confidence reduction (flat skin without nose drops confidence)', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticNoseEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithNose(rgba, maskData, W, H, 20, 10, 80, 75, {
        omitNose: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject = createSubjectFromFaceBox(20, 10, 80, 75, W, H);
    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const nose = detectNose(face, image, gradients, mask);
    assert(
      nose.visibility === 'not_detected' || nose.visibility === 'uncertain',
      `Expected not_detected or uncertain on featureless face, got ${nose.visibility}`
    );
  });

  it('Test 13: Real benchmark BM-02 true side profile strictly suppresses hidden nostril', () => {
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

    // Occluded right nostril MUST be strictly suppressed
    assert(nose.rightNostril !== undefined);
    assert.strictEqual(nose.rightNostril.visibility, 'occluded');
    assert.strictEqual(nose.rightNostril.confidence, 0);
    assert.strictEqual(nose.rightNostril.points.length, 0);
  });
});
