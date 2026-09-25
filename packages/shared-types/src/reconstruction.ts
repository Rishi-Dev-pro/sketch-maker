import { Point2D, BoundingBox } from './geometry';
import { ContourPath, FeatureVisibility, HeadPose } from './subject';

/**
 * Traced lifecycle status of an anatomical or structural feature across the entire procedural art pipeline.
 */
export interface FeatureTraceStatus {
  /** Feature was identified in raw perception evidence */
  readonly detected: boolean;
  /** Feature was interpreted into intentional artistic geometry */
  readonly geometry: boolean;
  /** Feature was vectorized into at least one VectorPath */
  readonly vector: boolean;
  /** Feature produced at least one valid StrokeCandidate */
  readonly candidate: boolean;
  /** Feature was scheduled in the progressive OrderedStrokeSequence */
  readonly ordered: boolean;
  /** Feature was mapped into the temporal StrokeTimeline */
  readonly timelined: boolean;
  /** Feature reached active RenderState / StyledRenderState */
  readonly rendered: boolean;
  /** Optional diagnostic or occlusion reason notes */
  readonly notes?: string;
}

/**
 * Structured feature coverage report tracking feature preservation through the pipeline.
 */
export interface FeatureCoverageReport {
  readonly features: {
    readonly leftEye: FeatureTraceStatus;
    readonly rightEye: FeatureTraceStatus;
    readonly leftEyebrow: FeatureTraceStatus;
    readonly rightEyebrow: FeatureTraceStatus;
    readonly noseBridge: FeatureTraceStatus;
    readonly noseTip: FeatureTraceStatus;
    readonly nostrils: FeatureTraceStatus;
    readonly upperLip: FeatureTraceStatus;
    readonly lowerLip: FeatureTraceStatus;
    readonly mouthCorners: FeatureTraceStatus;
    readonly jaw: FeatureTraceStatus;
    readonly chin: FeatureTraceStatus;
    readonly leftEar: FeatureTraceStatus;
    readonly rightEar: FeatureTraceStatus;
    readonly hairSilhouette: FeatureTraceStatus;
    readonly hairMasses: FeatureTraceStatus;
    readonly hairFlow: FeatureTraceStatus;
    readonly neck: FeatureTraceStatus;
    readonly shoulders: FeatureTraceStatus;
    readonly clothing: FeatureTraceStatus;
  };
  readonly metrics: {
    /** Ratio of detected & rendered facial features [0.0 - 1.0] */
    readonly facialCoverage: number;
    /** Ratio of eye structure coverage [0.0 - 1.0] */
    readonly eyeCoverage: number;
    /** Ratio of nose structure coverage [0.0 - 1.0] */
    readonly noseCoverage: number;
    /** Ratio of mouth structure coverage [0.0 - 1.0] */
    readonly mouthCoverage: number;
    /** Ratio of jaw/chin structure coverage [0.0 - 1.0] */
    readonly jawCoverage: number;
    /** Ratio of hair silhouette, mass, and flow coverage [0.0 - 1.0] */
    readonly hairCoverage: number;
    /** Ratio of neck, shoulders, and clothing coverage [0.0 - 1.0] */
    readonly bodyCoverage: number;
    /** Composite structural coverage across all 19 features [0.0 - 1.0] */
    readonly overallStructuralCoverage: number;
    /** Percentage of candidate strokes derived from raw semantic boundaries [0.0 - 1.0] */
    readonly semanticBoundaryRatio: number;
    /** Percentage of strokes derived from meaningful anatomical/artistic structures [0.0 - 1.0] */
    readonly meaningfulStrokeRatio: number;
    /** Total generated stroke count */
    readonly generatedStrokeCount: number;
  };
}

/**
 * Reconstructed eye structure.
 */
export interface ReconstructedEye {
  readonly visibility: FeatureVisibility;
  readonly confidence: number;
  readonly upperLid: ContourPath;
  readonly lowerLid: ContourPath;
  readonly upperCrease?: ContourPath;
  readonly innerCorner?: Point2D;
  readonly outerCorner?: Point2D;
  readonly innerCanthusTick?: ContourPath;
  readonly outerCanthusTick?: ContourPath;
  readonly irisCenter?: Point2D;
  readonly irisContour?: ContourPath;
  readonly irisBoundary?: ContourPath;
  readonly pupilCenter?: Point2D;
  readonly pupilContour?: ContourPath;
  readonly lashAccents?: readonly ContourPath[];
}

/**
 * Reconstructed eyebrow structure with directional mass and taper.
 */
export interface ReconstructedEyebrow {
  readonly visibility: FeatureVisibility;
  readonly confidence: number;
  /** Primary expressive arch stroke */
  readonly arch: ContourPath;
  /** Medial head contour or accent */
  readonly head?: ContourPath;
  /** Lateral tapered tail */
  readonly tail?: ContourPath;
  /** Upper boundary curve if thickness is resolved */
  readonly upperContour?: ContourPath;
  /** Lower boundary curve if thickness is resolved */
  readonly lowerContour?: ContourPath;
  /** Directional hair strand strokes */
  readonly hairStrokes?: readonly ContourPath[];
}

/**
 * Reconstructed nose structure.
 */
export interface ReconstructedNose {
  readonly visibility: FeatureVisibility;
  readonly confidence: number;
  /** Nasal dorsum ridge line */
  readonly bridge: ContourPath;
  /** Apex dome arc (tip of the nose) */
  readonly tip: ContourPath;
  /** Columella / under-nose shadow shelf curve */
  readonly underside?: ContourPath;
  /** Columella center pillar */
  readonly columella?: ContourPath;
  /** Subnasale junction with philtrum */
  readonly subnasale?: ContourPath;
  /** Left alar wing crease curve */
  readonly leftAla?: ContourPath;
  /** Right alar wing crease curve */
  readonly rightAla?: ContourPath;
  /** Left nostril rim/aperture */
  readonly leftNostril?: ContourPath;
  /** Right nostril rim/aperture */
  readonly rightNostril?: ContourPath;
}

/**
 * Reconstructed mouth structure.
 */
export interface ReconstructedMouth {
  readonly visibility: FeatureVisibility;
  readonly confidence: number;
  /** Oral fissure line (the primary expressive seam between lips) */
  readonly oralFissure: ContourPath;
  /** Left commissure corner tick / anchor */
  readonly leftCorner?: ContourPath;
  /** Right commissure corner tick / anchor */
  readonly rightCorner?: ContourPath;
  /** Upper lip vermilion boundary with cupid's bow */
  readonly upperVermilion?: ContourPath;
  /** Lower lip vermilion boundary curve */
  readonly lowerVermilion?: ContourPath;
  /** Sub-labial mental crease accent curve below lower lip */
  readonly mentalCrease?: ContourPath;
  /** Philtrum columns above upper lip */
  readonly philtrum?: readonly ContourPath[];
}

/**
 * Reconstructed jawline and chin structure.
 */
export interface ReconstructedJawChin {
  readonly visibility: FeatureVisibility;
  readonly confidence: number;
  /** Mandibular jawline curve converging toward chin */
  readonly jawline: ContourPath;
  /** Distinct chin apex dome curve */
  readonly chin: ContourPath;
  /** Continuous anterior facial contour in side-profile poses */
  readonly profileContour?: ContourPath;
  /** Subtle malar / cheek plane curves */
  readonly malarPlanes?: readonly ContourPath[];
  /** Temple plane indications */
  readonly templeContour?: ContourPath;
}

/**
 * Reconstructed ear structure.
 */
export interface ReconstructedEar {
  readonly visibility: FeatureVisibility;
  readonly confidence: number;
  /** Outer helical rim curve */
  readonly helix: ContourPath;
  /** Inner conchal hollow / antihelix accent curve */
  readonly concha?: ContourPath;
  /** Lobule curve */
  readonly lobe?: ContourPath;
}

/**
 * Reconstructed hair structure with multi-tier hierarchy.
 */
export interface ReconstructedHair {
  readonly visibility: FeatureVisibility;
  readonly confidence: number;
  /** Anti-aliased outer hair silhouette (free of voxel staircase noise) */
  readonly silhouette?: ContourPath;
  /** Major volumetric mass partitions / hair lock outlines */
  readonly masses: readonly ContourPath[];
  /** Internal flow streamlines following dominant luminance gradients */
  readonly flowCurves: readonly ContourPath[];
  /** Fine hair strand groups */
  readonly strandGroups?: readonly ContourPath[];
  /** Hairline boundary transition with forehead */
  readonly hairline?: ContourPath;
}

/**
 * Reconstructed body and garment structure.
 */
export interface ReconstructedBody {
  readonly confidence: number;
  /** Bilateral neck contours connecting jawline to shoulders */
  readonly neckLines: readonly ContourPath[];
  /** Smooth anatomical shoulder curves (not straight stick bones) */
  readonly shoulderLines: readonly ContourPath[];
  /** Garment collar / neckline structural curves */
  readonly collarLines: readonly ContourPath[];
  /** Prominent structural garment seams */
  readonly clothingContours: readonly ContourPath[];
}

/**
 * Categorical luminance / tonal classification for shading synthesis.
 */
export type TonalRegionClassification =
  | 'highlight'
  | 'light'
  | 'midtone'
  | 'shadow'
  | 'deep_shadow';

/**
 * Spatial graphite mark scale hierarchy for multi-scale shading synthesis.
 */
export type GraphiteMarkScale = 'broad' | 'medium' | 'fine' | 'micro';

/**
 * Procedural tonal evidence extracted from original photograph luminance.
 */
export interface TonalRegion {
  readonly id: string;
  readonly bounds: BoundingBox;
  readonly centroid: Point2D;
  /** Normalized luminance intensity [0.0 - 1.0] (0 = dark, 1 = bright) */
  readonly intensity: number;
  readonly confidence: number;
  readonly importance: number;
  readonly semanticAssociation: string;
  readonly classification: TonalRegionClassification;
}

/**
 * Continuous 2D Spatial Tonal Field (TASK-113)
 * Preserves high-density spatial luminance L(x,y) and perceptual graphite density D(x,y)
 * across an anatomical region rather than collapsing to a single scalar average.
 */
export interface TonalField {
  readonly id: string;
  readonly bounds: BoundingBox;
  /** Grid horizontal resolution */
  readonly width: number;
  /** Grid vertical resolution */
  readonly height: number;
  /** Normalized spatial photographic luminance L(x,y) in [0.0, 1.0] (0 = pitch dark, 1 = peak white) */
  readonly values: Float32Array;
  /** Perceptual graphite darkness density field D(x,y) in [0.0, 1.0] (0 = paper white, 1 = maximum graphite deposit) */
  readonly density: Float32Array;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly semanticAssociation: string;
  readonly classification: TonalRegionClassification;
  readonly confidence?: Float32Array;
}

/**
 * Universal intermediate representation of all reconstructed artistic features for a subject.
 */
export interface ArtisticReconstruction {
  readonly subjectId: string;
  readonly pose: HeadPose;
  readonly leftEye?: ReconstructedEye;
  readonly rightEye?: ReconstructedEye;
  readonly leftEyebrow?: ReconstructedEyebrow;
  readonly rightEyebrow?: ReconstructedEyebrow;
  readonly nose?: ReconstructedNose;
  readonly mouth?: ReconstructedMouth;
  readonly jawChin?: ReconstructedJawChin;
  readonly leftEar?: ReconstructedEar;
  readonly rightEar?: ReconstructedEar;
  readonly hair?: ReconstructedHair;
  readonly body?: ReconstructedBody;
  readonly tonalRegions?: readonly TonalRegion[];
  /** Continuous spatial 2D tonal value fields (TASK-113) */
  readonly tonalFields?: readonly TonalField[];
  readonly shadingStrokes?: readonly ContourPath[];
  /** Tonal mass strokes for large volumetric hair body (TASK-113) */
  readonly hairMassStrokes?: readonly ContourPath[];
  /** Tonal mass strokes for clothing body (TASK-113) */
  readonly clothingMassStrokes?: readonly ContourPath[];
  /** Authoritative subject silhouette derived from cleaned segmentation (TASK-114) */
  readonly authoritativeSilhouette?: ContourPath;
  /** Explicit structural hierarchy model (TASK-114) */
  readonly structuralModel?: import('./structural').StructuralModel;
  readonly allReconstructedPaths: readonly ContourPath[];
  readonly confidence: number;
  readonly timestamp: number;
}
