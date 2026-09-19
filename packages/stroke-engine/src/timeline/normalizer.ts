import {
  TimelineConfig,
  TimelineStroke
} from './timeline-types';

export interface NormalizationResult {
  readonly strokes: TimelineStroke[];
  readonly finalDurationMs: number;
}

/**
 * Scales a natural progressive drawing schedule towards a requested target duration.
 * Preserves relative timing proportions while respecting per-stroke physical min/max clamps
 * and structural dependency constraints.
 */
export function normalizeSchedule(
  naturalStrokes: TimelineStroke[],
  naturalDurationMs: number,
  config: TimelineConfig
): NormalizationResult {
  if (
    !config.targetDurationMs ||
    config.targetDurationMs <= 0 ||
    naturalStrokes.length === 0 ||
    naturalDurationMs <= 0
  ) {
    return {
      strokes: naturalStrokes,
      finalDurationMs: naturalDurationMs
    };
  }

  const targetMs = config.targetDurationMs;
  const scale = targetMs / naturalDurationMs;

  const scaledStrokes: TimelineStroke[] = [];
  const scheduledMap = new Map<string, { startTimeMs: number; durationMs: number; endTimeMs: number }>();

  for (let i = 0; i < naturalStrokes.length; i++) {
    const natural = naturalStrokes[i];

    // Scale duration while respecting hard physical clamps
    const rawScaledDuration = Math.round(natural.durationMs * scale);
    const durationMs = Math.min(
      config.maxStrokeDurationMs,
      Math.max(config.minStrokeDurationMs, rawScaledDuration)
    );

    let startTimeMs = 0;

    if (i > 0) {
      const prev = scaledStrokes[i - 1];
      const prevNatural = naturalStrokes[i - 1];

      if (config.allowOverlap && natural.metadata?.overlapMs) {
        const scaledOverlap = Math.min(
          config.maxOverlapMs,
          Math.round(natural.metadata.overlapMs * scale)
        );
        startTimeMs = Math.max(0, prev.endTimeMs - scaledOverlap);
      } else {
        startTimeMs = prev.endTimeMs;
      }

      // Check if this stroke had a dependency constraint
      if (natural.metadata?.dependencyDelayMs && natural.metadata.dependencyDelayMs > 0) {
        // Enforce parent progress
        for (let pIdx = i - 1; pIdx >= 0; pIdx--) {
          const parentCandidate = scaledStrokes[pIdx];
          if (
            parentCandidate.stroke.stroke.subjectId === natural.stroke.stroke.subjectId &&
            natural.stroke.dependencyLevel > parentCandidate.stroke.dependencyLevel
          ) {
            const minStart = parentCandidate.startTimeMs +
              Math.round(parentCandidate.durationMs * config.minParentProgress);
            if (minStart > startTimeMs) {
              startTimeMs = minStart;
            }
            break;
          }
        }
      }
    }

    const endTimeMs = startTimeMs + durationMs;

    scheduledMap.set(natural.stroke.stroke.id, { startTimeMs, durationMs, endTimeMs });

    scaledStrokes.push({
      stroke: natural.stroke,
      timelineIndex: i,
      startTimeMs,
      durationMs,
      endTimeMs,
      startProgress: 0, // Assigned after total calculation
      endProgress: 0,   // Assigned after total calculation
      easing: natural.easing,
      phase: natural.phase,
      metadata: {
        ...natural.metadata,
        naturalDurationMs: natural.durationMs
      }
    });
  }

  const finalDurationMs = scaledStrokes.reduce(
    (max, s) => Math.max(max, s.endTimeMs),
    0
  );

  // Recompute normalized progress bounds [0.0, 1.0] relative to final total duration
  const normalizedStrokes = scaledStrokes.map((s) => ({
    ...s,
    startProgress: finalDurationMs > 0 ? Math.min(1.0, Math.max(0.0, s.startTimeMs / finalDurationMs)) : 0,
    endProgress: finalDurationMs > 0 ? Math.min(1.0, Math.max(0.0, s.endTimeMs / finalDurationMs)) : 1
  }));

  return {
    strokes: normalizedStrokes,
    finalDurationMs
  };
}
