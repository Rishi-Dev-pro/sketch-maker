import {
  PixelBuffer,
  NormalizedImage,
  PreprocessOptions,
  PROFILE_MAX_DIMENSIONS,
} from './types';
import { calculateTargetDimensions, validatePixelBuffer } from './dimensions';
import { resamplePixelBuffer } from './resample';
import {
  rgbaToLuminance,
  computeLuminanceStats,
  normalizeLuminanceContrast,
  bilateralFilterLuminance,
} from './luminance';

/**
 * Preprocesses an arbitrary input RGBA pixel buffer into a normalized,
 * information-preserving representation ready for downstream structural analysis.
 *
 * Execution stages:
 * 1. Validation of buffer integrity and dimensions.
 * 2. Dimension normalization subject to quality profile or explicit maximum bounds.
 * 3. Area-weighted anti-aliased downsampling (or smooth bilinear resampling).
 * 4. Rec. 709 photometric perceptual luminance extraction (8-bit and 32-bit float).
 * 5. Luminance statistical moments & histogram accumulation.
 * 6. Percentile-bounded contrast normalization (if enabled, default: true).
 * 7. Optional gentle edge-preserving bilateral smoothing (if requested).
 * 8. Package immutable NormalizedImage container with coordinate scale mappings.
 *
 * @param input Raw RGBA PixelBuffer
 * @param options Configuration options
 * @returns NormalizedImage
 */
export function preprocessPixelBuffer(
  input: PixelBuffer,
  options?: PreprocessOptions
): NormalizedImage {
  validatePixelBuffer(input.width, input.height, input.data);

  const profile = options?.profile ?? 'balanced';
  const maxDimension = options?.maxDimension ?? PROFILE_MAX_DIMENSIONS[profile] ?? 1024;
  const shouldNormalizeContrast = options?.normalizeContrast ?? true;
  const smoothingRadius = options?.edgePreservingSmoothingRadius ?? 0;
  const orientation = options?.orientation ?? 1;

  const originalDimensions = {
    width: input.width,
    height: input.height,
    aspectRatio: input.width / input.height,
  };

  // 1. Determine target processing dimensions
  const processingDimensions = calculateTargetDimensions(
    input.width,
    input.height,
    maxDimension
  );

  // 2. Resample RGBA buffer if dimensions changed
  let rgbaBuffer: PixelBuffer;
  if (
    processingDimensions.width === input.width &&
    processingDimensions.height === input.height
  ) {
    rgbaBuffer = input;
  } else {
    rgbaBuffer = resamplePixelBuffer(
      input,
      processingDimensions.width,
      processingDimensions.height
    );
  }

  // 3. Extract Rec. 709 photometric luminance
  let luminance = rgbaToLuminance(rgbaBuffer);

  // 4. Compute initial distribution statistics
  let stats = computeLuminanceStats(luminance);

  // 5. Apply gentle percentile-bounded contrast normalization if enabled
  if (shouldNormalizeContrast) {
    const normalizedLum = normalizeLuminanceContrast(luminance, stats);
    if (normalizedLum !== luminance) {
      luminance = normalizedLum;
      stats = computeLuminanceStats(luminance);
    }
  }

  // 6. Optional gentle edge-preserving smoothing
  if (smoothingRadius > 0) {
    luminance = bilateralFilterLuminance(luminance, smoothingRadius);
    stats = computeLuminanceStats(luminance);
  }

  // 7. Calculate coordinate scaling multipliers (original / processing)
  const scale = {
    x: originalDimensions.width / processingDimensions.width,
    y: originalDimensions.height / processingDimensions.height,
  };

  return {
    originalDimensions,
    processingDimensions,
    scale,
    rgba: rgbaBuffer,
    luminance,
    stats,
    orientation,
  };
}
