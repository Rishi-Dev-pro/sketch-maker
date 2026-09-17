import { PixelBuffer, LuminanceBuffer, LuminanceStats } from './types';
import { validatePixelBuffer } from './dimensions';

// ITU-R Rec. BT.709 photometric coefficients
const REC709_R = 0.2126;
const REC709_G = 0.7152;
const REC709_B = 0.0722;

/**
 * Converts an RGBA pixel buffer into a dual-format luminance buffer (Uint8Array and Float32Array)
 * using ITU-R Rec. BT.709 perceptual photometric weighting.
 *
 * This formula matches human eye spectral sensitivity (highest to green, then red, least to blue),
 * preserving authentic edge contrast across skin tones, hair textures, and facial features.
 *
 * @param rgba Input RGBA PixelBuffer
 * @returns LuminanceBuffer containing both 8-bit integer and 32-bit float buffers
 */
export function rgbaToLuminance(rgba: PixelBuffer): LuminanceBuffer {
  validatePixelBuffer(rgba.width, rgba.height, rgba.data);

  const { width, height, data } = rgba;
  const pixelCount = width * height;
  const uint8Data = new Uint8Array(pixelCount);
  const floatData = new Float32Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const a = data[offset + 3];

    // Compute base Rec. 709 luminance
    let y = REC709_R * r + REC709_G * g + REC709_B * b;

    // Handle alpha transparency if present: composite over white
    if (a < 255) {
      const alphaNorm = a / 255;
      y = y * alphaNorm + 255 * (1 - alphaNorm);
    }

    const yClamped = Math.min(255, Math.max(0, Math.round(y)));
    uint8Data[i] = yClamped;
    floatData[i] = yClamped / 255.0;
  }

  return {
    width,
    height,
    data: uint8Data,
    floatData,
  };
}

/**
 * Computes luminance distribution statistics including min, max, mean,
 * standard deviation, 256-bin histogram, and 1st/99th percentiles.
 *
 * @param luminance LuminanceBuffer to analyze
 * @returns LuminanceStats
 */
export function computeLuminanceStats(luminance: LuminanceBuffer): LuminanceStats {
  const { data } = luminance;
  const pixelCount = data.length;

  if (pixelCount === 0) {
    return {
      min: 0,
      max: 0,
      mean: 0,
      stdDev: 0,
      p1: 0,
      p99: 0,
      histogram: new Uint32Array(256),
    };
  }

  const histogram = new Uint32Array(256);
  let min = 255;
  let max = 0;
  let sum = 0;

  for (let i = 0; i < pixelCount; i++) {
    const val = data[i];
    histogram[val]++;
    if (val < min) min = val;
    if (val > max) max = val;
    sum += val;
  }

  const mean = sum / pixelCount;

  // Second pass for standard deviation
  let varianceSum = 0;
  for (let i = 0; i < pixelCount; i++) {
    const diff = data[i] - mean;
    varianceSum += diff * diff;
  }
  const stdDev = Math.sqrt(varianceSum / pixelCount);

  // Compute 1st percentile (p1) and 99th percentile (p99) from cumulative histogram
  let p1 = min;
  let p99 = max;

  if (pixelCount >= 100) {
    const countP1 = Math.max(1, Math.floor(pixelCount * 0.01));
    const countP99 = Math.min(pixelCount, Math.ceil(pixelCount * 0.99));

    let cumulative = 0;
    let foundP1 = false;

    for (let val = 0; val < 256; val++) {
      cumulative += histogram[val];
      if (!foundP1 && cumulative >= countP1) {
        p1 = val;
        foundP1 = true;
      }
      if (cumulative >= countP99) {
        p99 = val;
        break;
      }
    }
  }

  return {
    min,
    max,
    mean,
    stdDev,
    p1,
    p99,
    histogram,
  };
}

/**
 * Applies gentle percentile-bounded contrast normalization to a luminance buffer.
 *
 * Maps [p1, p99] to [0, 255] linearly. This avoids blowing out highlights or
 * crushing subtle shadows, and only expands contrast when the dynamic range
 * is meaningfully compressed (e.g. low-light or hazy photos).
 *
 * If the dynamic range is already healthy (e.g. p1 <= 15 and p99 >= 240),
 * this function preserves the luminance buffer untouched.
 *
 * @param luminance Source LuminanceBuffer
 * @param stats Precomputed LuminanceStats
 * @returns Contrast-normalized LuminanceBuffer
 */
export function normalizeLuminanceContrast(
  luminance: LuminanceBuffer,
  stats: LuminanceStats
): LuminanceBuffer {
  const { p1, p99 } = stats;
  const range = p99 - p1;

  // Don't stretch if image is essentially flat or already has healthy dynamic range
  if (range < 15 || (p1 <= 15 && p99 >= 240)) {
    return luminance;
  }

  const { width, height, data } = luminance;
  const pixelCount = data.length;
  const normData = new Uint8Array(pixelCount);
  const normFloat = new Float32Array(pixelCount);
  const invRange = 255.0 / range;

  for (let i = 0; i < pixelCount; i++) {
    const val = data[i];
    let stretched: number;
    if (val <= p1) {
      stretched = 0;
    } else if (val >= p99) {
      stretched = 255;
    } else {
      stretched = Math.round((val - p1) * invRange);
    }
    normData[i] = stretched;
    normFloat[i] = stretched / 255.0;
  }

  return {
    width,
    height,
    data: normData,
    floatData: normFloat,
  };
}

/**
 * Gentle edge-preserving bilateral smoothing for luminance buffers.
 *
 * Smooths high-frequency sensor grain (such as in low-light selfies)
 * while strictly maintaining sharp anatomical boundaries (eyelids, lips, jawline).
 *
 * @param luminance Source LuminanceBuffer
 * @param radius Filter window radius (default: 1, resulting in 3x3 kernel)
 * @param spatialSigma Spatial Gaussian sigma (default: 1.5)
 * @param rangeSigma Radiometric luminance sigma in [0-255] (default: 25.0)
 * @returns Edge-preserved smoothed LuminanceBuffer
 */
export function bilateralFilterLuminance(
  luminance: LuminanceBuffer,
  radius: number = 1,
  spatialSigma: number = 1.5,
  rangeSigma: number = 25.0
): LuminanceBuffer {
  if (radius <= 0) return luminance;

  const { width, height, data } = luminance;
  const pixelCount = data.length;
  const outData = new Uint8Array(pixelCount);
  const outFloat = new Float32Array(pixelCount);

  const twoSpatialSigmaSq = 2 * spatialSigma * spatialSigma;
  const twoRangeSigmaSq = 2 * rangeSigma * rangeSigma;

  // Precompute spatial weights
  const size = radius * 2 + 1;
  const spatialWeights = new Float32Array(size * size);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const distSq = dx * dx + dy * dy;
      const idx = (dy + radius) * size + (dx + radius);
      spatialWeights[idx] = Math.exp(-distSq / twoSpatialSigmaSq);
    }
  }

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const centerVal = data[rowOffset + x];
      let weightSum = 0;
      let valSum = 0;

      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        const nRowOffset = ny * width;

        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;

          const neighborVal = data[nRowOffset + nx];
          const diff = neighborVal - centerVal;
          const rangeWeight = Math.exp(-(diff * diff) / twoRangeSigmaSq);

          const spatialIdx = (dy + radius) * size + (dx + radius);
          const weight = spatialWeights[spatialIdx] * rangeWeight;

          valSum += neighborVal * weight;
          weightSum += weight;
        }
      }

      const filtered = Math.round(weightSum > 0 ? valSum / weightSum : centerVal);
      const clamped = Math.min(255, Math.max(0, filtered));
      const outIdx = rowOffset + x;
      outData[outIdx] = clamped;
      outFloat[outIdx] = clamped / 255.0;
    }
  }

  return {
    width,
    height,
    data: outData,
    floatData: outFloat,
  };
}
