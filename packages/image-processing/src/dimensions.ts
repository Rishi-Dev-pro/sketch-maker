import { ImageDimensions } from './types';

/**
 * Calculates target processing dimensions subject to a maximum bounding constraint,
 * strictly preserving the original aspect ratio without upscaling small images.
 *
 * @param origWidth Original image width in pixels (must be > 0)
 * @param origHeight Original image height in pixels (must be > 0)
 * @param maxDimension Maximum allowed dimension (width or height) in pixels
 * @returns ImageDimensions with integer pixel values and floating-point aspect ratio
 */
export function calculateTargetDimensions(
  origWidth: number,
  origHeight: number,
  maxDimension: number
): ImageDimensions {
  if (!Number.isFinite(origWidth) || origWidth <= 0) {
    throw new Error(`Invalid original width: ${origWidth}. Width must be a positive finite number.`);
  }
  if (!Number.isFinite(origHeight) || origHeight <= 0) {
    throw new Error(`Invalid original height: ${origHeight}. Height must be a positive finite number.`);
  }
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
    throw new Error(`Invalid maxDimension: ${maxDimension}. Max dimension must be a positive finite number.`);
  }

  const aspectRatio = origWidth / origHeight;

  // Do NOT upscale images that are already smaller than the processing budget.
  // Upscaling introduces interpolation blur without adding any structural information.
  if (origWidth <= maxDimension && origHeight <= maxDimension) {
    return {
      width: Math.round(origWidth),
      height: Math.round(origHeight),
      aspectRatio,
    };
  }

  let targetWidth: number;
  let targetHeight: number;

  if (origWidth >= origHeight) {
    targetWidth = maxDimension;
    targetHeight = Math.max(1, Math.round(maxDimension / aspectRatio));
  } else {
    targetHeight = maxDimension;
    targetWidth = Math.max(1, Math.round(maxDimension * aspectRatio));
  }

  return {
    width: targetWidth,
    height: targetHeight,
    aspectRatio,
  };
}

/**
 * Verifies that a PixelBuffer is structurally well-formed.
 */
export function validatePixelBuffer(width: number, height: number, data: Uint8ClampedArray): void {
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error(`Invalid buffer width: ${width}. Must be a positive integer.`);
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new Error(`Invalid buffer height: ${height}. Must be a positive integer.`);
  }
  const expectedLength = width * height * 4;
  if (data.length !== expectedLength) {
    throw new Error(
      `Buffer length mismatch: expected ${expectedLength} bytes for ${width}x${height} RGBA, got ${data.length} bytes.`
    );
  }
}
