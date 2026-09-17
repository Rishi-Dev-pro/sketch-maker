import { PixelBuffer, LuminanceBuffer } from '@sketch-maker/image-processing';
import { GradientField } from './gradient';

export interface SaliencyField {
  readonly width: number;
  readonly height: number;
  /** Dense saliency score [0.0 - 1.0] */
  readonly data: Float32Array;
  /** Estimated background color model [R, G, B] */
  readonly backgroundColorModel: { r: number; g: number; b: number };
}

/**
 * Computes a multi-cue perceptual saliency field combining:
 * 1. Perimeter background color dissimilarity
 * 2. Spatial anatomical center prior
 * 3. High-frequency structural gradient density
 *
 * @param rgba Normalized RGBA PixelBuffer
 * @param gradients GradientField from computeSobelGradients
 * @returns SaliencyField
 */
export function computePerceptualSaliency(
  rgba: PixelBuffer,
  gradients: GradientField
): SaliencyField {
  const { width, height, data: rgbaData } = rgba;
  const pixelCount = width * height;
  const saliencyData = new Float32Array(pixelCount);

  // 1. Sample perimeter border pixels to construct the background color model
  // We sample top 5% rows, left 5% columns, and right 5% columns (avoiding bottom row where subject grounds)
  const borderThicknessX = Math.max(2, Math.floor(width * 0.05));
  const borderThicknessY = Math.max(2, Math.floor(height * 0.05));

  let bgRSum = 0;
  let bgGSum = 0;
  let bgBSum = 0;
  let bgSampleCount = 0;

  for (let y = 0; y < height; y++) {
    const isTopBorder = y < borderThicknessY;
    const rowOffset = y * width;

    for (let x = 0; x < width; x++) {
      const isLeftBorder = x < borderThicknessX;
      const isRightBorder = x >= width - borderThicknessX;

      if (isTopBorder || isLeftBorder || isRightBorder) {
        const idx = (rowOffset + x) * 4;
        bgRSum += rgbaData[idx];
        bgGSum += rgbaData[idx + 1];
        bgBSum += rgbaData[idx + 2];
        bgSampleCount++;
      }
    }
  }

  const bgR = bgSampleCount > 0 ? bgRSum / bgSampleCount : 240;
  const bgG = bgSampleCount > 0 ? bgGSum / bgSampleCount : 240;
  const bgB = bgSampleCount > 0 ? bgBSum / bgSampleCount : 240;

  // 2. Precompute spatial prior parameters
  // Face / Upper torso center is typically at x=0.50, y=0.42
  const centerX = width * 0.50;
  const centerY = height * 0.45;
  const sigmaX = width * 0.38;
  const sigmaY = height * 0.48;
  const twoSigmaXSq = 2 * sigmaX * sigmaX;
  const twoSigmaYSq = 2 * sigmaY * sigmaY;

  // Max theoretical Euclidean RGB color distance = sqrt(3 * 255^2) ≈ 441.67
  const maxColorDist = 441.67;

  // 3. Compute multi-cue saliency per pixel
  for (let y = 0; y < height; y++) {
    const dy = y - centerY;
    const spatialYWeight = Math.exp(-(dy * dy) / twoSigmaYSq);
    const rowOffset = y * width;

    for (let x = 0; x < width; x++) {
      const dx = x - centerX;
      const spatialXWeight = Math.exp(-(dx * dx) / twoSigmaXSq);
      const spatialPrior = spatialXWeight * spatialYWeight; // [0.0 - 1.0]

      const pixelIdx = rowOffset + x;
      const rgbaIdx = pixelIdx * 4;

      const r = rgbaData[rgbaIdx];
      const g = rgbaData[rgbaIdx + 1];
      const b = rgbaData[rgbaIdx + 2];

      const diffR = r - bgR;
      const diffG = g - bgG;
      const diffB = b - bgB;
      const colorDist = Math.sqrt(diffR * diffR + diffG * diffG + diffB * diffB) / maxColorDist; // [0.0 - 1.0]

      const gradEnergy = gradients.magnitude[pixelIdx]; // [0.0 - 1.0]

      // If pixel is chromatically near-identical to perimeter background and has no structural edge,
      // it is definitively background (suppress spatial prior bleeding).
      if (colorDist < 0.08 && gradEnergy < 0.05) {
        saliencyData[pixelIdx] = 0.0;
      } else {
        // Multi-cue fusion:
        // - colorDist (0.50): subjects differ in chromaticity/luminance from background
        // - spatialPrior (0.30): subject occupies the core frame
        // - gradEnergy (0.20): subject contains internal facial & anatomical structural edges
        const fused = 0.50 * colorDist + 0.30 * spatialPrior + 0.20 * gradEnergy;
        saliencyData[pixelIdx] = Math.min(1.0, Math.max(0.0, fused));
      }
    }
  }

  return {
    width,
    height,
    data: saliencyData,
    backgroundColorModel: { r: bgR, g: bgG, b: bgB },
  };
}
