import {
  StrokeTimeline,
  TimelineStroke,
  TimelineStrokeState,
  TimelineState
} from './timeline-types';
import { applyEasing } from './easing';

/**
 * Calculates the real-time execution state and eased progress of an individual TimelineStroke
 * at a given timestamp in milliseconds.
 */
export function getStrokeProgress(
  timelineStroke: TimelineStroke,
  timeMs: number
): { progress: number; state: 'pending' | 'drawing' | 'complete' } {
  const { startTimeMs, durationMs, endTimeMs, easing } = timelineStroke;

  if (timeMs <= startTimeMs) {
    return { progress: 0.0, state: 'pending' };
  }

  if (timeMs >= endTimeMs) {
    return { progress: 1.0, state: 'complete' };
  }

  if (durationMs <= 0) {
    return { progress: 1.0, state: 'complete' };
  }

  const localLinearProgress = Math.min(
    1.0,
    Math.max(0.0, (timeMs - startTimeMs) / durationMs)
  );
  const easedProgress = applyEasing(localLinearProgress, easing);

  return {
    progress: easedProgress,
    state: 'drawing'
  };
}

/**
 * Pure, deterministic query function determining the complete state of the progressive artwork
 * at any arbitrary timestamp t in milliseconds.
 *
 * Automatically handles seeking, scrubbing, and out-of-bounds timestamps (clamped to [0, totalDurationMs]).
 */
export function getTimelineState(
  timeline: StrokeTimeline,
  timeMs: number
): TimelineState {
  const totalDuration = timeline.totalDurationMs;
  const clampedTimeMs = Math.min(totalDuration, Math.max(0, timeMs));

  const overallProgress = totalDuration > 0
    ? Math.min(1.0, Math.max(0.0, clampedTimeMs / totalDuration))
    : 1.0;

  const strokeStates: TimelineStrokeState[] = [];
  let activeCount = 0;
  let completedCount = 0;
  let pendingCount = 0;

  for (let i = 0; i < timeline.strokes.length; i++) {
    const s = timeline.strokes[i];
    const { progress, state } = getStrokeProgress(s, clampedTimeMs);

    if (state === 'drawing') {
      activeCount++;
    } else if (state === 'complete') {
      completedCount++;
    } else {
      pendingCount++;
    }

    strokeStates.push({
      strokeId: s.stroke.stroke.id,
      sequenceIndex: s.stroke.sequenceIndex,
      timelineIndex: s.timelineIndex,
      progress,
      state
    });
  }

  return {
    timeMs: clampedTimeMs,
    overallProgress,
    strokes: strokeStates,
    activeCount,
    completedCount,
    pendingCount,
    totalStrokes: timeline.strokes.length
  };
}
