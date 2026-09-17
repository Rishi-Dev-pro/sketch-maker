import { BoundingBox, Dimensions, SubjectModel } from '@sketch-maker/shared-types';

/**
 * A detected structural subject instance (e.g. primary person, second person in multi-person shots).
 */
export interface SubjectRegion {
  readonly id: string;
  readonly label: 'primary_subject' | 'secondary_subject' | 'subject';
  /** Bounding box in normalized [0.0 - 1.0] coordinate space */
  readonly boundingBox: BoundingBox;
  /** Bounding box in processing pixel coordinates */
  readonly pixelBoundingBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  /** Area of this subject instance in pixels */
  readonly pixelArea: number;
  /** Statistical confidence score of this subject detection [0.0 - 1.0] */
  readonly confidence: number;
}

/**
 * Dense foreground/background mask representations.
 */
export interface SubjectMask {
  readonly width: number;
  readonly height: number;
  /** Binary mask where 255 = foreground subject, 0 = background */
  readonly data: Uint8Array;
  /** Soft continuous probability/confidence map [0.0 - 1.0] for boundary anti-aliasing */
  readonly confidenceMap: Float32Array;
}

/**
 * Complete immutable output emitted by the subject segmentation stage.
 */
export interface SegmentationResult {
  /** The primary subject binary mask and soft confidence map at processing resolution */
  readonly mask: SubjectMask;
  /** Overall bounding box of all detected foreground subjects in normalized [0.0 - 1.0] space */
  readonly boundingBox: BoundingBox;
  /** Overall bounding box in processing pixel coordinates */
  readonly pixelBoundingBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  /** Detected subject instances (supports single-subject and multi-subject group shots) */
  readonly instances: SubjectRegion[];
  /** Overall segmentation confidence score [0.0 - 1.0] */
  readonly confidence: number;
  /** Ratio of foreground pixels relative to total image area [0.0 - 1.0] */
  readonly coverage: number;
  /** Coordinate scale multipliers (original dimension / processing dimension) */
  readonly scale: { readonly x: number; readonly y: number };
  /** Source and processing dimensions */
  readonly originalDimensions: Dimensions;
  readonly processingDimensions: Dimensions;
  /** Performance and diagnostic metrics */
  readonly metrics: {
    readonly latencyMs: number;
    readonly algorithm: string;
  };
}

/**
 * Configuration options for subject segmentation.
 */
export interface SegmentationOptions {
  /**
   * Sensitivity threshold for foreground classification [0.0 - 1.0].
   * Higher values capture more peripheral details; lower values suppress more background.
   * Default: 0.50
   */
  readonly sensitivity?: number;
  /**
   * Edge barrier weight multiplier for gradient stopping.
   * Controls how strongly anatomical contours prevent mask bleeding.
   * Default: 1.0
   */
  readonly edgeWeight?: number;
  /**
   * Maximum number of distinct subject instances to segment (default: 4).
   */
  readonly maxInstances?: number;
  /**
   * Minimum pixel area (as a fraction of total image area) to consider as a valid subject instance.
   * Default: 0.02 (2% of image)
   */
  readonly minSubjectAreaFraction?: number;
  /**
   * Segmentation strategy mode.
   * - 'standard': balanced foreground extraction with soft anti-aliased boundaries
   * - 'aggressive': tighter subject boundary, stricter background clutter elimination
   * - 'conservative': wider subject boundary, prioritizing retaining delicate hair wisps
   */
  readonly mode?: 'standard' | 'aggressive' | 'conservative';
}

/**
 * Complete immutable output emitted by the structural analysis and landmark extraction stage.
 * Represents one or more subjects analyzed into structured semantic contours.
 */
export interface SubjectAnalysisResult {
  /** Primary detected subject (or highest-confidence subject in multi-person shots) */
  readonly primarySubject: SubjectModel;
  /** All detected subjects (for multi-person images like BM-11) */
  readonly subjects: SubjectModel[];
  /** Coordinate scale multipliers (original dimension / processing dimension) */
  readonly scale: { readonly x: number; readonly y: number };
  /** Performance and diagnostic metrics */
  readonly metrics: {
    readonly latencyMs: number;
    readonly subjectCount: number;
    readonly hasFace: boolean;
    readonly hasBody: boolean;
  };
}
