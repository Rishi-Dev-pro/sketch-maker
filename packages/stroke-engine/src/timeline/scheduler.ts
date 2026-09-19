import {
  OrderedStroke,
  TimelineConfig,
  TimelineStroke
} from './timeline-types';
import { calculateStrokeDuration } from './duration-model';
import { getAllowableOverlapRatio } from './phase-timing';
import {
  calculateDependencyEarliestStart,
  ScheduledStrokeInfo
} from './dependencies';

export interface NaturalScheduleResult {
  readonly strokes: TimelineStroke[];
  readonly naturalDurationMs: number;
  readonly constrainedDependencyCount: number;
  readonly averageOverlapMs: number;
}

/**
 * Builds the natural progressive drawing schedule for an array of OrderedStrokes.
 * Applies physical duration modeling, controlled overlap staggering, and dependency constraints.
 */
export function buildNaturalSchedule(
  orderedStrokes: OrderedStroke[],
  config: TimelineConfig
): NaturalScheduleResult {
  if (orderedStrokes.length === 0) {
    return {
      strokes: [],
      naturalDurationMs: 0,
      constrainedDependencyCount: 0,
      averageOverlapMs: 0
    };
  }

  const scheduledInfo: ScheduledStrokeInfo[] = [];
  let totalOverlapMs = 0;
  let overlapCount = 0;
  let constrainedDependencyCount = 0;

  const partialStrokes: {
    stroke: OrderedStroke;
    timelineIndex: number;
    startTimeMs: number;
    durationMs: number;
    endTimeMs: number;
    overlapMs: number;
    dependencyDelayMs: number;
  }[] = [];

  for (let i = 0; i < orderedStrokes.length; i++) {
    const orderedStroke = orderedStrokes[i];
    const durationMs = calculateStrokeDuration(orderedStroke, config);

    let startTimeMs = 0;
    let overlapMs = 0;
    let dependencyDelayMs = 0;

    if (i > 0) {
      const prevInfo = scheduledInfo[i - 1];

      if (config.allowOverlap) {
        const overlapRatio = getAllowableOverlapRatio(
          prevInfo.stroke.phase,
          orderedStroke.phase,
          config
        );
        overlapMs = Math.min(
          config.maxOverlapMs,
          Math.round(prevInfo.durationMs * overlapRatio)
        );
        startTimeMs = Math.max(0, prevInfo.endTimeMs - overlapMs);
      } else {
        startTimeMs = prevInfo.endTimeMs;
        overlapMs = 0;
      }

      // Enforce structural dependency constraints
      const depConstraint = calculateDependencyEarliestStart(
        orderedStroke,
        scheduledInfo,
        config
      );

      if (depConstraint.earliestStartMs > startTimeMs) {
        dependencyDelayMs = depConstraint.earliestStartMs - startTimeMs;
        startTimeMs = depConstraint.earliestStartMs;
        constrainedDependencyCount++;
      }

      if (overlapMs > 0) {
        totalOverlapMs += overlapMs;
        overlapCount++;
      }
    }

    const endTimeMs = startTimeMs + durationMs;

    const info: ScheduledStrokeInfo = {
      stroke: orderedStroke,
      startTimeMs,
      durationMs,
      endTimeMs
    };
    scheduledInfo.push(info);

    partialStrokes.push({
      stroke: orderedStroke,
      timelineIndex: i,
      startTimeMs,
      durationMs,
      endTimeMs,
      overlapMs,
      dependencyDelayMs
    });
  }

  const naturalDurationMs = partialStrokes.reduce(
    (max, s) => Math.max(max, s.endTimeMs),
    0
  );

  const averageOverlapMs = overlapCount > 0 ? Math.round(totalOverlapMs / overlapCount) : 0;

  // Finalize TimelineStroke contracts with normalized startProgress and endProgress
  const strokes: TimelineStroke[] = partialStrokes.map((p) => {
    const startProgress = naturalDurationMs > 0 ? p.startTimeMs / naturalDurationMs : 0;
    const endProgress = naturalDurationMs > 0 ? p.endTimeMs / naturalDurationMs : 1;

    return {
      stroke: p.stroke,
      timelineIndex: p.timelineIndex,
      startTimeMs: p.startTimeMs,
      durationMs: p.durationMs,
      endTimeMs: p.endTimeMs,
      startProgress: Math.min(1.0, Math.max(0.0, startProgress)),
      endProgress: Math.min(1.0, Math.max(0.0, endProgress)),
      easing: config.defaultEasing,
      phase: p.stroke.phase,
      metadata: {
        naturalDurationMs: p.durationMs,
        overlapMs: p.overlapMs,
        dependencyDelayMs: p.dependencyDelayMs,
        schedulingReason: p.stroke.orderingReason
      }
    };
  });

  return {
    strokes,
    naturalDurationMs,
    constrainedDependencyCount,
    averageOverlapMs
  };
}
