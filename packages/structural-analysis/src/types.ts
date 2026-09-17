import { BoundingBox, Dimensions, HeadPose, Point2D, SubjectModel } from '@sketch-maker/shared-types';

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

/**
 * Indicates which lateral side of the subject's face is visible to the camera.
 * - 'both': Frontal or slight 3/4 angle where both eyes/cheeks are in frame.
 * - 'left_only': Left-profile view where only the subject's left-facing side is visible.
 * - 'right_only': Right-profile view where only the subject's right-facing side is visible.
 * - 'neither': Face is occluded, turned away, or undetected.
 */
export type LateralVisibility = 'both' | 'left_only' | 'right_only' | 'neither';

/**
 * Diagnostic metrics and intermediate scores for face region and pose estimation.
 */
export interface FaceRegionDiagnostics {
  /** Bilateral symmetry score [0.0 - 1.0], 1.0 = perfectly symmetric */
  readonly symmetryScore: number;
  /** Horizontal centroid offset relative to head center [-1.0 to 1.0] (negative = left, positive = right) */
  readonly centroidOffset: number;
  /** Fraction of subject instance mask area occupied by the head [0.0 - 1.0] */
  readonly headAreaFraction: number;
  /** Ratio of skin-tone probability pixels within face candidate region [0.0 - 1.0] */
  readonly skinToneCoverage: number;
  /** Average normalized Sobel edge energy in the face candidate region [0.0 - 1.0] */
  readonly edgeEnergy: number;
  /** Profile boundary projection asymmetry ratio [0.0 - 1.0] (0.5 = balanced) */
  readonly profileAsymmetryRatio: number;
  /** Illumination asymmetry between left and right halves [0.0 - 1.0] (0.0 = even, 1.0 = extreme chiaroscuro) */
  readonly illuminationAsymmetry?: number;
  /** Head silhouette asymmetry ratio [0.0 - 1.0] (0.5 = balanced) */
  readonly headSilhouetteAsymmetry?: number;
}

/**
 * Bounding and orientation estimation for the head and facial feature zone of a subject.
 */
export interface FaceRegionEstimate {
  /** Unique ID of the subject instance this face belongs to */
  readonly subjectId: string;
  /** Bounding box of the entire head (cranium, hair, jaw) in normalized [0.0 - 1.0] coordinates */
  readonly headBoundingBox: BoundingBox;
  /** Bounding box of the facial feature zone (brows to chin, cheek to cheek) in normalized [0.0 - 1.0] coordinates */
  readonly faceBoundingBox: BoundingBox;
  /** Estimated center point of the facial feature zone in normalized [0.0 - 1.0] coordinates */
  readonly center: Point2D;
  /** Estimated head pose orientation */
  readonly pose: HeadPose;
  /** Confidence of the head pose classification [0.0 - 1.0] */
  readonly poseConfidence: number;
  /** Overall confidence that a valid face region was identified [0.0 - 1.0] */
  readonly confidence: number;
  /** Which lateral side of the face is visible based on pose */
  readonly visibleSide: LateralVisibility;
  /** Diagnostic metrics explaining the estimation rationale */
  readonly diagnostics: FaceRegionDiagnostics;
}
