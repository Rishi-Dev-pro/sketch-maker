/**
 * Core geometric primitive types for the Photo-to-Procedural-Art pipeline.
 * All coordinates are normalized in the [0.0, 1.0] unit square coordinate space
 * relative to the source image dimensions, unless explicitly noted.
 */

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Dimensions {
  readonly width: number;
  readonly height: number;
}

export interface Polyline {
  readonly points: Point2D[];
  readonly closed: boolean;
}

export interface BezierCurve {
  readonly start: Point2D;
  readonly cp1: Point2D;
  readonly cp2?: Point2D;
  readonly end: Point2D;
}
