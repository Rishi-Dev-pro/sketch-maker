import { BoundingBox } from './geometry';
import { ContourPath, FacialFeatures } from './subject';
import { BodyPose } from './subject';

/**
 * Spatial region mask representing ownership of a semantic segment.
 */
export interface RegionMask {
  readonly category: string;
  readonly bounds: BoundingBox;
  readonly data?: Uint8Array;
  readonly width?: number;
  readonly height?: number;
  readonly confidence?: number;
  readonly pixelArea?: number;
}

/**
 * Complete structural model for a single subject (TASK-114).
 * Enforces explicit structural hierarchy:
 * - Outer boundary: authoritative subject silhouette
 * - Internal anatomy: MediaPipe Face landmarks
 * - Body geometry: MediaPipe Pose landmarks constrained by segmentation
 * - Semantic ownership: hair, face, neck, clothing, torso region masks
 */
export interface SubjectStructure {
  readonly subjectId: string;
  readonly silhouette: ContourPath;
  readonly regions: {
    readonly hair?: RegionMask;
    readonly face?: RegionMask;
    readonly neck?: RegionMask;
    readonly clothing?: RegionMask;
    readonly torso?: RegionMask;
  };
  readonly face?: FacialFeatures;
  readonly pose?: BodyPose;
  readonly confidence: number;
}

/**
 * Multi-subject structural model bridging perception and procedural drawing.
 */
export interface StructuralModel {
  readonly subjects: SubjectStructure[];
  readonly timestamp: number;
}
