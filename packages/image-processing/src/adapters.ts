import { PixelBuffer } from './types';

/**
 * Converts browser ImageData into a platform-agnostic PixelBuffer.
 *
 * @param imageData Standard DOM/Canvas ImageData
 * @returns PixelBuffer
 */
export function imageDataToPixelBuffer(imageData: ImageData): PixelBuffer {
  return {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  };
}

/**
 * Extracts a PixelBuffer from an HTMLCanvasElement or OffscreenCanvas.
 *
 * @param canvas Canvas instance
 * @returns PixelBuffer
 */
export function canvasToPixelBuffer(
  canvas: HTMLCanvasElement | OffscreenCanvas
): PixelBuffer {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) {
    throw new Error('Failed to acquire 2D rendering context from canvas.');
  }
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    width: canvas.width,
    height: canvas.height,
    data: new Uint8ClampedArray(imageData.data),
  };
}

/**
 * Renders an HTMLImageElement or ImageBitmap onto an internal canvas to extract a PixelBuffer.
 *
 * @param image HTMLImageElement or ImageBitmap
 * @returns PixelBuffer
 */
export function imageSourceToPixelBuffer(
  image: HTMLImageElement | ImageBitmap
): PixelBuffer {
  const width = 'naturalWidth' in image ? image.naturalWidth : image.width;
  const height = 'naturalHeight' in image ? image.naturalHeight : image.height;

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to acquire OffscreenCanvas 2D context.');
    ctx.drawImage(image, 0, 0);
    return canvasToPixelBuffer(canvas);
  } else if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to acquire HTMLCanvasElement 2D context.');
    ctx.drawImage(image, 0, 0);
    return canvasToPixelBuffer(canvas);
  } else {
    throw new Error('Neither OffscreenCanvas nor document is available in the current environment.');
  }
}
