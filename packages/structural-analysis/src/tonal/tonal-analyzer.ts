/**
 * Tonal Analyzer & TonalField Engine (TASK-111 / TASK-113)
 *
 * Extracts structural image-evidence tonal regions and continuous 2D TonalFields
 * from photographic luminance data.
 *
 * Preserves high-density spatial luminance L(x,y) and maps it through a calibrated,
 * non-linear perceptual response curve into graphite darkness density D(x,y):
 * - Clean paper highlights (D ≈ 0.0)
 * - Subtle midtone transitions (D ≈ 0.20 - 0.55)
 * - Deep shadow and crevice accumulation (D ≈ 0.60 - 1.0)
 * - Volumetric hair mass density
 * - Clothing mass density
 *
 * Operates purely on normalized luminance [0.0 - 1.0].
 * ZERO Math.random() usage — 100% deterministic analysis.
 */

import { LuminanceBuffer } from '@sketch-maker/image-processing';
import {
  Point2D,
  BoundingBox,
  SubjectModel,
  FacialFeatures,
  TonalRegion,
  TonalField,
  TonalRegionClassification,
} from '@sketch-maker/shared-types';

export interface TonalAnalysisOptions {
  /** Contrast sensitivity multiplier [0.5 - 2.0] (default: 1.0) */
  readonly sensitivity?: number;
  /** Minimum confidence threshold for emitting a tonal region [0.0 - 1.0] */
  readonly minConfidence?: number;
}

/**
 * Samples average normalized luminance inside a normalized bounding box.
 */
export function sampleLuminanceBox(
  luminance: LuminanceBuffer,
  box: BoundingBox
): { mean: number; min: number; max: number } {
  const { width, height } = luminance;
  const floatData = luminance.floatData ?? (luminance as any).data;
  if (!floatData || floatData.length === 0 || width <= 0 || height <= 0) {
    return { mean: 0.5, min: 0.5, max: 0.5 };
  }

  const startX = Math.max(0, Math.min(width - 1, Math.floor(box.x * width)));
  const endX = Math.max(0, Math.min(width - 1, Math.ceil((box.x + box.width) * width)));
  const startY = Math.max(0, Math.min(height - 1, Math.floor(box.y * height)));
  const endY = Math.max(0, Math.min(height - 1, Math.ceil((box.y + box.height) * height)));

  let sum = 0;
  let count = 0;
  let min = 1.0;
  let max = 0.0;

  for (let y = startY; y <= endY; y++) {
    const rowOffset = y * width;
    for (let x = startX; x <= endX; x++) {
      const val = floatData[rowOffset + x];
      sum += val;
      if (val < min) min = val;
      if (val > max) max = val;
      count++;
    }
  }

  if (count === 0) return { mean: 0.5, min: 0.5, max: 0.5 };
  return {
    mean: Number((sum / count).toFixed(4)),
    min: Number(min.toFixed(4)),
    max: Number(max.toFixed(4)),
  };
}

export interface FacialLuminanceStats {
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly median: number;
  readonly p10: number;
  readonly p15: number;
  readonly p35: number;
  readonly p65: number;
  readonly p85: number;
  readonly p90: number;
}

/**
 * Samples robust facial luminance distribution across faceBox to establish
 * an adaptive, relative tonal scale across any lighting (high-key, low-key, neutral).
 */
export function sampleFacialLuminanceStats(
  luminance: LuminanceBuffer,
  faceBox: BoundingBox
): FacialLuminanceStats {
  const { width, height } = luminance;
  const floatData = luminance.floatData ?? (luminance as any).data;
  if (!floatData || floatData.length === 0 || width <= 0 || height <= 0) {
    return {
      min: 0.2,
      max: 0.8,
      mean: 0.5,
      median: 0.5,
      p10: 0.25,
      p15: 0.30,
      p35: 0.42,
      p65: 0.58,
      p85: 0.72,
      p90: 0.78,
    };
  }

  const startX = Math.max(0, Math.min(width - 1, Math.floor(faceBox.x * width)));
  const endX = Math.max(0, Math.min(width - 1, Math.ceil((faceBox.x + faceBox.width) * width)));
  const startY = Math.max(0, Math.min(height - 1, Math.floor(faceBox.y * height)));
  const endY = Math.max(0, Math.min(height - 1, Math.ceil((faceBox.y + faceBox.height) * height)));

  const boxW = Math.max(1, endX - startX + 1);
  const boxH = Math.max(1, endY - startY + 1);
  const step = Math.max(1, Math.floor(Math.sqrt((boxW * boxH) / 600)));

  const samples: number[] = [];
  let sum = 0;

  for (let y = startY; y <= endY; y += step) {
    const rowOffset = y * width;
    for (let x = startX; x <= endX; x += step) {
      const val = floatData[rowOffset + x];
      samples.push(val);
      sum += val;
    }
  }

  if (samples.length === 0) {
    return {
      min: 0.2,
      max: 0.8,
      mean: 0.5,
      median: 0.5,
      p10: 0.25,
      p15: 0.30,
      p35: 0.42,
      p65: 0.58,
      p85: 0.72,
      p90: 0.78,
    };
  }

  samples.sort((a, b) => a - b);
  const n = samples.length;
  const mean = Number((sum / n).toFixed(4));
  const min = Number(samples[0].toFixed(4));
  const max = Number(samples[n - 1].toFixed(4));
  const p10 = Number(samples[Math.min(n - 1, Math.floor(n * 0.10))].toFixed(4));
  const p15 = Number(samples[Math.min(n - 1, Math.floor(n * 0.15))].toFixed(4));
  const p35 = Number(samples[Math.min(n - 1, Math.floor(n * 0.35))].toFixed(4));
  const median = Number(samples[Math.min(n - 1, Math.floor(n * 0.50))].toFixed(4));
  const p65 = Number(samples[Math.min(n - 1, Math.floor(n * 0.65))].toFixed(4));
  const p85 = Number(samples[Math.min(n - 1, Math.floor(n * 0.85))].toFixed(4));
  const p90 = Number(samples[Math.min(n - 1, Math.floor(n * 0.90))].toFixed(4));

  return { min, max, mean, median, p10, p15, p35, p65, p85, p90 };
}

/**
 * Classifies normalized intensity [0.0 - 1.0] into discrete tonal bands.
 * Supports adaptive relative facial distribution when stats are provided.
 */
export function classifyIntensity(
  intensity: number,
  stats?: FacialLuminanceStats
): TonalRegionClassification {
  if (!stats) {
    if (intensity < 0.22) return 'deep_shadow';
    if (intensity < 0.42) return 'shadow';
    if (intensity < 0.65) return 'midtone';
    if (intensity < 0.85) return 'light';
    return 'highlight';
  }

  // Absolute dark floor: truly deep graphite (< 0.08) is always deep shadow
  if (intensity < 0.08) return 'deep_shadow';

  // Relative facial luminance distribution
  if (intensity <= stats.p15) return 'deep_shadow';
  if (intensity <= stats.p35) return 'shadow';
  if (intensity <= stats.p65) return 'midtone';
  if (intensity <= stats.p85) return 'light';
  return 'highlight';
}

/**
 * Bilinear luminance sampling from continuous normalized coordinates [0.0, 1.0].
 */
function sampleBilinearLuminance(
  floatData: Float32Array,
  width: number,
  height: number,
  normX: number,
  normY: number
): number {
  const x = Math.max(0, Math.min(width - 1, normX * (width - 1)));
  const y = Math.max(0, Math.min(height - 1, normY * (height - 1)));

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);

  const fx = x - x0;
  const fy = y - y0;

  const row0 = y0 * width;
  const row1 = y1 * width;

  const v00 = floatData[row0 + x0];
  const v10 = floatData[row0 + x1];
  const v01 = floatData[row1 + x0];
  const v11 = floatData[row1 + x1];

  const top = v00 * (1 - fx) + v10 * fx;
  const bottom = v01 * (1 - fx) + v11 * fx;

  return top * (1 - fy) + bottom * fy;
}

/**
 * Samples a continuous 2D spatial TonalField across an anatomical region (TASK-113).
 * Preserves high-density spatial luminance L(x,y) and computes perceptual graphite density D(x,y).
 */
export function sampleTonalField(
  luminance: LuminanceBuffer | undefined,
  box: BoundingBox,
  gridW: number,
  gridH: number,
  id: string,
  semanticAssociation: string,
  faceStats?: FacialLuminanceStats
): TonalField {
  const totalPixels = gridW * gridH;
  const values = new Float32Array(totalPixels);
  const density = new Float32Array(totalPixels);

  const floatData = luminance ? (luminance.floatData ?? (luminance as any).data) : undefined;
  const imgW = luminance?.width ?? 1;
  const imgH = luminance?.height ?? 1;

  const p15 = faceStats?.p15 ?? 0.28;
  const p85 = faceStats?.p85 ?? 0.72;
  const dynRange = Math.max(0.18, p85 - p15);

  let sum = 0;
  let min = 1.0;
  let max = 0.0;

  for (let gy = 0; gy < gridH; gy++) {
    const normY = box.y + ((gy + 0.5) / gridH) * box.height;
    const rowOffset = gy * gridW;

    for (let gx = 0; gx < gridW; gx++) {
      const normX = box.x + ((gx + 0.5) / gridW) * box.width;

      let L = 0.50; // Neutral fallback
      if (floatData && imgW > 0 && imgH > 0) {
        L = sampleBilinearLuminance(floatData, imgW, imgH, normX, normY);
      }

      values[rowOffset + gx] = L;
      sum += L;
      if (L < min) min = L;
      if (L > max) max = L;

      // Relative normalized luminance u in [0.0, 1.0]
      const u = Math.max(0.0, Math.min(1.0, (L - p15) / dynRange));

      // Non-linear perceptual graphite density curve:
      // Paper highlights remain pure white (D = 0);
      // Midtones accumulate soft graphite;
      // Shadows accumulate rich graphite deposit.
      let d = 0.0;
      if (u >= 0.85) {
        d = 0.0; // Paper white highlight
      } else if (u >= 0.65) {
        // Light tones: whisper graphite
        const t = (0.85 - u) / 0.20;
        d = 0.22 * Math.pow(t, 1.3);
      } else if (u >= 0.35) {
        // Midtones: progressive form shading
        const t = (0.65 - u) / 0.30;
        d = 0.22 + 0.38 * t;
      } else {
        // Deep shadow: heavy graphite deposition
        const t = (0.35 - u) / 0.35;
        d = 0.60 + 0.40 * Math.pow(t, 0.85);
      }

      density[rowOffset + gx] = Number(Math.max(0.0, Math.min(1.0, d)).toFixed(4));
    }
  }

  const mean = totalPixels > 0 ? Number((sum / totalPixels).toFixed(4)) : 0.5;
  const classification = classifyIntensity(mean, faceStats);

  return {
    id,
    bounds: box,
    width: gridW,
    height: gridH,
    values,
    density,
    min: Number(min.toFixed(4)),
    max: Number(max.toFixed(4)),
    mean,
    semanticAssociation,
    classification,
  };
}

/**
 * Extracts anatomical tonal regions and continuous TonalFields from photographic luminance.
 * Supports either (luminance, subject) or (subject, luminance) parameter orders.
 */
export function analyzeSubjectTonalRegions(
  arg1: LuminanceBuffer | SubjectModel | undefined,
  arg2?: SubjectModel | LuminanceBuffer,
  options?: TonalAnalysisOptions
): TonalRegion[] {
  let luminance: LuminanceBuffer | undefined;
  let subject: SubjectModel | undefined;

  if (arg1 && ('floatData' in arg1 || ('data' in arg1 && !(arg1 as any).boundingBox))) {
    luminance = arg1 as LuminanceBuffer;
    subject = arg2 as SubjectModel;
  } else {
    subject = arg1 as SubjectModel;
    luminance = arg2 as LuminanceBuffer;
  }

  const tonalRegions: TonalRegion[] = [];
  if (!subject) return tonalRegions;

  const subjectId = subject.id;
  const face = subject.face;
  const faceBox = face?.boundingBox ?? subject.boundingBox;

  if (!faceBox || faceBox.width <= 0 || faceBox.height <= 0) {
    return tonalRegions;
  }

  const minConfidence = options?.minConfidence ?? 0.05;
  const faceStats = luminance ? sampleFacialLuminanceStats(luminance, faceBox) : undefined;

  const checkZone = (
    subId: string,
    zoneName: string,
    box: BoundingBox,
    baseImportance: number
  ) => {
    const clampedBox: BoundingBox = {
      x: Math.max(0, Math.min(0.99, box.x)),
      y: Math.max(0, Math.min(0.99, box.y)),
      width: Math.max(0.005, Math.min(1.0 - box.x, box.width)),
      height: Math.max(0.005, Math.min(1.0 - box.y, box.height)),
    };

    let meanIntensity = 0.45;
    const confidence = Math.max(0.6, subject?.globalConfidence ?? 0.85);

    const rawData = luminance ? (luminance.floatData ?? (luminance as any).data) : undefined;
    if (luminance && rawData) {
      const stats = sampleLuminanceBox(luminance, clampedBox);
      meanIntensity = stats.mean;
    }

    const classification = classifyIntensity(meanIntensity, faceStats);
    const centroid: Point2D = {
      x: Number((clampedBox.x + clampedBox.width * 0.5).toFixed(4)),
      y: Number((clampedBox.y + clampedBox.height * 0.5).toFixed(4)),
    };

    if (confidence >= minConfidence) {
      tonalRegions.push({
        id: `${subjectId}_tonal_${subId}`,
        bounds: clampedBox,
        centroid,
        intensity: meanIntensity,
        confidence,
        importance: baseImportance,
        semanticAssociation: zoneName,
        classification,
      });
    }
  };

  // 1. Left Eye Socket Zone
  if (face?.leftEye && face.featureVisibility?.leftEye !== 'occluded') {
    const eyeUpper = face.leftEye.upperLid?.points ?? [];
    if (eyeUpper.length >= 2) {
      const p0 = eyeUpper[0];
      const pN = eyeUpper[eyeUpper.length - 1];
      const eyeSpan = Math.abs(pN.x - p0.x);
      checkZone(
        'left_eye_socket',
        'eye_socket',
        {
          x: Math.min(p0.x, pN.x) - eyeSpan * 0.1,
          y: Math.min(p0.y, pN.y) - eyeSpan * 0.35,
          width: eyeSpan * 1.2,
          height: eyeSpan * 0.8,
        },
        0.85
      );
    }
  }

  // 2. Right Eye Socket Zone
  if (face?.rightEye && face.featureVisibility?.rightEye !== 'occluded') {
    const eyeUpper = face.rightEye.upperLid?.points ?? [];
    if (eyeUpper.length >= 2) {
      const p0 = eyeUpper[0];
      const pN = eyeUpper[eyeUpper.length - 1];
      const eyeSpan = Math.abs(pN.x - p0.x);
      checkZone(
        'right_eye_socket',
        'eye_socket',
        {
          x: Math.min(p0.x, pN.x) - eyeSpan * 0.1,
          y: Math.min(p0.y, pN.y) - eyeSpan * 0.35,
          width: eyeSpan * 1.2,
          height: eyeSpan * 0.8,
        },
        0.85
      );
    }
  }

  // 3. Nose Side Wall (Bridge Shadow)
  if (face?.noseBridge && face.noseBridge.points.length >= 2) {
    const bPts = face.noseBridge.points;
    const topPt = bPts[0];
    const botPt = bPts[bPts.length - 1];
    const bridgeHeight = Math.abs(botPt.y - topPt.y);
    const shadowSide = face.pose === 'left_profile' || face.pose === 'three_quarter_left' ? 'left' : 'right';
    const shift = shadowSide === 'left' ? -0.025 : 0.01;
    checkZone(
      'nose_side_shadow',
      'nose_shadow',
      {
        x: topPt.x + shift,
        y: topPt.y,
        width: 0.025,
        height: bridgeHeight,
      },
      0.80
    );
  }

  // 4. Under-Nose Shadow (Subnasal / Philtrum Shelf)
  const tipPt = face?.noseTip?.points?.[0];
  if (tipPt) {
    checkZone(
      'under_nose_shadow',
      'under_nose',
      {
        x: tipPt.x - 0.025,
        y: tipPt.y + 0.003,
        width: 0.050,
        height: 0.022,
      },
      0.88
    );
  }

  // 5. Under-Lower-Lip Shadow (Mental Crease Depression)
  if (face?.lowerLip && face.lowerLip.points.length >= 2) {
    const lPts = face.lowerLip.points;
    const midL = lPts[Math.floor(lPts.length / 2)];
    checkZone(
      'under_lip_shadow',
      'under_lip',
      {
        x: midL.x - 0.03,
        y: midL.y + 0.005,
        width: 0.06,
        height: 0.025,
      },
      0.82
    );
  }

  // 6. Submandibular Jaw Shadow (Jaw Drop Shadow onto Neck)
  const chinPt = face?.chin?.points?.[0];
  if (chinPt) {
    checkZone(
      'jaw_drop_shadow',
      'jaw_shadow',
      {
        x: chinPt.x - 0.05,
        y: chinPt.y + 0.005,
        width: 0.10,
        height: 0.04,
      },
      0.75
    );
  }

  // 7. Left Cheek / Malar Plane
  checkZone(
    'left_cheek_plane',
    'cheek_plane',
    {
      x: faceBox.x + faceBox.width * 0.12,
      y: faceBox.y + faceBox.height * 0.42,
      width: faceBox.width * 0.28,
      height: faceBox.height * 0.25,
    },
    0.60
  );

  // 8. Right Cheek / Malar Plane
  checkZone(
    'right_cheek_plane',
    'cheek_plane',
    {
      x: faceBox.x + faceBox.width * 0.60,
      y: faceBox.y + faceBox.height * 0.42,
      width: faceBox.width * 0.28,
      height: faceBox.height * 0.25,
    },
    0.60
  );

  // 9. Forehead Plane
  checkZone(
    'forehead_plane',
    'forehead_plane',
    {
      x: faceBox.x + faceBox.width * 0.25,
      y: faceBox.y + faceBox.height * 0.08,
      width: faceBox.width * 0.50,
      height: faceBox.height * 0.18,
    },
    0.50
  );

  // 10. Left Temple Hollow
  checkZone(
    'left_temple_plane',
    'temple_plane',
    {
      x: faceBox.x + faceBox.width * 0.05,
      y: faceBox.y + faceBox.height * 0.18,
      width: faceBox.width * 0.18,
      height: faceBox.height * 0.18,
    },
    0.55
  );

  // 11. Right Temple Hollow
  checkZone(
    'right_temple_plane',
    'temple_plane',
    {
      x: faceBox.x + faceBox.width * 0.77,
      y: faceBox.y + faceBox.height * 0.18,
      width: faceBox.width * 0.18,
      height: faceBox.height * 0.18,
    },
    0.55
  );

  // 12. Oral Fissure Depression Shadow (Mouth Corner / Fissure Tone)
  if (face?.upperLip && face.upperLip.points.length >= 2) {
    const uPts = face.upperLip.points;
    const midU = uPts[Math.floor(uPts.length / 2)];
    checkZone(
      'mouth_fissure_shadow',
      'mouth_shadow',
      {
        x: midU.x - 0.035,
        y: midU.y - 0.005,
        width: 0.07,
        height: 0.02,
      },
      0.82
    );
  }

  // 13. Submandibular Neck Shadow (Under Jawline & Throat)
  const neckY = (chinPt ? chinPt.y : (faceBox.y + faceBox.height)) + 0.01;
  const neckX = chinPt ? chinPt.x - 0.08 : (faceBox.x + faceBox.width * 0.30);
  checkZone(
    'neck_shadow',
    'neck_shadow',
    {
      x: neckX,
      y: neckY,
      width: faceBox.width * 0.40,
      height: faceBox.height * 0.18,
    },
    0.72
  );

  // 14. Hair Volumetric Mass (TASK-113)
  const masks = subject.semanticSegmentation?.masks;
  const hairMask = Array.isArray(masks) ? masks.find(m => m.category === 'hair') : undefined;
  if (hairMask?.boundingBox) {
    checkZone(
      'hair_mass',
      'hair_mass',
      hairMask.boundingBox,
      0.65
    );
  }

  // 15. Clothing Tonal Mass (TASK-113)
  const clothingMask = Array.isArray(masks) ? masks.find(m => m.category === 'clothing') : undefined;
  if (clothingMask?.boundingBox) {
    checkZone(
      'clothing_mass',
      'clothing_mass',
      clothingMask.boundingBox,
      0.55
    );
  }

  return tonalRegions;
}

/**
 * Extracts continuous 2D spatial TonalFields for all anatomical and volumetric mass regions (TASK-113).
 */
export function analyzeSubjectTonalFields(
  luminance: LuminanceBuffer | undefined,
  subject: SubjectModel
): TonalField[] {
  const fields: TonalField[] = [];
  const subjectId = subject.id;
  const face = subject.face;
  const faceBox = face?.boundingBox ?? subject.boundingBox;

  if (!faceBox || faceBox.width <= 0 || faceBox.height <= 0) {
    return fields;
  }

  const faceStats = luminance ? sampleFacialLuminanceStats(luminance, faceBox) : undefined;

  const addField = (
    subId: string,
    semanticAssoc: string,
    box: BoundingBox,
    gridW: number = 16,
    gridH: number = 16
  ) => {
    const clampedBox: BoundingBox = {
      x: Math.max(0, Math.min(0.99, box.x)),
      y: Math.max(0, Math.min(0.99, box.y)),
      width: Math.max(0.005, Math.min(1.0 - box.x, box.width)),
      height: Math.max(0.005, Math.min(1.0 - box.y, box.height)),
    };

    const tf = sampleTonalField(
      luminance,
      clampedBox,
      gridW,
      gridH,
      `${subjectId}_field_${subId}`,
      semanticAssoc,
      faceStats
    );
    fields.push(tf);
  };

  // 1. Forehead plane
  addField(
    'forehead',
    'forehead_plane',
    {
      x: faceBox.x + faceBox.width * 0.20,
      y: faceBox.y + faceBox.height * 0.05,
      width: faceBox.width * 0.60,
      height: faceBox.height * 0.22,
    },
    20,
    14
  );

  // 2. Left & Right Temples
  addField(
    'temple_left',
    'temple_plane',
    {
      x: faceBox.x + faceBox.width * 0.04,
      y: faceBox.y + faceBox.height * 0.16,
      width: faceBox.width * 0.20,
      height: faceBox.height * 0.20,
    },
    14,
    14
  );
  addField(
    'temple_right',
    'temple_plane',
    {
      x: faceBox.x + faceBox.width * 0.76,
      y: faceBox.y + faceBox.height * 0.16,
      width: faceBox.width * 0.20,
      height: faceBox.height * 0.20,
    },
    14,
    14
  );

  // 3. Left & Right Eye Sockets
  if (face?.leftEye && face.featureVisibility?.leftEye !== 'occluded') {
    const pts = face.leftEye.upperLid?.points ?? [];
    if (pts.length >= 2) {
      const p0 = pts[0];
      const pN = pts[pts.length - 1];
      const eyeSpan = Math.abs(pN.x - p0.x);
      addField(
        'eye_socket_left',
        'eye_socket',
        {
          x: Math.min(p0.x, pN.x) - eyeSpan * 0.12,
          y: Math.min(p0.y, pN.y) - eyeSpan * 0.40,
          width: eyeSpan * 1.25,
          height: eyeSpan * 0.85,
        },
        16,
        14
      );
    }
  }

  if (face?.rightEye && face.featureVisibility?.rightEye !== 'occluded') {
    const pts = face.rightEye.upperLid?.points ?? [];
    if (pts.length >= 2) {
      const p0 = pts[0];
      const pN = pts[pts.length - 1];
      const eyeSpan = Math.abs(pN.x - p0.x);
      addField(
        'eye_socket_right',
        'eye_socket',
        {
          x: Math.min(p0.x, pN.x) - eyeSpan * 0.12,
          y: Math.min(p0.y, pN.y) - eyeSpan * 0.40,
          width: eyeSpan * 1.25,
          height: eyeSpan * 0.85,
        },
        16,
        14
      );
    }
  }

  // 4. Nose Sidewalls & Subnasal
  if (face?.noseBridge && face.noseBridge.points.length >= 2) {
    const bPts = face.noseBridge.points;
    const topPt = bPts[0];
    const botPt = bPts[bPts.length - 1];
    const bridgeHeight = Math.abs(botPt.y - topPt.y);
    addField(
      'nose_bridge',
      'nose_shadow',
      {
        x: topPt.x - 0.020,
        y: topPt.y,
        width: 0.040,
        height: bridgeHeight,
      },
      14,
      18
    );
  }

  const tipPt = face?.noseTip?.points?.[0];
  if (tipPt) {
    addField(
      'under_nose',
      'under_nose',
      {
        x: tipPt.x - 0.028,
        y: tipPt.y + 0.002,
        width: 0.056,
        height: 0.025,
      },
      14,
      12
    );
  }

  // 5. Left & Right Cheeks / Malar Form
  addField(
    'cheek_left',
    'cheek_plane',
    {
      x: faceBox.x + faceBox.width * 0.08,
      y: faceBox.y + faceBox.height * 0.40,
      width: faceBox.width * 0.32,
      height: faceBox.height * 0.28,
    },
    18,
    18
  );
  addField(
    'cheek_right',
    'cheek_plane',
    {
      x: faceBox.x + faceBox.width * 0.60,
      y: faceBox.y + faceBox.height * 0.40,
      width: faceBox.width * 0.32,
      height: faceBox.height * 0.28,
    },
    18,
    18
  );

  // 6. Lips & Mental Crease
  if (face?.lowerLip && face.lowerLip.points.length >= 2) {
    const lPts = face.lowerLip.points;
    const midL = lPts[Math.floor(lPts.length / 2)];
    addField(
      'lower_lip_volume',
      'under_lip',
      {
        x: midL.x - 0.035,
        y: midL.y - 0.005,
        width: 0.070,
        height: 0.032,
      },
      16,
      12
    );
  }

  // 7. Chin Dome
  const chinPt = face?.chin?.points?.[0];
  if (chinPt) {
    addField(
      'chin_dome',
      'jaw_shadow',
      {
        x: chinPt.x - 0.045,
        y: chinPt.y - 0.015,
        width: 0.090,
        height: 0.035,
      },
      16,
      12
    );
  }

  // 8. Jaw Shadows
  addField(
    'jaw_shadow_left',
    'jaw_shadow',
    {
      x: faceBox.x + faceBox.width * 0.12,
      y: faceBox.y + faceBox.height * 0.72,
      width: faceBox.width * 0.30,
      height: faceBox.height * 0.18,
    },
    16,
    14
  );
  addField(
    'jaw_shadow_right',
    'jaw_shadow',
    {
      x: faceBox.x + faceBox.width * 0.58,
      y: faceBox.y + faceBox.height * 0.72,
      width: faceBox.width * 0.30,
      height: faceBox.height * 0.18,
    },
    16,
    14
  );

  // 9. Submandibular Neck Shadow
  const neckY = (chinPt ? chinPt.y : (faceBox.y + faceBox.height)) + 0.008;
  const neckX = chinPt ? chinPt.x - 0.09 : (faceBox.x + faceBox.width * 0.28);
  addField(
    'neck_shadow',
    'neck_shadow',
    {
      x: neckX,
      y: neckY,
      width: faceBox.width * 0.44,
      height: faceBox.height * 0.22,
    },
    18,
    16
  );

  // 10. Volumetric Hair Mass (TASK-113)
  const masks = subject.semanticSegmentation?.masks;
  const hairMask = Array.isArray(masks) ? masks.find(m => m.category === 'hair') : undefined;
  if (hairMask?.boundingBox) {
    addField(
      'hair_mass',
      'hair_mass',
      hairMask.boundingBox,
      24,
      24
    );
  } else {
    // Fallback hair region surrounding the head
    addField(
      'hair_mass_fallback',
      'hair_mass',
      {
        x: Math.max(0, faceBox.x - faceBox.width * 0.25),
        y: Math.max(0, faceBox.y - faceBox.height * 0.22),
        width: Math.min(1.0, faceBox.width * 1.50),
        height: Math.min(1.0, faceBox.height * 1.35),
      },
      24,
      24
    );
  }

  // 11. Clothing Tonal Mass (TASK-113)
  const clothingMask = Array.isArray(masks) ? masks.find(m => m.category === 'clothing') : undefined;
  if (clothingMask?.boundingBox) {
    addField(
      'clothing_mass',
      'clothing_mass',
      clothingMask.boundingBox,
      24,
      20
    );
  } else {
    // Fallback clothing region beneath neck
    addField(
      'clothing_mass_fallback',
      'clothing_mass',
      {
        x: Math.max(0, faceBox.x - faceBox.width * 0.60),
        y: Math.min(0.95, neckY + 0.02),
        width: Math.min(1.0, faceBox.width * 2.20),
        height: Math.max(0.10, 1.0 - (neckY + 0.02)),
      },
      24,
      20
    );
  }

  return fields;
}
