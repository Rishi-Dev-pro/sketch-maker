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
  | 'hair_boundary'
  | 'body_outline'
  | 'shoulders'
  | 'clothing'
  | 'accessories'
  | 'texture'
  | 'background'
  | 'highlight';

export interface ContourPath {
  readonly id: string;
  readonly region: SemanticRegion;
  readonly points: Point2D[];
  readonly closed: boolean;
  readonly confidence: number; // [0.0 - 1.0]
  readonly length?: number;
}

export interface EyeLandmarks {
  readonly upperLid: ContourPath;
  readonly lowerLid: ContourPath;
  readonly iris?: Point2D;
  readonly pupil?: Point2D;
}

export interface FacialFeatures {
  readonly leftEye: EyeLandmarks;
  readonly rightEye: EyeLandmarks;
  readonly leftEyebrow: ContourPath;
  readonly rightEyebrow: ContourPath;
  readonly noseBridge: ContourPath;
  readonly noseTip: ContourPath;
  readonly nostrils: ContourPath[];
  readonly upperLip: ContourPath;
  readonly lowerLip: ContourPath;
  readonly lipSeparation: ContourPath;
  readonly jawline: ContourPath;
  readonly leftEar?: ContourPath;
  readonly rightEar?: ContourPath;
  readonly confidence: number;
}

export interface BodyFeatures {
  readonly shoulders: ContourPath[];
  readonly arms: ContourPath[];
  readonly torso: ContourPath[];
  readonly legs: ContourPath[];
  readonly poseConfidence: number;
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
  readonly globalConfidence: number;
  readonly timestamp: number;
}
