import { Point2D, BoundingBox, Dimensions } from './geometry';

/**
 * Semantic regions for structural analysis and adaptive drawing allocation.
 */
export type SemanticRegion =
  | 'eyes'
  | 'eyebrows'
  | 'nose'
  | 'mouth'
  | 'face_contour'
  | 'jawline'
  | 'ears'
  | 'hair'
  | 'hair_boundary'
  | 'body_outline'
  | 'shoulders'
  | 'clothing'
  | 'accessories'
  | 'texture'
  | 'background'
  | 'highlight';

/**
 * Visibility state of an anatomical or structural feature.
 * - 'visible': Feature is observed with clear image evidence.
 * - 'occluded': Feature is physically present but hidden by pose angle (e.g. opposite eye in profile) or foreground obstruction.
 * - 'not_detected': Feature could not be resolved from image evidence within expected region.
 * - 'uncertain': Weak or ambiguous image evidence exists.
 */
export type FeatureVisibility = 'visible' | 'occluded' | 'not_detected' | 'uncertain';

/**
 * Estimated head pose orientation based on facial asymmetry and silhouette boundaries.
 */
export type HeadPose =
  | 'frontal'
  | 'three_quarter_left'
  | 'three_quarter_right'
  | 'left_profile'
  | 'right_profile';

export interface ContourPath {
  readonly id: string;
  readonly region: SemanticRegion;
  readonly points: Point2D[];
  readonly closed: boolean;
  readonly confidence: number; // [0.0 - 1.0]
  readonly visibility?: FeatureVisibility;
  readonly length?: number;
}

export interface EyeLandmarks {
  readonly visibility?: FeatureVisibility;
  readonly upperLid: ContourPath;
  readonly lowerLid: ContourPath;
  readonly upperCrease?: ContourPath;
  readonly innerCorner?: Point2D;
  readonly outerCorner?: Point2D;
  readonly iris?: Point2D;
  readonly irisContour?: ContourPath;
  readonly pupil?: Point2D;
  readonly pupilContour?: ContourPath;
  readonly confidence?: number;
}

export interface FacialFeatures {
  readonly boundingBox?: BoundingBox;
  readonly pose?: HeadPose;
  readonly leftEye?: EyeLandmarks;
  readonly rightEye?: EyeLandmarks;
  readonly leftEyebrow?: ContourPath;
  readonly rightEyebrow?: ContourPath;
  readonly noseBridge?: ContourPath;
  readonly noseTip?: ContourPath;
  readonly nostrils?: ContourPath[];
  readonly upperLip?: ContourPath;
  readonly lowerLip?: ContourPath;
  readonly lipSeparation?: ContourPath;
  readonly jawline?: ContourPath;
  readonly chin?: ContourPath;
  readonly leftEar?: ContourPath;
  readonly rightEar?: ContourPath;
  readonly columella?: ContourPath;
  readonly subnasale?: ContourPath;
  readonly philtrum?: ContourPath[];
  readonly mentalCrease?: ContourPath;
  readonly malarPlanes?: ContourPath[];
  readonly featureVisibility?: Partial<
    Record<
      | 'leftEye'
      | 'rightEye'
      | 'leftEyebrow'
      | 'rightEyebrow'
      | 'nose'
      | 'mouth'
      | 'jawline'
      | 'chin'
      | 'leftEar'
      | 'rightEar',
      FeatureVisibility
    >
  >;
  readonly confidence: number;
}

export interface PoseLandmark {
  readonly id: string;
  readonly point: Point2D; // Normalized [0.0 - 1.0]
  readonly z?: number; // Relative depth in normalized screen units
  readonly visibility: FeatureVisibility;
  readonly presence?: number; // Likelihood of landmark existing in frame [0.0 - 1.0]
  readonly confidence: number; // Combined reliability confidence [0.0 - 1.0]
}

export interface PoseConnection {
  readonly from: Point2D;
  readonly to: Point2D;
  readonly name: string;
  readonly confidence: number;
}

export interface BodyPose {
  readonly landmarks: PoseLandmark[];
  readonly connections: PoseConnection[];
  // Key articulated anatomical points
  readonly nose?: PoseLandmark;
  readonly leftEye?: PoseLandmark;
  readonly rightEye?: PoseLandmark;
  readonly leftEar?: PoseLandmark;
  readonly rightEar?: PoseLandmark;
  readonly neck?: PoseLandmark; // Synthesized midpoint of shoulders
  readonly leftShoulder?: PoseLandmark;
  readonly rightShoulder?: PoseLandmark;
  readonly leftElbow?: PoseLandmark;
  readonly rightElbow?: PoseLandmark;
  readonly leftWrist?: PoseLandmark;
  readonly rightWrist?: PoseLandmark;
  readonly leftHip?: PoseLandmark;
  readonly rightHip?: PoseLandmark;
  readonly leftKnee?: PoseLandmark;
  readonly rightKnee?: PoseLandmark;
  readonly leftAnkle?: PoseLandmark;
  readonly rightAnkle?: PoseLandmark;
  readonly leftHeel?: PoseLandmark;
  readonly rightHeel?: PoseLandmark;
  readonly leftFootIndex?: PoseLandmark;
  readonly rightFootIndex?: PoseLandmark;
  readonly boundingBox?: BoundingBox;
  readonly confidence: number;
}

export interface BodyFeatures {
  readonly pose?: BodyPose;
  readonly shoulders: ContourPath[];
  readonly arms: ContourPath[];
  readonly torso: ContourPath[];
  readonly legs: ContourPath[];
  readonly poseConfidence: number;
}

/**
 * Canonical semantic segmentation classes.
 * Mapped from model-specific categories (e.g. MediaPipe Selfie Multiclass).
 */
export type SemanticCategory =
  | 'background'
  | 'hair'
  | 'body_skin'
  | 'face_skin'
  | 'clothing'
  | 'accessories'
  | 'unknown';

/**
 * Dense binary and soft confidence mask for a discrete semantic category.
 */
export interface SemanticMask {
  readonly category: SemanticCategory;
  readonly confidence: number;
  readonly width: number;
  readonly height: number;
  /** Binary mask where 255 = present in this category, 0 = absent */
  readonly data: Uint8Array;
  /** Soft continuous probability map [0.0 - 1.0] for boundary anti-aliasing */
  readonly confidenceMap?: Float32Array;
  /** Bounding box of this semantic region in normalized [0.0 - 1.0] space */
  readonly boundingBox?: BoundingBox;
  /** Pixel area of this semantic class */
  readonly pixelArea: number;
}

/**
 * Complete semantic segmentation result containing multi-class category masks.
 */
export interface SemanticSegmentation {
  readonly categories: SemanticCategory[];
  readonly masks: SemanticMask[];
  readonly confidence: number;
  readonly provider: 'deterministic' | 'mediapipe' | 'hybrid';
}

/**
 * Universal SubjectModel
 * The architectural bridge between image analysis and procedural rendering.
 * Pure data object, platform-independent, cacheable across styles.
 */
export interface SubjectModel {
  readonly id: string;
  readonly version: string;
  readonly sourceDimensions: Dimensions;
  readonly boundingBox: BoundingBox;
  readonly silhouette: ContourPath[];
  readonly face?: FacialFeatures;
  readonly hair?: ContourPath[];
  readonly body?: BodyFeatures;
  readonly clothing?: ContourPath[];
  readonly accessories?: ContourPath[];
  readonly backgroundContours?: ContourPath[];
  readonly semanticSegmentation?: SemanticSegmentation;
  readonly reconstruction?: import('./reconstruction').ArtisticReconstruction;
  readonly globalConfidence: number;
  readonly timestamp: number;
}

