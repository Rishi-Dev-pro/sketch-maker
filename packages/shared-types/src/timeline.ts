import { BoundingBox } from './geometry';
import { OrderedStroke, CompositionPhase } from './stroke';

/**
 * Standard mathematical easing curves for progressive stroke reveal.
 */
export type TimelineEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

/**
 * Platform-independent progressive timeline stroke.
 * Non-destructive wrapper around an OrderedStroke defining its temporal lifecycle.
 */
export interface TimelineStroke {
  /** Reference to the underlying OrderedStroke (geometry preserved untouched) */
  readonly stroke: OrderedStroke;

  /** 0-indexed contiguous position in the timeline */
  readonly timelineIndex: number;

  /** Absolute start timestamp in milliseconds */
  readonly startTimeMs: number;

  /** Duration of stroke execution in milliseconds */
  readonly durationMs: number;

  /** Absolute completion timestamp in milliseconds (startTimeMs + durationMs) */
  readonly endTimeMs: number;

  /** Normalized timeline progress at start [0.0, 1.0] */
  readonly startProgress: number;

  /** Normalized timeline progress at completion [0.0, 1.0] */
  readonly endProgress: number;

  /** Easing function governing stroke interpolation */
  readonly easing: TimelineEasing;

  /** Composition phase categorization */
  readonly phase: CompositionPhase;

  /** Additional temporal metadata and scheduling rationale */
  readonly metadata?: {
    readonly naturalDurationMs?: number;
    readonly overlapMs?: number;
    readonly dependencyDelayMs?: number;
    readonly schedulingReason?: string;
  };
}

/**
 * Configuration parameters governing timeline generation and progressive scheduling.
 */
export interface TimelineConfig {
  /**
   * Optional target total animation duration in milliseconds.
   * If provided, the natural schedule will be scaled towards this duration
   * while respecting min/max stroke duration bounds.
   */
  readonly targetDurationMs?: number;

  /** Minimum duration for an individual stroke in milliseconds (default: 80ms) */
  readonly minStrokeDurationMs: number;

  /** Maximum duration for an individual stroke in milliseconds (default: 800ms) */
  readonly maxStrokeDurationMs: number;

  /** Base pen down/up inertia duration in milliseconds (default: 120ms) */
  readonly baseStrokeDurationMs: number;

  /** Duration scaling factor per unit of normalized geometric arc length (default: 800ms) */
  readonly lengthFactor: number;

  /** Phase-specific duration multipliers */
  readonly phaseTimingMultipliers: Record<CompositionPhase, number>;

  /** Whether to allow concurrent overlapping strokes (default: true) */
  readonly allowOverlap: boolean;

  /** Target overlap ratio relative to preceding stroke duration (default: 0.35) */
  readonly overlapRatio: number;

  /** Maximum allowable overlap window in milliseconds (default: 250ms) */
  readonly maxOverlapMs: number;

  /** Minimum progress a parent stroke must reach before a dependent child stroke may begin (default: 0.75) */
  readonly minParentProgress: number;

  /** Default easing curve for stroke drawing (default: 'easeOut') */
  readonly defaultEasing: TimelineEasing;
}

/**
 * Canonical default timeline scheduling configuration.
 */
export const DEFAULT_TIMELINE_CONFIG: TimelineConfig = {
  minStrokeDurationMs: 80,
  maxStrokeDurationMs: 800,
  baseStrokeDurationMs: 120,
  lengthFactor: 800,
  phaseTimingMultipliers: {
    foundation: 1.25,
    primary_structure: 1.20,
    expressive_features: 1.10,
    secondary_anatomy: 1.00,
    refinement: 0.85,
    texture_accent: 0.70
  },
  allowOverlap: true,
  overlapRatio: 0.35,
  maxOverlapMs: 250,
  minParentProgress: 0.75,
  defaultEasing: 'easeOut'
};

/**
 * Quantitative metrics capturing timeline composition, concurrency, and duration.
 */
export interface TimelineMetrics {
  readonly totalStrokes: number;
  readonly naturalDurationMs: number;
  readonly targetDurationMs?: number;
  readonly finalDurationMs: number;
  readonly averageStrokeDurationMs: number;
  readonly minStrokeDurationMs: number;
  readonly maxStrokeDurationMs: number;
  readonly maxConcurrency: number;
  readonly averageOverlapMs: number;
  readonly constrainedDependencyCount: number;
  readonly generationLatencyMs: number;
}

/**
 * Top-level container representing the complete progressive stroke timeline.
 */
export interface StrokeTimeline {
  readonly version: string;
  readonly strokes: TimelineStroke[];
  readonly totalDurationMs: number;
  readonly naturalDurationMs: number;
  readonly targetDurationMs?: number;
  readonly bounds: BoundingBox;
  readonly metrics: TimelineMetrics;
  readonly timestamp: number;
}

/**
 * Real-time temporal state of an individual stroke at a queried timestamp.
 */
export interface TimelineStrokeState {
  readonly strokeId: string;
  readonly sequenceIndex: number;
  readonly timelineIndex: number;
  /** Normalized drawing progress [0.0 = not started, 1.0 = fully drawn] */
  readonly progress: number;
  /** Current state: 'pending' (t < start), 'drawing' (in-progress), 'complete' (t >= end) */
  readonly state: 'pending' | 'drawing' | 'complete';
}

/**
 * Comprehensive snapshot of the entire artwork state at a queried timestamp.
 */
export interface TimelineState {
  /** Queried timestamp in milliseconds (clamped to [0, totalDurationMs]) */
  readonly timeMs: number;
  /** Global timeline progress [0.0, 1.0] */
  readonly overallProgress: number;
  /** Individual stroke states */
  readonly strokes: TimelineStrokeState[];
  /** Number of strokes currently drawing */
  readonly activeCount: number;
  /** Number of strokes fully completed */
  readonly completedCount: number;
  /** Number of strokes yet to begin */
  readonly pendingCount: number;
  /** Total strokes in timeline */
  readonly totalStrokes: number;
}
