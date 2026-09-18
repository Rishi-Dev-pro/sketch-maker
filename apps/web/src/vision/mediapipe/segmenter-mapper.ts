/**
 * MediaPipe Image Segmenter Canonical Mapper
 * TASK-103.9 MediaPipe Integration
 *
 * Maps raw MediaPipe ImageSegmenter results (Selfie Multiclass 256x256)
 * to canonical SemanticSegmentation, SemanticMask[], and SubjectMask.
 * All coordinates clamped strictly to [0.0, 1.0].
 */

import {
  BoundingBox,
  SemanticCategory,
  SemanticMask,
  SemanticSegmentation,
} from '@sketch-maker/shared-types';
import { SubjectMask } from '@sketch-maker/structural-analysis';

/**
 * Official MediaPipe Selfie Multiclass category indices (from labels.txt).
 * 0: background
 * 1: hair
 * 2: body-skin
 * 3: face-skin
 * 4: clothes
 * 5: others
 */
export const MEDIAPIPE_SEGMENTER_CATEGORIES: Record<number, SemanticCategory> = {
  0: 'background',
  1: 'hair',
  2: 'body_skin',
  3: 'face_skin',
  4: 'clothing',
  5: 'accessories',
};

/**
 * Maps a numeric category ID to its canonical SemanticCategory.
 */
export function mapCategoryIdToSemanticCategory(id: number): SemanticCategory {
  return MEDIAPIPE_SEGMENTER_CATEGORIES[id] ?? 'unknown';
}

/**
 * Raw output abstraction matching MediaPipe MPMask.
 */
export interface RawMPMask {
  readonly width: number;
  readonly height: number;
  getAsUint8Array(): Uint8Array;
  getAsFloat32Array?(): Float32Array;
}

/**
 * Raw output abstraction matching MediaPipe ImageSegmenterResult.
 */
export interface RawMediaPipeSegmenterResult {
  readonly categoryMask?: RawMPMask;
  readonly confidenceMasks?: RawMPMask[];
  readonly qualityScores?: number[];
}

/**
 * Bilinear interpolation on a 1D Float32Array grid.
 */
export function bilinearSampleFloat(
  grid: Float32Array,
  srcWidth: number,
  srcHeight: number,
  normX: number,
  normY: number
): number {
  const gx = normX * (srcWidth - 1);
  const gy = normY * (srcHeight - 1);

  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(x0 + 1, srcWidth - 1);
  const y1 = Math.min(y0 + 1, srcHeight - 1);

  const fx = gx - x0;
  const fy = gy - y0;

  const v00 = grid[y0 * srcWidth + x0];
  const v10 = grid[y0 * srcWidth + x1];
  const v01 = grid[y1 * srcWidth + x0];
  const v11 = grid[y1 * srcWidth + x1];

  const top = v00 * (1 - fx) + v10 * fx;
  const bottom = v01 * (1 - fx) + v11 * fx;

  return Math.max(0, Math.min(1, top * (1 - fy) + bottom * fy));
}

/**
 * Resamples a category mask using nearest-neighbor to prevent synthetic category IDs.
 */
export function resampleCategoryMask(
  srcData: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number
): Uint8Array {
  if (srcWidth === targetWidth && srcHeight === targetHeight) {
    return new Uint8Array(srcData);
  }

  const out = new Uint8Array(targetWidth * targetHeight);
  const scaleX = srcWidth / targetWidth;
  const scaleY = srcHeight / targetHeight;

  for (let y = 0; y < targetHeight; y++) {
    const srcY = Math.min(srcHeight - 1, Math.floor(y * scaleY));
    const rowOffset = y * targetWidth;
    const srcRowOffset = srcY * srcWidth;

    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.min(srcWidth - 1, Math.floor(x * scaleX));
      out[rowOffset + x] = srcData[srcRowOffset + srcX];
    }
  }

  return out;
}

/**
 * Resamples a continuous confidence map using bilinear interpolation.
 */
export function resampleConfidenceMap(
  srcData: Float32Array,
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number
): Float32Array {
  if (srcWidth === targetWidth && srcHeight === targetHeight) {
    return new Float32Array(srcData);
  }

  const out = new Float32Array(targetWidth * targetHeight);
  const invW = targetWidth > 1 ? 1 / (targetWidth - 1) : 0;
  const invH = targetHeight > 1 ? 1 / (targetHeight - 1) : 0;

  for (let y = 0; y < targetHeight; y++) {
    const normY = y * invH;
    const rowOffset = y * targetWidth;

    for (let x = 0; x < targetWidth; x++) {
      const normX = x * invW;
      out[rowOffset + x] = bilinearSampleFloat(srcData, srcWidth, srcHeight, normX, normY);
    }
  }

  return out;
}

/**
 * Computes bounding box for binary mask pixels.
 */
export function computeMaskBoundingBox(
  data: Uint8Array,
  width: number,
  height: number
): BoundingBox | undefined {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      if (data[rowOffset + x] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return undefined;
  }

  return {
    x: Number(Math.max(0, Math.min(1, minX / width)).toFixed(5)),
    y: Number(Math.max(0, Math.min(1, minY / height)).toFixed(5)),
    width: Number(Math.max(0, Math.min(1, (maxX - minX + 1) / width)).toFixed(5)),
    height: Number(Math.max(0, Math.min(1, (maxY - minY + 1) / height)).toFixed(5)),
  };
}

/**
 * Complete mapped segmentation payload.
 */
export interface MappedSegmentationOutput {
  readonly semanticSegmentation: SemanticSegmentation;
  readonly subjectMask: SubjectMask;
  readonly categoryMask: Uint8Array;
}

/**
 * Maps raw MediaPipe ImageSegmenterResult into canonical SemanticSegmentation and SubjectMask.
 *
 * @param raw The raw output from MediaPipe ImageSegmenter
 * @param targetWidth Desired target width (e.g. processing resolution)
 * @param targetHeight Desired target height
 * @param confidenceThreshold Threshold for classifying pixels as foreground (default: 0.5)
 */
export function mapMediaPipeSegmenterResult(
  raw: RawMediaPipeSegmenterResult,
  targetWidth: number,
  targetHeight: number,
  confidenceThreshold = 0.5
): MappedSegmentationOutput {
  const hasCategoryMask = Boolean(raw.categoryMask);
  const srcWidth = raw.categoryMask?.width ?? raw.confidenceMasks?.[0]?.width ?? targetWidth;
  const srcHeight = raw.categoryMask?.height ?? raw.confidenceMasks?.[0]?.height ?? targetHeight;

  // Extract raw category array
  let rawCategoryData: Uint8Array;
  if (raw.categoryMask) {
    rawCategoryData = raw.categoryMask.getAsUint8Array();
  } else if (raw.confidenceMasks && raw.confidenceMasks.length > 0) {
    // Synthesize category mask by finding argmax confidence across confidence masks
    rawCategoryData = new Uint8Array(srcWidth * srcHeight);
    const numClasses = raw.confidenceMasks.length;
    const classArrays = raw.confidenceMasks.map((cm) => cm.getAsFloat32Array?.() ?? new Float32Array(srcWidth * srcHeight));

    for (let i = 0; i < srcWidth * srcHeight; i++) {
      let maxConf = -1;
      let maxCat = 0;
      for (let c = 0; c < numClasses; c++) {
        const conf = classArrays[c][i];
        if (conf > maxConf) {
          maxConf = conf;
          maxCat = c;
        }
      }
      rawCategoryData[i] = maxCat;
    }
  } else {
    // Empty / fallback
    rawCategoryData = new Uint8Array(srcWidth * srcHeight);
  }

  // Resample category mask to target processing dimensions
  const resampledCategories = resampleCategoryMask(
    rawCategoryData,
    srcWidth,
    srcHeight,
    targetWidth,
    targetHeight
  );

  // Resample confidence masks if available
  const resampledConfidences: Record<number, Float32Array> = {};
  if (raw.confidenceMasks && raw.confidenceMasks.length > 0) {
    raw.confidenceMasks.forEach((cm, idx) => {
      const floatData = cm.getAsFloat32Array?.();
      if (floatData) {
        resampledConfidences[idx] = resampleConfidenceMap(
          floatData,
          cm.width,
          cm.height,
          targetWidth,
          targetHeight
        );
      }
    });
  }

  // Build foreground subject mask (any non-background pixel: hair, skin, clothes, others)
  const totalPixels = targetWidth * targetHeight;
  const subjectBinary = new Uint8Array(totalPixels);
  const subjectConfidence = new Float32Array(totalPixels);

  const bgConfidence = resampledConfidences[0]; // Category 0 is background

  for (let i = 0; i < totalPixels; i++) {
    const cat = resampledCategories[i];
    const isForeground = cat > 0; // category 1..5

    if (isForeground) {
      subjectBinary[i] = 255;
    }

    if (bgConfidence) {
      // Continuous foreground probability: 1.0 - background probability
      subjectConfidence[i] = Math.max(0, Math.min(1, 1.0 - bgConfidence[i]));
    } else {
      subjectConfidence[i] = isForeground ? 0.95 : 0.05;
    }
  }

  // Create discrete SemanticMask for each detected non-background category
  const categoriesPresent = new Set<number>();
  for (let i = 0; i < totalPixels; i++) {
    categoriesPresent.add(resampledCategories[i]);
  }

  const masks: SemanticMask[] = [];
  const recognizedCategories: SemanticCategory[] = [];

  // Order: hair, face_skin, body_skin, clothing, accessories, background
  const categoryOrder = [1, 3, 2, 4, 5, 0];

  for (const catId of categoryOrder) {
    if (!categoriesPresent.has(catId) && !resampledConfidences[catId]) {
      continue;
    }

    const canonicalCat = mapCategoryIdToSemanticCategory(catId);
    recognizedCategories.push(canonicalCat);

    const catBinary = new Uint8Array(totalPixels);
    let pixelArea = 0;

    for (let i = 0; i < totalPixels; i++) {
      if (resampledCategories[i] === catId) {
        catBinary[i] = 255;
        pixelArea++;
      }
    }

    const catConfMap = resampledConfidences[catId];
    const bbox = computeMaskBoundingBox(catBinary, targetWidth, targetHeight);

    // Compute average confidence in positive region
    let avgConf = 0.85;
    if (catConfMap && pixelArea > 0) {
      let sum = 0;
      for (let i = 0; i < totalPixels; i++) {
        if (catBinary[i] > 0) sum += catConfMap[i];
      }
      avgConf = Number(Math.max(0.1, Math.min(1.0, sum / pixelArea)).toFixed(4));
    }

    masks.push({
      category: canonicalCat,
      confidence: avgConf,
      width: targetWidth,
      height: targetHeight,
      data: catBinary,
      confidenceMap: catConfMap,
      boundingBox: bbox,
      pixelArea,
    });
  }

  const subjectMask: SubjectMask = {
    width: targetWidth,
    height: targetHeight,
    data: subjectBinary,
    confidenceMap: subjectConfidence,
  };

  const semanticSegmentation: SemanticSegmentation = {
    categories: recognizedCategories,
    masks,
    confidence: 0.92,
    provider: 'mediapipe',
  };

  return {
    semanticSegmentation,
    subjectMask,
    categoryMask: resampledCategories,
  };
}
