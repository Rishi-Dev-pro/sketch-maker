import { Point2D, BoundingBox } from '@sketch-maker/shared-types';

export interface ViewportOptions {
  /** Target canvas physical display width (CSS pixels) */
  readonly width: number;
  /** Target canvas physical display height (CSS pixels) */
  readonly height: number;
  /** Device pixel ratio for high-DPI scaling (default: window.devicePixelRatio || 1) */
  readonly dpr?: number;
  /** Inner padding margin ratio [0.0 - 0.2] (default: 0.04 = 4% padding) */
  readonly padding?: number;
  /** Original artwork normalized aspect ratio (width / height). Default: 1.0 */
  readonly artworkAspectRatio?: number;
}

/**
 * Resolution-independent viewport transformation engine.
 * Maps normalized [0, 1] x [0, 1] procedural art coordinates into physical canvas pixels
 * with strict aspect-ratio preservation (contain/letterbox), centering, and High-DPI support.
 *
 * Guarantees that source geometry remains strictly normalized and untouched.
 */
export class ViewportTransform {
  public readonly displayWidth: number;
  public readonly displayHeight: number;
  public readonly dpr: number;
  public readonly pixelWidth: number;
  public readonly pixelHeight: number;

  public readonly offsetX: number;
  public readonly offsetY: number;
  public readonly scaleX: number;
  public readonly scaleY: number;

  constructor(options: ViewportOptions) {
    this.displayWidth = Math.max(1, options.width);
    this.displayHeight = Math.max(1, options.height);
    this.dpr = Math.max(1, options.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1));

    this.pixelWidth = Math.round(this.displayWidth * this.dpr);
    this.pixelHeight = Math.round(this.displayHeight * this.dpr);

    const padding = options.padding ?? 0.04;
    const padW = this.displayWidth * padding;
    const padH = this.displayHeight * padding;
    const availW = this.displayWidth - padW * 2;
    const availH = this.displayHeight - padH * 2;

    const artAspect = options.artworkAspectRatio ?? 1.0;
    const availAspect = availW / availH;

    let targetW: number;
    let targetH: number;

    if (availAspect > artAspect) {
      // Available area is wider: fit to height
      targetH = availH;
      targetW = availH * artAspect;
    } else {
      // Available area is taller: fit to width
      targetW = availW;
      targetH = availW / artAspect;
    }

    this.scaleX = targetW;
    this.scaleY = targetH;
    this.offsetX = padW + (availW - targetW) / 2;
    this.offsetY = padH + (availH - targetH) / 2;
  }

  /**
   * Projects a normalized Point2D [0..1] into display canvas pixel space (pre-DPR).
   */
  public toPixel(point: Point2D): { x: number; y: number } {
    return {
      x: this.offsetX + point.x * this.scaleX,
      y: this.offsetY + point.y * this.scaleY
    };
  }

  /**
   * Projects a normalized stroke width multiplier into canvas pixel stroke width.
   * Clamped between minPixelWidth and maxPixelWidth.
   */
  public toPixelWidth(
    relativeWidth: number,
    minPixel: number = 1.0,
    maxPixel: number = 10.0
  ): number {
    // Standard baseline: 1.0 relative width corresponds to ~0.2% of viewport min dimension
    const baseDimension = Math.min(this.scaleX, this.scaleY);
    const pixelWidth = relativeWidth * (baseDimension * 0.0028);
    return Math.min(maxPixel, Math.max(minPixel, pixelWidth));
  }
}
