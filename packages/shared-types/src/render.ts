import { Point2D, BezierCurve, BoundingBox } from './geometry';
import { StrokeSemanticRole, CompositionPhase } from './stroke';

/**
 * Geometric representation of a partially or fully traversed procedural stroke.
 */
export interface PartialStrokeGeometry {
  /** Traversed polyline points up to the current progress */
  readonly points: Point2D[];
  /** Traversed Bézier curves up to the current progress (with the active curve trimmed via De Casteljau) */
  readonly curves?: BezierCurve[];
  /** Exact instantaneous pen tip coordinate [x, y] in normalized space */
  readonly tipPoint?: Point2D;
  /** Instantaneous pen travel tangent vector [dx, dy] normalized */
  readonly tipTangent?: Point2D;
  /** Drawing progress clamped in [0.0, 1.0] */
  readonly progress: number;
  /** Whether the stroke is 100% complete */
  readonly isComplete: boolean;
}

/**
 * Visual diagnostic mode for procedural stroke inspection.
 */
export type RenderDiagnosticMode =
  | 'normal'     // Clean high-contrast procedural artwork
  | 'sequence'   // Color-coded by drawing sequence order
  | 'phase'      // Color-coded by composition phase
  | 'subject'    // Color-coded by subject ID (multi-person debugging)
  | 'timeline';   // Emphasizes active strokes and pending state

/**
 * Platform-independent renderable stroke state at an arbitrary timestamp.
 */
export interface RenderStroke {
  readonly strokeId: string;
  readonly subjectId: string;
  readonly sequenceIndex: number;
  readonly timelineIndex: number;
  /** Current temporal status */
  readonly status: 'pending' | 'drawing' | 'complete';
  /** Clamped progress [0.0, 1.0] */
  readonly progress: number;
  /** Extracted partial or complete geometry */
  readonly geometry: PartialStrokeGeometry;
  /** Relative stroke line weight multiplier from StrokeCandidate */
  readonly lineWidth: number;
  /** Opacity [0.0, 1.0] */
  readonly opacity: number;
  /** Semantic role */
  readonly semanticRole: StrokeSemanticRole;
  /** Composition phase */
  readonly phase: CompositionPhase;
  /** Importance score [0.0, 1.0] */
  readonly importance: number;
  /** Whether this stroke was flagged as background */
  readonly isBackground: boolean;
}

/**
 * Pure configuration options for compiling a RenderState.
 */
export interface RenderConfig {
  /** Whether to emit pending strokes in the render state (default: false) */
  readonly showPending: boolean;
  /** Base line width multiplier (default: 1.5) */
  readonly baseLineWidth: number;
  /** Minimum pixel width after viewport projection (default: 1.0) */
  readonly minPixelWidth: number;
  /** Maximum pixel width after viewport projection (default: 10.0) */
  readonly maxPixelWidth: number;
  /** Whether to compute active pen tip indicator glow (default: true) */
  readonly penTipGlow: boolean;
  /** Diagnostic visualization mode (default: 'normal') */
  readonly diagnosticMode: RenderDiagnosticMode;
  /** Optional subject ID filter for multi-person inspection (undefined = all subjects) */
  readonly filterSubjectId?: string;
}

/**
 * Canonical default render configuration.
 */
export const DEFAULT_RENDER_CONFIG: RenderConfig = {
  showPending: false,
  baseLineWidth: 1.5,
  minPixelWidth: 1.0,
  maxPixelWidth: 10.0,
  penTipGlow: true,
  diagnosticMode: 'normal'
};

/**
 * Snapshot of the entire procedural artwork ready for rendering at a given timestamp.
 */
export interface RenderState {
  /** Timestamp in milliseconds */
  readonly timeMs: number;
  /** Overall global artwork progress [0.0, 1.0] */
  readonly overallProgress: number;
  /** All renderable strokes (active + completed, and pending if enabled) in strict timeline order */
  readonly strokes: RenderStroke[];
  /** Subset of strokes currently actively drawing */
  readonly activeStrokes: RenderStroke[];
  /** Count of actively drawing strokes */
  readonly activeCount: number;
  /** Count of fully completed strokes */
  readonly completedCount: number;
  /** Count of pending strokes */
  readonly pendingCount: number;
  /** Total strokes in timeline */
  readonly totalStrokes: number;
  /** Whether the artwork is 100% completed */
  readonly isComplete: boolean;
  /** Combined bounding box of artwork */
  readonly bounds: BoundingBox;
}
