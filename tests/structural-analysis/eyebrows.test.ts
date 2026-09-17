import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import {
  detectEyebrows,
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
 * Creates a synthetic NormalizedImage and SubjectMask for testing eyebrow landmark detection.
 */
function createSyntheticBrowEnvironment(
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

  // Compute ITU-R Rec. BT.709 luminance
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
 * Paints a synthetic face with eyes and supraorbital eyebrows.
 */
function paintSyntheticFaceWithEyesAndBrows(
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
    paintBeard?: boolean;
    paintHairForehead?: boolean;
    omitBrows?: boolean;
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
        // Shadowed right side
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
  const eyeLevelY = fY + Math.floor(fH * 0.38);
  const eyeRadius = Math.max(3, Math.floor(fW * 0.08));

  const leftEyeCenterX = options?.profileLeftOnly
    ? fX + Math.floor(fW * 0.22)
    : fX + Math.floor(fW * 0.28);
  const rightEyeCenterX = fX + Math.floor(fW * 0.72);

  function paintEye(cx: number, cy: number) {
    for (let dy = -eyeRadius; dy <= eyeRadius; dy++) {
      for (let dx = -eyeRadius * 1.5; dx <= eyeRadius * 1.5; dx++) {
        const px = Math.floor(cx + dx);
        const py = Math.floor(cy + dy);
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        const idx = py * W + px;

        const distSq = (dx * dx) / 2.25 + dy * dy;
        if (distSq <= eyeRadius * eyeRadius) {
          rgba[idx * 4] = options?.lowLight ? 120 : 240;
          rgba[idx * 4 + 1] = options?.lowLight ? 110 : 235;
          rgba[idx * 4 + 2] = options?.lowLight ? 100 : 230;

          const rCenterSq = dx * dx + dy * dy;
          if (rCenterSq <= Math.pow(eyeRadius * 0.55, 2)) {
            rgba[idx * 4] = 30;
            rgba[idx * 4 + 1] = 20;
            rgba[idx * 4 + 2] = 15;
          }
        }
      }
    }
  }

  paintEye(leftEyeCenterX, eyeLevelY);
  if (!options?.profileLeftOnly) {
    paintEye(rightEyeCenterX, eyeLevelY);
  }

  // Paint eyebrows
  if (!options?.omitBrows) {
    const browLevelY = eyeLevelY - Math.max(12, Math.floor(fH * 0.25));
    const browHalfW = Math.max(5, Math.floor(fW * 0.15));

    function paintBrow(cx: number, cy: number) {
      for (let dx = -browHalfW; dx <= browHalfW; dx++) {
        const arch = Math.round((1.0 - (dx / browHalfW) * (dx / browHalfW)) * 2);
        const by = cy - arch;
        for (let dy = -1; dy <= 1; dy++) {
          const px = Math.floor(cx + dx);
          const py = Math.floor(by + dy);
          if (px < 0 || px >= W || py < 0 || py >= H) continue;
          const idx = py * W + px;
          rgba[idx * 4] = 40;
          rgba[idx * 4 + 1] = 30;
          rgba[idx * 4 + 2] = 25;
        }
      }
    }

    paintBrow(leftEyeCenterX, browLevelY);
    if (!options?.profileLeftOnly) {
      paintBrow(rightEyeCenterX, browLevelY);
    }
  }

  // Optional glasses rims across orbital band
  if (options?.paintGlasses) {
    const rimY = eyeLevelY - eyeRadius - 2;
    for (let x = fX + Math.floor(fW * 0.15); x <= fX + Math.floor(fW * 0.85); x++) {
      if (rimY >= 0 && rimY < H) {
        const idx = rimY * W + x;
        rgba[idx * 4] = 20;
        rgba[idx * 4 + 1] = 20;
        rgba[idx * 4 + 2] = 20;
      }
    }
  }

  // Optional beard / facial hair in lower face
  if (options?.paintBeard) {
    const beardY = fY + Math.floor(fH * 0.70);
    for (let y = beardY; y < fY + fH; y++) {
      for (let x = fX + Math.floor(fW * 0.25); x <= fX + Math.floor(fW * 0.75); x++) {
        const idx = y * W + x;
        rgba[idx * 4] = 35;
        rgba[idx * 4 + 1] = 25;
        rgba[idx * 4 + 2] = 20;
      }
    }
  }

  // Optional hair bangs on top of forehead
  if (options?.paintHairForehead) {
    const hairMaxY = fY + Math.floor(fH * 0.15);
    for (let y = fY; y <= hairMaxY; y++) {
      for (let x = fX + Math.floor(fW * 0.10); x <= fX + Math.floor(fW * 0.90); x++) {
        const idx = y * W + x;
        rgba[idx * 4] = 25;
        rgba[idx * 4 + 1] = 20;
        rgba[idx * 4 + 2] = 15;
      }
    }
  }
}

describe('Eyebrow Landmark Detection (TASK-103 Step 2B)', () => {
  it('Test 1: Normalized coordinates strictly in [0, 1]', () => {
    const W = 120;
    const H = 120;
    const { image, mask } = createSyntheticBrowEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEyesAndBrows(rgba, maskData, W, H, 20, 20, 80, 80);
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
    const brows = detectEyebrows(face, image, gradients, mask, eyes);

    assert(brows.leftEyebrow !== undefined);
    assert(brows.rightEyebrow !== undefined);

    for (const brow of [brows.leftEyebrow, brows.rightEyebrow]) {
      for (const p of brow.points) {
        assert(p.x >= 0 && p.x <= 1, `Point x must be in [0,1], got ${p.x}`);
        assert(p.y >= 0 && p.y <= 1, `Point y must be in [0,1], got ${p.y}`);
      }
    }
  });

  it('Test 2: Deterministic output across identical runs', () => {
    const W = 100;
    const H = 100;
    const { image, mask } = createSyntheticBrowEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEyesAndBrows(rgba, maskData, W, H, 20, 20, 60, 60);
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

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const run1 = detectEyebrows(face, image, gradients, mask, eyes);
    const run2 = detectEyebrows(face, image, gradients, mask, eyes);

    assert.deepStrictEqual(run1, run2, 'Repeated eyebrow detector calls must produce identical landmark results');
  });

  it('Test 3: Frontal synthetic eyebrow detection (both eyebrows visible)', () => {
    const W = 100;
    const H = 100;
    const { image, mask } = createSyntheticBrowEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEyesAndBrows(rgba, maskData, W, H, 20, 20, 60, 60);
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
    const brows = detectEyebrows(face, image, gradients, mask, eyes);

    assert(brows.leftEyebrow !== undefined);
    assert(brows.rightEyebrow !== undefined);
    assert.strictEqual(brows.leftEyebrow.visibility, 'visible');
    assert.strictEqual(brows.rightEyebrow.visibility, 'visible');
    assert(brows.leftEyebrow.confidence! >= 0.18);
    assert(brows.rightEyebrow.confidence! >= 0.18);
    assert(brows.leftEyebrow.points.length >= 4);
    assert(brows.rightEyebrow.points.length >= 4);
  });

  it('Test 4: Asymmetric / three-quarter case allows asymmetric confidence', () => {
    const W = 100;
    const H = 100;
    const { image, mask } = createSyntheticBrowEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEyesAndBrows(rgba, maskData, W, H, 20, 20, 60, 60, {
        darkenRightSide: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject: SubjectRegion = {
      id: 'sub-3q',
      label: 'primary_subject',
      boundingBox: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
      pixelBoundingBox: { x: 20, y: 20, width: 60, height: 60 },
      pixelArea: 3600,
      confidence: 0.92,
    };

    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const brows = detectEyebrows(face, image, gradients, mask, eyes);

    assert(brows.leftEyebrow !== undefined);
    assert(brows.rightEyebrow !== undefined);
    // Lit left eyebrow should be clearly visible
    assert.strictEqual(brows.leftEyebrow.visibility, 'visible');
    assert(brows.leftEyebrow.confidence! >= 0.18);
  });

  it('Test 5: Profile visibility (BM-02 profile hidden side strictly occluded)', () => {
    const imgPath = path.resolve(__dirname, '../images/bm-02-side-profile.jpg');
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
    const brows = detectEyebrows(face, normImage, gradients, segResult.mask, eyes);

    assert(brows.leftEyebrow !== undefined);
    assert(brows.rightEyebrow !== undefined);

    // Visible left eyebrow candidate on left profile
    assert(
      brows.leftEyebrow.visibility === 'visible' || brows.leftEyebrow.visibility === 'uncertain',
      `Left eyebrow on visible profile side should be visible/uncertain, got ${brows.leftEyebrow.visibility}`
    );
    assert(brows.leftEyebrow.confidence! > 0);

    // Occluded right eyebrow MUST be strictly suppressed
    assert.strictEqual(brows.rightEyebrow.visibility, 'occluded');
    assert.strictEqual(brows.rightEyebrow.confidence, 0);
    assert.strictEqual(brows.rightEyebrow.points.length, 0);
  });

  it('Test 6: Hidden-side suppression (synthetic profile suppresses hidden eyebrow)', () => {
    const W = 120;
    const H = 100;
    const { image, mask } = createSyntheticBrowEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEyesAndBrows(rgba, maskData, W, H, 20, 15, 65, 55, {
        profileLeftOnly: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject: SubjectRegion = {
      id: 'sub-profile-synth',
      label: 'primary_subject',
      boundingBox: { x: 20 / W, y: 15 / H, width: 65 / W, height: 55 / H },
      pixelBoundingBox: { x: 20, y: 15, width: 65, height: 55 },
      pixelArea: 3500,
      confidence: 0.93,
    };

    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);
    assert.strictEqual(face.pose, 'left_profile');

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const brows = detectEyebrows(face, image, gradients, mask, eyes);

    assert(brows.leftEyebrow !== undefined);
    assert(brows.rightEyebrow !== undefined);

    // Right eyebrow is physically occluded: 0 points, confidence 0
    assert.strictEqual(brows.rightEyebrow.visibility, 'occluded');
    assert.strictEqual(brows.rightEyebrow.confidence, 0);
    assert.strictEqual(brows.rightEyebrow.points.length, 0);
  });

  it('Test 7: Glasses robustness (glasses frame does not become eyebrow)', () => {
    const W = 100;
    const H = 100;
    const { image, mask } = createSyntheticBrowEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEyesAndBrows(rgba, maskData, W, H, 20, 20, 60, 60, {
        paintGlasses: true,
      });
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
    const brows = detectEyebrows(face, image, gradients, mask, eyes);

    assert(brows.leftEyebrow !== undefined);
    assert.strictEqual(brows.leftEyebrow.visibility, 'visible');

    // Verify eyebrow points are strictly above upper eyelid points
    if (eyes.leftEye?.upperLid.points.length) {
      let minEyelidY = 1.0;
      for (const p of eyes.leftEye.upperLid.points) {
        if (p.y < minEyelidY) minEyelidY = p.y;
      }
      for (const p of brows.leftEyebrow.points) {
        assert(p.y < minEyelidY, `Eyebrow point y (${p.y}) must be strictly superior to upper eyelid (${minEyelidY})`);
      }
    }
  });

  it('Test 8: Facial-hair robustness (chin beard does not corrupt eyebrow search)', () => {
    const W = 100;
    const H = 100;
    const { image, mask } = createSyntheticBrowEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEyesAndBrows(rgba, maskData, W, H, 20, 20, 60, 60, {
        paintBeard: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject: SubjectRegion = {
      id: 'sub-beard',
      label: 'primary_subject',
      boundingBox: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
      pixelBoundingBox: { x: 20, y: 20, width: 60, height: 60 },
      pixelArea: 3600,
      confidence: 0.95,
    };

    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const brows = detectEyebrows(face, image, gradients, mask, eyes);

    assert(brows.leftEyebrow !== undefined);
    assert(brows.rightEyebrow !== undefined);
    assert.strictEqual(brows.leftEyebrow.visibility, 'visible');
    assert.strictEqual(brows.rightEyebrow.visibility, 'visible');

    // Eyebrows must remain strictly in the upper half of the face
    const faceMidY = face.faceBoundingBox.y + face.faceBoundingBox.height * 0.45;
    for (const p of brows.leftEyebrow.points) {
      assert(p.y < faceMidY, `Eyebrow point y (${p.y}) must be in upper half of face (< ${faceMidY})`);
    }
  });

  it('Test 9: Hair / background robustness (forehead hair boundary does not become eyebrow)', () => {
    const W = 100;
    const H = 100;
    const { image, mask } = createSyntheticBrowEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEyesAndBrows(rgba, maskData, W, H, 20, 20, 60, 60, {
        paintHairForehead: true,
      });
    });

    const gradients = computeSobelGradients(image.luminance);
    const subject: SubjectRegion = {
      id: 'sub-hair',
      label: 'primary_subject',
      boundingBox: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
      pixelBoundingBox: { x: 20, y: 20, width: 60, height: 60 },
      pixelArea: 3600,
      confidence: 0.95,
    };

    const face = estimateFaceRegion(subject, mask, image, gradients);
    assert(face !== null);

    const eyes = detectEyeLandmarks(face, image, gradients, mask);
    const brows = detectEyebrows(face, image, gradients, mask, eyes);

    assert(brows.leftEyebrow !== undefined);
    // Eyebrow points must remain below the top 10% of face height (cranium / hairline)
    const hairlineY = face.faceBoundingBox.y + face.faceBoundingBox.height * 0.08;
    for (const p of brows.leftEyebrow.points) {
      assert(p.y >= hairlineY, `Eyebrow point y (${p.y}) must be below hairline (${hairlineY})`);
    }
  });

  it('Test 10: Low-light behavior preserves detection using local contrast', () => {
    const W = 100;
    const H = 100;
    const { image, mask } = createSyntheticBrowEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEyesAndBrows(rgba, maskData, W, H, 20, 20, 60, 60, {
        lowLight: true,
      });
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
    const brows = detectEyebrows(face, image, gradients, mask, eyes);

    assert(brows.leftEyebrow !== undefined);
    assert(brows.rightEyebrow !== undefined);
    // Low-light eyebrows should be resolved without crash
    assert(brows.leftEyebrow.points.length >= 4);
  });

  it('Test 11: Multi-person isolation (evaluates instances independently)', () => {
    const W = 200;
    const H = 100;
    const { image, mask } = createSyntheticBrowEnvironment(W, H, (rgba, maskData) => {
      // Person 1 on left (x=10 to 70)
      paintSyntheticFaceWithEyesAndBrows(rgba, maskData, W, H, 10, 20, 60, 60);
      // Person 2 on right (x=130 to 190)
      paintSyntheticFaceWithEyesAndBrows(rgba, maskData, W, H, 130, 20, 60, 60);
    });

    const gradients = computeSobelGradients(image.luminance);

    const sub1: SubjectRegion = {
      id: 'sub-p1',
      label: 'primary_subject',
      boundingBox: { x: 10 / W, y: 20 / H, width: 60 / W, height: 60 / H },
      pixelBoundingBox: { x: 10, y: 20, width: 60, height: 60 },
      pixelArea: 3600,
      confidence: 0.94,
    };
    const sub2: SubjectRegion = {
      id: 'sub-p2',
      label: 'secondary_subject',
      boundingBox: { x: 130 / W, y: 20 / H, width: 60 / W, height: 60 / H },
      pixelBoundingBox: { x: 130, y: 20, width: 60, height: 60 },
      pixelArea: 3600,
      confidence: 0.94,
    };

    const face1 = estimateFaceRegion(sub1, mask, image, gradients)!;
    const face2 = estimateFaceRegion(sub2, mask, image, gradients)!;

    const eyes1 = detectEyeLandmarks(face1, image, gradients, mask);
    const eyes2 = detectEyeLandmarks(face2, image, gradients, mask);

    const brows1 = detectEyebrows(face1, image, gradients, mask, eyes1);
    const brows2 = detectEyebrows(face2, image, gradients, mask, eyes2);

    assert(brows1.leftEyebrow !== undefined);
    assert(brows2.leftEyebrow !== undefined);

    // Person 1 brows strictly in left half (x < 0.5)
    for (const p of brows1.leftEyebrow.points) {
      assert(p.x < 0.5, `Person 1 brow must be in left half, got x=${p.x}`);
    }

    // Person 2 brows strictly in right half (x >= 0.5)
    for (const p of brows2.leftEyebrow.points) {
      assert(p.x >= 0.5, `Person 2 brow must be in right half, got x=${p.x}`);
    }
  });

  it('Test 12: Confidence decreases when evidence weakens (flat forehead)', () => {
    // 1. Normal face with eyebrows
    const W = 100;
    const H = 100;
    const envNormal = createSyntheticBrowEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEyesAndBrows(rgba, maskData, W, H, 20, 20, 60, 60);
    });
    const gradsNormal = computeSobelGradients(envNormal.image.luminance);
    const subject: SubjectRegion = {
      id: 'sub-norm',
      label: 'primary_subject',
      boundingBox: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
      pixelBoundingBox: { x: 20, y: 20, width: 60, height: 60 },
      pixelArea: 3600,
      confidence: 0.95,
    };
    const faceNormal = estimateFaceRegion(subject, envNormal.mask, envNormal.image, gradsNormal)!;
    const eyesNormal = detectEyeLandmarks(faceNormal, envNormal.image, gradsNormal, envNormal.mask);
    const browsNormal = detectEyebrows(faceNormal, envNormal.image, gradsNormal, envNormal.mask, eyesNormal);

    // 2. Face with NO eyebrows (flat skin)
    const envNoBrows = createSyntheticBrowEnvironment(W, H, (rgba, maskData) => {
      paintSyntheticFaceWithEyesAndBrows(rgba, maskData, W, H, 20, 20, 60, 60, {
        omitBrows: true,
      });
    });
    const gradsNoBrows = computeSobelGradients(envNoBrows.image.luminance);
    const faceNoBrows = estimateFaceRegion(subject, envNoBrows.mask, envNoBrows.image, gradsNoBrows)!;
    const eyesNoBrows = detectEyeLandmarks(faceNoBrows, envNoBrows.image, gradsNoBrows, envNoBrows.mask);
    const browsNoBrows = detectEyebrows(faceNoBrows, envNoBrows.image, gradsNoBrows, envNoBrows.mask, eyesNoBrows);

    assert(browsNormal.leftEyebrow !== undefined);
    assert(browsNoBrows.leftEyebrow !== undefined);

    assert(
      browsNoBrows.leftEyebrow.confidence! < browsNormal.leftEyebrow.confidence!,
      `Confidence on face without eyebrows (${browsNoBrows.leftEyebrow.confidence}) must be less than face with eyebrows (${browsNormal.leftEyebrow.confidence})`
    );
  });
});
