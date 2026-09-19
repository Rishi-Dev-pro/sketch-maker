import {
  OrderedStrokeSequence,
  TimelineConfig,
  DEFAULT_TIMELINE_CONFIG,
  TimelineMetrics,
  StrokeTimeline
} from './timeline-types';
import { buildNaturalSchedule } from './scheduler';
import { normalizeSchedule } from './normalizer';
import { validateStrokeTimeline } from './validator';

export * from './timeline-types';
export * from './easing';
export * from './duration-model';
export * from './phase-timing';
export * from './dependencies';
export * from './scheduler';
export * from './normalizer';
export * from './progress';
export * from './validator';

export const TIMELINE_ENGINE_VERSION = '0.1.0';

/**
 * Computes the maximum concurrent active strokes at any moment in the timeline.
 */
function calculateMaxConcurrency(
  strokes: Array<{ startTimeMs: number; endTimeMs: number }>
): number {
  if (strokes.length === 0) return 0;

  // Create start and end events
  const events: Array<{ timeMs: number; delta: number }> = [];
  for (const s of strokes) {
    events.push({ timeMs: s.startTimeMs, delta: 1 });
    events.push({ timeMs: s.endTimeMs, delta: -1 });
  }

  // Sort events: on time tie, process end events (-1) before start events (+1)
  events.sort((a, b) => {
    if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
    return a.delta - b.delta;
  });

  let currentConcurrency = 0;
  let maxConcurrency = 0;

  for (const e of events) {
    currentConcurrency += e.delta;
    if (currentConcurrency > maxConcurrency) {
      maxConcurrency = currentConcurrency;
    }
  }

  return maxConcurrency;
}

/**
 * Creates a deterministic, progressive StrokeTimeline from an OrderedStrokeSequence.
 * Transforms spatial ordering into time-anchored start/duration/end schedules with
 * physical duration modeling, controlled overlap, and dependency constraints.
 */
export function createStrokeTimeline(
  sequence: OrderedStrokeSequence,
  userConfig?: Partial<TimelineConfig>
): StrokeTimeline {
  const startTime = performance.now();
  const config: TimelineConfig = {
    ...DEFAULT_TIMELINE_CONFIG,
    ...userConfig
  };

  const drawableStrokes = sequence.strokes;

  // 1. Build natural physical schedule
  const natural = buildNaturalSchedule(drawableStrokes, config);

  // 2. Normalize towards target duration if specified
  const normalized = normalizeSchedule(
    natural.strokes,
    natural.naturalDurationMs,
    config
  );

  const finalStrokes = normalized.strokes;
  const totalDurationMs = normalized.finalDurationMs;

  // 3. Compute detailed metrics
  let totalDurationSum = 0;
  let minStrokeDurationMs = finalStrokes.length > 0 ? Infinity : 0;
  let maxStrokeDurationMs = 0;

  for (const s of finalStrokes) {
    totalDurationSum += s.durationMs;
    if (s.durationMs < minStrokeDurationMs) minStrokeDurationMs = s.durationMs;
    if (s.durationMs > maxStrokeDurationMs) maxStrokeDurationMs = s.durationMs;
  }

  const averageStrokeDurationMs = finalStrokes.length > 0
    ? Math.round(totalDurationSum / finalStrokes.length)
    : 0;

  const maxConcurrency = calculateMaxConcurrency(finalStrokes);
  const latencyMs = Math.round((performance.now() - startTime) * 100) / 100;

  const metrics: TimelineMetrics = {
    totalStrokes: finalStrokes.length,
    naturalDurationMs: natural.naturalDurationMs,
    targetDurationMs: config.targetDurationMs,
    finalDurationMs: totalDurationMs,
    averageStrokeDurationMs,
    minStrokeDurationMs: minStrokeDurationMs === Infinity ? 0 : minStrokeDurationMs,
    maxStrokeDurationMs,
    maxConcurrency,
    averageOverlapMs: natural.averageOverlapMs,
    constrainedDependencyCount: natural.constrainedDependencyCount,
    generationLatencyMs: latencyMs
  };

  const timeline: StrokeTimeline = {
    version: TIMELINE_ENGINE_VERSION,
    strokes: finalStrokes,
    totalDurationMs,
    naturalDurationMs: natural.naturalDurationMs,
    targetDurationMs: config.targetDurationMs,
    bounds: sequence.bounds,
    metrics,
    timestamp: Date.now()
  };

  // 4. Validate output integrity
  const validation = validateStrokeTimeline(timeline);
  if (!validation.valid) {
    throw new Error(
      `Timeline validation failed:\n${validation.errors.join('\n')}`
    );
  }

  return timeline;
}
