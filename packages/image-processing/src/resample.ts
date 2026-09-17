import { PixelBuffer } from './types';
import { validatePixelBuffer } from './dimensions';

/**
 * Resamples an RGBA PixelBuffer to the target dimensions.
 *
 * For downscaling (target dimensions <= source dimensions), uses an area-weighted
 * box filter that integrates all source pixels within the target pixel footprint.
 * This guarantees zero aliasing, preserves photometric energy, and eliminates
 * Moiré patterns on high-frequency details (hair, fabrics, glasses).
 *
 * For identical dimensions, returns a fast clone.
 * For upscaling, applies smooth bilinear interpolation.
 *
 * @param source Input RGBA PixelBuffer
 * @param targetWidth Target width in pixels (integer > 0)
 * @param targetHeight Target height in pixels (integer > 0)
 * @returns Resampled RGBA PixelBuffer
 */
export function resamplePixelBuffer(
  source: PixelBuffer,
  targetWidth: number,
  targetHeight: number
): PixelBuffer {
  validatePixelBuffer(source.width, source.height, source.data);

  if (!Number.isInteger(targetWidth) || targetWidth <= 0) {
    throw new Error(`Target width must be a positive integer: ${targetWidth}`);
  }
  if (!Number.isInteger(targetHeight) || targetHeight <= 0) {
    throw new Error(`Target height must be a positive integer: ${targetHeight}`);
  }

  const srcW = source.width;
  const srcH = source.height;
  const srcData = source.data;

  // Identity: identical dimensions require no resampling
  if (srcW === targetWidth && srcH === targetHeight) {
    return {
      width: targetWidth,
      height: targetHeight,
      data: new Uint8ClampedArray(srcData),
    };
  }

  const dstData = new Uint8ClampedArray(targetWidth * targetHeight * 4);

  // If both dimensions are shrinking or equal, use area-weighted box downsampling
  if (targetWidth <= srcW && targetHeight <= srcH) {
    downsampleAreaAverage(srcData, srcW, srcH, dstData, targetWidth, targetHeight);
  } else {
    // Upsampling or mixed scale: use bilinear interpolation
    resampleBilinear(srcData, srcW, srcH, dstData, targetWidth, targetHeight);
  }

  return {
    width: targetWidth,
    height: targetHeight,
    data: dstData,
  };
}

/**
 * Area-weighted box downsampling.
 * Integrates every source pixel covering each destination pixel cell.
 */
function downsampleAreaAverage(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dst: Uint8ClampedArray,
  dstW: number,
  dstH: number
): void {
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;

  // Precompute horizontal pixel weight spans for cache efficiency
  const xSpans: Array<{
    startX: number;
    endX: number;
    weights: Float32Array;
  }> = new Array(dstW);

  for (let dx = 0; dx < dstW; dx++) {
    const x0 = dx * scaleX;
    const x1 = (dx + 1) * scaleX;
    const startX = Math.floor(x0);
    const endX = Math.min(srcW - 1, Math.floor(x1));
    const count = endX - startX + 1;
    const weights = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const sx = startX + i;
      const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
      weights[i] = wx;
    }

    xSpans[dx] = { startX, endX, weights };
  }

  // Iterate over destination rows
  for (let dy = 0; dy < dstH; dy++) {
    const y0 = dy * scaleY;
    const y1 = (dy + 1) * scaleY;
    const startY = Math.floor(y0);
    const endY = Math.min(srcH - 1, Math.floor(y1));
    const dstRowOffset = dy * dstW * 4;

    for (let dx = 0; dx < dstW; dx++) {
      const { startX, endX, weights: xWeights } = xSpans[dx];

      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;
      let totalWeight = 0;

      for (let sy = startY; sy <= endY; sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        const srcRowOffset = sy * srcW * 4;

        for (let sx = startX; sx <= endX; sx++) {
          const wx = xWeights[sx - startX];
          const w = wx * wy;

          const idx = srcRowOffset + sx * 4;
          rSum += src[idx] * w;
          gSum += src[idx + 1] * w;
          bSum += src[idx + 2] * w;
          aSum += src[idx + 3] * w;
          totalWeight += w;
        }
      }

      const invWeight = totalWeight > 0 ? 1 / totalWeight : 1;
      const dstIdx = dstRowOffset + dx * 4;

      dst[dstIdx] = Math.round(rSum * invWeight);
      dst[dstIdx + 1] = Math.round(gSum * invWeight);
      dst[dstIdx + 2] = Math.round(bSum * invWeight);
      dst[dstIdx + 3] = Math.round(aSum * invWeight);
    }
  }
}

/**
 * Standard bilinear interpolation for upscaling or non-uniform scaling.
 */
function resampleBilinear(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dst: Uint8ClampedArray,
  dstW: number,
  dstH: number
): void {
  const scaleX = (srcW - 1) / Math.max(1, dstW - 1);
  const scaleY = (srcH - 1) / Math.max(1, dstH - 1);

  for (let dy = 0; dy < dstH; dy++) {
    const sy = dy * scaleY;
    const y0 = Math.floor(sy);
    const y1 = Math.min(srcH - 1, y0 + 1);
    const yFrac = sy - y0;
    const yFracInv = 1 - yFrac;

    const row0Offset = y0 * srcW * 4;
    const row1Offset = y1 * srcW * 4;
    const dstRowOffset = dy * dstW * 4;

    for (let dx = 0; dx < dstW; dx++) {
      const sx = dx * scaleX;
      const x0 = Math.floor(sx);
      const x1 = Math.min(srcW - 1, x0 + 1);
      const xFrac = sx - x0;
      const xFracInv = 1 - xFrac;

      const w00 = xFracInv * yFracInv;
      const w10 = xFrac * yFracInv;
      const w01 = xFracInv * yFrac;
      const w11 = xFrac * yFrac;

      const idx00 = row0Offset + x0 * 4;
      const idx10 = row0Offset + x1 * 4;
      const idx01 = row1Offset + x0 * 4;
      const idx11 = row1Offset + x1 * 4;

      const dstIdx = dstRowOffset + dx * 4;

      dst[dstIdx] = Math.round(
        src[idx00] * w00 + src[idx10] * w10 + src[idx01] * w01 + src[idx11] * w11
      );
      dst[dstIdx + 1] = Math.round(
        src[idx00 + 1] * w00 + src[idx10 + 1] * w10 + src[idx01 + 1] * w01 + src[idx11 + 1] * w11
      );
      dst[dstIdx + 2] = Math.round(
        src[idx00 + 2] * w00 + src[idx10 + 2] * w10 + src[idx01 + 2] * w01 + src[idx11 + 2] * w11
      );
      dst[dstIdx + 3] = Math.round(
        src[idx00 + 3] * w00 + src[idx10 + 3] * w10 + src[idx01 + 3] * w01 + src[idx11 + 3] * w11
      );
    }
  }
}
