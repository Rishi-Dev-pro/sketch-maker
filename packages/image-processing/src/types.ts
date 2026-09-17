import { QualityProfile } from '@sketch-maker/shared-types';

/**
 * Geometric dimensions and aspect ratio of an image.
 */
export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: number; // width / height
}

/**
 * 4-channel RGBA pixel buffer (Uint8ClampedArray of length width * height * 4).
 */
export interface PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/**
 * 1-channel luminance representation in both 8-bit integer and 32-bit float formats.
 */
export interface LuminanceBuffer {
  readonly width: number;
  readonly height: number;
  /** 8-bit quantized photometric luminance [0 - 255] */
  readonly data: Uint8Array;
  /** 32-bit linear normalized luminance [0.0 - 1.0] */
  readonly floatData: Float32Array;
}

/**
 * Statistical luminance distribution metrics for contrast normalization and downstream thresholding.
 */
export interface LuminanceStats {
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly stdDev: number;
  readonly p1: number;             // 1st percentile luminance [0-255]
  readonly p99: number;            // 99th percentile luminance [0-255]
  readonly histogram: Uint32Array; // 256-bin distribution
}

/**
 * Complete normalized image container consumed by downstream structural analysis.
 */
export interface NormalizedImage {
  readonly originalDimensions: ImageDimensions;
  readonly processingDimensions: ImageDimensions;
  /** Coordinate scaling multipliers (original dimension / processing dimension) */
  readonly scale: { readonly x: number; readonly y: number };
  /** RGBA color buffer at processing resolution (for segmentation and color feature isolation) */
  readonly rgba: PixelBuffer;
  /** Perceptual luminance buffer at processing resolution */
  readonly luminance: LuminanceBuffer;
  /** Luminance statistics of the processed image */
  readonly stats: LuminanceStats;
  /** EXIF orientation tag (1 = standard horizontal orientation) */
  readonly orientation: number;
}

/**
 * Options configuring the preprocessing and normalization pipeline.
 */
export interface PreprocessOptions {
  /** Target adaptive quality profile (default: 'balanced') */
  readonly profile?: QualityProfile;
  /** Explicit maximum dimension override in pixels (overrides profile limit if specified) */
  readonly maxDimension?: number;
  /** Whether to apply gentle percentile-bounded contrast normalization (default: true) */
  readonly normalizeContrast?: boolean;
  /** Optional gentle edge-preserving bilateral smoothing radius in pixels (0 = disabled, default: 0) */
  readonly edgePreservingSmoothingRadius?: number;
  /** EXIF orientation tag if known (default: 1) */
  readonly orientation?: number;
}

/**
 * Quality profile max dimension mapping adhering to docs/BENCHMARKS.md.
 */
export const PROFILE_MAX_DIMENSIONS: Record<QualityProfile, number> = {
  fast: 512,
  balanced: 1024,
  high: 1600,
  ultra: 3000,
};
