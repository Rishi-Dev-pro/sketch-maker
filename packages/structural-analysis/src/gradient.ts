import { LuminanceBuffer } from '@sketch-maker/image-processing';

export interface GradientField {
  readonly width: number;
  readonly height: number;
  /** Normalized gradient magnitude [0.0 - 1.0] */
  readonly magnitude: Float32Array;
  /** Gradient direction in radians [-PI, PI] */
  readonly direction: Float32Array;
}

/**
 * Computes 3x3 Sobel gradient magnitude and direction from a LuminanceBuffer.
 *
 * The resulting magnitude acts as an edge barrier in segmentation, preventing
 * regional growing from leaking across sharp anatomical contours (jawline, eyelids, lips, silhouette).
 *
 * @param luminance LuminanceBuffer with floatData [0.0 - 1.0]
 * @returns GradientField
 */
export function computeSobelGradients(luminance: LuminanceBuffer): GradientField {
  const { width, height, floatData } = luminance;
  const pixelCount = width * height;
  const magnitude = new Float32Array(pixelCount);
  const direction = new Float32Array(pixelCount);

  for (let y = 1; y < height - 1; y++) {
    const rowPrev = (y - 1) * width;
    const rowCurr = y * width;
    const rowNext = (y + 1) * width;

    for (let x = 1; x < width - 1; x++) {
      // 3x3 neighborhood
      const p00 = floatData[rowPrev + (x - 1)];
      const p01 = floatData[rowPrev + x];
      const p02 = floatData[rowPrev + (x + 1)];

      const p10 = floatData[rowCurr + (x - 1)];
      const p12 = floatData[rowCurr + (x + 1)];

      const p20 = floatData[rowNext + (x - 1)];
      const p21 = floatData[rowNext + x];
      const p22 = floatData[rowNext + (x + 1)];

      // Horizontal Sobel kernel:
      // [-1  0 +1]
      // [-2  0 +2]
      // [-1  0 +1]
      const gx = (p02 + 2 * p12 + p22) - (p00 + 2 * p10 + p20);

      // Vertical Sobel kernel:
      // [-1 -2 -1]
      // [ 0  0  0]
      // [+1 +2 +1]
      const gy = (p20 + 2 * p21 + p22) - (p00 + 2 * p01 + p02);

      const mag = Math.hypot(gx, gy);
      const idx = rowCurr + x;

      // Normalization: maximum possible Sobel response for [0, 1] data is 4 * sqrt(2) ≈ 5.65685
      magnitude[idx] = Math.min(1.0, mag / 4.0);
      direction[idx] = Math.atan2(gy, gx);
    }
  }

  return {
    width,
    height,
    magnitude,
    direction,
  };
}
