import { Point2D } from './geometry';
import { SemanticRegion } from './subject';

export interface StrokePoint extends Point2D {
  readonly pressure?: number; // Normalized pen pressure [0.0 - 1.0]
  readonly widthMultiplier?: number;
  readonly tangent?: Point2D;
}

/**
 * Universal Stroke representation.
 * Represents an individual procedural vector stroke.
 */
export interface Stroke {
  readonly id: string;
  readonly startPoint: StrokePoint;
  readonly endPoint: StrokePoint;
  readonly controlPoints: StrokePoint[];
  readonly region: SemanticRegion;
  readonly importance: number; // Normalized [0.0 - 1.0]
  readonly length: number;     // Normalized geometric arc length
  readonly order: number;      // Sequence index in progressive timeline
  readonly styleMetadata?: Record<string, unknown>;
}

/**
 * Universal StrokeModel
 * Cached intermediate representation containing all synthesized strokes
 * and their drawing sequence.
 */
export interface StrokeModel {
  readonly id: string;
  readonly subjectModelId: string;
  readonly strokes: Stroke[];
  readonly totalStrokes: number;
  readonly totalLength: number;
  readonly drawingOrder: number[]; // Array of stroke indices in progressive order
  readonly timestamp: number;
}
